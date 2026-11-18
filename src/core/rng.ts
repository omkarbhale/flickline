/**
 * Seeded deterministic PRNG (mulberry32). All randomness inside the simulation must come from an
 * Rng owned by the World; never call Math.random() in sim code.
 */
export class Rng {
  /**
   * The 32-bit state, in a typed array: a uint32 above 2^30 is not a small integer, so kept in a plain
   * field every update would allocate a heap number (architecture §7 rule 1); a typed-array store does not.
   */
  private readonly st = new Uint32Array(1);
  /** Second Box–Muller output waiting to be used by the next `normal()`; valid when `hasSpare`. */
  private spare = 0;
  private hasSpare = false;

  constructor(seed = 1) {
    this.st[0] = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    const s = (this.st[0]! + 0x6d2b79f5) >>> 0;
    this.st[0] = s;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /**
   * Standard normal draw (mean 0, SD 1) by Box–Muller. One pair of uniforms makes two normals; the
   * second is kept and returned by the next call, so both outputs are used and a draw costs one
   * uniform on average. The cached half is not part of `getState()`: `setState` and `reseed`
   * discard it, so a restored stream restarts on a pair boundary.
   */
  normal(): number {
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    const r = Math.sqrt(-2 * Math.log(1 - this.next())); // 1 - u in (0, 1]: log never sees 0
    const a = 6.283185307179586 * this.next();
    this.spare = r * Math.sin(a);
    this.hasSpare = true;
    return r * Math.cos(a);
  }

  /**
   * Write the next `n` uniforms in [0, 1) into `out[0..n)`: exactly the values `n` calls of `next()`
   * would return. For per-tick callers: a number returned from a method V8 does not inline is a heap
   * allocation, a store into a typed array is not (architecture §7 rule 1).
   */
  uniformsInto(out: Float64Array, n: number): void {
    let s = this.st[0]!;
    for (let i = 0; i < n; i++) {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      out[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    this.st[0] = s;
  }

  getState(): number {
    return this.st[0]!;
  }

  setState(s: number): void {
    this.st[0] = s >>> 0;
    this.hasSpare = false;
  }
}

/** Fisher-Yates shuffle of `a` in place from the seeded stream; returns `a`. */
export function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}
