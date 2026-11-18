import type { EnemyFireTunables } from '../config/enemies';
import { TICK_RATE } from '../core/time';
import { lineClear } from './exposure';
import type { BehaviourContext } from './fsm';
import type { TargetState } from './types';

/**
 * What a shooting Echo shares between the dial-driven fire model (`enemyFire.ts`) and the enemy
 * mind (`mind/duel.ts`, #90): the sight test standing in for perception until #89, the muzzle
 * height, and tick rounding for the tell.
 */

/** Whole ticks that last at least `sec` (the tell floor must not round down). */
export function ceilTicks(sec: number): number {
  return Math.max(1, Math.ceil(sec * TICK_RATE - 1e-9));
}

/** Muzzle height of a target above the world origin (chest height, lower when crouched). */
export function muzzleY(t: TargetState, cfg: EnemyFireTunables): number {
  return t.pos.y + (t.crouched ? cfg.muzzleHeightCrouch : cfg.muzzleHeightStand);
}

/** Whether the enemy can see (and is in range of) the player's eye. */
export function seesPlayer(t: TargetState, ctx: BehaviourContext): boolean {
  const cfg = ctx.tunables.enemies.fire;
  const p = ctx.world.player;
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
  const mx = t.pos.x, my = muzzleY(t, cfg), mz = t.pos.z;
  const dx = ex - mx, dy = ey - my, dz = ez - mz;
  if (dx * dx + dy * dy + dz * dz > cfg.acquireRangeM * cfg.acquireRangeM) return false;
  return lineClear(ctx.world.boxes, mx, my, mz, ex, ey, ez);
}
