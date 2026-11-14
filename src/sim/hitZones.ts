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

const NO_HIT = -1;

// Scratch for the normal of the last primitive test (module-level: the sim is single-threaded).
let hitNx = 0;
let hitNy = 0;
let hitNz = 0;

/** Ray vs sphere; entry distance or -1. Writes the normal scratch. */
function raySphereN(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number, maxDist: number,
): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return NO_HIT;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxDist) return NO_HIT;
  hitNx = (ox + dx * t - cx) / r;
  hitNy = (oy + dy * t - cy) / r;
  hitNz = (oz + dz * t - cz) / r;
  return t;
}

/**
 * Ray vs a capped vertical cylinder (axis through (cx, cz), spanning y0..y1). Entry distance or
 * -1; rays that start inside the solid are ignored for the zone (they would not be "shot at").
 */
function rayCylinderY(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cz: number, r: number, y0: number, y1: number,
  maxDist: number,
): number {
  let best = NO_HIT;
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
          hitNx = (px + dx * t) / r;
          hitNy = 0;
          hitNz = (pz + dz * t) / r;
        }
      }
    }
  }
  // Caps: a ray crossing the plane inside the disc.
  if (Math.abs(dy) > 1e-12) {
    const r2 = r * r;
    // Bottom cap (hit from below when the ray moves up), top cap (from above when moving down).
    const tb = (y0 - oy) / dy;
    if (dy > 0 && tb >= 0 && tb <= maxDist && (best < 0 || tb < best)) {
      const hx = px + dx * tb, hz = pz + dz * tb;
      if (hx * hx + hz * hz <= r2) { best = tb; hitNx = 0; hitNy = -1; hitNz = 0; }
    }
    const tt = (y1 - oy) / dy;
    if (dy < 0 && tt >= 0 && tt <= maxDist && (best < 0 || tt < best)) {
      const hx = px + dx * tt, hz = pz + dz * tt;
      if (hx * hx + hz * hz <= r2) { best = tt; hitNx = 0; hitNy = 1; hitNz = 0; }
    }
  }
  return best;
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
  out.y = t.pos.y + zoneCentreY(t, h, kind, zone);
  out.z = t.pos.z;
  return out;
}

/**
 * Trace one unit-direction ray against a target. Returns true and fills `out` when a zone is
 * struck no further than `maxDist`.
 */
export function traceTarget(
  t: TargetState,
  h: HitTunables,
  kind: TargetKindDef,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  out: ZoneHit,
): boolean {
  if (kind.shape === 'orb') {
    const d = raySphereN(ox, oy, oz, dx, dy, dz, t.pos.x, t.pos.y, t.pos.z, kind.orbRadius * t.scale, maxDist);
    if (d < 0) return false;
    out.zone = 'head';
    out.distance = d;
    out.nx = hitNx; out.ny = hitNy; out.nz = hitNz;
    return true;
  }

  const crouched = t.crouched;
  const base = t.pos.y;
  const cx = t.pos.x, cz = t.pos.z;

  let bestT = maxDist;
  let found = false;

  // Head first so that exact ties go to the head.
  const headY = base + (crouched ? h.headCentreCrouch : h.headCentreStand);
  const th = raySphereN(ox, oy, oz, dx, dy, dz, cx, headY, cz, h.headRadius, bestT);
  if (th >= 0) {
    found = true;
    bestT = th;
    out.zone = 'head';
    out.distance = th;
    out.nx = hitNx; out.ny = hitNy; out.nz = hitNz;
  }

  const torsoBottom = base + (crouched ? h.torsoBottomCrouch : h.torsoBottomStand);
  const torsoTop = base + (crouched ? h.torsoTopCrouch : h.torsoTopStand);
  const tb = rayCylinderY(ox, oy, oz, dx, dy, dz, cx, cz, h.torsoWidth / 2, torsoBottom, torsoTop, bestT);
  if (tb >= 0 && (!found || tb < bestT)) {
    found = true;
    bestT = tb;
    out.zone = 'body';
    out.distance = tb;
    out.nx = hitNx; out.ny = hitNy; out.nz = hitNz;
  }

  const legTop = base + (crouched ? h.legTopCrouch : h.legTopStand);
  const tl = rayCylinderY(ox, oy, oz, dx, dy, dz, cx, cz, h.legWidth / 2, base, legTop, bestT);
  if (tl >= 0 && (!found || tl < bestT)) {
    found = true;
    out.zone = 'leg';
    out.distance = tl;
    out.nx = hitNx; out.ny = hitNy; out.nz = hitNz;
  }
  return found;
}
