import { coldOpener as coldCfg, type ColdOpenerTunables } from '../config/coldOpener';
import type { SkillEstimate } from '../adaptive/coldScore';

/**
 * # Cold-opener records, levels and the trend (design §8.5, `docs/research/transfer.md` §5.3, §5.6)
 *
 * What the save keeps of each cold opener (`ProgressData.coldOpeners`, compact plain objects), the
 * player's level (`coldOpenerLevels`), and the verdict over the valid ones. Pure: dates come from the
 * caller.
 *
 * - **Valid** for the trend: the current content version, not warm, the first cold opener of its local
 *   date, and at least one trial.
 * - **Level**: the first from the matched dial (`coldLevelFor`); it moves up when contacts won exceed
 *   `upAbove` in `moveOf` of the last `moveWindow` valid cold openers at the level, down below `downBelow`.
 * - **Verdict**: the mean of the last `k` valid cold scores against the `k` before, beyond a band from the
 *   player's own day-to-day spread (`coldTrend`).
 */

/** One cold opener as the save keeps it. Dial-scale numbers unless named otherwise. */
export interface ColdOpenerRecord {
  /** Content version (`coldOpener.version`) it was played on. */
  v: number;
  /** Local date (`YYYY-MM-DD`) and ISO date-time it ended. */
  date: string;
  at: string;
  /** Hours since the player's previous finished run or cold opener (null: none before), for transfer.md H1. */
  gapH: number | null;
  seed: number;
  level: number;
  /** Legs finished, of the legs planned (fewer after a death inside it). */
  legs: number;
  of: number;
  /** The cold score (rating scale) and the mean estimate it is made from (dial scale). */
  score: number;
  dial: number;
  /** Skill -> [posterior mean, s.d., trials] of its flat-prior estimate. */
  skills: Record<string, [number, number, number]>;
  trials: number;
  /** Raw facts, comparable within a level (design §8.5). */
  contacts: number;
  won: number;
  /** First-bullet headshot kills ÷ Echoes engaged; null without any. */
  headRate: number | null;
  /** Median time to shot, ms; null without a sample. */
  ttsMs: number | null;
  /** Moving shots ÷ shots; null without a shot. */
  movingShare: number | null;
  /** Health+shield at the end ÷ at the start (0 after a death in it). */
  kept: number;
  /** Answered "Aimed in any game in the last hour?" with yes: left out of the trend. */
  warm: boolean;
  /** Sensitivity it was played at (a change is marked on the trend, transfer.md §5.8). */
  sens: number;
  /** How it ended. */
  end: 'exit' | 'death';
}

/** The player's level and its history (`ProgressData.coldOpenerLevels`). */
export interface ColdLevelState {
  /** Content version the level belongs to (a new version starts a new series, and a new first level). */
  v: number;
  level: number;
  /** Every move, newest last: the date and the levels. */
  moves: { date: string; from: number; to: number }[];
}

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const numOr = (x: unknown, d: number | null): number | null => (finite(x) ? x : d);

/** A stored record read back, or null when it is not one (a hand-edited or foreign object is skipped, never trusted). */
export function readColdRecord(raw: unknown): ColdOpenerRecord | null {
  if (!isRec(raw)) return null;
  const r = raw;
  if (!finite(r.v) || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !finite(r.level) || !finite(r.dial) || !finite(r.score)) return null;
  const skills: Record<string, [number, number, number]> = {};
  if (isRec(r.skills)) {
    for (const k of Object.keys(r.skills)) {
      const e = r.skills[k];
      if (Array.isArray(e) && e.length === 3 && e.every(finite)) skills[k] = [e[0], e[1], e[2]];
    }
  }
  return {
    v: r.v,
    date: r.date,
    at: typeof r.at === 'string' ? r.at.slice(0, 40) : '',
    gapH: numOr(r.gapH, null),
    seed: finite(r.seed) ? r.seed : 0,
    level: r.level,
    legs: finite(r.legs) ? r.legs : 0,
    of: finite(r.of) ? r.of : 0,
    score: r.score,
    dial: r.dial,
    skills,
    trials: finite(r.trials) ? r.trials : 0,
    contacts: finite(r.contacts) ? r.contacts : 0,
    won: finite(r.won) ? r.won : 0,
    headRate: numOr(r.headRate, null),
    ttsMs: numOr(r.ttsMs, null),
    movingShare: numOr(r.movingShare, null),
    kept: finite(r.kept) ? r.kept : 0,
    warm: r.warm === true,
    sens: finite(r.sens) ? r.sens : 0,
    end: r.end === 'death' ? 'death' : 'exit',
  };
}

/** Every readable record, oldest first. */
export function readColdRecords(list: readonly unknown[]): ColdOpenerRecord[] {
  const out: ColdOpenerRecord[] = [];
  for (const raw of list) {
    const r = readColdRecord(raw);
    if (r) out.push(r);
  }
  return out;
}

/** The stored level state, or null when there is none for `version`. */
export function readColdLevel(raw: unknown, version: number): ColdLevelState | null {
  if (!isRec(raw) || raw.v !== version || !finite(raw.level)) return null;
  const moves: ColdLevelState['moves'] = [];
  if (Array.isArray(raw.moves)) {
    for (const m of raw.moves) if (isRec(m) && typeof m.date === 'string' && finite(m.from) && finite(m.to)) moves.push({ date: m.date, from: m.from, to: m.to });
  }
  return { v: version, level: raw.level, moves };
}

/** Per-skill estimates as the record stores them (rounded). */
export function packSkills(skills: Readonly<Record<string, SkillEstimate>>): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  for (const k of Object.keys(skills)) {
    const e = skills[k]!;
    out[k] = [Math.round(e.mean * 100) / 100, Math.round(e.sd * 100) / 100, e.n];
  }
  return out;
}

/**
 * Which records count for the trend (transfer.md §5.6): current version, not warm, at least one trial,
 * and only the first of each local date. Same order and length as `records`.
 */
export function validMask(records: readonly ColdOpenerRecord[], version: number = coldCfg.version): boolean[] {
  const seen = new Set<string>();
  return records.map((r) => {
    if (r.v !== version) return false;
    const first = !seen.has(r.date);
    seen.add(r.date);
    return first && !r.warm && r.trials > 0;
  });
}

/** The valid records, oldest first. */
export function validRecords(records: readonly ColdOpenerRecord[], version: number = coldCfg.version): ColdOpenerRecord[] {
  const mask = validMask(records, version);
  return records.filter((_, i) => mask[i]);
}

/**
 * The level after the valid records so far at it (design §8.5: "3 of 5 above 85% or below 35% contacts
 * won"): `recent` are the valid records played at `level` since its last move, oldest first. Returns
 * the new level (the same when it does not move). Levels are `cfg.levels`; the ends stay put.
 */
export function nextColdLevel(level: number, recent: readonly Pick<ColdOpenerRecord, 'won' | 'contacts'>[], cfg: ColdOpenerTunables = coldCfg): number {
  const window = recent.slice(-cfg.moveWindow);
  let up = 0, down = 0;
  for (const r of window) {
    if (r.contacts <= 0) continue;
    const rate = r.won / r.contacts;
    if (rate > cfg.upAbove) up++;
    if (rate < cfg.downBelow) down++;
  }
  const i = cfg.levels.indexOf(level);
  if (i < 0) return level;
  if (up >= cfg.moveOf && i + 1 < cfg.levels.length) return cfg.levels[i + 1]!;
  if (down >= cfg.moveOf && i > 0) return cfg.levels[i - 1]!;
  return level;
}

/**
 * The level state after a new record (already appended to `records`): the record counts only when
 * valid, and only the valid records at the level since its last move are read. Returns a new state.
 */
export function stepColdLevel(state: ColdLevelState, records: readonly ColdOpenerRecord[], cfg: ColdOpenerTunables = coldCfg): ColdLevelState {
  const valid = validRecords(records, state.v);
  const last = records[records.length - 1];
  if (!last || valid[valid.length - 1] !== last) return state;
  const since = state.moves.length > 0 ? state.moves[state.moves.length - 1]!.date : '';
  // Records at the level since its last move (a record of the move's own date was played before it moved).
  const recent = valid.filter((r) => r.level === state.level && r.date > since);
  const to = nextColdLevel(state.level, recent, cfg);
  if (to === state.level) return state;
  return { v: state.v, level: to, moves: [...state.moves, { date: last.date, from: state.level, to }] };
}

export type ColdVerdict = 'none' | 'Improved' | 'Steady' | 'Lower';

export interface ColdTrend {
  verdict: ColdVerdict;
  /** Valid cold openers in the series. */
  n: number;
  /** Window size, the two window means and their difference (dial scale), and the band (±). */
  k: number;
  recent: number;
  before: number;
  delta: number;
  band: number;
  /** The day-to-day spread the band is made from (dial points). */
  sigma: number;
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The raw comparison over `xs` (no confirmation). */
function compare(xs: readonly number[], t: ColdOpenerTunables['trend']): ColdTrend {
  const n = xs.length;
  const k = Math.min(t.kMax, Math.floor(n / 2));
  if (n < t.minValid || k < t.kMin) return { verdict: 'none', n, k, recent: Number.NaN, before: Number.NaN, delta: Number.NaN, band: Number.NaN, sigma: Number.NaN };
  const recent = mean(xs.slice(n - k));
  const before = mean(xs.slice(n - 2 * k, n - k));
  // Day-to-day spread from successive differences, so a steady trend does not inflate it (transfer.md §5.6).
  let sigma = t.sigmaDefault;
  if (n >= t.sigmaFromN) {
    let ss = 0;
    for (let i = 1; i < n; i++) ss += (xs[i]! - xs[i - 1]!) ** 2;
    sigma = Math.sqrt(ss / (n - 1) / 2);
  }
  const band = t.z * sigma * Math.sqrt(2 / k);
  const delta = recent - before;
  const verdict: ColdVerdict = delta > band ? 'Improved' : delta < -band ? 'Lower' : 'Steady';
  return { verdict, n, k, recent, before, delta, band, sigma };
}

/**
 * The verdict over a series of valid cold scores (dial scale, oldest first): "Improved" only beyond the
 * band, otherwise "Steady" or "Lower"; `none` before `minValid` valid cold openers. With `confirm`, a
 * verdict other than Steady also needs the series without its newest point to say the same, so one
 * lucky or unlucky day cannot flip it.
 */
export function coldTrend(xs: readonly number[], cfg: ColdOpenerTunables = coldCfg): ColdTrend {
  const t = cfg.trend;
  const now = compare(xs, t);
  if (!t.confirm || now.verdict === 'none' || now.verdict === 'Steady') return now;
  const prev = compare(xs.slice(0, -1), t);
  return prev.verdict === now.verdict ? now : { ...now, verdict: 'Steady' };
}

/** What one cold opener produced: the facts its tally collected and how it ended. */
export interface ColdOutcome {
  version: number;
  seed: number;
  level: number;
  legs: number;
  of: number;
  trials: readonly { skill: string; itemDifficulty: number; success: boolean }[];
  contacts: number;
  won: number;
  firstBulletHeads: number;
  engaged: number;
  ttsMs: readonly number[];
  shots: number;
  movingShots: number;
  kept: number;
  end: 'exit' | 'death';
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

const r3 = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * The record of a cold opener: its estimate (`score` from `adaptive/coldScore.ts`), raw facts and
 * context. `date` is the local date key and `at` the ISO time it ended; `gapH` the hours since the
 * previous finished run or cold opener.
 */
export function buildColdRecord(
  o: ColdOutcome,
  score: { skills: Readonly<Record<string, SkillEstimate>>; dial: number; score: number; trials: number },
  when: { date: string; at: string; gapH: number | null; sens: number },
): ColdOpenerRecord {
  return {
    v: o.version,
    date: when.date,
    at: when.at,
    gapH: when.gapH === null ? null : Math.round(when.gapH * 100) / 100,
    seed: o.seed,
    level: o.level,
    legs: o.legs,
    of: o.of,
    score: Number.isFinite(score.score) ? score.score : 0,
    dial: Number.isFinite(score.dial) ? Math.round(score.dial * 100) / 100 : 0,
    skills: packSkills(score.skills),
    trials: score.trials,
    contacts: o.contacts,
    won: o.won,
    headRate: o.engaged > 0 ? r3(o.firstBulletHeads / o.engaged) : null,
    ttsMs: median(o.ttsMs),
    movingShare: o.shots > 0 ? r3(o.movingShots / o.shots) : null,
    kept: r3(o.kept),
    warm: false,
    sens: when.sens,
    end: o.end,
  };
}

/**
 * The level state recomputed from every record (after a record's warm answer changed, which can change
 * what counted): from the level the series started at, stepping record by record.
 */
export function replayColdLevel(state: ColdLevelState, records: readonly ColdOpenerRecord[], cfg: ColdOpenerTunables = coldCfg): ColdLevelState {
  let s: ColdLevelState = { v: state.v, level: state.moves.length > 0 ? state.moves[0]!.from : state.level, moves: [] };
  for (let i = 0; i < records.length; i++) s = stepColdLevel(s, records.slice(0, i + 1), cfg);
  return s;
}
