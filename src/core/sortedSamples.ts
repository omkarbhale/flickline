/**
 * A fixed-capacity bag of numbers kept sorted, for running medians without allocating after
 * construction. Insert is a binary search plus a `copyWithin` (O(n) memmove, n is a few dozen kills
 * per run). When full, further samples are ignored (a run never gets near the capacity).
 */
export class SortedSamples {
  private readonly a: Float64Array;
  private n = 0;

  constructor(capacity: number) {
    this.a = new Float64Array(Math.max(1, capacity));
  }

  get count(): number {
    return this.n;
  }

  clear(): void {
    this.n = 0;
  }

  add(v: number): void {
    if (this.n >= this.a.length || Number.isNaN(v)) return;
    const a = this.a;
    let lo = 0;
    let hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (a[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    a.copyWithin(lo + 1, lo, this.n);
    a[lo] = v;
    this.n++;
  }

  /** The median (mean of the two middle samples for an even count); NaN when empty. */
  median(): number {
    const n = this.n;
    if (n === 0) return NaN;
    const m = n >>> 1;
    return n & 1 ? this.a[m]! : (this.a[m - 1]! + this.a[m]!) / 2;
  }
}
