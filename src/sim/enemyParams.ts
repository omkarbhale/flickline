import type { FireParams, StrafeParams } from './enemyAi';

/**
 * The dial's numbers for one enemy, from a `DialAxes`-shaped object (`adaptive/dial.ts`
 * `axes(dial)`), without the sim importing the adaptive layer: the structural subsets below are
 * what the Strafer, Peeker and the shooting model read. A mode spawns with
 * `{ strafe: straferParams(axes), fire: fireParams(axes) }`.
 */

export interface StraferAxes {
  strafeSpeed: number;
  strafeLegSec: number;
  standStillSec: number;
}

export interface FireAxes {
  tellSec: number;
  enemyReactionSec: number;
  enemyHitChance: number;
}

export interface PeekAxes {
  peekWideSec: number;
}

export function straferParams(a: StraferAxes): StrafeParams {
  return { speed: a.strafeSpeed, legSec: a.strafeLegSec, standStillSec: a.standStillSec };
}

export function fireParams(a: FireAxes, extra?: Partial<FireParams>): FireParams {
  return { tellSec: a.tellSec, reactionSec: a.enemyReactionSec, hitChance: a.enemyHitChance, ...extra };
}
