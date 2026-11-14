import type { PeekTunables } from '../config/enemies';
import { secondsToTicks, TICK_DT } from '../core/time';
import { arriveStep } from './arrival';
import type { PeekParams } from './enemyAi';
import { fireBusy, fireReset, fireStep } from './enemyFire';
import { bodyExposure } from './exposure';
import {
  fsmSetTimerRange, fsmSetTimerTicks, STAY, type Behaviour, type BehaviourContext, type BehaviourState,
} from './fsm';
import type { PeekPattern } from './mapTypes';
import type { TargetState } from './types';

/**
 * Peeker (design §5.2): an Echo behind cover that steps out in one of four patterns, from a
 * map's `peek` anchor (`hold` hidden behind the cover, `out` the full step out):
 *
 *   shoulder  exposes 40% of the body for 0.3 s
 *   wide      the full body for 0.8-1.2 s (or the dial's wide exposure); where enemies shoot back it
 *             fires one or two bursts, the first with a tell, and stays out until its burst is done
 *   jiggle    shoulder out, in, out (0.15, 0.12, 0.15 s), then back
 *   hop       stands up above low cover for 0.35 s: head and upper body only
 *
 * "40% of the body" is measured, not assumed: at the start of each step the position between
 * `hold` and `out` is solved by raycast against the level's boxes (`sim/exposure.ts`) so that
 * the stated fraction of the body is visible from the player's eye at that moment.
 */

export const PEEK_HIDDEN = 0;
export const PEEK_MOVE = 1;
export const PEEK_HOLD = 2;
export const PEEK_BACK = 3;
/** Walking its route in to its cover (hold sectors, `sim/arrival.ts`): the state of an arriving Peeker until it is behind its cover. */
export const PEEK_ARRIVE = 4;

/** One step of a pattern: how much of the body to show, for how long, and whether it stands up. */
export interface PeekStep {
  exposure: number;
  holdSec: number;
  stand: boolean;
}

const stepScratch: PeekStep = { exposure: 0, holdSec: 0, stand: false };

/** Steps in a pattern. */
export function peekStepCount(pattern: PeekPattern): number {
  return pattern === 'jiggle' ? 3 : 1;
}

/** Step `i` of `pattern` into `out` (the wide peek's duration is `wideSec`). */
export function peekStep(pattern: PeekPattern, i: number, cfg: PeekTunables, wideSec: number, out: PeekStep): PeekStep {
  switch (pattern) {
    case 'shoulder':
      out.exposure = cfg.shoulder.exposure; out.holdSec = cfg.shoulder.holdSec; out.stand = false;
      break;
    case 'wide':
      out.exposure = cfg.wide.exposure; out.holdSec = wideSec; out.stand = false;
      break;
    case 'jiggle':
      out.exposure = i === 1 ? 0 : cfg.jiggle.exposure;
      out.holdSec = i === 1 ? cfg.jiggle.inSec : cfg.jiggle.outSec;
      out.stand = false;
      break;
    default: // hop
      out.exposure = 0; out.holdSec = cfg.hop.holdSec; out.stand = true;
      break;
  }
  return out;
}

/** Set a freshly spawned Peeker's anchor and pattern (before its FSM starts). */
export function peekInit(t: TargetState, p: PeekParams | undefined): void {
  const a = t.ai;
  if (p) {
    a.pattern = p.pattern;
    a.hold.x = p.hold.x; a.hold.y = p.hold.y; a.hold.z = p.hold.z;
    a.out.x = p.out.x; a.out.y = p.out.y; a.out.z = p.out.z;
    a.wideSec = p.wideSec ?? 0;
    a.crouchedHold = p.crouchedHold ?? t.crouched;
  } else {
    // No anchor: it holds where it spawned and steps one metre to its right of the player's view.
    a.pattern = 'shoulder';
    a.hold.x = t.pos.x; a.hold.y = t.pos.y; a.hold.z = t.pos.z;
    a.out.x = t.pos.x + 1; a.out.y = t.pos.y; a.out.z = t.pos.z;
    a.wideSec = 0;
    a.crouchedHold = t.crouched;
  }
  a.u = 0;
  a.uTarget = 0;
  a.step = 0;
  t.crouched = a.crouchedHold;
  placeOnPath(t);
  t.prevPos.x = t.pos.x; t.prevPos.y = t.pos.y; t.prevPos.z = t.pos.z;
}

function placeOnPath(t: TargetState): void {
  const a = t.ai;
  t.pos.x = a.hold.x + (a.out.x - a.hold.x) * a.u;
  t.pos.y = a.hold.y + (a.out.y - a.hold.y) * a.u;
  t.pos.z = a.hold.z + (a.out.z - a.hold.z) * a.u;
}

/**
 * The position on the hold-to-out path (0..1) at which `fraction` of the body is visible from the
 * player's eye now: bisection on the exposure raycast. A fraction the path cannot reach gives 1.
 */
export function solvePeekU(t: TargetState, ctx: BehaviourContext, fraction: number): number {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.peek;
  const hit = ctx.tunables.targets.hit;
  const p = ctx.world.player;
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
  const boxes = ctx.world.boxes;
  const at = (u: number): number =>
    bodyExposure(
      boxes, hit, t.crouched, ex, ey, ez,
      a.hold.x + (a.out.x - a.hold.x) * u, a.hold.y + (a.out.y - a.hold.y) * u, a.hold.z + (a.out.z - a.hold.z) * u,
      cfg.solveColumns, cfg.solveRows,
    );
  if (at(1) <= fraction) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < cfg.solveSteps; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < fraction) lo = mid; else hi = mid;
  }
  return hi;
}

/** Fraction of the path covered per tick at the peek speed. */
function stepPerTick(t: TargetState, ctx: BehaviourContext): number {
  const a = t.ai;
  const dx = a.out.x - a.hold.x, dy = a.out.y - a.hold.y, dz = a.out.z - a.hold.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return len < 1e-6 ? 1 : (ctx.tunables.enemies.peek.speedMps * TICK_DT) / len;
}

/** Move `u` towards its target; true when it has arrived. */
function slide(t: TargetState, ctx: BehaviourContext): boolean {
  const a = t.ai;
  const d = a.uTarget - a.u;
  const step = stepPerTick(t, ctx);
  a.u = Math.abs(d) <= step ? a.uTarget : a.u + Math.sign(d) * step;
  placeOnPath(t);
  return a.u === a.uTarget;
}

const hidden: BehaviourState = {
  name: 'hidden',
  enter(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.peek;
    a.u = 0;
    a.uTarget = 0;
    a.step = 0;
    t.crouched = a.crouchedHold;
    placeOnPath(t);
    fireReset(a);
    fsmSetTimerRange(t, ctx.rng, cfg.hiddenMinSec, cfg.hiddenMaxSec);
  },
  update(t, ctx) {
    fireStep(t, ctx, false);
    return STAY;
  },
  onTimer(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.peek;
    // One draw per peek, always: the wide exposure's jitter (unused by the other patterns).
    const j = (ctx.rng.next() * 2 - 1) * cfg.wide.jitter;
    const base = a.wideSec > 0 ? a.wideSec : cfg.wide.defaultSec;
    a.wideDrawSec = Math.max(ctx.tunables.dial.floors.exposureSec, base * (1 + j));
    a.step = 0;
    return PEEK_MOVE;
  },
};

const move: BehaviourState = {
  name: 'move',
  enter(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.peek;
    peekStep(a.pattern, a.step, cfg, a.wideDrawSec, stepScratch);
    a.uTarget = stepScratch.stand || stepScratch.exposure <= 0 ? 0 : solvePeekU(t, ctx, stepScratch.exposure);
  },
  update(t, ctx) {
    fireStep(t, ctx, false);
    return slide(t, ctx) ? PEEK_HOLD : STAY;
  },
};

const hold: BehaviourState = {
  name: 'hold',
  enter(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.peek;
    peekStep(a.pattern, a.step, cfg, a.wideDrawSec, stepScratch);
    if (stepScratch.stand) t.crouched = false;
    const ticks = secondsToTicks(stepScratch.holdSec);
    fsmSetTimerTicks(t, ticks);
    a.windowEndTick = ctx.tick + ticks;
  },
  update(t, ctx) {
    // Only a wide peek shoots (the others are baits and looks): its tell starts the moment it is out.
    fireStep(t, ctx, t.ai.pattern === 'wide');
    return STAY;
  },
  onTimer(t) {
    const a = t.ai;
    // A tell or burst in progress is finished before it ducks back.
    if (fireBusy(a)) {
      fsmSetTimerTicks(t, 1);
      return STAY;
    }
    t.crouched = a.crouchedHold;
    a.step++;
    return a.step < peekStepCount(a.pattern) ? PEEK_MOVE : PEEK_BACK;
  },
};

const back: BehaviourState = {
  name: 'back',
  enter(t) {
    t.ai.uTarget = 0;
    fireReset(t.ai);
  },
  update(t, ctx) {
    return slide(t, ctx) ? PEEK_HIDDEN : STAY;
  },
};

const arrive: BehaviourState = {
  name: 'arrive',
  enter(t) {
    t.crouched = false;
  },
  update(t, ctx) {
    if (!arriveStep(t, ctx, false)) return STAY;
    t.ai.arriving = false;
    return PEEK_HIDDEN;
  },
};

export const peekerBehaviour: Behaviour = {
  name: 'peeker',
  states: [hidden, move, hold, back, arrive],
  initial: PEEK_HIDDEN,
  arrive: PEEK_ARRIVE,
};
