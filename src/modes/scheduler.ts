import { isFairSpawn } from '../adaptive/dial';
import { DEG2RAD } from '../core/math';
import type { Rng } from '../core/rng';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, set, vec3, type Vec3 } from '../core/vec3';
import type { FairnessFloors } from '../config/dial';
import type { ModeTunables } from '../config/modes';
import type { AnchorLike, AnchorSource, PlayerView } from './contracts';

/**
 * Spawn scheduling (design §4 intro, §10.2): the only code that knows how to turn "a Post 10-20 m
 * away, 5-25 degrees off the crosshair" into a position, so no mode knows a map's contents.
 *
 * Everything is deterministic under the run's Rng and allocation-free after construction (queries
 * and results are caller-owned scratch objects). The fairness floors are unconditional: nothing is
 * ever placed closer than the dial floor `spawnMinDistance` (4 m) to the player's eye, nor inside the
 * view cone closer than `spawnViewConeDistance` (5 m), whatever the query says (design §9.3.5).
 */

/** What to pick. Reuse one query object per mode and mutate it. */
export interface SpawnQuery {
  /** Anchor kind (`post`, `gate`, `beacon-shell`, ...). */
  kind: string;
  /** Optional anchor tag filter. */
  tag?: string;
  /** Distance band from the player's eye, metres. */
  minDist: number;
  maxDist: number;
  /** Angular distance band from the reference direction, degrees (0-180). */
  minAngleDeg: number;
  maxAngleDeg: number;
  /** Reference direction (unit); null = the player's current view direction. */
  refDir: Vec3 | null;
  /** Added to an anchor's `pos` before measuring (e.g. head height above a Post's feet). */
  aimOffsetY: number;
}

/**
 * Where to put one stored item (`placeFixed`): reuse one object per engine and mutate it. Angles in
 * degrees, distances in metres.
 */
export interface FixedPlacement {
  /** Great-circle angle from the crosshair direction. */
  angleDeg: number;
  /** Pitch of the target direction above the horizon (an orb); ignored when `lockPitch`. */
  pitchDeg: number;
  /** Nominal distance from the eye. */
  distance: number;
  /** +1 = left of the crosshair, -1 = right; the other side is tried when this one does not fit. */
  side: 1 | -1;
  /**
   * The target's height is fixed (a Post's head on a standing body): its pitch follows from the
   * distance (`headDy` metres above the eye), and an angle the view's pitch makes impossible is
   * widened to the nearest one that works, instead of moving the target off the floor.
   */
  lockPitch: boolean;
  headDy: number;
  /** Lowest the target's centre may be above the player's floor (m): an orb's pitch is lifted to keep it there. */
  minHeight: number;
  /** Shortest distance the item may be shrunk to when it does not fit the hall. */
  minDistance: number;
  /** Distance steps from `distance` to `minDistance` (>= 1). */
  fitSteps: number;
}

/** What `placeFixed` did, for the trial's record. */
export interface FixedPlaced {
  /** Side actually used (+1 left, -1 right). */
  side: 1 | -1;
  /** Degrees the angle (Post) or pitch (orb) had to move to be possible from the current view; 0 = exact. */
  adjustDeg: number;
}

export function createFixedPlacement(): FixedPlacement {
  return { angleDeg: 0, pitchDeg: 0, distance: 10, side: 1, lockPitch: false, headDy: 0, minHeight: 0, minDistance: 5, fitSteps: 6 };
}

export function createSpawnQuery(kind = 'post'): SpawnQuery {
  return { kind, minDist: 0, maxDist: Infinity, minAngleDeg: 0, maxAngleDeg: 180, refDir: null, aimOffsetY: 0 };
}

/** Anchors grouped by kind once per run, so a pick never scans or allocates. */
export class AnchorIndex {
  private readonly byKind = new Map<string, AnchorLike[]>();
  readonly bounds: AnchorSource['bounds'];
  readonly sightClear: AnchorSource['sightClear'];

  constructor(source: AnchorSource | null) {
    this.bounds = source?.bounds;
    this.sightClear = source?.sightClear;
    for (const a of source?.anchors ?? []) {
      const list = this.byKind.get(a.kind);
      if (list) list.push(a);
      else this.byKind.set(a.kind, [a]);
    }
  }

  ofKind(kind: string): readonly AnchorLike[] {
    return this.byKind.get(kind) ?? EMPTY;
  }
}
const EMPTY: readonly AnchorLike[] = [];

/** Position of a point-like anchor: `pos`, else a shell's `centre`, else a lane's midpoint. */
export function anchorPosition(out: Vec3, a: AnchorLike): Vec3 | null {
  if (a.pos) return set(out, a.pos.x, a.pos.y, a.pos.z);
  if (a.centre) return set(out, a.centre.x, a.centre.y, a.centre.z);
  if (a.a && a.b) return set(out, (a.a.x + a.b.x) / 2, (a.a.y + a.b.y) / 2, (a.a.z + a.b.z) / 2);
  return null;
}

/** Angle in degrees between two unit vectors. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) / DEG2RAD;
}

export class SpawnScheduler {
  private readonly eye = vec3();
  private readonly ref = vec3();
  private readonly pos = vec3();
  private readonly dir = vec3();
  private readonly view = vec3();
  /** Spawns rejected by the fairness floor or exhausted constraints (for the debug hook). */
  rejected = 0;
  /** What the last successful `placeFixed` did (valid until the next call). */
  readonly placed: FixedPlaced = { side: 1, adjustDeg: 0 };

  constructor(
    private readonly cfg: ModeTunables,
    private readonly floors: FairnessFloors,
    private readonly rng: Rng,
    private readonly index: AnchorIndex,
    private readonly player: PlayerView,
  ) {}

  /** The player's eye position (scratch, valid until the next call). */
  eyePosition(): Vec3 {
    const p = this.player;
    return set(this.eye, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
  }

  /**
   * Spawn fairness for a world point against the player's current eye and view (design §9.3.5,
   * `isFairSpawn`): never closer than `spawnMinDistance`, never inside the view cone closer than
   * `spawnViewConeDistance`.
   */
  fairAt(p: Vec3): boolean {
    const eye = this.eyePosition();
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return false;
    set(this.dir, dx / d, dy / d, dz / d);
    directionFromAngles(this.view, this.player.yaw, this.player.pitch);
    return isFairSpawn(angleBetweenDeg(this.dir, this.view), d, this.floors);
  }

  /** Line of sight between two points under the map's predicate (always true without one). */
  sightClear(from: Vec3, to: Vec3): boolean {
    const f = this.index.sightClear;
    return f ? f(from, to) : true;
  }

  /** The first anchor of a kind (a mode's `beacon-shell`), or null. */
  firstOfKind(kind: string): AnchorLike | null {
    return this.index.ofKind(kind)[0] ?? null;
  }

  /**
   * Pick one anchor of `q.kind` uniformly among those satisfying the distance and angle bands
   * (and never closer than the fairness floor). If none does, relax the angle band, then the
   * distance band; the floor is never relaxed. Writes the anchor's aim position into `out`.
   * Returns null when the map has nothing that satisfies even the floor.
   */
  pickAnchor(q: SpawnQuery, out: Vec3): AnchorLike | null {
    const list = this.index.ofKind(q.kind);
    if (list.length === 0) return null;
    this.eyePosition();
    this.resolveRef(q);
    for (let stage = 0; stage < 3; stage++) {
      const found = this.reservoir(list, q, stage < 1, stage < 2, out);
      if (found) return found;
    }
    this.rejected++;
    return null;
  }

  /**
   * Sample a point on a `beacon-shell` anchor: radius within the shell and the query's distance
   * band, angular distance from the reference direction within the angle band, pitch within the
   * shell pitch limits and biased towards head height. Never closer than the fairness floor.
   * Writes the point into `out`; returns false (and leaves `out`) if no sample fits the bounds.
   */
  pickShellPoint(shell: AnchorLike, q: SpawnQuery, out: Vec3): boolean {
    const c = this.cfg;
    const eye = this.eyePosition();
    const ref = this.resolveRef(q);
    const rLo = Math.max(shell.rMin ?? 0, q.minDist, this.floors.spawnMinDistance);
    const rHi = Math.min(shell.rMax ?? Infinity, q.maxDist);
    if (rHi < rLo) return false;
    const pitch0 = Math.asin(Math.max(-1, Math.min(1, ref.y)));
    const yaw0 = Math.atan2(-ref.x, -ref.z);
    const cp0 = Math.cos(pitch0);
    const sp0 = Math.sin(pitch0);
    const pLo = c.shellPitchMinDeg * DEG2RAD;
    const pHi = c.shellPitchMaxDeg * DEG2RAD;
    const pBias = c.shellPitchBiasDeg * DEG2RAD;
    for (let i = 0; i < c.spawnMaxTries; i++) {
      const a = this.rng.range(q.minAngleDeg, q.maxAngleDeg) * DEG2RAD;
      // Two uniform draws averaged make a triangular bias towards the centre of the pitch range.
      const u = (this.rng.next() + this.rng.next()) / 2;
      const p = u < 0.5 ? pLo + (pBias - pLo) * (u * 2) : pBias + (pHi - pBias) * ((u - 0.5) * 2);
      const cp = Math.cos(p);
      const arg = (Math.cos(a) - sp0 * Math.sin(p)) / (cp0 * cp);
      if (!(arg >= -1 && arg <= 1)) continue; // no direction at this angle and pitch: resample
      const dyaw = Math.acos(arg) * (this.rng.next() < 0.5 ? -1 : 1);
      directionFromAngles(this.dir, yaw0 + dyaw, p);
      const r = this.rng.range(rLo, rHi);
      set(this.pos, eye.x + this.dir.x * r, eye.y + this.dir.y * r, eye.z + this.dir.z * r);
      if (!this.inBounds(this.pos)) continue;
      if (!this.fairAt(this.pos)) continue;
      if (this.index.sightClear && !this.index.sightClear(eye, this.pos)) continue;
      out.x = this.pos.x;
      out.y = this.pos.y;
      out.z = this.pos.z;
      return true;
    }
    this.rejected++;
    return false;
  }

  /**
   * Put a stored item at `angleDeg` from the crosshair, `pitchDeg` above the horizon, `distance`
   * from the eye (design §8.5: the Daily Baseline's items). Nothing is random: the angle, pitch and
   * distance are the item's, and only what the hall cannot hold changes. If the point is out of
   * bounds, behind a pillar or unfair on `side`, the other side is tried; then the item is brought
   * closer in `fitSteps` steps, never nearer than `minDistance`. A pitch the view makes impossible
   * (a crosshair looking far up cannot be 20 degrees from a target far below, nor an orb be under the
   * floor) is moved to the nearest possible one, or the angle is for a `lockPitch` item. Writes the point into `out` and the
   * outcome into `placed`; false when nothing fits this tick (the caller tries again next tick).
   */
  placeFixed(f: FixedPlacement, out: Vec3): boolean {
    const eye = this.eyePosition();
    const ref = directionFromAngles(this.ref, this.player.yaw, this.player.pitch);
    const pitch0 = Math.asin(Math.max(-1, Math.min(1, ref.y)));
    const yaw0 = Math.atan2(-ref.x, -ref.z);
    const steps = Math.max(1, f.fitSteps);
    for (let i = 0; i <= steps; i++) {
      const r = f.distance - ((f.distance - f.minDistance) * i) / steps;
      for (let k = 0; k < 2; k++) {
        const side = k === 0 ? f.side : (-f.side as 1 | -1);
        if (this.fixedPoint(f, eye, yaw0, pitch0, r, side, out)) return true;
      }
    }
    this.rejected++;
    return false;
  }

  private fixedPoint(f: FixedPlacement, eye: Vec3, yaw0: number, pitch0: number, r: number, side: 1 | -1, out: Vec3): boolean {
    let a = f.angleDeg * DEG2RAD;
    let p = f.lockPitch ? Math.asin(Math.max(-1, Math.min(1, f.headDy / r))) : f.pitchDeg * DEG2RAD;
    const want = f.lockPitch ? a : p;
    // Both directions can only be this far apart: |p - pitch0| <= a <= PI - |p + pitch0|.
    if (f.lockPitch) {
      a = Math.min(Math.max(a, Math.abs(p - pitch0)), Math.PI - Math.abs(p + pitch0));
    } else {
      const floorP = Math.asin(Math.max(-1, Math.min(1, (this.player.pos.y + f.minHeight - eye.y) / r)));
      const lo = Math.max(pitch0 - a, -(Math.PI - a) - pitch0, -Math.PI / 2, floorP);
      const hi = Math.min(pitch0 + a, Math.PI - a - pitch0, Math.PI / 2);
      p = Math.min(Math.max(p, lo), hi);
    }
    const cp0 = Math.cos(pitch0);
    const cp = Math.cos(p);
    const denom = cp0 * cp;
    const arg = denom < 1e-9 ? 1 : (Math.cos(a) - Math.sin(pitch0) * Math.sin(p)) / denom;
    const dyaw = Math.acos(Math.max(-1, Math.min(1, arg))) * side;
    directionFromAngles(this.dir, yaw0 + dyaw, p);
    set(this.pos, eye.x + this.dir.x * r, eye.y + this.dir.y * r, eye.z + this.dir.z * r);
    if (!this.inBounds(this.pos)) return false;
    if (!this.fairAt(this.pos)) return false;
    if (this.index.sightClear && !this.index.sightClear(eye, this.pos)) return false;
    out.x = this.pos.x;
    out.y = this.pos.y;
    out.z = this.pos.z;
    this.placed.side = side;
    this.placed.adjustDeg = Math.abs((f.lockPitch ? a : p) - want) / DEG2RAD;
    return true;
  }

  private reservoir(list: readonly AnchorLike[], q: SpawnQuery, useAngle: boolean, useDist: boolean, out: Vec3): AnchorLike | null {
    const floor = this.floors.spawnMinDistance;
    const eye = this.eye;
    const sight = this.index.sightClear;
    let chosen: AnchorLike | null = null;
    let seen = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      if (q.tag !== undefined && !(a.tags && a.tags.includes(q.tag))) continue;
      if (!anchorPosition(this.pos, a)) continue;
      const p = this.pos;
      p.y += q.aimOffsetY;
      const dx = p.x - eye.x;
      const dy = p.y - eye.y;
      const dz = p.z - eye.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < floor || !this.fairAt(p)) continue;
      if (sight && !sight(eye, p)) continue;
      if (useDist && (d < q.minDist || d > q.maxDist)) continue;
      if (useAngle) {
        this.dir.x = dx / d;
        this.dir.y = dy / d;
        this.dir.z = dz / d;
        const ang = angleBetweenDeg(this.dir, this.ref);
        if (ang < q.minAngleDeg || ang > q.maxAngleDeg) continue;
      }
      // Reservoir sampling: the n-th valid candidate replaces the choice with probability 1/n.
      seen++;
      if (seen === 1 || this.rng.next() * seen < 1) {
        chosen = a;
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
      }
    }
    return chosen;
  }

  private resolveRef(q: SpawnQuery): Vec3 {
    if (q.refDir) return set(this.ref, q.refDir.x, q.refDir.y, q.refDir.z);
    return directionFromAngles(this.ref, this.player.yaw, this.player.pitch);
  }

  private inBounds(p: Vec3): boolean {
    const b = this.index.bounds;
    if (!b) return true;
    return p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;
  }
}

/** Seeded gap between two spawns, as whole ticks (never zero). */
export function gapTicks(rng: Rng, minSec: number, maxSec: number): number {
  return secondsToTicks(rng.range(minSec, maxSec));
}
