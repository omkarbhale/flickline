import { SKILL_IDS, type SkillId } from '../config/dial';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import { SkillState, type SkillSnapshot } from '../adaptive/skillModel';
import { sanitizePlayLog } from '../settings/playLog';
import type { RunEndReason } from '../sim/runEvents';

/**
 * # The save object (design §14.5)
 *
 * Everything the player has earned, as plain JSON-safe data: the skill posteriors (`ratings`), rank
 * state, personal bests per (mode, dial band), medals, the last 200 runs as summaries, and the
 * counters the menu reads. There is **no time-played counter and no XP anywhere in it**: nothing
 * rewards time spent (design §2, §8.4), and a test walks a populated save to keep it so.
 *
 * Versions: `SAVE_VERSION` is the version of this object, in `localStorage` and in the export file
 * alike. Each version bump adds one entry to `MIGRATIONS` (version N -> N + 1), and `migrateSave`
 * walks them, so any older save loads. Version 1 was the #182 export file (settings, profile and
 * a play log of bests and run counts).
 *
 * The settings and the profile keep their own stores and keys (live apply, #54 §5.6); the export file
 * (`settings/saveData.ts`) wraps them around this object. Daily Baseline records and reference
 * check-ins (design §8.5, #151, #154) have their slots here as capped lists of plain objects, so those
 * features need no migration to start storing.
 *
 * Pure: no DOM, no clock (the caller reads dates), no randomness.
 */
export const SAVE_VERSION = 2;

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
 * A personal best: the run that set it, and its cumulative score once per `curveStepSec`
 * (`curve[k]` = the score `k` steps into the run) so the ghost-pace bar can compare live.
 */
export interface BestRecord {
  score: number;
  seed: number;
  date: string;
  dial: number;
  stats: RunStatsSummary;
  curve: number[];
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
  /** mode id -> dial band id -> best. */
  bests: Record<string, Record<string, BestRecord>>;
  medals: Record<string, MedalRecord>;
  /** Newest last. */
  history: RunSummary[];
  /** Finished runs per mode id (the "favourite" signal; not time). */
  plays: Record<string, number>;
  /** The skill of the last "one thing to fix", or null. */
  flaggedSkill: SkillId | null;
  /** Daily Baseline records and levels, reference check-ins: opaque to this version (#151, #154). */
  baselines: Record<string, unknown>[];
  baselineLevels: Record<string, unknown>;
  checkins: Record<string, unknown>[];
}

export function defaultProgress(): ProgressData {
  return {
    ratings: null, ranks: {}, bests: {}, medals: {}, history: [], plays: {}, flaggedSkill: null,
    baselines: [], baselineLevels: {}, checkins: [],
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

function sanitizeBest(raw: unknown, cfg: ProgressTunables): BestRecord | null {
  if (!isRec(raw)) return null;
  const score = numOrNull(raw.score, 0, 1e9);
  if (score === null || score <= 0) return null;
  const curve: number[] = [];
  if (Array.isArray(raw.curve)) {
    for (const v of raw.curve.slice(0, cfg.curveMaxSamples)) curve.push(Math.round(num(v, 0, 1e9, 0)));
  }
  return {
    score: Math.round(score),
    seed: Math.floor(num(raw.seed, 0, 0xffffffff, 0)),
    date: str(raw.date, 40),
    dial: num(raw.dial, 0, 100, 0),
    stats: sanitizeStats(raw.stats),
    curve,
  };
}

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

  const bests = section(raw, 'bests', 'object') as Rec | undefined;
  if (bests) {
    const bandIds = cfg.bands.map((b) => b.id);
    for (const mode of Object.keys(bests).slice(0, cfg.maxModes)) {
      const bands = bests[mode];
      if (!isRec(bands)) continue;
      for (const band of bandIds) {
        const b = sanitizeBest(bands[band], cfg);
        if (b) (out.bests[mode] ??= {})[band] = b;
      }
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

  out.baselines = plainObjects(section(raw, 'baselines', 'array'), cfg.maxBaselines);
  const levels = section(raw, 'baselineLevels', 'object');
  out.baselineLevels = levels ? (JSON.parse(JSON.stringify(levels)) as Rec) : {};
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
