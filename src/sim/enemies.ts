import type { BehaviourId } from '../config/targets';
import { moveTowards } from '../core/math';
import { TICK_RATE } from '../core/time';
import { fsmSetTimerRange, STAY, type Behaviour, type BehaviourContext, type BehaviourState } from './fsm';
import { peekerBehaviour } from './peeker';
import { straferBehaviour } from './strafer';
import type { TargetState } from './types';

/**
 * Behaviours (FSM tables) for the roster. The roster itself (shape, tags, radius) is data in
 * `config/targets.ts`; this file holds only the code each `BehaviourId` needs. Strafer and Peeker
 * live in `strafer.ts` / `peeker.ts` (they share the shooting model in `enemyFire.ts`); later
 * enemies (#33) add a table and an entry in `BEHAVIOURS`.
 */

// ---------------------------------------------------------------------------------------------
// Post: a standing Echo with idle sway. Stationary; the sway is presentation only (the hit zones
// never move), but it is simulated so it is seeded, replayable and interpolated like all motion.
// ---------------------------------------------------------------------------------------------

const POST_IDLE = 0;
const POST_SWAY = 1;

/** Ease the sway towards its target at a rate that covers the amplitude in `smoothSec`. */
function easeSway(t: TargetState, ctx: BehaviourContext): number {
  const s = ctx.tunables.targets.sway;
  const step = s.amplitude / Math.max(1, s.smoothSec * TICK_RATE);
  t.sway = moveTowards(t.sway, t.swayTarget, step);
  return STAY;
}

const postIdle: BehaviourState = {
  name: 'idle',
  enter(t, ctx) {
    const s = ctx.tunables.targets.sway;
    t.swayTarget = 0;
    fsmSetTimerRange(t, ctx.rng, s.idleMinSec, s.idleMaxSec);
  },
  update: easeSway,
  onTimer: () => POST_SWAY,
};

const postSway: BehaviourState = {
  name: 'sway',
  enter(t, ctx) {
    const s = ctx.tunables.targets.sway;
    // Seeded direction and size: draws exactly two numbers from the world stream per sway.
    const dir = ctx.rng.next() < 0.5 ? -1 : 1;
    t.swayTarget = dir * s.amplitude * ctx.rng.range(0.5, 1);
    fsmSetTimerRange(t, ctx.rng, s.swayMinSec, s.swayMaxSec);
  },
  update: easeSway,
  onTimer: () => POST_IDLE,
};

export const postBehaviour: Behaviour = { name: 'post', states: [postIdle, postSway], initial: POST_IDLE };

// ---------------------------------------------------------------------------------------------
// Beacon: an orb that just hangs there. One state, no timers, no randomness.
// ---------------------------------------------------------------------------------------------

export const beaconBehaviour: Behaviour = {
  name: 'beacon',
  states: [{ name: 'hold' }],
  initial: 0,
};

export const BEHAVIOURS: Readonly<Record<BehaviourId, Behaviour>> = {
  post: postBehaviour,
  beacon: beaconBehaviour,
  strafer: straferBehaviour,
  peeker: peekerBehaviour,
};
