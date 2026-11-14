import type { Vec3 } from '../core/vec3';
import type { BoxDef } from './types';

/**
 * Axis-aligned box collision. Robust for walking speeds: the player moves one axis at a time
 * (X, then Z, then Y) and is pushed out of any box it overlaps. Max travel per tick is a few cm,
 * far below the thinnest wall, so tunnelling cannot happen. Brute force over boxes is fine for
 * small maps; add a uniform grid broadphase when maps get large (see architecture issue).
 */

const EPS = 1e-9;

function overlaps(px: number, py: number, pz: number, hw: number, h: number, b: BoxDef): boolean {
  return (
    px - hw < b.max.x &&
    px + hw > b.min.x &&
    py < b.max.y &&
    py + h > b.min.y &&
    pz - hw < b.max.z &&
    pz + hw > b.min.z
  );
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
  for (let i = 0; i < boxes.length; i++) if (overlaps(px, py, pz, hw, h, boxes[i]!)) return true;
  return false;
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
    if (!overlaps(pos.x, pos.y, pos.z, hw, h, b)) continue;
    blocked = true;
    if (axis === 'x') pos.x = delta > 0 ? b.min.x - hw : b.max.x + hw;
    else if (axis === 'z') pos.z = delta > 0 ? b.min.z - hw : b.max.z + hw;
    else pos.y = delta > 0 ? b.min.y - h : b.max.y;
  }
  return blocked;
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
