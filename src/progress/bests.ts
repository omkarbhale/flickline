import { clamp } from '../core/math';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import type { RunStats } from '../feedback/statTracker';
import type { PersonalBestSource } from '../feedback/ghostPace';
import type { BestRecord, RunStatsSummary, RunSummary } from './save';

/**
 * # Personal bests per (mode, dial band) and the ghost-pace curve (design §8.4, §2, §7.3)
 *
 * Score already carries the difficulty factor, but a best at an easy band must not hide a hard band's
 * (design §8.4), so bests are kept per band. Each best stores the cumulative score of the run once
 * per `curveStepSec`; `GhostPace` reads it as the live comparison (`feedback/ghostPace.ts` turns the
 * difference into the bar).
 */

/** The band id a dial value falls in. */
export function bandOf(dial: number, cfg: ProgressTunables = progressCfg): string {
  const d = clamp(dial, 0, 100);
  let id = cfg.bands[0]!.id;
  for (const b of cfg.bands) if (d >= b.from) id = b.id;
  return id;
}

/** The summary numbers of a finished run, rounded for storage. */
export function summariseStats(s: RunStats): RunStatsSummary {
  const r = (v: number | null, digits: number): number | null => (v === null ? null : Number(v.toFixed(digits)));
  return {
    shots: s.shots, hits: s.hits, headHits: s.headHits, kills: s.kills, movingShots: s.movingShots,
    accuracy: r(s.accuracy, 4), headshotRate: r(s.headshotRate, 4),
    medianRtMs: r(s.medianRtMs, 1), medianTtkMs: r(s.medianTtkMs, 1),
    maxChain: s.maxChain, cleanKills: s.cleanKills,
  };
}

/** The history entry for a finished run (the medals as the distinct ids earned). `date` is an ISO date-time the caller read from its clock. */
export function summariseRun(s: RunStats, score: number, date: string, medals: readonly string[]): RunSummary {
  return {
    ...summariseStats(s),
    mode: s.mode,
    seed: s.seed,
    dial: s.dial,
    date,
    reason: s.endReason ?? 'timer',
    score: Math.max(0, Math.round(score)),
    medals: Array.from(new Set(medals)),
  };
}

/** Does `score` beat the stored best (or is it the first score on the board)? A run that scored nothing never sets one. */
export function beatsBest(score: number, best: BestRecord | null | undefined): boolean {
  return score > 0 && (best === null || best === undefined || Math.round(score) > best.score);
}

// ---------------------------------------------------------------- the curve

/**
 * Records a run's cumulative score as one sample per `step` seconds: `samples[k]` is the total after the
 * last award at or before `k * step`. Preallocated, so recording a kill allocates nothing; `finish` makes the
 * stored array once, at run end.
 */
export class ScoreCurve {
  private readonly samples: Float64Array;
  private filled = 0;
  private total = 0;

  constructor(private readonly step: number = progressCfg.curveStepSec, capacity: number = progressCfg.curveMaxSamples) {
    this.samples = new Float64Array(capacity);
  }

  reset(): void {
    this.filled = 0;
    this.total = 0;
  }

  /** The run's total became `total` at `tSec` seconds into the live run (totals never decrease). */
  record(tSec: number, total: number): void {
    const upTo = Math.min(this.samples.length, Math.ceil(tSec / this.step - 1e-9));
    while (this.filled < upTo) this.samples[this.filled++] = this.total;
    if (total > this.total) this.total = total;
  }

  /** Close the curve at `durationSec` and return it (integers). Sample 0 is always 0. */
  finish(durationSec: number): number[] {
    const end = Math.min(this.samples.length, Math.max(1, Math.ceil(durationSec / this.step - 1e-9)) + 1);
    while (this.filled < end) this.samples[this.filled++] = this.total;
    const out: number[] = [];
    for (let i = 0; i < this.filled; i++) out.push(Math.round(this.samples[i]!));
    out[0] = 0;
    return out;
  }
}

/** Score at `tSec` along a stored curve: linear between samples, flat past the end. Allocation-free. */
export function scoreOnCurve(curve: readonly number[], tSec: number, step: number = progressCfg.curveStepSec): number {
  const n = curve.length;
  if (n === 0) return 0;
  const x = tSec <= 0 ? 0 : tSec / step;
  const i = Math.floor(x);
  if (i >= n - 1) return curve[n - 1]!;
  const f = x - i;
  return curve[i]! + (curve[i + 1]! - curve[i]!) * f;
}

/**
 * The ghost: what the personal best for the run about to start had at each second. Armed at `runReady`
 * (from the best of the run's mode and band as it was *before* this run), read by the HUD every frame.
 */
export class GhostPace implements PersonalBestSource {
  private mode = '';
  private curve: readonly number[] | null = null;

  constructor(private readonly step: number = progressCfg.curveStepSec) {}

  arm(mode: string, best: BestRecord | null): void {
    this.mode = mode;
    this.curve = best !== null && best.curve.length > 1 ? best.curve : null;
  }

  clear(): void {
    this.curve = null;
  }

  scoreAt(modeId: string, elapsedSec: number): number | null {
    if (this.curve === null || modeId !== this.mode) return null;
    return scoreOnCurve(this.curve, elapsedSec, this.step);
  }
}
