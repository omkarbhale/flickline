import type { HitTunables } from '../config/targets';
import { vec3 } from '../core/vec3';
import { rayBox } from './collision';
import type { BoxDef } from './types';

/**
 * How much of an Echo a viewer can see, by raycast (design §5.2 peek patterns: "shoulder exposes
 * 40% of the body"). A grid of sample points is laid over the body's silhouette (across its
 * width, up its height) and each is traced to the eye against the level's boxes; the fraction that
 * arrives is the exposure. Pure geometry on plain numbers, allocation-free (module scratch), so
 * the Peeker FSM can solve a step-out position at runtime and a test can check the result with
 * a finer grid.
 */

const NORMAL = vec3();

/** True when no box lies between the two points. */
export function lineClear(boxes: readonly BoxDef[], ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return true;
  const inv = 1 / dist;
  const ux = dx * inv, uy = dy * inv, uz = dz * inv;
  const limit = dist - 0.001;
  for (let i = 0; i < boxes.length; i++) {
    const hit = rayBox(ox, oy, oz, ux, uy, uz, boxes[i]!, limit, NORMAL);
    if (hit >= 0 && hit < limit) return false;
  }
  return true;
}

/** Top of a humanoid's hit volume (the head's crown), standing or crouched. */
export function bodyTop(h: HitTunables, crouched: boolean): number {
  return (crouched ? h.headCentreCrouch : h.headCentreStand) + h.headRadius;
}

/**
 * Fraction of a humanoid with feet at (`fx`, `fy`, `fz`) that the eye at (`ex`, `ey`, `ez`) sees,
 * over the height band `y0`..`y1` above the feet (clamped to the body), sampled on `columns` x
 * `rows` points across the torso width. 0 = hidden, 1 = every sample visible.
 */
export function bandExposure(
  boxes: readonly BoxDef[], h: HitTunables, crouched: boolean,
  ex: number, ey: number, ez: number, fx: number, fy: number, fz: number,
  y0: number, y1: number, columns: number, rows: number,
): number {
  const top = bodyTop(h, crouched);
  const lo = Math.max(0, y0), hi = Math.min(top, y1);
  if (hi <= lo || columns < 1 || rows < 1) return 0;
  // Lateral axis: square to the line of sight on the ground plane.
  let lx = -(fz - ez), lz = fx - ex;
  const ll = Math.sqrt(lx * lx + lz * lz);
  if (ll < 1e-9) { lx = 1; lz = 0; } else { lx /= ll; lz /= ll; }
  const half = h.torsoWidth / 2;
  let seen = 0;
  for (let r = 0; r < rows; r++) {
    const y = fy + lo + ((r + 0.5) / rows) * (hi - lo);
    for (let c = 0; c < columns; c++) {
      const off = ((c + 0.5) / columns - 0.5) * 2 * half;
      if (lineClear(boxes, ex, ey, ez, fx + lx * off, y, fz + lz * off)) seen++;
    }
  }
  return seen / (columns * rows);
}

/** The whole body (feet to crown). */
export function bodyExposure(
  boxes: readonly BoxDef[], h: HitTunables, crouched: boolean,
  ex: number, ey: number, ez: number, fx: number, fy: number, fz: number,
  columns: number, rows: number,
): number {
  return bandExposure(boxes, h, crouched, ex, ey, ez, fx, fy, fz, 0, bodyTop(h, crouched), columns, rows);
}
