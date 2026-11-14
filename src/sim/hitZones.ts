import type { HitTunables, TargetKindDef } from '../config/targets';
import type { Vec3 } from '../core/vec3';
import type { HitZone, TargetState } from './types';

/**
 * Hitscan against a target's zone shapes (design §5.1, spec §5.1). The shapes are plain
 * geometry derived from `hit.*` tunables and the target's pose; the render mesh is never
 * consulted.
 *
 *   head  - sphere (radius `headRadius`, centre `headCentre*`)
 *   body  - vertical cylinder, diameter `torsoWidth`, from the torso bottom to its top (arms count as body)
 *   leg   - vertical cylinder, diameter `legWidth`, from the floor to `legTop*`
 *   orb   - a single head-zone sphere (Beacon)
 *
 * Vertical cylinders are used because they are rotation-invariant: a humanoid needs no facing.
 * Where rays cross several zones the nearest surface wins; exact ties go head > body > leg.
 */

/** Result of a zone trace. Reused between calls. */
export interface ZoneHit {
  zone: HitZone;
  /** Distance along the (unit) ray to the surface. */
  distance: number;
  /** Outward surface normal at the hit point. */
  nx: number;
  ny: number;
  nz: number;
}

export function createZoneHit(): ZoneHit {
  return { zone: 'body', distance: 0, nx: 0, ny: 0, nz: 0 };
}

/**
 * A ray to trace: origin, unit direction and the furthest distance that counts. An object rather
 * than seven numbers because V8 boxes every double it passes to a function it does not inline (a
 * heap allocation per number per call, architecture §7 rule 1), while an object, and a store into
 * one of its fields, allocates nothing. The per-tick users (the run probe's five padded aim rays,
 * target AI) fill one and reuse it.
 */
export interface Ray {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  maxDist: number;
}

export function createRay(): Ray {
  return { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, maxDist: 0 };
}

/**
 * Scratch shared by the primitive tests (module-level: the sim is single-threaded): [0] the entry
 * distance and [1..3] the normal of the last hit (out); [4] the furthest distance that counts and
 * [5..10] the shape being tested - centre x, y (or the cylinder's y0), z, radius, and the
 * cylinder's y1 (in). A typed array, not `let` variables or arguments and results: V8 boxes a
 * double stored in a module variable, passed to or returned from a function it does not inline,
 * and each of those is a heap allocation per call.
 */
const prim = new Float64Array(11);
const OUT_T = 0, OUT_NX = 1, OUT_NY = 2, OUT_NZ = 3, IN_LIMIT = 4, IN_CX = 5, IN_CY = 6, IN_CZ = 7, IN_R = 8, IN_Y1 = 9;

/** Ray vs the sphere in `prim[IN_CX..IN_R]`; true on a hit, with the entry distance and normal in `prim`. */
function raySphereN(ray: Ray): boolean {
  const cx = prim[IN_CX]!, cy = prim[IN_CY]!, cz = prim[IN_CZ]!, r = prim[IN_R]!;
  const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return false;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > prim[IN_LIMIT]!) return false;
  prim[OUT_T] = t;
  prim[OUT_NX] = (ox + dx * t - cx) / r;
  prim[OUT_NY] = (oy + dy * t - cy) / r;
  prim[OUT_NZ] = (oz + dz * t - cz) / r;
  return true;
}

/**
 * Ray vs a capped vertical cylinder (axis through (`prim[IN_CX]`, `prim[IN_CZ]`), radius
 * `prim[IN_R]`, spanning `prim[IN_CY]`..`prim[IN_Y1]`). True on a hit, with the entry distance and
 * normal in `prim`; rays that start inside the solid are ignored for the zone (they would not be
 * "shot at").
 */
function rayCylinderY(ray: Ray): boolean {
  const cx = prim[IN_CX]!, cz = prim[IN_CZ]!, r = prim[IN_R]!, y0 = prim[IN_CY]!, y1 = prim[IN_Y1]!;
  const maxDist = prim[IN_LIMIT]!;
  const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  let best = -1;
  let found = false;
  // Side wall: solve |(o - c).xz + t d.xz| = r.
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = px * dx + pz * dz;
    const c = px * px + pz * pz - r * r;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0 && t <= maxDist) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) {
          best = t;
          found = true;
          prim[OUT_NX] = (px + dx * t) / r;
          prim[OUT_NY] = 0;
          prim[OUT_NZ] = (pz + dz * t) / r;
        }
      }
    }
  }
  // Caps: a ray crossing the plane inside the disc.
  if (Math.abs(dy) > 1e-12) {
    const r2 = r * r;
    // Bottom cap (hit from below when the ray moves up), top cap (from above when moving down).
    const tb = (y0 - oy) / dy;
    if (dy > 0 && tb >= 0 && tb <= maxDist && (!found || tb < best)) {
      const hx = px + dx * tb, hz = pz + dz * tb;
      if (hx * hx + hz * hz <= r2) { best = tb; found = true; prim[OUT_NX] = 0; prim[OUT_NY] = -1; prim[OUT_NZ] = 0; }
    }
    const tt = (y1 - oy) / dy;
    if (dy < 0 && tt >= 0 && tt <= maxDist && (!found || tt < best)) {
      const hx = px + dx * tt, hz = pz + dz * tt;
      if (hx * hx + hz * hz <= r2) { best = tt; found = true; prim[OUT_NX] = 0; prim[OUT_NY] = 1; prim[OUT_NZ] = 0; }
    }
  }
  prim[OUT_T] = best;
  return found;
}

/** Height of the aimed-at centre of a zone above the target's `pos.y`. */
export function zoneCentreY(t: TargetState, h: HitTunables, kind: TargetKindDef, zone: HitZone): number {
  if (kind.shape === 'orb') return 0;
  const c = t.crouched;
  if (zone === 'head') return c ? h.headCentreCrouch : h.headCentreStand;
  if (zone === 'body') return c ? (h.torsoBottomCrouch + h.torsoTopCrouch) / 2 : (h.torsoBottomStand + h.torsoTopStand) / 2;
  return (c ? h.legTopCrouch : h.legTopStand) / 2;
}

/** World-space centre of a zone (what a player aims at). */
export function zoneCentre(out: Vec3, t: TargetState, h: HitTunables, kind: TargetKindDef, zone: HitZone): Vec3 {
  out.x = t.pos.x;
  out.z = t.pos.z;
  // `zoneCentreY` inline: a double returned from a function V8 does not inline is boxed, and this
  // runs for every unseen target every tick.
  if (kind.shape === 'orb') out.y = t.pos.y;
  else if (zone === 'head') out.y = t.pos.y + (t.crouched ? h.headCentreCrouch : h.headCentreStand);
  else if (zone === 'body') out.y = t.pos.y + (t.crouched ? (h.torsoBottomCrouch + h.torsoTopCrouch) / 2 : (h.torsoBottomStand + h.torsoTopStand) / 2);
  else out.y = t.pos.y + (t.crouched ? h.legTopCrouch : h.legTopStand) / 2;
  return out;
}

/**
 * Trace one unit-direction ray against a target. Returns true and fills `out` when a zone is
 * struck no further than `ray.maxDist`.
 */
export function traceTargetRay(
  t: TargetState,
  h: HitTunables,
  kind: TargetKindDef,
  ray: Ray,
  out: ZoneHit,
): boolean {
  prim[IN_LIMIT] = ray.maxDist;
  if (kind.shape === 'orb') {
    prim[IN_CX] = t.pos.x; prim[IN_CY] = t.pos.y; prim[IN_CZ] = t.pos.z; prim[IN_R] = kind.orbRadius * t.scale;
    if (!raySphereN(ray)) return false;
    out.zone = 'head';
    out.distance = prim[OUT_T]!;
    out.nx = prim[OUT_NX]!; out.ny = prim[OUT_NY]!; out.nz = prim[OUT_NZ]!;
    return true;
  }

  const crouched = t.crouched;
  const base = t.pos.y;
  let found = false;

  // Head first so that exact ties go to the head.
  prim[IN_CX] = t.pos.x; prim[IN_CZ] = t.pos.z;
  prim[IN_CY] = base + (crouched ? h.headCentreCrouch : h.headCentreStand);
  prim[IN_R] = h.headRadius;
  if (raySphereN(ray)) {
    found = true;
    out.zone = 'head';
    out.distance = prim[OUT_T]!;
    out.nx = prim[OUT_NX]!; out.ny = prim[OUT_NY]!; out.nz = prim[OUT_NZ]!;
  }

  // The nearest surface so far bounds the next test (`out.distance` once a zone has been struck).
  prim[IN_LIMIT] = found ? out.distance : ray.maxDist;
  prim[IN_CY] = base + (crouched ? h.torsoBottomCrouch : h.torsoBottomStand);
  prim[IN_Y1] = base + (crouched ? h.torsoTopCrouch : h.torsoTopStand);
  prim[IN_R] = h.torsoWidth / 2;
  if (rayCylinderY(ray) && (!found || prim[OUT_T]! < out.distance)) {
    found = true;
    out.zone = 'body';
    out.distance = prim[OUT_T]!;
    out.nx = prim[OUT_NX]!; out.ny = prim[OUT_NY]!; out.nz = prim[OUT_NZ]!;
  }

  prim[IN_LIMIT] = found ? out.distance : ray.maxDist;
  prim[IN_CY] = base;
  prim[IN_Y1] = base + (crouched ? h.legTopCrouch : h.legTopStand);
  prim[IN_R] = h.legWidth / 2;
  if (rayCylinderY(ray) && (!found || prim[OUT_T]! < out.distance)) {
    found = true;
    out.zone = 'leg';
    out.distance = prim[OUT_T]!;
    out.nx = prim[OUT_NX]!; out.ny = prim[OUT_NY]!; out.nz = prim[OUT_NZ]!;
  }
  return found;
}

const scratchRay = createRay();

/** `traceTargetRay` for a ray given as numbers (one-off callers such as the player's shot). */
export function traceTarget(
  t: TargetState,
  h: HitTunables,
  kind: TargetKindDef,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  out: ZoneHit,
): boolean {
  scratchRay.ox = ox; scratchRay.oy = oy; scratchRay.oz = oz;
  scratchRay.dx = dx; scratchRay.dy = dy; scratchRay.dz = dz;
  scratchRay.maxDist = maxDist;
  return traceTargetRay(t, h, kind, scratchRay, out);
}
