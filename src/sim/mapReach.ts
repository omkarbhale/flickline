import type { MovementTunables } from '../config/movement';
import type { Vec3 } from '../core/vec3';
import { hullBlocked, supportBelow } from './collision';
import type { BoxDef } from './types';

/**
 * Which floor can a player on foot reach? A flood fill over a grid of hull-sized cells using the
 * same rules as `stepBody`: from a cell you may walk to a neighbour whose floor is no more than
 * `stepHeight` above your feet (stairs, ledges, ramps) or any distance below (you walk off an
 * edge), provided the standing hull fits there. Jumps are not counted: every raised hold must be
 * reachable by walking, so it is reachable by everyone. Used by the map lint; allocates freely
 * (it runs once per map, in the lint CLI and in tests, never in the game).
 *
 * With `within`, the fill stays inside that horizontal box (a sector's region): a point is then
 * reachable only if a walk that never leaves the box gets there.
 */
export interface WalkReach {
  /** True if a level within `tolY` of `y` was reached in the cell containing (x, z) or one of its neighbours. */
  reaches(x: number, y: number, z: number, tolY: number): boolean;
  /** Cells visited (a sanity number for reports). */
  readonly cells: number;
}

const CELL = 0.3;
/** Two floors closer than this in one cell are the same floor. */
const LEVEL_MERGE = 0.02;

export function walkReach(
  boxes: readonly BoxDef[],
  bounds: { min: Vec3; max: Vec3 },
  start: Vec3,
  mv: MovementTunables,
  within?: { min: Vec3; max: Vec3 },
): WalkReach {
  const hw = mv.hullHalfWidth;
  const step = mv.stepHeight;
  const x0 = bounds.min.x;
  const z0 = bounds.min.z;
  const nx = Math.ceil((bounds.max.x - x0) / CELL) + 1;
  const nz = Math.ceil((bounds.max.z - z0) / CELL) + 1;
  const levels = new Map<number, number[]>();
  const queue: { ix: number; iz: number; y: number }[] = [];
  let cells = 0;

  const cx = (ix: number): number => x0 + ix * CELL;
  const cz = (iz: number): number => z0 + iz * CELL;
  const visit = (ix: number, iz: number, y: number): void => {
    const key = iz * nx + ix;
    let list = levels.get(key);
    if (list === undefined) {
      list = [];
      levels.set(key, list);
    }
    for (const l of list) if (Math.abs(l - y) < LEVEL_MERGE) return;
    list.push(y);
    queue.push({ ix, iz, y });
    cells++;
  };

  const sx = Math.round((start.x - x0) / CELL);
  const sz = Math.round((start.z - z0) / CELL);
  visit(sx, sz, start.y);

  for (let head = 0; head < queue.length; head++) {
    const { ix, iz, y } = queue[head]!;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const jx = ix + dx;
        const jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        const px = cx(jx);
        const pz = cz(jz);
        if (within !== undefined && (px < within.min.x || px > within.max.x || pz < within.min.z || pz > within.max.z)) continue;
        const floor = supportBelow(boxes, px, pz, hw, y + step);
        if (floor === -Infinity) continue; // nothing to stand on
        if (hullBlocked(boxes, px, floor, pz, hw, mv.standHeight)) continue;
        // Walking straight across a cell border must also fit: check the midpoint on the way.
        const mx = (cx(ix) + px) / 2;
        const mz = (cz(iz) + pz) / 2;
        const mid = Math.max(y, floor);
        if (hullBlocked(boxes, mx, mid, mz, hw, mv.standHeight)) continue;
        visit(jx, jz, floor);
      }
    }
  }

  return {
    cells,
    reaches(x, y, z, tolY) {
      const ix = Math.round((x - x0) / CELL);
      const iz = Math.round((z - z0) / CELL);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = levels.get((iz + dz) * nx + (ix + dx));
          if (list === undefined) continue;
          for (const l of list) if (Math.abs(l - y) <= tolY) return true;
        }
      }
      return false;
    },
  };
}
