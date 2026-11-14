import type { StraferTunables } from '../config/enemies';
import { moveTowards } from '../core/math';
import { TICK_DT } from '../core/time';
import { arriveStep, walkReach } from './arrival';
import type { EnemyAi, StrafeParams } from './enemyAi';
import { fireBusy, fireStep, seesPlayer } from './enemyFire';
import {
  fsmSetTimerRange, fsmSetTimerTicks, STAY, type Behaviour, type BehaviourContext, type BehaviourState,
} from './fsm';
import type { TargetState } from './types';

/**
 * Strafer (design §5.2, §9.4): an Echo that mirrors a strafing player. It runs a leg (0.3-1.0 s,
 * drawn up to the dial's leg), brakes to a real stop with the spec's braking (§2.3: about 0.16 s,
 * the same stop time at every speed), stands still (0.2-0.4 s by the dial), then strafes again,
 * reversing on a seeded coin. The stand-still is exactly the window where a counter-strafed shot
 * is accurate; where enemies shoot back it shoots in that window (its tell starts as it brakes,
 * and it does not move again until its burst is out).
 *
 * Motion is along a line (a map's `strafe-lane`, or a line square to the player at spawn): pure
 * 1-D kinematics on `ai.s`, so the whole thing is a few multiplies per tick.
 */

export const STRAFER_LEG = 0;
export const STRAFER_DECEL = 1;
export const STRAFER_STAND = 2;
/** Walking its route in (hold sectors, `sim/arrival.ts`): the state of an arriving Strafer until it hands over to the legs. */
export const STRAFER_ARRIVE = 3;

/** Distance the braking bands cover from cruise speed `v`, metres (spec §2.3 bands scaled by v / ref speed). */
export function brakeDistance(v: number, cfg: StraferTunables): number {
  const b = cfg.brakeBandFraction;
  const speed = Math.abs(v);
  return speed * cfg.brakeRefSpeed * ((1 - b * b) / (2 * cfg.brakeHigh) + (b * b) / (2 * cfg.brakeLow));
}

/** Time the braking bands take from cruise speed `v`, seconds (independent of `v` by construction). */
export function brakeSeconds(cfg: StraferTunables): number {
  const b = cfg.brakeBandFraction;
  return cfg.brakeRefSpeed * ((1 - b) / cfg.brakeHigh + b / cfg.brakeLow);
}

/** Set a freshly spawned Strafer's lane and numbers (before its FSM starts). */
export function strafeInit(t: TargetState, ctx: BehaviourContext, p: StrafeParams | undefined): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.strafer;
  a.speed = p?.speed ?? cfg.defaultSpeed;
  a.legSec = p?.legSec ?? cfg.defaultLegSec;
  a.standSec = p?.standStillSec ?? cfg.defaultStandStillSec;
  a.vel = 0;
  a.dir = 1;
  a.brakeFrom = 0;
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

function placeOnLane(t: TargetState): void {
  const a = t.ai;
  t.pos.x = a.laneOrigin.x + a.axis.x * a.s;
  t.pos.y = a.laneOrigin.y;
  t.pos.z = a.laneOrigin.z + a.axis.z * a.s;
}

/** Integrate the lane position by one tick; the lane's ends stop it dead (the guard brakes before them). */
function advance(t: TargetState): void {
  const a = t.ai;
  a.s += a.vel * TICK_DT;
  if (a.s < 0) { a.s = 0; a.vel = 0; } else if (a.s > a.laneLen) { a.s = a.laneLen; a.vel = 0; }
  placeOnLane(t);
}

/** Room left ahead in the current direction, metres. */
function room(a: EnemyAi, dir: number): number {
  return dir > 0 ? a.laneLen - a.s : a.s;
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
  a.brakeFrom = 0;
  placeOnLane(t);
}

const arrive: BehaviourState = {
  name: 'arrive',
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
    // Never start towards a wall: turn round instead.
    if (room(a, a.dir) < cfg.minLegRoomM) a.dir = -a.dir;
  },
  update(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.strafer;
    // An arrival that has not told the player it is here yet runs its legs (steps that carry) rather than walks them.
    const cruise = a.honest && a.audibleTick < 0 && t.visibleTick < 0 ? Math.max(a.speed, ctx.tunables.audio.enemy.silentMps + 0.4) : a.speed;
    a.vel = moveTowards(a.vel, a.dir * cruise, (cruise / cfg.accelSec) * TICK_DT);
    advance(t);
    fireStep(t, ctx, false);
    // Brake early enough to stop inside the lane.
    if (room(a, a.vel !== 0 ? Math.sign(a.vel) : a.dir) <= brakeDistance(a.vel, cfg) + 0.02) return STRAFER_DECEL;
    return STAY;
  },
  onTimer: () => STRAFER_DECEL,
};

const decel: BehaviourState = {
  name: 'decel',
  enter(t) {
    t.ai.brakeFrom = Math.abs(t.ai.vel);
  },
  update(t, ctx) {
    const a = t.ai;
    const cfg = ctx.tunables.enemies.strafer;
    const v0 = a.brakeFrom;
    const speed = Math.abs(a.vel);
    if (speed > 0) {
      const scale = v0 / cfg.brakeRefSpeed;
      const rate = (speed > cfg.brakeBandFraction * v0 ? cfg.brakeHigh : cfg.brakeLow) * scale;
      const next = Math.max(0, speed - rate * TICK_DT);
      a.vel = a.vel > 0 ? next : -next;
      advance(t);
    }
    // The tell starts as it brakes, so the burst lands in the stand-still.
    fireStep(t, ctx, true);
    return a.vel === 0 ? STRAFER_STAND : STAY;
  },
};

const stand: BehaviourState = {
  name: 'stand',
  enter(t, ctx) {
    const cfg = ctx.tunables.enemies.strafer;
    t.ai.vel = 0;
    fsmSetTimerRange(t, ctx.rng, cfg.standMinSec, Math.max(cfg.standMinSec, t.ai.standSec));
  },
  update(t, ctx) {
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
};
