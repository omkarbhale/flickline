import { cloneTunables } from '../config/tunables';
import type { EnemyWorld } from './fsm';
import type { PlayerState } from './types';
import { vec3 } from '../core/vec3';

/**
 * A do-nothing `EnemyWorld` for tests that drive a target field without a `World`: the player
 * stands at the origin, nothing blocks sight, nothing fires.
 */
export function createStubEnemyWorld(): EnemyWorld {
  const m = cloneTunables().movement;
  const player: PlayerState = {
    pos: vec3(), prevPos: vec3(), vel: vec3(), yaw: 0, pitch: 0, grounded: true, crouching: false,
    height: m.standHeight, eyeHeight: m.standEyeHeight, prevEyeHeight: m.standEyeHeight, stepAccum: 0, tagScale: 1, aimPunch: 0,
  };
  return {
    firing: false,
    player,
    boxes: [],
    enemyWeapon: 'kestrel',
    playerMoving: () => false,
    hitPlayer: () => false,
  };
}
