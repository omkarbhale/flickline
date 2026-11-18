import type { Rng } from '../../core/rng';
import { DEG2RAD } from '../../core/math';
import { TICK_DT } from '../../core/time';
import type { MindDecisionTunables } from '../../config/mindDecision';
import type { MindProfile } from './profile';
import type { EnemyCommand } from '../types';

/**
 * Where an Echo's view goes, tick by tick (issue #91). A **stand-in** for the human aim model of
 * #90 (reaction, minimum-jerk submovements, corrections, tracking with lead): the decision layer
 * only says *what* to look at (a point and a drift), and this controller turns the command's view
 * towards it as a human-looking second-order motion, never a snap: the turn rate approaches the
 * error over `tauSec`, is limited by the braking distance so it lands without overshooting, and is
 * capped by the profile's angular speed and acceleration (`mind.caps`, §5.5 step 7). #90 replaces
 * `lookStep` with its model and keeps the same inputs.
 *
 * The drift is seeded value noise: each axis glides (smoothstep) between random knots drawn every
 * 0.6-1.6 s, so a holder's view is never still (§5.7) and a duellist's settle is never zero (§5.5).
 *
 * Inputs and outputs travel in `LookState` fields, never as number arguments or return values: V8
 * boxes a double passed to or returned from a function it does not inline (architecture §7), and
 * this runs every tick for every Echo.
 */
export interface LookState {
  /** Where to look this tick (radians, world convention) and the drift's SD, degrees: written by the caller. */
  targetYaw: number;
  targetPitch: number;
  sdDeg: number;
  /** After `lookStep`: the angular error to the point it means to aim at (target plus drift), radians. */
  err: number;
  /** Angular velocity of the view, rad/s (yaw + = left, pitch + = up). */
  yawVel: number;
  pitchVel: number;
  /** Drift knots (radians), the phase through the current pair (0..1) and its length in seconds. */
  driftYaw0: number;
  driftYaw1: number;
  driftPitch0: number;
  driftPitch1: number;
  driftPhase: number;
  driftPeriodSec: number;
  /** The drift offset this tick, radians. */
  driftYaw: number;
  driftPitch: number;
  /** Last tick's target angles (NaN: none yet), for the feed-forward of a target that moves smoothly. */
  lastYaw: number;
  lastPitch: number;
}

export function createLookState(): LookState {
  return {
    targetYaw: 0, targetPitch: 0, sdDeg: 0, err: 0,
    yawVel: 0, pitchVel: 0, driftYaw0: 0, driftYaw1: 0, driftPitch0: 0, driftPitch1: 0, driftPhase: 1, driftPeriodSec: 1,
    driftYaw: 0, driftPitch: 0, lastYaw: Number.NaN, lastPitch: Number.NaN,
  };
}

export function resetLookState(l: LookState): void {
  l.targetYaw = l.targetPitch = l.sdDeg = l.err = 0;
  l.yawVel = l.pitchVel = 0;
  l.driftYaw0 = l.driftYaw1 = l.driftPitch0 = l.driftPitch1 = 0;
  l.driftPhase = 1;
  l.driftPeriodSec = 1;
  l.driftYaw = l.driftPitch = 0;
  l.lastYaw = l.lastPitch = Number.NaN;
}

/**
 * Advance the drift one tick with SD `l.sdDeg`; a new knot pair starts every period drawn in
 * [`driftPeriodMinSec`, `driftPeriodMaxSec`). Three draws per knot (period, yaw, pitch), from `rng`
 * (the enemy's aim stream).
 */
export function driftStep(l: LookState, rng: Rng, cfg: MindDecisionTunables['hold']): void {
  l.driftPhase += TICK_DT / l.driftPeriodSec;
  if (l.driftPhase >= 1) {
    l.driftPhase = 0;
    l.driftPeriodSec = cfg.driftPeriodMinSec + (cfg.driftPeriodMaxSec - cfg.driftPeriodMinSec) * rng.next();
    l.driftYaw0 = l.driftYaw1;
    l.driftPitch0 = l.driftPitch1;
    const sd = l.sdDeg * DEG2RAD;
    l.driftYaw1 = rng.normal() * sd;
    l.driftPitch1 = rng.normal() * sd * 0.6;
  }
  const u = l.driftPhase;
  const s = u * u * (3 - 2 * u);
  l.driftYaw = l.driftYaw0 + (l.driftYaw1 - l.driftYaw0) * s;
  l.driftPitch = l.driftPitch0 + (l.driftPitch1 - l.driftPitch0) * s;
}

/** One axis of the controller, in and out through fields (no double crosses a call). */
interface Axis {
  vel: number;
  err: number;
  ff: number;
  tau: number;
  maxV: number;
  maxA: number;
}
const AX: Axis = { vel: 0, err: 0, ff: 0, tau: 0, maxV: 0, maxA: 0 };

/**
 * The next angular velocity of one axis towards an error `err` (rad), human-shaped and capped, into
 * `ax.vel`. `ff` is the target's own angular rate (rad/s): a human tracking a point while strafing
 * turns with it rather than chasing it, so a tracked target is held instead of lagged by `tau`.
 */
function axisStep(ax: Axis): void {
  const err = ax.err, ff = ax.ff, vel = ax.vel, maxV = ax.maxV, maxA = ax.maxA;
  const a = err < 0 ? -err : err;
  // Fast while far, braking-limited near the target (v^2 = 2 a d), capped at the speed limit.
  let want = a / ax.tau;
  const brake = Math.sqrt(2 * maxA * a);
  if (want > brake) want = brake;
  if (err < 0) want = -want;
  want += ff;
  if (want > maxV) want = maxV;
  else if (want < -maxV) want = -maxV;
  const dv = maxA * TICK_DT;
  const d = want - vel;
  let v = d > dv ? vel + dv : d < -dv ? vel - dv : want;
  // Never step past the (moving) target in one tick.
  const reach = a + (ff < 0 ? -ff : ff) * TICK_DT;
  if (v * TICK_DT > reach && err >= 0) v = reach / TICK_DT;
  else if (-v * TICK_DT > reach && err <= 0) v = -reach / TICK_DT;
  ax.vel = v;
}

/** Wrap to (-PI, PI] (written out here so no double leaves this module through a call). */
const TWO_PI = Math.PI * 2;

/**
 * Turn the command's view one tick towards (`l.targetYaw`, `l.targetPitch`) plus the drift. A
 * target that moves smoothly is tracked with feed-forward (its own rate, capped at
 * `feedForwardMaxDegPerSec`); one that jumps more than `newTargetDeg` in a tick is a new target.
 * The profile's caps limit speed and acceleration. Writes `l.err`: the remaining angular error to
 * the point it means to aim at (target plus drift), radians: a player fires when the crosshair is
 * where *he* thinks the target is, and the drift is the error he cannot see.
 */
export function lookStep(cmd: EnemyCommand, l: LookState, cfg: MindDecisionTunables['look'], pr: MindProfile): void {
  const yaw = l.targetYaw, pitch = l.targetPitch;
  const jump = cfg.newTargetDeg * DEG2RAD;
  const ffMax = cfg.feedForwardMaxDegPerSec * DEG2RAD;
  let ey = (yaw + l.driftYaw - cmd.yaw) % TWO_PI;
  if (ey > Math.PI) ey -= TWO_PI; else if (ey <= -Math.PI) ey += TWO_PI;
  const ep = pitch + l.driftPitch - cmd.pitch;
  let fy = 0, fp = 0;
  if (l.lastYaw === l.lastYaw) {
    fy = (yaw - l.lastYaw) % TWO_PI;
    if (fy > Math.PI) fy -= TWO_PI; else if (fy <= -Math.PI) fy += TWO_PI;
    fp = pitch - l.lastPitch;
  }
  if (fy > jump || fy < -jump || fp > jump || fp < -jump) fy = fp = 0;
  fy /= TICK_DT; fp /= TICK_DT;
  fy = fy > ffMax ? ffMax : fy < -ffMax ? -ffMax : fy;
  fp = fp > ffMax ? ffMax : fp < -ffMax ? -ffMax : fp;
  l.lastYaw = yaw;
  l.lastPitch = pitch;
  const ax = AX;
  ax.tau = cfg.tauSec;
  ax.maxV = pr.maxAngularSpeedDegPerSec * DEG2RAD;
  ax.maxA = pr.maxAngularAccelDegPerSec2 * DEG2RAD;
  ax.vel = l.yawVel; ax.err = ey; ax.ff = fy;
  axisStep(ax);
  l.yawVel = ax.vel;
  ax.vel = l.pitchVel; ax.err = ep; ax.ff = fp;
  axisStep(ax);
  l.pitchVel = ax.vel;
  let cy = (cmd.yaw + l.yawVel * TICK_DT) % TWO_PI;
  if (cy > Math.PI) cy -= TWO_PI; else if (cy <= -Math.PI) cy += TWO_PI;
  cmd.yaw = cy;
  cmd.pitch += l.pitchVel * TICK_DT;
  let ry = (yaw + l.driftYaw - cmd.yaw) % TWO_PI;
  if (ry > Math.PI) ry -= TWO_PI; else if (ry <= -Math.PI) ry += TWO_PI;
  const rp = pitch + l.driftPitch - cmd.pitch;
  l.err = Math.sqrt(ry * ry + rp * rp);
}
