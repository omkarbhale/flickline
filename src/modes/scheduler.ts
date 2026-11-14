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
 * and results are caller-owned scratch objects). The fairness floor is unconditional: nothing is
 * ever placed closer than the dial floor `spawnMinDistance` (3 m) to the player's eye, whatever the query says.
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
  /** Spawns rejected by the fairness floor or exhausted constraints (for the debug hook). */
  rejected = 0;

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
      if (this.index.sightClear && !this.index.sightClear(eye, this.pos)) continue;
      out.x = this.pos.x;
      out.y = this.pos.y;
      out.z = this.pos.z;
      return true;
    }
    this.rejected++;
    return false;
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
      if (d < floor) continue;
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
