import { TICK_DT } from '../core/time';
import { arriveStep, walkReach } from './arrival';
import { FIRE_WAIT, type EnemyAi, type StrafeParams } from './enemyAi';
import { commandLookAt, commandMoveToward } from './enemyBody';
import { fireBusy, fireStep } from './enemyFire';
import { seesPlayer } from './enemySight';
import { mindWantsStop } from './mind/duel';
import {
  fsmSetTimerRange, fsmSetTimerTicks, STAY, type Behaviour, type BehaviourContext, type BehaviourState,
} from './fsm';
import { brakeDistance, brakeSpeed } from './movement';
import type { TargetState } from './types';

/**
 * Strafer (design §5.2, §9.4): an Echo that mirrors a strafing player. It runs a leg (0.35-1.0 s,
 * drawn up to the dial's leg), lets go of its strafe key and stops (spec §2.3: 0.16 s, the same
 * stop time at every speed), stands still (0.25-0.4 s by the dial), then strafes again, reversing
 * on a seeded coin. The stand-still is exactly the window where a counter-strafed shot is
 * accurate; where enemies shoot back it shoots in that window (its tell starts as it brakes, and it
 * does not move again until its burst is out).
 *
 * It plays through the shared body (#87, `sim/enemyBody.ts`): each tick its state writes a
 * command (face the player, hold the key that runs along the lane, or hold nothing) and the
 * player's own movement code accelerates, brakes and collides it. Its run speed is the dial's
 * strafe speed (the body's gait); acceleration and braking are the player's. The lane is a map's
 * `strafe-lane`, or a line square to the player at spawn; `ai.s` and `ai.vel` are the body's
 * position and velocity along it, read back after every step.
 */

export const STRAFER_LEG = 0;
export const STRAFER_DECEL = 1;
export const STRAFER_STAND = 2;
/** Walking its route in (hold sectors, `sim/arrival.ts`): the state of an arriving Strafer until it hands over to the legs. */
export const STRAFER_ARRIVE = 3;

/** Set a freshly spawned Strafer's lane and numbers (before its FSM starts; its body is already reset). */
export function strafeInit(t: TargetState, ctx: BehaviourContext, p: StrafeParams | undefined): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.strafer;
  a.speed = p?.speed ?? cfg.defaultSpeed;
  a.legSec = p?.legSec ?? cfg.defaultLegSec;
  a.standSec = p?.standStillSec ?? cfg.defaultStandStillSec;
  a.vel = 0;
  a.dir = 1;
  a.travel = p?.travel === true && p.laneA !== undefined && p.laneB !== undefined;
  t.body.gait.runSpeedMps = a.speed;
  const o = a.laneOrigin;
  if (p?.laneA && p.laneB) {
    let dx = p.laneB.x - p.laneA.x, dz = p.laneB.z - p.laneA.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len > 1e-6) { dx /= len; dz /= len; } else { dx = 1; dz = 0; }
    a.axis.x = dx; a.axis.y = 0; a.axis.z = dz;
    o.x = p.laneA.x; o.y = p.laneA.y; o.z = p.laneA.z;
    a.laneLen = len;
    a.s = Math.min(len, Math.max(0, (t.pos.x - o.x) * dx + (t.pos.z - o.z) * dz));
  } else {
    // Square to the line from the player: it strafes across the player's view.
    const pl = ctx.world.player;
    let fx = t.pos.x - pl.pos.x, fz = t.pos.z - pl.pos.z;
    const fl = Math.sqrt(fx * fx + fz * fz);
    if (fl > 1e-6) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
    a.axis.x = -fz; a.axis.y = 0; a.axis.z = fx;
    const half = cfg.freeHalfRangeM;
    o.x = t.pos.x - a.axis.x * half; o.y = t.pos.y; o.z = t.pos.z - a.axis.z * half;
    a.laneLen = half * 2;
    a.s = half;
  }
  placeOnLane(t);
  t.prevPos.x = t.pos.x; t.prevPos.y = t.pos.y; t.prevPos.z = t.pos.z;
}

/** Stand on the lane at `ai.s` (where a lane is set up; from then on the body moves it). */
function placeOnLane(t: TargetState): void {
  const a = t.ai;
  t.pos.x = a.laneOrigin.x + a.axis.x * a.s;
  t.pos.y = a.laneOrigin.y;
  t.pos.z = a.laneOrigin.z + a.axis.z * a.s;
}

/** Read the moved body back: position and signed speed along the lane (`Behaviour.bodyMoved`). */
function measure(t: TargetState): void {
  const a = t.ai;
  const v = t.body.kin.vel;
  a.s = (t.pos.x - a.laneOrigin.x) * a.axis.x + (t.pos.z - a.laneOrigin.z) * a.axis.z;
  a.vel = v.x * a.axis.x + v.z * a.axis.z;
}

/**
 * This tick's command: face the player's head (a mind's view is its aim model's, #90) and hold the
 * key that runs along the lane in direction `dir` (+1 / -1), or no key at all (`dir` 0).
 */
function steer(t: TargetState, ctx: BehaviourContext, dir: number): void {
  const p = ctx.world.player;
  const b = t.body;
  // A mind looks where its aim model has it (#90, `mind/duel.ts`); the dial's Echo faces the player.
  if (!t.ai.mind) commandLookAt(b, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
  commandMoveToward(b, t.ai.axis.x * dir, t.ai.axis.z * dir);
}

/** Room left ahead in the current direction, metres. */
function room(a: EnemyAi, dir: number): number {
  return dir > 0 ? a.laneLen - a.s : a.s;
}

/**
 * Whether the key must be let go of now for the stop to end inside the lane: holding it one more
 * tick would cover that tick at the next speed plus the braking distance from it (spec §2.3).
 */
function mustRelease(t: TargetState, ctx: BehaviourContext): boolean {
  const a = t.ai;
  const m = ctx.tunables.movement;
  const top = t.body.gait.runSpeedMps;
  const v = Math.abs(a.vel);
  const next = Math.min(top, v + (top / m.accelTimeToMax) * TICK_DT);
  return room(a, a.dir) <= next * TICK_DT + brakeDistance(next, top, m) + 1e-3;
}

/**
 * The leg's run speed, set as the body's gait: the dial's strafe speed, but an arrival that has not
 * told the player it is here yet runs its legs (steps that carry) rather than walks them.
 */
function legGait(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  t.body.gait.runSpeedMps = a.honest && a.audibleTick < 0 && t.visibleTick < 0
    ? Math.max(a.speed, ctx.tunables.audio.enemy.silentBelowMps + 0.4)
    : a.speed;
}

/** Metres between the samples of the lane's wall test. */
const LANE_STEP_M = 0.25;

/**
 * The strafe lane of an arrival that has stopped walking: through where it stands, square to the way
 * it was heading (to the way to the player when it has him in its sights), as long each way as it can
 * walk without meeting a wall. In a corridor too narrow to strafe across it strafes along it.
 */
function laneHere(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.strafer;
  const hull = ctx.tunables.movement.hullHalfWidth;
  const boxes = ctx.world.boxes;
  let hx = a.headX, hz = a.headZ;
  if (seesPlayer(t, ctx)) {
    const p = ctx.world.player;
    const dx = p.pos.x - t.pos.x, dz = p.pos.z - t.pos.z;
    const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 1e-6) { hx = dx / l; hz = dz / l; }
  }
  let ax = -hz, az = hx;
  let fwd = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, ax, az, cfg.freeHalfRangeM, LANE_STEP_M);
  let back = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, -ax, -az, cfg.freeHalfRangeM, LANE_STEP_M);
  if (fwd + back < cfg.minLegRoomM * 2) {
    ax = hx; az = hz;
    fwd = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, ax, az, cfg.freeHalfRangeM, LANE_STEP_M);
    back = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, -ax, -az, cfg.freeHalfRangeM, LANE_STEP_M);
  }
  a.axis.x = ax; a.axis.y = 0; a.axis.z = az;
  a.laneOrigin.x = t.pos.x - ax * back; a.laneOrigin.y = t.pos.y; a.laneOrigin.z = t.pos.z - az * back;
  a.laneLen = fwd + back;
  a.s = back;
  a.vel = 0;
  placeOnLane(t);
}

/** Walking its route in: moved by `arriveStep` along the route (kinematic: the body waits until the legs start). */
const arrive: BehaviourState = {
  name: 'arrive',
  kinematic: true,
  update(t, ctx) {
    if (!arriveStep(t, ctx, true)) return STAY;
    t.ai.arriving = false;
    laneHere(t, ctx);
    return STRAFER_LEG;
  },
};

const leg: BehaviourState = {
  name: 'leg',
  enter(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.strafer;
    // Two draws per leg, always: the seeded coin and the leg length.
    const coin = ctx.rng.next();
    fsmSetTimerRange(t, ctx.rng, cfg.legMinSec, Math.max(cfg.legMinSec, a.legSec));
    if (coin < cfg.reverseChance) a.dir = -a.dir;
    if (a.travel) {
      // On its route: towards the far end, with no timer; it stops when it has reacted to the player or runs out of lane.
      a.dir = 1;
      t.fsm.timerTicks = -1;
    } else if (room(a, a.dir) < cfg.minLegRoomM) {
      // Never start towards a wall: turn round instead.
      a.dir = -a.dir;
    }
    legGait(t, ctx);
    steer(t, ctx, a.dir);
  },
  update(t, ctx) {
    const a = t.ai;
    legGait(t, ctx);
    // A leg commits to the fight (a mind may shoot from it by its moving-shot habit) but is no stop.
    fireStep(t, ctx, false, true);
    // On its route it keeps moving through its reaction to the player (first sight to the tell), then brakes so the tell starts in the stop.
    if (!a.mind && a.travel && a.phase === FIRE_WAIT && ctx.tick >= a.readyTick) return STRAFER_DECEL;
    // A mind lets go of its key as its aim arrives, so its shot leaves from the stop (#90).
    if (mindWantsStop(t, ctx.tick)) return STRAFER_DECEL;
    // Let go early enough to stop inside the lane.
    if (mustRelease(t, ctx)) return STRAFER_DECEL;
    steer(t, ctx, a.dir);
    return STAY;
  },
  onTimer: () => STRAFER_DECEL,
};

const decel: BehaviourState = {
  name: 'decel',
  enter(t, ctx) {
    // The first stop ends the route: from here it strafes on the line.
    t.ai.travel = false;
    steer(t, ctx, 0);
  },
  update(t, ctx) {
    const a = t.ai;
    steer(t, ctx, 0);
    // The tell starts as it brakes, so the burst lands in the stand-still.
    fireStep(t, ctx, true);
    // It stands still from the tick its body comes to rest (this tick's step brakes to zero).
    const v = Math.abs(a.vel);
    return v === 0 || brakeSpeed(v, 0, t.body.gait.runSpeedMps, ctx.tunables.movement, 1, TICK_DT) === 0 ? STRAFER_STAND : STAY;
  },
};

const stand: BehaviourState = {
  name: 'stand',
  enter(t, ctx) {
    const cfg = ctx.tunables.enemies.strafer;
    steer(t, ctx, 0);
    fsmSetTimerRange(t, ctx.rng, cfg.standMinSec, Math.max(cfg.standMinSec, t.ai.standSec));
  },
  update(t, ctx) {
    steer(t, ctx, 0);
    fireStep(t, ctx, true);
    return STAY;
  },
  onTimer(t) {
    // It does not move again until the tell and burst are out.
    if (fireBusy(t.ai)) {
      fsmSetTimerTicks(t, 1);
      return STAY;
    }
    return STRAFER_LEG;
  },
};

export const straferBehaviour: Behaviour = {
  name: 'strafer',
  states: [leg, decel, stand, arrive],
  initial: STRAFER_LEG,
  arrive: STRAFER_ARRIVE,
  drivesBody: true,
  bodyMoved: measure,
};
