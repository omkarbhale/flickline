import type { BoxDef } from '../sim/types';
import type { RenderTunables } from '../config/render';

/**
 * Pure helpers (no three.js) deciding what the Lightline environment draws for a level; kept
 * separate so they are unit-testable without WebGL.
 */

/** The 12 edges of a box as pairs of corner indices; corner bit 0 = x, bit 1 = y, bit 2 = z (max side if set). */
export const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/** Whether a box is a pillar: tall and narrow in both horizontal directions. */
export function isPillar(b: BoxDef, cfg: RenderTunables['blob']): boolean {
  if (b.tag === 'floor') return false;
  const dx = b.max.x - b.min.x;
  const dz = b.max.z - b.min.z;
  const h = b.max.y - b.min.y;
  return h >= cfg.pillarMinHeight && dx <= cfg.pillarMaxFootprint && dz <= cfg.pillarMaxFootprint;
}

/**
 * Trim edges for a level, as a flat array of segment endpoints (x,y,z, x,y,z, ...). Non-floor
 * boxes get all 12 edges; floor slabs only the outline of their top face.
 */
export function trimSegments(boxes: readonly BoxDef[]): number[] {
  const out: number[] = [];
  for (const b of boxes) {
    for (let e = 0; e < BOX_EDGES.length; e++) {
      const [i0, i1] = BOX_EDGES[e]!;
      if (b.tag === 'floor' && !((i0 & 2) !== 0 && (i1 & 2) !== 0)) continue; // top face edges only
      out.push(
        i0 & 1 ? b.max.x : b.min.x, i0 & 2 ? b.max.y : b.min.y, i0 & 4 ? b.max.z : b.min.z,
        i1 & 1 ? b.max.x : b.min.x, i1 & 2 ? b.max.y : b.min.y, i1 & 4 ? b.max.z : b.min.z,
      );
    }
  }
  return out;
}
