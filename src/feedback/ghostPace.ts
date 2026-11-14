import { clamp } from '../core/math';
import type { HudTunables } from '../config/hud';

/**
 * Where the run to beat comes from (design §7.2 "pace vs best run", §7.3). The progress feature implements it from
 * the best run of the run's dial band; until there is one, `NO_PACE` answers "none" and the HUD hides the bar.
 *
 * The comparison is made **at the same sector**: the best run's total score when it finished sector `k` against the
 * live run's total when it finished sector `k`. Inside a sector the bar holds the last comparison, so it moves
 * when a sector is done and never rewards finishing sooner (principle 10: long arcs without rewarding time).
 */
export interface RunPaceSource {
  /**
   * The pace to show now, or `null` when there is no best run to compare against or no sector has been finished
   * yet. `reference` is the best run's total score at the end of the same sector, `score` the live run's total
   * at that moment. The returned object is reused: read it, do not keep it.
   */
  pace(): { score: number; reference: number } | null;
}

export const NO_PACE: RunPaceSource = { pace: () => null };

/**
 * Signed pace in -1..1: 0 = level with the best run at this sector, +1 = ahead by `ghostFullScaleFrac` of
 * its score (or more), -1 = behind by that much. NaN when there is nothing to compare against
 * (no best run, or a reference too small for the ratio to mean anything).
 */
export function paceFraction(score: number, reference: number | null, cfg: Pick<HudTunables, 'ghostFullScaleFrac' | 'ghostMinPbScore'>): number {
  if (reference === null || !(reference >= cfg.ghostMinPbScore)) return NaN;
  return clamp((score - reference) / (reference * cfg.ghostFullScaleFrac), -1, 1);
}
