import type { Vec3 } from '../core/vec3';
import type { MovementTunables } from '../config/movement';
import { createRay, type Ray } from './hitZones';
import type { BoxDef, PlayerState } from './types';

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
 * `hullOverlaps` for the player's hull against one box, taking the player and the tunables rather
 * than the position, half-width and height as numbers (V8 boxes every double passed to a function
 * it does not inline, architecture §7), and `hullBlockedBy` for all boxes. Used by the movers below.
 */
function hullHits(p: PlayerState, m: MovementTunables, b: BoxDef): boolean {
  const pos = p.pos;
  const hw = m.hullHalfWidth;
  if (
    pos.x - hw < b.max.x - SKIN &&
    pos.x + hw > b.min.x + SKIN &&
    pos.y < b.max.y - SKIN &&
    pos.y + p.height > b.min.y + SKIN &&
    pos.z - hw < b.max.z - SKIN &&
    pos.z + hw > b.min.z + SKIN
  ) {
    return b.ramp === undefined || pos.y < restHeight(b, pos.x, pos.z, hw) - SKIN;
  }
  return false;
}

/** Whether the player's hull, at its position and with its height, intersects any box. */
export function hullBlockedBy(boxes: readonly BoxDef[], p: PlayerState, m: MovementTunables): boolean {
  for (let i = 0; i < boxes.length; i++) if (hullHits(p, m, boxes[i]!)) return true;
  return false;
}

/** Whether the standing hull at the player's position (`m.standHeight` tall, whatever the player's height now) intersects any box: room to stand up. */
export function standBlocked(boxes: readonly BoxDef[], p: PlayerState, m: MovementTunables): boolean {
  const h = p.height;
  p.height = m.standHeight;
  const blocked = hullBlockedBy(boxes, p, m);
  p.height = h;
  return blocked;
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
 * The hull movers below take the player and the tunables, not the half-width, height, step height
 * and delta as numbers, and hand the delta to the shared core through this one-slot scratch.
 * V8 passes arguments to a function it does not inline as boxed heap numbers, so a call with a
 * freshly computed or loaded double allocates once per double per call (architecture §7 rule 1);
 * objects, integers and a typed-array store do not.
 */
const sweepDelta = new Float64Array(1);

/**
 * Move the hull along `axis` by `sweepDelta[0]` and resolve overlaps. Returns true if blocked (the
 * move was truncated by a box).
 */
function sweepAxis(boxes: readonly BoxDef[], p: PlayerState, axis: Axis, m: MovementTunables): boolean {
  const delta = sweepDelta[0]!;
  if (delta === 0) return false;
  const pos = p.pos;
  const hw = m.hullHalfWidth;
  const h = p.height;
  // Explicit branches, not `pos[axis] += delta`: a keyed double store boxes a heap number per call.
  if (axis === 'x') pos.x += delta;
  else if (axis === 'z') pos.z += delta;
  else pos.y += delta;
  let blocked = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullHits(p, m, b)) continue;
    blocked = true;
    if (axis === 'x') pos.x = delta > 0 ? b.min.x - hw : b.max.x + hw;
    else if (axis === 'z') pos.z = delta > 0 ? b.min.z - hw : b.max.z + hw;
    else pos.y = delta > 0 ? b.min.y - h : b.ramp === undefined ? b.max.y : restHeight(b, pos.x, pos.z, hw);
  }
  return blocked;
}

/**
 * Move the player's hull along `axis` by its velocity on that axis for `dt` seconds and resolve
 * overlaps. Returns true if blocked (the move was truncated by a box).
 */
export function moveAxis(boxes: readonly BoxDef[], p: PlayerState, axis: Axis, dt: number, m: MovementTunables): boolean {
  sweepDelta[0] = (axis === 'x' ? p.vel.x : axis === 'z' ? p.vel.z : p.vel.y) * dt;
  return sweepAxis(boxes, p, axis, m);
}

/**
 * Like `moveAxis` for a horizontal axis, but a hull that would be blocked only by surfaces at most
 * `stepHeight` above its feet (a stair, a ledge, the slope of a ramp) is lifted onto them instead,
 * provided the lifted hull has headroom. Returns true if the move was truncated (a real wall).
 * Call it only while the player is grounded: a jumping hull does not step.
 */
export function moveAxisStep(boxes: readonly BoxDef[], p: PlayerState, axis: 'x' | 'z', dt: number, m: MovementTunables): boolean {
  const delta = (axis === 'x' ? p.vel.x : p.vel.z) * dt;
  if (delta === 0) return false;
  const pos = p.pos;
  const hw = m.hullHalfWidth;
  if (axis === 'x') pos.x += delta;
  else pos.z += delta;
  let top = -Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullHits(p, m, b)) continue;
    const t = b.ramp === undefined ? b.max.y : restHeight(b, pos.x, pos.z, hw);
    if (t > top) top = t;
  }
  if (top === -Infinity) return false; // free
  if (top - pos.y <= m.stepHeight) {
    const y0 = pos.y;
    pos.y = top;
    if (!hullBlockedBy(boxes, p, m)) return false; // stepped up
    pos.y = y0; // no headroom: it is a wall after all
  }
  let blocked = false;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]!;
    if (!hullHits(p, m, b)) continue;
    blocked = true;
    if (axis === 'x') pos.x = delta > 0 ? b.min.x - hw : b.max.x + hw;
    else pos.z = delta > 0 ? b.min.z - hw : b.max.z + hw;
  }
  return blocked;
}

/**
 * Keep a grounded hull on the ground it is walking over: if the first surface below is at most
 * `m.stepHeight` down, move onto it and return true; otherwise leave `pos` untouched and return
 * false (a real drop, so the caller lets gravity take over). This is what stops walking down
 * stairs or a ramp from being a series of tiny falls.
 */
export function snapDown(boxes: readonly BoxDef[], p: PlayerState, m: MovementTunables): boolean {
  const y0 = p.pos.y;
  sweepDelta[0] = -m.stepHeight;
  if (sweepAxis(boxes, p, 'y', m)) return true;
  p.pos.y = y0;
  return false;
}

const blockScratch: Vec3 = { x: 0, y: 0, z: 0 };
const losRay = createRay();
const rayBoxScratch = createRay();
/** Entry distance of the last `rayBoxHit` hit. A one-slot typed array: a double returned from a function V8 does not inline is boxed. */
const boxT = new Float64Array(1);

/**
 * Whether a box lies on the unit-direction ray from (`ox`, `oy`, `oz`) before it has gone `dist` metres (less a 1 mm margin): line of sight is blocked. Allocates nothing.
 * The ray goes through a scratch object because V8 boxes every double passed to a function it does not inline (architecture §7).
 */
export function lineBlocked(
  boxes: readonly BoxDef[],
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number,
): boolean {
  losRay.ox = ox; losRay.oy = oy; losRay.oz = oz;
  losRay.dx = dx; losRay.dy = dy; losRay.dz = dz;
  losRay.maxDist = dist;
  return lineBlockedRay(boxes, losRay);
}

/** `lineBlocked` for a ray in an object: `ray.maxDist` is the distance to the far end of the line. Takes no doubles, so it allocates nothing however V8 inlines it. */
export function lineBlockedRay(boxes: readonly BoxDef[], ray: Ray): boolean {
  const dist = ray.maxDist;
  ray.maxDist = dist - 0.001;
  let blocked = false;
  for (let i = 0; i < boxes.length; i++) {
    if (rayBoxHit(ray, boxes[i]!, blockScratch) && boxT[0]! < ray.maxDist) { blocked = true; break; }
  }
  ray.maxDist = dist;
  return blocked;
}

/**
 * Ray vs AABB (slab method), the ray in an object. True on a hit no further than `ray.maxDist`,
 * with the entry distance along the (unit) direction in `boxT[0]` and the hit normal written to
 * `normalOut`. Rays starting inside a box are ignored.
 */
function rayBoxHit(ray: Ray, b: BoxDef, normalOut: Vec3): boolean {
  let nx = 0, ny = 0, nz = 0;
  const ox = ray.ox, oy = ray.oy, oz = ray.oz, dx = ray.dx, dy = ray.dy, dz = ray.dz;
  let tmin = 0;
  let tmax = ray.maxDist;

  // X slab
  if (Math.abs(dx) < EPS) {
    if (ox < b.min.x || ox > b.max.x) return false;
  } else {
    let t1 = (b.min.x - ox) / dx;
    let t2 = (b.max.x - ox) / dx;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Y slab
  if (Math.abs(dy) < EPS) {
    if (oy < b.min.y || oy > b.max.y) return false;
  } else {
    let t1 = (b.min.y - oy) / dy;
    let t2 = (b.max.y - oy) / dy;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; nz = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
  }
  // Z slab
  if (Math.abs(dz) < EPS) {
    if (oz < b.min.z || oz > b.max.z) return false;
  } else {
    let t1 = (b.min.z - oz) / dz;
    let t2 = (b.max.z - oz) / dz;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = 0; nz = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return false;
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
      if (g0 > 0) return false;
    } else {
      const t = -g0 / a;
      if (a > 0) {
        if (t < tmax) tmax = t;
      } else if (t > tmin) {
        tmin = t;
        const inv = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
        nx = -sx * inv; ny = inv; nz = -sz * inv;
      }
      if (tmin > tmax) return false;
    }
  }
  if (tmin <= 0) return false; // origin inside (or touching) the box
  normalOut.x = nx;
  normalOut.y = ny;
  normalOut.z = nz;
  boxT[0] = tmin;
  return true;
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
  const r = rayBoxScratch;
  r.ox = ox; r.oy = oy; r.oz = oz; r.dx = dx; r.dy = dy; r.dz = dz; r.maxDist = maxDist;
  return rayBoxHit(r, b, normalOut) ? boxT[0]! : -1;
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
