/**
 * Pure model of the directional damage arcs (design §7.1 "Taking damage"): where each arc points
 * and how visible it is. No DOM: `DamageView` draws it, tests drive it. Angles are radians;
 * the screen angle is measured clockwise from straight up (0 = the shooter is dead ahead,
 * +PI/2 = to the right).
 */

/**
 * The shooter's on-screen angle for a hit that carried `dir` (player yaw frame: +X right, -Z
 * ahead) when the player's yaw was `hitYaw`, now that the view yaw is `liveYaw`. The arc stays
 * on the shooter while the player turns: turning left (yaw up) moves it clockwise.
 */
export function arcScreenAngle(dirX: number, dirZ: number, hitYaw: number, liveYaw: number): number {
  return Math.atan2(dirX, -dirZ) + (liveYaw - hitYaw);
}

/** Visibility 0..1 of an arc `ageMs` after the hit: a 50 ms attack, then an ease-out to nothing at `lifeMs`. */
export function arcAlpha(ageMs: number, lifeMs: number): number {
  if (ageMs < 0 || ageMs >= lifeMs) return 0;
  const attack = 50;
  if (ageMs < attack) return ageMs / attack;
  const f = 1 - (ageMs - attack) / (lifeMs - attack);
  return f * f;
}

/**
 * A fixed ring of arcs. Each remembers the world bearing of its shooter (as `hitYaw`-relative
 * angle plus the yaw at the hit) and when it started. `add` refreshes an arc already pointing
 * within `mergeRad` of the new one (a burst from one shooter is one arc) and otherwise recycles
 * the oldest slot. Allocates nothing after construction.
 */
export class DamageArcPool {
  readonly capacity: number;
  /** Per slot: angle at the hit (screen frame), the player's yaw at the hit, start time (ms), alive. */
  readonly angle: Float64Array;
  readonly hitYaw: Float64Array;
  readonly startMs: Float64Array;
  readonly live: Uint8Array;
  private next = 0;
  /** Number of live slots (arcs may have faded: `prune` removes them). */
  active = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity | 0);
    this.angle = new Float64Array(this.capacity);
    this.hitYaw = new Float64Array(this.capacity);
    this.startMs = new Float64Array(this.capacity);
    this.live = new Uint8Array(this.capacity);
  }

  /** Add (or refresh) an arc for a hit at `nowMs`; `liveYaw` is the current view yaw. Returns its slot. */
  add(dirX: number, dirZ: number, hitYaw: number, liveYaw: number, nowMs: number, mergeRad: number): number {
    const a = arcScreenAngle(dirX, dirZ, hitYaw, liveYaw);
    for (let i = 0; i < this.capacity; i++) {
      if (this.live[i] === 0) continue;
      if (angleDiff(this.screenAngle(i, liveYaw), a) <= mergeRad) {
        this.angle[i] = Math.atan2(dirX, -dirZ);
        this.hitYaw[i] = hitYaw;
        this.startMs[i] = nowMs;
        return i;
      }
    }
    const slot = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.live[slot] === 0) this.active++;
    this.live[slot] = 1;
    this.angle[slot] = Math.atan2(dirX, -dirZ);
    this.hitYaw[slot] = hitYaw;
    this.startMs[slot] = nowMs;
    return slot;
  }

  /** Where slot `i` points on screen now (it follows the view yaw, see `arcScreenAngle`). */
  screenAngle(i: number, liveYaw: number): number {
    return this.angle[i]! + (liveYaw - this.hitYaw[i]!);
  }

  /** Free the arcs that have faded out; returns how many are still live. */
  prune(nowMs: number, lifeMs: number): number {
    for (let i = 0; i < this.capacity; i++) {
      if (this.live[i] !== 0 && nowMs - this.startMs[i]! >= lifeMs) {
        this.live[i] = 0;
        this.active--;
      }
    }
    return this.active;
  }

  clear(): void {
    this.live.fill(0);
    this.active = 0;
  }
}

/** Smallest absolute difference between two angles, radians (0..PI). */
export function angleDiff(a: number, b: number): number {
  const TAU = Math.PI * 2;
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return Math.abs(d);
}
