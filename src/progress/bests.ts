import { clamp } from '../core/math';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import type { RunStats } from '../feedback/statTracker';
import type { RunStatsSummary, RunSummary } from './save';

/**
 * # Dial bands and run summaries (design §8.4)
 *
 * Score already carries the difficulty factor, but a best at an easy band must not hide a hard band's
 * (design §8.4), so run bests are kept per band (`progress/runRecords.ts`).
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
