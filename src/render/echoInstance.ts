/**
 * Pure helpers for placing one enemy instance. Kept free of three.js so the transform maths is
 * unit-tested; the batch writes straight into the instance buffers with these.
 */

/** Floats per instance in a batch's `instanceMatrix` (a column-major 4x4). */
export const MATRIX_FLOATS = 16;
/** Floats per instance in a batch's `aState`: flash 0..1, dissolve 0..1, crouch 0|1, lean (m). */
export const STATE_FLOATS = 4;

/**
 * Write a yaw-rotation plus translation into `out` at instance `index` (column-major). Yaw
 * rotates about +Y by the three.js convention, so local +Z maps to (sin yaw, 0, cos yaw).
 * `x,y,z` is the feet centre for humanoids and the centre for orbs.
 */
export function writeInstanceMatrix(out: Float32Array, index: number, x: number, y: number, z: number, yaw: number): void {
  const o = index * MATRIX_FLOATS;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[o] = c; out[o + 1] = 0; out[o + 2] = -s; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = 1; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = s; out[o + 9] = 0; out[o + 10] = c; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}

/**
 * Yaw that turns an Echo's local +Z towards a viewer. An Echo always presents its front (the
 * silhouette width the hit zones are built for) to the player.
 */
export function yawTowards(x: number, z: number, viewerX: number, viewerZ: number): number {
  return Math.atan2(viewerX - x, viewerZ - z);
}

/**
 * Hit flash intensity 0..1 for a given age in seconds: full white for the first 60% of
 * `flashSec`, then a linear fade to nothing. 0 before the hit and from `flashSec` on.
 */
export function flashAmount(ageSec: number, flashSec: number): number {
  if (ageSec < 0 || ageSec >= flashSec) return 0;
  const hold = flashSec * 0.6;
  return ageSec <= hold ? 1 : 1 - (ageSec - hold) / (flashSec - hold);
}

/**
 * Where to put an Echo so that `exposure` (0..1) of its body width shows past a cover edge.
 * `edge` is the cover's edge coordinate along the axis the Echo steps out along, `side` is +1 if
 * the open side is towards +axis and -1 towards -axis, `width` the body width (`hit.torsoWidth`).
 * Returns the Echo's centre coordinate on that axis. The mesh is not clipped by cover (the cover
 * hides it by depth), so a peek is purely a transform: exposure 0 = fully behind the edge,
 * 1 = fully clear of it.
 */
export function peekCentre(edge: number, side: 1 | -1, exposure: number, width: number): number {
  const e = exposure < 0 ? 0 : exposure > 1 ? 1 : exposure;
  return edge + side * (e * width - width / 2);
}
