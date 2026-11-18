import { TICK_RATE } from '../core/time';
import type { BehaviourContext } from './fsm';
import type { TargetState } from './types';

/**
 * An enemy's running steps (design §12 "Footsteps", engagement-information §4.2): the same rule
 * the player's hearing and the enemy's hearing share. An Echo makes a step every
 * `audio.enemy.strideM` metres it covers on the ground *while its speed is above the walk*
 * (`audio.enemy.silentBelowMps`: a walk and a crouch-walk are silent, a run is not), and each step
 * is announced as `enemyFootstep` with `audibleToPlayer` (inside `attribution.soundRadiusM.footstep`
 * of the player, the same radius the Echo hears the player's steps at). The speed is read from where
 * the Echo actually moved this tick, so it is the shared body's own speed (#87: its acceleration,
 * braking and collision) and the kinematic walk of an arrival alike; nothing else decides whether it
 * is loud. A jump of more than `audio.enemy.teleportM` in one tick is a respawn and restarts the
 * count. Run for every humanoid Echo after it has moved this tick; allocates nothing.
 *
 * The first audible step of an arrival is also the sim's own fact that the player could hear it run
 * (`ai.audibleTick`, "audible before it fires", design §4.4), so the fact and the sound cannot disagree.
 */
export function stepEnemySteps(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const e = ctx.tunables.audio.enemy;
  const dx = t.pos.x - t.prevPos.x;
  const dz = t.pos.z - t.prevPos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > e.teleportM || !t.body.kin.grounded) {
    a.strideAccum = 0;
    return;
  }
  // Walking, standing or crouch-walking: no sound, and the metres walked quietly do not count towards the next step.
  if (d * TICK_RATE < e.silentBelowMps) return;
  a.strideAccum += d;
  if (a.strideAccum < e.strideM) return;
  a.strideAccum -= e.strideM;
  if (ctx.world.enemySound('footstep', ctx.events, ctx.tick, t) && a.honest && a.audibleTick < 0) a.audibleTick = ctx.tick;
}
