import type { AxisId, AxisValues, DialSource } from './contracts';

const BISECT_ITERATIONS = 24;

/**
 * The dial-scale difficulty (0-100) that a set of concrete axis values represents, so an item's
 * `itemDifficulty` follows the values actually in force (design §9.1), not just the dial that was
 * requested: fairness floors that clamp an axis, or a mode that pins one, show up here.
 *
 * Each used axis is inverted through the dial module's own `axes(dial)` (monotone in the dial, so a
 * bisection finds the dial that produces the value; this needs no copy of the axis table and
 * works for linear and geometric axes alike), then the results are averaged. Axes the dial module
 * does not know, or that do not vary with the dial, are skipped; with none left the requested dial
 * is returned. Runs once per beat boundary, never per tick.
 */
export function effectiveDial(source: DialSource, values: AxisValues, used: readonly AxisId[], fallback: number): number {
  const lo = source.axes(0);
  const hi = source.axes(100);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < used.length; i++) {
    const k = used[i]!;
    const v = values[k];
    const a = lo[k];
    const b = hi[k];
    if (v === undefined || a === undefined || b === undefined || a === b) continue;
    const increasing = b > a;
    let low = 0;
    let high = 100;
    for (let it = 0; it < BISECT_ITERATIONS; it++) {
      const mid = (low + high) / 2;
      const f = source.axes(mid)[k]!;
      if (f < v === increasing) low = mid;
      else high = mid;
    }
    sum += (low + high) / 2;
    n++;
  }
  return n === 0 ? fallback : sum / n;
}
