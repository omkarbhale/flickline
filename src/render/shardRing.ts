/**
 * Pure bookkeeping for the kill-shatter shards. All shards live in fixed typed arrays sized once
 * (`kills * shardsPerKill` instances); a kill overwrites the oldest slot in place, so nothing is
 * allocated per kill. The motion itself is done by the vertex shader from `kill` (origin and
 * birth time), `bias` (burst push away from the shooter) and the static per-shard `seed`.
 */

export const KILL_FLOATS = 4; // origin xyz, birth time (seconds)
export const BIAS_FLOATS = 3;
export const SEED_FLOATS = 4; // unit direction xyz, random 0..1

/** Birth time of a shard that is not flying (far in the past, so the shader culls it). */
export const DEAD_BIRTH = -1e9;

export class ShardRing {
  readonly instances: number;
  readonly kill: Float32Array;
  readonly bias: Float32Array;
  readonly seed: Float32Array;
  /** Number of kill slots in use at most (for diagnostics) and total kills recorded. */
  total = 0;
  /** Newest birth time, to know when the whole ring has gone quiet. */
  lastBirth = DEAD_BIRTH;
  private next = 0;

  constructor(
    readonly killCapacity: number,
    readonly shardsPerKill: number,
    nextRandom: () => number,
  ) {
    this.instances = killCapacity * shardsPerKill;
    this.kill = new Float32Array(this.instances * KILL_FLOATS);
    this.bias = new Float32Array(this.instances * BIAS_FLOATS);
    this.seed = new Float32Array(this.instances * SEED_FLOATS);
    for (let i = 0; i < this.instances; i++) {
      this.kill[i * KILL_FLOATS + 3] = DEAD_BIRTH;
      // Uniform direction on the sphere.
      const z = nextRandom() * 2 - 1;
      const a = nextRandom() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      this.seed[i * SEED_FLOATS] = r * Math.cos(a);
      this.seed[i * SEED_FLOATS + 1] = z;
      this.seed[i * SEED_FLOATS + 2] = r * Math.sin(a);
      this.seed[i * SEED_FLOATS + 3] = nextRandom();
    }
  }

  /**
   * Record a kill: `count` shards (at most `shardsPerKill`) fly from (x, y, z) at time `now`,
   * pushed away along the unit vector (bx, by, bz). Returns the kill slot used. No allocation.
   */
  spawn(x: number, y: number, z: number, now: number, bx: number, by: number, bz: number, count: number): number {
    const slot = this.next;
    this.next = (this.next + 1) % this.killCapacity;
    const n = Math.min(count, this.shardsPerKill);
    const base = slot * this.shardsPerKill;
    for (let s = 0; s < this.shardsPerKill; s++) {
      const i = base + s;
      const k = i * KILL_FLOATS;
      this.kill[k] = x; this.kill[k + 1] = y; this.kill[k + 2] = z;
      this.kill[k + 3] = s < n ? now : DEAD_BIRTH;
      const b = i * BIAS_FLOATS;
      this.bias[b] = bx; this.bias[b + 1] = by; this.bias[b + 2] = bz;
    }
    this.total++;
    this.lastBirth = now;
    return slot;
  }

  /** Whether any shard could still be in the air at `now`. */
  active(now: number, lifeSec: number): boolean {
    return now - this.lastBirth < lifeSec && this.total > 0;
  }
}
