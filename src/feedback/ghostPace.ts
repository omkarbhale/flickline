import { clamp } from '../core/math';
import type { HudTunables } from '../config/hud';

/**
 * Where the personal best comes from (design §2 "ghost pace", §7.3). The progress/PB store (#38)
 * implements it; until then `NO_PERSONAL_BEST` answers "none" and the HUD hides the bar.
 */
export interface PersonalBestSource {
  /**
   * The score the personal best for `modeId` (at the current dial band) had at `elapsedSec` into
   * its run, or `null` when there is no PB to compare against.
   */
  scoreAt(modeId: string, elapsedSec: number): number | null;
}

export const NO_PERSONAL_BEST: PersonalBestSource = { scoreAt: () => null };

/**
 * Signed pace in -1..1: 0 = level with the PB at this second, +1 = ahead by `ghostFullScaleFrac` of
 * the PB's score (or more), -1 = behind by that much. NaN when there is nothing to compare against
 * (no PB, or a PB score too small for the ratio to mean anything).
 */
export function paceFraction(score: number, pbScore: number | null, cfg: Pick<HudTunables, 'ghostFullScaleFrac' | 'ghostMinPbScore'>): number {
  if (pbScore === null || !(pbScore >= cfg.ghostMinPbScore)) return NaN;
  return clamp((score - pbScore) / (pbScore * cfg.ghostFullScaleFrac), -1, 1);
}
