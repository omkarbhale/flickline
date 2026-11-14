import type { CuePhase, CueTunables, PhaseGate } from '../config/cues';
import { tunables } from '../config/tunables';

/**
 * Which phase a skill's coaching cues are in (design §7.4, issue #129).
 *
 * Cues fade with the **skill posterior** (`skillModel.ts`), not with play time: `every` trial for a
 * new or uncertain player, `bandwidth` (only a large error) once the rating clears a dial threshold
 * **and** the confidence band has narrowed, `summary` (results card only) higher up. Both gates must
 * hold, so a lucky first minute that lifts the mean but leaves a wide band does not strip the cues.
 *
 * Pure: the same rating and band always give the same phase. `prev` adds the hysteresis (see
 * `CueTunables.phases`): a player already in a phase stays in it until the rating falls
 * `hysteresis.rating` below its gate or the band widens `hysteresis.sd` above it, so a rating that
 * hovers on a threshold does not flip the cues on and off between runs.
 */
export function cuePhase(rating: number, sd: number, prev: CuePhase = 'every', cfg: CueTunables = tunables.cues): CuePhase {
  if (!Number.isFinite(rating) || !Number.isFinite(sd)) return 'every';
  const h = cfg.phases.hysteresis;
  const holds = (g: PhaseGate, already: boolean): boolean =>
    already ? rating >= g.minRating - h.rating && sd <= g.maxSd + h.sd : rating >= g.minRating && sd <= g.maxSd;
  if (holds(cfg.phases.summary, prev === 'summary')) return 'summary';
  if (holds(cfg.phases.bandwidth, prev !== 'every')) return 'bandwidth';
  return 'every';
}
