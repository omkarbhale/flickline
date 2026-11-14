export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `current` towards `target` by at most `maxDelta` (no overshoot). */
export function moveTowards(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

/** Median of a list (mean of the two middle values for even counts); NaN-free input assumed. Allocates a sorted copy. */
export function median(values: readonly number[]): number | null {
  const n = values.length;
  if (n === 0) return null;
  const a = values.slice().sort((x, y) => x - y);
  const mid = n >> 1;
  return n % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i]!;
  return s / values.length;
}
