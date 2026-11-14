import type { RunTunables } from '../config/run';
import { DEG2RAD } from '../core/math';
import { supportBelow } from './collision';
import type { LevelDef, PlayerState } from './types';

/**
 * Where the crosshair should be for the next enemy while nobody is in view (design section 3,
 * head-height discipline): at the head centre of the enemy the player is most likely to meet, not
 * at the player's own eye height. On a raised floor (a catwalk, a ramp, a ledge) the two differ by
 * metres, and an enemy on stairs or below you has a head height that is not yours.
 *
 * The expected enemy is the nearest-to-the-line-of-sight one of the level's expected enemy feet
 * (anchors: posts, gates, peeks, lane ends) inside a cone around the view direction. With no
 * anchor in view (or a level without anchors) it falls back to an enemy standing on the floor
 * `headHeightRefDistance` metres ahead, which on flat ground is exactly the old definition.
 */
export interface ExpectedHead {
  /** World height of the expected head centre. */
  headY: number;
  /** Horizontal distance to it, metres. */
  dist: number;
}

export function createExpectedHead(): ExpectedHead {
  return { headY: 0, dist: 1 };
}

export function expectedHead(
  out: ExpectedHead,
  level: LevelDef,
  p: PlayerState,
  run: RunTunables,
  headCentreStand: number,
): ExpectedHead {
  const ex = p.pos.x;
  const ez = p.pos.z;
  const ey = p.pos.y + p.eyeHeight;
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);

  const feet = level.enemyFeet;
  if (feet !== undefined) {
    const minCos = Math.cos(run.headHeightConeDeg * DEG2RAD);
    let bestCos = minCos;
    let bestIndex = -1;
    let bestDist = 0;
    for (let i = 0; i < feet.length; i++) {
      const q = feet[i]!;
      const dx = q.x - ex;
      const dz = q.z - ez;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < run.headHeightMinDistance || d > run.headHeightMaxDistance) continue;
      const c = (dx * fx + dz * fz) / d;
      if (c > bestCos) {
        bestCos = c;
        bestIndex = i;
        bestDist = d;
      }
    }
    if (bestIndex >= 0) {
      out.headY = feet[bestIndex]!.y + headCentreStand;
      out.dist = bestDist;
      return out;
    }
  }

  // No anchor ahead: an enemy standing on whatever floor is `headHeightRefDistance` metres ahead.
  const d = run.headHeightRefDistance;
  let floor = supportBelow(level.boxes, ex + fx * d, ez + fz * d, 0, ey);
  if (floor === -Infinity) floor = p.pos.y;
  out.headY = floor + headCentreStand;
  out.dist = d;
  return out;
}
