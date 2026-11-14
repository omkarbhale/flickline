import { coldScore } from '../adaptive/coldScore';
import type { ColdOpenerTunables, ColdPool } from '../config/coldOpener';
import { COLD_POOL } from '../config/coldOpenerPool';
import type { Tunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { firstColdLevel, pickColdOpener } from '../modes/coldOpener';
import {
  buildColdRecord, coldTrend, stepColdLevel, validRecords, type ColdLevelState, type ColdOpenerRecord, type ColdVerdict,
} from '../progress/coldOpeners';

/**
 * The cold opener's bot harness (design §8.5, `docs/research/transfer.md` H2–H5, `replay-not-drills.md`
 * R5, #209). A simulated player of known ability plays one cold opener a day: the day's real pick from
 * the stored pool at its level (one trial per Echo engaged, the item difficulty the level), each trial won
 * with the model's own probability `σ((θ − d)/s)`, a contact won when its Echoes die. The records,
 * levels, validity and verdict are the game's own functions, so the harness measures exactly what the
 * player would be told. Pure and seeded: the same inputs give the same report, in milliseconds.
 */

/** How a simulated player's cold ability moves, and what else it does each day. */
export interface ColdBot {
  /** Cold ability (dial) on day `d` (1-based). */
  theta(day: number): number;
  /** Matched dial its first cold opener's level is read from (its warmed-up matched rating). */
  matched: number;
  /** Days it warmed up elsewhere first and answers the warm question with yes (it plays `warmGain` higher). */
  warmDays?: readonly number[];
  warmGain?: number;
  /** Days it plays a second, already warmed-up cold opener later the same day (not valid: not the first). */
  repeatDays?: readonly number[];
}

export interface ColdDay {
  day: number;
  level: number;
  /** The record's estimate (dial) and the verdict after it. */
  dial: number;
  verdict: ColdVerdict;
  band: number;
  levelMoved: boolean;
}

/** A day as `YYYY-MM-DD` counted from 2026-01-01. */
function dateOf(day: number): string {
  const d = new Date(Date.UTC(2026, 0, day));
  return d.toISOString().slice(0, 10);
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** One cold opener played by a bot of cold ability `theta` at `level` on run seed `seed`. */
export function playColdOpener(t: Tunables, rng: Rng, theta: number, level: number, seed: number, date: string, pool: ColdPool = COLD_POOL): ColdOpenerRecord {
  const cfg = t.coldOpener;
  const pick = pickColdOpener(seed, level, pool, cfg);
  const trials: { skill: string; itemDifficulty: number; success: boolean }[] = [];
  let won = 0;
  for (const leg of pick.legs) {
    let all = true;
    for (let k = 0; k < leg.contact.echoes.length; k++) {
      const success = rng.next() < sigmoid((theta - level) / cfg.scale);
      trials.push({ skill: t.sweep.cardSkill[leg.contact.card], itemDifficulty: level, success });
      if (!success) all = false;
    }
    if (all) won++;
  }
  const score = coldScore(trials, cfg, t.dial);
  return buildColdRecord(
    {
      version: cfg.version, seed, level, legs: pick.legs.length, of: pick.legs.length, trials, contacts: pick.legs.length, won,
      firstBulletHeads: 0, engaged: trials.length, ttsMs: [], shots: 0, movingShots: 0, kept: 1, end: 'exit',
    },
    score,
    { date, at: `${date}T09:00:00.000Z`, gapH: 16, sens: 0.4 },
  );
}

/** A bot plays `days` days of cold openers; the verdict and level after each valid day. */
export function runColdBot(t: Tunables, bot: ColdBot, days: number, seed: number, pool: ColdPool = COLD_POOL): ColdDay[] {
  const cfg = t.coldOpener;
  const rng = new Rng(seed >>> 0);
  const records: ColdOpenerRecord[] = [];
  let state: ColdLevelState = { v: cfg.version, level: firstColdLevel(bot.matched, cfg), moves: [] };
  const out: ColdDay[] = [];
  for (let day = 1; day <= days; day++) {
    const date = dateOf(day);
    const warm = bot.warmDays?.includes(day) ?? false;
    const theta = bot.theta(day) + (warm ? (bot.warmGain ?? 6) : 0);
    const rec = playColdOpener(t, rng, theta, state.level, (seed ^ Math.imul(day, 0x9e3779b1)) >>> 0, date, pool);
    rec.warm = warm;
    records.push(rec);
    const before = state.level;
    state = stepColdLevel(state, records, cfg);
    if (bot.repeatDays?.includes(day)) {
      // Later the same day, warmed up: played and recorded, never valid (only the first of a date counts).
      records.push(playColdOpener(t, rng, theta + (bot.warmGain ?? 6), state.level, (seed ^ Math.imul(day, 0x85ebca6b)) >>> 0, date, pool));
    }
    const valid = validRecords(records, cfg.version);
    const trend = coldTrend(valid.map((r) => r.dial), cfg);
    out.push({ day, level: rec.level, dial: rec.dial, verdict: trend.verdict, band: trend.band, levelMoved: state.level !== before });
  }
  return out;
}

/** Standard error of one cold opener for fixed-ability bots: the spread of their daily estimates around their own mean, pooled. */
export function coldStandardError(t: Tunables, thetas: readonly number[], days: number, seed: number, pool: ColdPool = COLD_POOL): { se: number; meanAbsBias: number } {
  let ss = 0, n = 0, bias = 0;
  thetas.forEach((theta, b) => {
    const rng = new Rng((seed + b * 7919) >>> 0);
    const level = firstColdLevel(theta, t.coldOpener);
    const xs: number[] = [];
    for (let d = 1; d <= days; d++) xs.push(playColdOpener(t, rng, theta, level, (seed ^ Math.imul(b * 31 + d, 0x9e3779b1)) >>> 0, dateOf(d), pool).dial);
    const m = xs.reduce((a, c) => a + c, 0) / xs.length;
    for (const x of xs) ss += (x - m) ** 2;
    n += xs.length - 1;
    bias += Math.abs(m - theta);
  });
  return { se: Math.sqrt(ss / n), meanAbsBias: bias / thetas.length };
}

export interface ColdHarnessReport {
  /** Pooled standard error of one cold opener (dial points) and the mean |bias| of its estimate. */
  se: number;
  meanAbsBias: number;
  /** H3: share of warm-up-only bot-months told "Improved" at least once in 30 days; share of verdict days that were. */
  h3MonthsFalseImproved: number;
  h3DaysFalseImproved: number;
  /** H4: share of learning bots (+1 dial a day) told "Improved" by day 14, and by day 30; their median first day. */
  h4By14: number;
  h4By30: number;
  h4MedianDay: number | null;
  bots: number;
}

/** The harness's whole report over `bots` simulated players with abilities spread over the dial. */
export function coldHarness(t: Tunables, bots: number, seed: number, cfg: ColdOpenerTunables = t.coldOpener, pool: ColdPool = COLD_POOL): ColdHarnessReport {
  const tt: Tunables = cfg === t.coldOpener ? t : { ...t, coldOpener: cfg };
  const thetas: number[] = [];
  for (let b = 0; b < bots; b++) thetas.push(25 + (60 * (b + 0.5)) / bots);
  const se = coldStandardError(tt, thetas, 30, seed, pool);
  let h3Months = 0, h3Days = 0, h3Verdicts = 0, h4a = 0, h4b = 0;
  const firsts: number[] = [];
  thetas.forEach((theta, b) => {
    const steady = runColdBot(tt, { theta: () => theta, matched: theta + 6, warmDays: [5, 17], repeatDays: [3, 9, 21] }, 30, seed + 101 * b, pool);
    let any = false;
    for (const d of steady) {
      if (d.verdict === 'none') continue;
      h3Verdicts++;
      if (d.verdict === 'Improved') {
        h3Days++;
        any = true;
      }
    }
    if (any) h3Months++;
    const learner = runColdBot(tt, { theta: (day) => theta - 10 + day, matched: theta - 10 }, 30, seed + 103 * b + 1, pool);
    const first = learner.find((d) => d.verdict === 'Improved')?.day ?? null;
    if (first !== null) {
      firsts.push(first);
      if (first <= 14) h4a++;
      h4b++;
    }
  });
  firsts.sort((a, c) => a - c);
  return {
    se: se.se,
    meanAbsBias: se.meanAbsBias,
    h3MonthsFalseImproved: h3Months / bots,
    h3DaysFalseImproved: h3Verdicts > 0 ? h3Days / h3Verdicts : 0,
    h4By14: h4a / bots,
    h4By30: h4b / bots,
    h4MedianDay: firsts.length > 0 ? firsts[firsts.length >> 1]! : null,
    bots,
  };
}

/**
 * The step a level change puts in the series (transfer.md H4: "no step at the change larger than the
 * band"): for players between two adjacent levels, the mean estimate at the upper level minus at the
 * lower one, over `n` cold openers each. Zero for an unbiased estimate; returns the largest |step|.
 */
export function coldLevelStep(t: Tunables, n: number, seed: number, pool: ColdPool = COLD_POOL): number {
  const ls = t.coldOpener.levels;
  let worst = 0;
  for (let i = 0; i + 1 < ls.length; i++) {
    const theta = (ls[i]! + ls[i + 1]!) / 2; // a player on the border of the two levels
    const rng = new Rng((seed + i * 977) >>> 0);
    let lo = 0, hi = 0;
    for (let k = 0; k < n; k++) {
      lo += playColdOpener(t, rng, theta, ls[i]!, (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0, '2026-01-01', pool).dial;
      hi += playColdOpener(t, rng, theta, ls[i + 1]!, (seed ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0, '2026-01-01', pool).dial;
    }
    worst = Math.max(worst, Math.abs(hi - lo) / n);
  }
  return worst;
}
