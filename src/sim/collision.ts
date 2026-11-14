import type { Vec3 } from '../core/vec3';
import type { BoxDef } from './types';

/**
 * Axis-aligned box collision, plus ramps (a box clipped by one sloped plane, `BoxDef.ramp`).
 * Robust for walking speeds: the player moves one axis at a time (X, then Z, then Y) and is pushed
 * out of any solid it overlaps. Max travel per tick is a few cm, far below the thinnest wall, so
 * tunnelling cannot happen. A grounded hull blocked by a surface no higher than the step height
 * climbs it instead (`moveAxisStep`), which is what makes stairs, ledges and ramps walkable.
 * Brute force over boxes is fine for small maps; add a uniform grid broadphase when maps get large
 * (see architecture issue). Nothing here allocates.
 */

const EPS = 1e-9;
/** Faces closer than this count as touching, not overlapping (absorbs float error after a push-out). */
const SKIN = 1e-7;

/** Height of ramp box `b`'s surface above the point (x, z), clamped to the box's footprint. */
export function rampY(b: BoxDef, x: number, z: number): number {
  const r = b.ramp!;
  let t: number;
  switch (r.rise) {
    case '+x': t = (x - b.min.x) / (b.max.x - b.min.x); break;
    case '-x': t = (b.max.x - x) / (b.max.x - b.min.x); break;
    case '+z': t = (z - b.min.z) / (b.max.z - b.min.z); break;
    default: t = (b.max.z - z) / (b.max.z - b.min.z); break;
  }
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return r.lowY + (b.max.y - r.lowY) * t;
}

/**
 * Height a hull whose feet centre is at (px, pz) rests on when standing on `b`: a plain box's top,
 * or for a ramp the surface at the hull's uphill edge (the first point of the footprint to touch
 * it, which is how a box hull rides a slope).
 */
export function restHeight(b: BoxDef, px: number, pz: number, hw: number): number {
  const r = b.ramp;
  if (r === undefined) return b.max.y;
  switch (r.rise) {
    case '+x': return rampY(b, px + hw, pz);
    case '-x': return rampY(b, px - hw, pz);
    case '+z': return rampY(b, px, pz + hw);
    default: return rampY(b, px, pz - hw);
  }
}

export function hullOverlaps(px: number, py: number, pz: number, hw: number, h: number, b: BoxDef): boolean {
  if (
    px - hw < b.max.x - SKIN &&
    px + hw > b.min.x + SKIN &&
    py < b.max.y - SKIN &&
    py + h > b.min.y + SKIN &&
    pz - hw < b.max.z - SKIN &&
    pz + hw > b.min.z + SKIN
  ) {
    return b.ramp === undefined || py < restHeight(b, px, pz, hw) - SKIN;
  }
  return false;
}

/** True if a hull (feet centre px,py,pz) intersects any box. */
export function hullBlocked(
  boxes: readonly BoxDef[],
  px: number,
  py: number,
  pz: number,
  hw: number,
  h: number,
): boolean {
  for (let i = 0; i < boxes.length; i++) if (hullOverlaps(px, py, pz, hw, h, boxes[i]!)) return true;
  return false;
}

/**
 * Highest surface at or below `maxY` that a hull with feet centre (px, pz) and half-width `hw`
 * (0 = a point) can stand on, or -Infinity if there is none. Does not check headroom.
 */
export function supportBelow(boxes: readonly BoxDef[], px: number, pz: number, hw: number, maxY: number): number {
  let best = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (px - hw >= b.max.x || px + hw <= b.min.x || pz - hw >= b.max.z || pz + hw <= b.min.z) continue;
    const top = restHeight(b, px, pz, hw);
    if (top <= maxY && top > best) best = top;
  }
  return best;
}

export type Axis = 'x' | 'y' | 'z';

/**
 * Move `pos` by `delta` along one axis and resolve overlaps.
 * Returns true if blocked (the move was truncated by a box).
 */
export function moveAxis(
  boxes: readonly BoxDef[],
  pos: Vec3,
  axis: Axis,
  delta: number,
  hw: number,
  h: number,
): boolean {
  if (delta === 0) return false;
  pos[axis] += delta;
  let blocked = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullOverlaps(pos.x, pos.y, pos.z, hw, h, b)) continue;
    blocked = true;
    if (axis === 'x') pos.x = delta > 0 ? b.min.x - hw : b.max.x + hw;
    else if (axis === 'z') pos.z = delta > 0 ? b.min.z - hw : b.max.z + hw;
    else pos.y = delta > 0 ? b.min.y - h : restHeight(b, pos.x, pos.z, hw);
  }
  return blocked;
}

/**
 * Like `moveAxis` for a horizontal axis, but a hull that would be blocked only by surfaces at most
 * `stepHeight` above its feet (a stair, a ledge, the slope of a ramp) is lifted onto them instead,
 * provided the lifted hull has headroom. Returns true if the move was truncated (a real wall).
 * Call it only while the player is grounded: a jumping hull does not step.
 */
export function moveAxisStep(
  boxes: readonly BoxDef[],
  pos: Vec3,
  axis: 'x' | 'z',
  delta: number,
  hw: number,
  h: number,
  stepHeight: number,
): boolean {
  if (delta === 0) return false;
  pos[axis] += delta;
  let top = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullOverlaps(pos.x, pos.y, pos.z, hw, h, b)) continue;
    const t = restHeight(b, pos.x, pos.z, hw);
    if (t > top) top = t;
  }
  if (top === -Infinity) return false; // free
  if (top - pos.y <= stepHeight) {
    const y0 = pos.y;
    pos.y = top;
    if (!hullBlocked(boxes, pos.x, pos.y, pos.z, hw, h)) return false; // stepped up
    pos.y = y0; // no headroom: it is a wall after all
  }
  let blocked = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullOverlaps(pos.x, pos.y, pos.z, hw, h, b)) continue;
    blocked = true;
    if (axis === 'x') pos.x = delta > 0 ? b.min.x - hw : b.max.x + hw;
    else pos.z = delta > 0 ? b.min.z - hw : b.max.z + hw;
  }
  return blocked;
}

/**
 * Keep a grounded hull on the ground it is walking over: if the first surface below is at most
 * `maxDrop` down, move onto it and return true; otherwise leave `pos` untouched and return false
 * (a real drop, so the caller lets gravity take over). This is what stops walking down stairs or
 * a ramp from being a series of tiny falls.
 */
export function snapDown(boxes: readonly BoxDef[], pos: Vec3, hw: number, h: number, maxDrop: number): boolean {
  const y0 = pos.y;
  if (moveAxis(boxes, pos, 'y', -maxDrop, hw, h)) return true;
  pos.y = y0;
  return false;
}

const blockScratch: Vec3 = { x: 0, y: 0, z: 0 };

/** Whether a box lies on the unit-direction ray from (`ox`, `oy`, `oz`) before it has gone `dist` metres (less a 1 mm margin): line of sight is blocked. Allocates nothing. */
export function lineBlocked(
  boxes: readonly BoxDef[],
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number,
): boolean {
  const limit = dist - 0.001;
  for (let i = 0; i < boxes.length; i++) {
    const hit = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]!, limit, blockScratch);
    if (hit >= 0 && hit < limit) return true;
  }
  return false;
}

/**
 * Ray vs AABB (slab method). Returns entry distance along the (unit) direction, or -1 on miss.
 * Writes the hit normal into `normalOut` when it hits. Rays starting inside a box are ignored.
 */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  b: BoxDef,
  maxDist: number,
  normalOut: Vec3,
): number {
  let tmin = 0;
  let tmax = maxDist;
  let nx = 0, ny = 0, nz = 0;

  // X slab
  if (Math.abs(dx) < EPS) {
    if (ox < b.min.x || ox > b.max.x) return -1;
  } else {
    let t1 = (b.min.x - ox) / dx;
    let t2 = (b.max.x - ox) / dx;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Y slab
  if (Math.abs(dy) < EPS) {
    if (oy < b.min.y || oy > b.max.y) return -1;
  } else {
    let t1 = (b.min.y - oy) / dy;
    let t2 = (b.max.y - oy) / dy;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  // Z slab
  if (Math.abs(dz) < EPS) {
    if (oz < b.min.z || oz > b.max.z) return -1;
  } else {
    let t1 = (b.min.z - oz) / dz;
    let t2 = (b.max.z - oz) / dz;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (b.ramp !== undefined) {
    // The solid is the part of the box below the sloped surface y = sx*x + sz*z + c.
    const span = b.max.y - b.ramp.lowY;
    let sx = 0, sz = 0, c: number;
    switch (b.ramp.rise) {
      case '+x': sx = span / (b.max.x - b.min.x); c = b.ramp.lowY - sx * b.min.x; break;
      case '-x': sx = -span / (b.max.x - b.min.x); c = b.ramp.lowY - sx * b.max.x; break;
      case '+z': sz = span / (b.max.z - b.min.z); c = b.ramp.lowY - sz * b.min.z; break;
      default: sz = -span / (b.max.z - b.min.z); c = b.ramp.lowY - sz * b.max.z; break;
    }
    const a = dy - sx * dx - sz * dz; // rate at which the ray rises above the surface
    const g0 = oy - sx * ox - sz * oz - c; // height of the origin above it
    if (Math.abs(a) < EPS) {
      if (g0 > 0) return -1;
    } else {
      const t = -g0 / a;
      if (a > 0) {
        if (t < tmax) tmax = t;
      } else if (t > tmin) {
        tmin = t;
        const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
        nx = -sx * inv; ny = inv; nz = -sz * inv;
      }
      if (tmin > tmax) return -1;
    }
  }
  if (tmin <= 0) return -1; // origin inside (or touching) the box
  normalOut.x = nx;
  normalOut.y = ny;
  normalOut.z = nz;
  return tmin;
}

/** Ray vs sphere. Returns entry distance or -1. `dir` must be a unit vector. */
export function raySphere(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  r: number,
  maxDist: number,
): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  if (t < 0 || t > maxDist) return -1;
  return t;
}
