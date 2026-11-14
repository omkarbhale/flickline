/**
 * Simulation clock constants.
 *
 * TICK_RATE = 128 Hz. Why 128:
 *  - It matches the server tick of the tactical shooter whose feel we model, so fire-rate and
 *    movement quantisation behave like the reference.
 *  - 1/128 s is a power of two, hence exactly representable in floating point (no drift when
 *    accumulating ticks).
 *  - At 144 Hz+ display rates the sim runs 0 or 1 ticks per frame; interpolation hides the gaps.
 *    At 60 Hz it runs 2-3 ticks per frame. Per-tick cost is microseconds, so this is cheap.
 * All gameplay numbers are expressed in seconds / metres, never "per tick", so the rate can change.
 */
export const TICK_RATE = 128;
export const TICK_DT = 1 / TICK_RATE;

/** Convert a duration in seconds to a whole number of ticks (at least 1). */
export function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_RATE));
}
