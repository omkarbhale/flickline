import { SKILL_IDS, type SkillId } from '../config/dial';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import { SkillState, type SkillSnapshot } from '../adaptive/skillModel';
import { sanitizePlayLog } from '../settings/playLog';
import type { RunEndReason } from '../sim/runEvents';

/**
 * # The save object (design §14.5)
 *
 * Everything the player has earned, as plain JSON-safe data: the skill posteriors (`ratings`), rank
 * state, run bests per dial band (`runBests`, with the Daily Route's best per date in `dailyBests`),
 * situation records per scenario card (`situations`), medals, the last 200 runs as summaries, and the
 * counters the menu reads. There is **no time-played counter and no XP anywhere in it**: nothing
 * rewards time spent (design §2, §8.4), and a test walks a populated save to keep it so.
 *
 * Versions: `SAVE_VERSION` is the version of this object, in `localStorage` and in the export file
 * alike. Each version bump adds one entry to `MIGRATIONS` (version N -> N + 1), and `migrateSave`
 * walks them, so any older save loads. Version 1 was the #182 export file (settings, profile and
 * a play log of bests and run counts); version 2 kept drill bests per mode and dial band; version 3 (#217)
 * moves to run bests per dial band and keeps the drill bests read-only as `drillBests`.
 *
 * The settings and the profile keep their own stores and keys (live apply, #54 §5.6); the export file
 * (`settings/saveData.ts`) wraps them around this object. Cold-opener records and levels and reference
 * check-ins (design §8.5, #209, #151, #154) have their slots here as capped lists of plain objects, so those
 * features need no migration to start storing.
 *
 * Pure: no DOM, no clock (the caller reads dates), no randomness.
 */
export const SAVE_VERSION = 3;

/** The numbers kept with a run in the history and with a personal best. */
export interface RunStatsSummary {
  shots: number;
  hits: number;
  headHits: number;
  kills: number;
  movingShots: number;
  /** 0..1, or null where the run had no sample (never a fake zero). */
  accuracy: number | null;
  headshotRate: number | null;
  /** Medians in ms. */
  medianRtMs: number | null;
  medianTtkMs: number | null;
  maxChain: number;
  cleanKills: number;
}

/** One finished run, summary only (the history keeps the last `historyMax`). */
export interface RunSummary extends RunStatsSummary {
  mode: string;
  seed: number;
  /** The dial the run started at (the one its band and its card use). */
  dial: number;
  /** ISO date-time the run ended, read from the caller's clock. */
  date: string;
  reason: RunEndReason;
  score: number;
  /** Ids of the medals earned in it. */
  medals: string[];
}

/**
 * A drill's personal best as version 2 kept it (one per mode and dial band). Drills are no longer a thing a
 * player chooses (design §4.10), so these are **read-only history**: nothing writes them after the v2 -> v3
 * migration, and the menu still shows them for the modes that remain. (The ghost's 1 s score curve is dropped:
 * the pace bar compares against the best run's sectors now.)
 */
export interface DrillBest {
  score: number;
  seed: number;
  date: string;
  dial: number;
  stats: RunStatsSummary;
}

/**
 * One sector of a run as the route strip shows it (design §8.2 item 2): its role, condition and door stake,
 * the contacts won and lost in it, health+shield at the entry and at the exit, and the gold Flawless mark.
 */
export interface RouteTile {
  /** 1-based sector number (7+ = Overtime). */
  index: number;
  role: string;
  condition: string;
  stake: string;
  won: number;
  lost: number;
  hpIn: number;
  hpOut: number;
  /** Every Echo of the sector dead and the player alive. */
  cleared: boolean;
  /** No miss and no moving shot in the sector (the Flawless medal; the gold mark). */
  flawless: boolean;
}

/**
 * A run the player can chase (design §8.4): the score it banked, how far it got, the seed that replays it, the
 * route strip, and `pace` for the pace bar: the run's total score at the end of each sector (`pace[0]` after
 * sector 1), so the next run compares at the same sector (design §7.2).
 */
export interface RunBest {
  score: number;
  /** The deepest sector reached (1-based) and how many sectors were cleared; the Finale is cleared at `finaleSector`. */
  depth: number;
  cleared: number;
  seed: number;
  date: string;
  dial: number;
  strip: RouteTile[];
  pace: number[];
}

/** What a dial band remembers (design §8.4): the best run by score, the deepest run, and Finales cleared. */
export interface BandRecords {
  best: RunBest | null;
  /** Deepest sector reached, then most sectors cleared, then score: its depth beyond the Finale is the deepest Overtime. */
  deepest: RunBest | null;
  finalesCleared: number;
}

/** One settled contact kept for the situation records: won (cleared) or not, and the health kept (0..1). */
export interface ContactRecord {
  won: boolean;
  kept: number;
}

/** Rank state of one skill (or `line`): see `progress/ranks.ts`. */
export interface RankEntry {
  /** Committed sub-tier index (tier and division, flat). */
  at: number;
  /** Highest sub-tier ever committed: Ascent is a new peak. */
  peak: number;
  /** Consecutive runs the estimate was above / below `at`, and the most lenient sub-tier it showed in that streak. */
  up: number;
  down: number;
  to: number;
}

export interface MedalRecord {
  count: number;
  /** ISO date-time of the last award. */
  last: string;
}

export interface ProgressData {
  /** The skill model's posterior snapshot (`SkillState.serialize()`), or null before any trial. */
  ratings: SkillSnapshot | null;
  ranks: Record<string, RankEntry>;
  /** Dial band id -> the run records of that band (design §8.4). Starts empty at the v3 migration. */
  runBests: Record<string, BandRecords>;
  /** The Daily Route's best run per local date (`YYYY-MM-DD`), the newest `maxDailyBests` dates (design §4.8). */
  dailyBests: Record<string, RunBest>;
  /** Scenario card id -> its last `situationWindow` settled contacts, newest last (design §8.4). */
  situations: Record<string, ContactRecord[]>;
  /** Drill bests of save v2: mode id -> dial band id -> best. Read-only history. */
  drillBests: Record<string, Record<string, DrillBest>>;
  medals: Record<string, MedalRecord>;
  /** Newest last. */
  history: RunSummary[];
  /** Finished runs per mode id (the "favourite" signal; not time). */
  plays: Record<string, number>;
  /** The skill of the last "one thing to fix", or null. */
  flaggedSkill: SkillId | null;
  /** Cold-opener records and levels, reference check-ins: opaque to this version (#209, #151, #154). */
  coldOpeners: Record<string, unknown>[];
  coldOpenerLevels: Record<string, unknown>;
  checkins: Record<string, unknown>[];
}

export function defaultProgress(): ProgressData {
  return {
    ratings: null, ranks: {}, runBests: {}, dailyBests: {}, situations: {}, drillBests: {}, medals: {}, history: [],
    plays: {}, flaggedSkill: null, coldOpeners: [], coldOpenerLevels: {}, checkins: [],
  };
}

// ---------------------------------------------------------------- sanitising

/** A save part with the wrong shape: the whole save is refused (so nothing is half-imported). */
export class SaveError extends Error {}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

function numOrNull(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
}

function str(v: unknown, max = 64): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function section(raw: Rec, key: string, kind: 'object' | 'array'): unknown {
  const v = raw[key];
  if (v === undefined || v === null) return undefined;
  if (kind === 'array' ? !Array.isArray(v) : !isRec(v)) throw new SaveError(`The save's "${key}" is not valid.`);
  return v;
}

function sanitizeStats(raw: unknown): RunStatsSummary {
  const r = isRec(raw) ? raw : {};
  const int = (k: string): number => Math.floor(num(r[k], 0, 1e6, 0));
  return {
    shots: int('shots'), hits: int('hits'), headHits: int('headHits'), kills: int('kills'),
    movingShots: int('movingShots'),
    accuracy: numOrNull(r.accuracy, 0, 1), headshotRate: numOrNull(r.headshotRate, 0, 1),
    medianRtMs: numOrNull(r.medianRtMs, 0, 1e5), medianTtkMs: numOrNull(r.medianTtkMs, 0, 1e5),
    maxChain: int('maxChain'), cleanKills: int('cleanKills'),
  };
}

const REASONS: readonly RunEndReason[] = ['timer', 'death', 'complete', 'quit', 'left'];

function sanitizeRun(raw: unknown): RunSummary | null {
  if (!isRec(raw) || typeof raw.mode !== 'string' || raw.mode === '') return null;
  const score = numOrNull(raw.score, 0, 1e9);
  if (score === null) return null;
  const reason = REASONS.find((r) => r === raw.reason) ?? 'timer';
  return {
    ...sanitizeStats(raw),
    mode: raw.mode.slice(0, 64),
    seed: Math.floor(num(raw.seed, 0, 0xffffffff, 0)),
    dial: num(raw.dial, 0, 100, 0),
    date: str(raw.date, 40),
    reason,
    score: Math.round(score),
    medals: Array.isArray(raw.medals) ? raw.medals.filter((m): m is string => typeof m === 'string').slice(0, 16).map((m) => m.slice(0, 32)) : [],
  };
}

function sanitizeDrillBest(raw: unknown): DrillBest | null {
  if (!isRec(raw)) return null;
  const score = numOrNull(raw.score, 0, 1e9);
  if (score === null || score <= 0) return null;
  return {
    score: Math.round(score),
    seed: Math.floor(num(raw.seed, 0, 0xffffffff, 0)),
    date: str(raw.date, 40),
    dial: num(raw.dial, 0, 100, 0),
    stats: sanitizeStats(raw.stats),
  };
}

function sanitizeTile(raw: unknown): RouteTile | null {
  if (!isRec(raw)) return null;
  const int = (k: string, hi: number): number => Math.floor(num(raw[k], 0, hi, 0));
  return {
    index: Math.max(1, int('index', 99)),
    role: str(raw.role, 24), condition: str(raw.condition, 24), stake: str(raw.stake, 24),
    won: int('won', 99), lost: int('lost', 99),
    hpIn: Math.round(num(raw.hpIn, 0, 1000, 0)), hpOut: Math.round(num(raw.hpOut, 0, 1000, 0)),
    cleared: raw.cleared === true, flawless: raw.flawless === true,
  };
}

function sanitizeRunBest(raw: unknown, cfg: ProgressTunables): RunBest | null {
  if (!isRec(raw)) return null;
  const score = numOrNull(raw.score, 0, 1e9);
  if (score === null || score <= 0) return null;
  const strip: RouteTile[] = [];
  if (Array.isArray(raw.strip)) {
    for (const t of raw.strip.slice(0, cfg.maxStrip)) {
      const tile = sanitizeTile(t);
      if (tile) strip.push(tile);
    }
  }
  const pace: number[] = [];
  if (Array.isArray(raw.pace)) {
    for (const v of raw.pace.slice(0, cfg.maxStrip)) pace.push(Math.round(num(v, 0, 1e9, 0)));
  }
  return {
    score: Math.round(score),
    depth: Math.max(1, Math.floor(num(raw.depth, 1, 99, 1))),
    cleared: Math.floor(num(raw.cleared, 0, 99, 0)),
    seed: Math.floor(num(raw.seed, 0, 0xffffffff, 0)),
    date: str(raw.date, 40),
    dial: num(raw.dial, 0, 100, 0),
    strip,
    pace,
  };
}

function sanitizeBand(raw: unknown, cfg: ProgressTunables): BandRecords | null {
  if (!isRec(raw)) return null;
  const out: BandRecords = {
    best: sanitizeRunBest(raw.best, cfg),
    deepest: sanitizeRunBest(raw.deepest, cfg),
    finalesCleared: Math.floor(num(raw.finalesCleared, 0, 1e6, 0)),
  };
  return out.best === null && out.deepest === null && out.finalesCleared === 0 ? null : out;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeRank(raw: unknown): RankEntry | null {
  if (!isRec(raw)) return null;
  const sub = (v: unknown): number => Math.floor(num(v, 0, 63, 0));
  const at = sub(raw.at);
  return { at, peak: Math.max(at, sub(raw.peak)), up: Math.floor(num(raw.up, 0, 99, 0)), down: Math.floor(num(raw.down, 0, 99, 0)), to: sub(raw.to) };
}

function plainObjects(raw: unknown, max: number): Rec[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRec).slice(-max).map((o) => JSON.parse(JSON.stringify(o)) as Rec);
}

/**
 * Validate and clamp a save object of the current version into `ProgressData`. A part with the wrong
 * top-level shape throws `SaveError` (the caller refuses the whole save and changes nothing); single
 * entries that cannot be read are dropped, and numbers are clamped, so a hand-edited file cannot put the
 * game in a state it could not have reached.
 */
export function sanitizeProgress(raw: unknown, cfg: ProgressTunables = progressCfg): ProgressData {
  if (!isRec(raw)) throw new SaveError('That save is not an object.');
  const out = defaultProgress();

  const ratings = raw.ratings;
  if (ratings !== undefined && ratings !== null) {
    if (SkillState.deserialize(ratings) === null) throw new SaveError('The save\'s ratings are not valid.');
    out.ratings = JSON.parse(JSON.stringify(ratings)) as SkillSnapshot;
  }

  const ranks = section(raw, 'ranks', 'object') as Rec | undefined;
  if (ranks) {
    for (const k of Object.keys(ranks).slice(0, SKILL_IDS.length + 1)) {
      if (k !== 'line' && !(SKILL_IDS as readonly string[]).includes(k)) continue;
      const e = sanitizeRank(ranks[k]);
      if (e) out.ranks[k] = e;
    }
  }

  const bandIds = cfg.bands.map((b) => b.id);
  const drill = section(raw, 'drillBests', 'object') as Rec | undefined;
  if (drill) {
    for (const mode of Object.keys(drill).slice(0, cfg.maxModes)) {
      const bands = drill[mode];
      if (!isRec(bands)) continue;
      for (const band of bandIds) {
        const b = sanitizeDrillBest(bands[band]);
        if (b) (out.drillBests[mode.slice(0, 64)] ??= {})[band] = b;
      }
    }
  }

  const runBests = section(raw, 'runBests', 'object') as Rec | undefined;
  if (runBests) {
    for (const band of bandIds) {
      const r = sanitizeBand(runBests[band], cfg);
      if (r) out.runBests[band] = r;
    }
  }

  const daily = section(raw, 'dailyBests', 'object') as Rec | undefined;
  if (daily) {
    // The newest dates win (a date key sorts as a date).
    for (const day of Object.keys(daily).filter((k) => DATE_KEY.test(k)).sort().slice(-cfg.maxDailyBests)) {
      const b = sanitizeRunBest(daily[day], cfg);
      if (b) out.dailyBests[day] = b;
    }
  }

  const situations = section(raw, 'situations', 'object') as Rec | undefined;
  if (situations) {
    for (const card of Object.keys(situations).slice(0, cfg.maxCards)) {
      const list = situations[card];
      if (!Array.isArray(list)) continue;
      const kept: ContactRecord[] = [];
      for (const c of list.slice(-cfg.situationWindow)) {
        if (!isRec(c)) continue;
        kept.push({ won: c.won === true, kept: Math.round(num(c.kept, 0, 1, 0) * 100) / 100 });
      }
      if (kept.length > 0) out.situations[card.slice(0, 40)] = kept;
    }
  }

  const medals = section(raw, 'medals', 'object') as Rec | undefined;
  if (medals) {
    for (const id of Object.keys(medals).slice(0, 64)) {
      const m = medals[id];
      if (!isRec(m)) continue;
      const count = Math.floor(num(m.count, 0, 1e6, 0));
      if (count > 0) out.medals[id.slice(0, 32)] = { count, last: str(m.last, 40) };
    }
  }

  const history = section(raw, 'history', 'array') as unknown[] | undefined;
  if (history) {
    for (const r of history.slice(-cfg.historyMax)) {
      const run = sanitizeRun(r);
      if (run) out.history.push(run);
    }
  }

  const plays = section(raw, 'plays', 'object') as Rec | undefined;
  if (plays) {
    for (const mode of Object.keys(plays).slice(0, cfg.maxModes)) {
      const n = plays[mode];
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) out.plays[mode.slice(0, 64)] = Math.min(n, 1e7);
    }
  }

  const flagged = raw.flaggedSkill;
  out.flaggedSkill = typeof flagged === 'string' && (SKILL_IDS as readonly string[]).includes(flagged) ? (flagged as SkillId) : null;

  out.coldOpeners = plainObjects(section(raw, 'coldOpeners', 'array'), cfg.maxColdOpeners);
  const levels = section(raw, 'coldOpenerLevels', 'object');
  out.coldOpenerLevels = levels ? (JSON.parse(JSON.stringify(levels)) as Rec) : {};
  out.checkins = plainObjects(section(raw, 'checkins', 'array'), cfg.maxCheckins);
  return out;
}

// ---------------------------------------------------------------- migrations

/** Version N -> N + 1. Each takes a parsed object and returns the next version's, without touching the input. */
export const MIGRATIONS: Record<number, (old: Rec) => Rec> = {
  // v1 (the #182 export file) -> v2: its play log's run counts and flagged skill carry over. Its per-mode
  // best scores did not record the dial, so they cannot be placed in a dial band (design §8.4: bests are per
  // band) and have no score curve for the ghost: they are not carried.
  1: (old) => {
    const next: Rec = { ...old, version: 2 };
    delete next.playLog;
    if (old.playLog !== undefined) {
      const log = sanitizePlayLog(old.playLog);
      next.plays = log.plays;
      next.flaggedSkill = log.flaggedSkill;
    }
    return next;
  },
  // v2 -> v3 (#217, design §14.5): drill bests per mode stop being bests. They are kept as `drillBests`, read-only
  // history (nothing writes them again); `runBests`, `dailyBests` and `situations` start empty, because a drill score
  // says nothing about a run. The empty Daily Baseline slots get their cold-opener names (#209 fills them).
  2: (old) => {
    const next: Rec = { ...old, version: 3 };
    if (old.bests !== undefined) next.drillBests = old.bests;
    delete next.bests;
    if (old.baselines !== undefined) next.coldOpeners = old.baselines;
    delete next.baselines;
    if (old.baselineLevels !== undefined) next.coldOpenerLevels = old.baselineLevels;
    delete next.baselineLevels;
    return next;
  },
};

export type MigrateResult = { ok: true; raw: Rec; from: number } | { ok: false; error: string; newer?: boolean };

/** Bring a parsed save of any known version up to `SAVE_VERSION`. Refuses a missing, invalid or newer version. */
export function migrateSave(raw: unknown): MigrateResult {
  if (!isRec(raw)) return { ok: false, error: 'That save is not an object.' };
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, error: 'That save has no valid version.' };
  if (v > SAVE_VERSION) {
    return { ok: false, error: `That save is from a newer version of Flickline (v${v}); this one reads up to v${SAVE_VERSION}.`, newer: true };
  }
  let cur: Rec = raw;
  for (let n = v; n < SAVE_VERSION; n++) {
    const step = MIGRATIONS[n];
    if (!step) return { ok: false, error: `No migration from save v${n}.` };
    cur = step(cur);
  }
  return { ok: true, raw: cur, from: v };
}

/** Parse and migrate a stored or imported text into data, or say why not. Touches nothing. */
export type ReadResult = { ok: true; data: ProgressData; from: number } | { ok: false; error: string; newer?: boolean };

export function readProgress(text: string, cfg: ProgressTunables = progressCfg): ReadResult {
  if (text.length > cfg.maxSaveBytes) return { ok: false, error: 'That file is too large to be a Flickline save.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a Flickline save (it is not valid JSON).' };
  }
  const m = migrateSave(raw);
  if (!m.ok) return m;
  try {
    return { ok: true, data: sanitizeProgress(m.raw, cfg), from: m.from };
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    throw e;
  }
}

/** The JSON-safe object stored in `localStorage` and embedded in the export file. */
export function toSave(data: ProgressData): Rec & { version: number } {
  return { version: SAVE_VERSION, ...data } as Rec & { version: number };
}
