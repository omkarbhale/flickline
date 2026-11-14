import { clamp, moveTowards, DEG2RAD } from '../core/math';
import type { EventSink } from '../core/eventBus';
import type { MovementTunables } from '../config/movement';
import { hullBlocked, moveAxis, moveAxisStep, snapDown } from './collision';
import type { BoxDef, PlayerState, SimEvents, TickInput } from './types';

/** Events the player movement emits (part of `SimEvents`). */
export interface PlayerEvents {
  playerJumped: { tick: number };
  playerLanded: { tick: number; impactSpeed: number };
  footstep: { tick: number; crouching: boolean; walking: boolean };
}

declare module './types' {
  interface SimEvents extends PlayerEvents {}
}

/** Seconds of the last `brakeSpeed` call left over after the speed reached its floor (0 if it did not). */
let brakeLeftover = 0;

/**
 * Spec §2.3 braking: constant deceleration in two bands (`brakeDecelHigh` above `brakeBandFraction`
 * of `maxSpeed`, `brakeDecelLow` at or below), both scaled by `maxSpeed / brakeRefSpeed` and by
 * `mult`. Brakes `speed` (>= 0) for `dt` seconds, never below `floor`; integrates exactly across
 * the band edge, so the stop time does not depend on the tick rate. Sets `brakeLeftover`.
 */
export function brakeSpeed(
  speed: number,
  floor: number,
  maxSpeed: number,
  m: MovementTunables,
  mult: number,
  dt: number,
): number {
  brakeLeftover = 0;
  if (speed <= floor) return speed;
  const scale = (maxSpeed / m.brakeRefSpeed) * mult;
  const high = m.brakeDecelHigh * scale;
  const low = m.brakeDecelLow * scale;
  const band = m.brakeBandFraction * maxSpeed;
  let t = dt;
  let v = speed;
  if (v > band) {
    const edge = band > floor ? band : floor;
    const tHigh = (v - edge) / high;
    if (tHigh >= t) return v - high * t;
    v = edge;
    t -= tHigh;
  }
  if (v > floor) {
    const tLow = (v - floor) / low;
    if (tLow >= t) return v - low * t;
    t -= tLow;
  }
  brakeLeftover = t;
  return floor;
}

/** Scale the horizontal velocity of `p` so its speed is at most `cap`. */
function capHorizontal(p: PlayerState, cap: number): void {
  const sp2 = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
  if (sp2 > cap * cap) {
    const k = cap / Math.sqrt(sp2);
    p.vel.x *= k;
    p.vel.z *= k;
  }
}

/**
 * Player movement, `docs/mechanics-spec.md` §2. `maxSpeed` is the equipped weapon's run speed
 * (spec §2.1); walking and crouch-walking are fractions of it (§2.2).
 *
 * Ground (§2.3): the horizontal velocity splits into the part along the wish direction and the part
 * across it. Along it, the player accelerates at `maxSpeed / accelTimeToMax` up to the target speed
 * (or brakes down to it, e.g. on pressing walk). Across it, with no input, or against it (a
 * counter-strafe), the player brakes at the two-band constant deceleration, so the stop time depends
 * only on the speed (0.16 s from a full run with any weapon) and is the same for a release and a
 * counter-strafe; a counter-strafe then accelerates the other way with the rest of the tick. Ground
 * movement never adds speed above max(previous speed, target speed).
 *
 * Air (§2.6): horizontal speed is kept from takeoff (no braking); input steers towards the wish
 * velocity at `airAccelFraction` of the ground acceleration and can never add speed. Gravity is
 * integrated exactly (trapezoid), so the jump apex is `jumpApex`.
 *
 * Collision, steps, ramps, crouch headroom and footsteps are unchanged. It is the only movement
 * entry point, also used by bodies that are not the player. No allocations: works on `p` in place.
 */
export function stepPlayer(
  p: PlayerState,
  input: TickInput,
  boxes: readonly BoxDef[],
  m: MovementTunables,
  maxSpeed: number,
  dt: number,
  tick: number,
  events: EventSink<SimEvents>,
): void {
  // Snapshot for render interpolation.
  p.prevPos.x = p.pos.x;
  p.prevPos.y = p.pos.y;
  p.prevPos.z = p.pos.z;
  p.prevEyeHeight = p.eyeHeight;

  const maxPitch = m.maxPitchDeg * DEG2RAD;
  p.yaw = input.yaw;
  // The aim punch from being hit (spec §4.4) is added to the view pitch the sim shoots with.
  p.pitch = clamp(input.pitch + p.aimPunch, -maxPitch, maxPitch);

  const hw = m.hullHalfWidth;

  // Crouch state. Standing up needs headroom.
  if (input.crouch) {
    if (!p.crouching) {
      p.crouching = true;
      p.height = m.crouchHeight;
    }
  } else if (p.crouching && !hullBlocked(boxes, p.pos.x, p.pos.y, p.pos.z, hw, m.standHeight)) {
    p.crouching = false;
    p.height = m.standHeight;
  }
  const targetEye = p.crouching ? m.crouchEyeHeight : m.standEyeHeight;
  const eyeSpeed = (m.standEyeHeight - m.crouchEyeHeight) / m.crouchTransitionSec;
  p.eyeHeight = moveTowards(p.eyeHeight, targetEye, eyeSpeed * dt);

  // Wish direction from input, in world space (unit length, or zero without input).
  let mx = input.moveX;
  let mz = input.moveZ;
  const len = Math.sqrt(mx * mx + mz * mz);
  if (len > 1) {
    mx /= len;
    mz /= len;
  }
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  let ux = mx * cos - mz * sin;
  let uz = -mx * sin - mz * cos;
  const wishLen = Math.sqrt(ux * ux + uz * uz);
  const speed = maxSpeed * (p.crouching ? m.crouchWalkFraction : input.walk ? m.walkFraction : 1);
  const wishSpeed = speed * (wishLen > 1 ? 1 : wishLen);
  if (wishLen > 1e-9) {
    ux /= wishLen;
    uz /= wishLen;
  } else {
    ux = 0;
    uz = 0;
  }
  const groundAccel = maxSpeed / m.accelTimeToMax;
  const vx = p.vel.x;
  const vz = p.vel.z;
  const speedBefore = Math.sqrt(vx * vx + vz * vz);

  if (p.grounded) {
    // Along the wish direction (signed) and across it.
    const along = vx * ux + vz * uz;
    let px = vx - along * ux;
    let pz = vz - along * uz;
    const across = Math.sqrt(px * px + pz * pz);
    let newAlong: number;
    if (along < 0) {
      // Counter-strafe: brake to a stop, then accelerate the other way with the time left.
      const stopped = brakeSpeed(-along, 0, maxSpeed, m, m.counterStrafeBrakeMult, dt);
      newAlong = stopped > 0 ? -stopped : Math.min(wishSpeed, groundAccel * brakeLeftover);
    } else if (along < wishSpeed) {
      newAlong = Math.min(wishSpeed, along + groundAccel * dt);
    } else {
      newAlong = brakeSpeed(along, wishSpeed, maxSpeed, m, 1, dt);
    }
    if (across > 0) {
      const k = brakeSpeed(across, 0, maxSpeed, m, 1, dt) / across;
      px *= k;
      pz *= k;
    }
    p.vel.x = px + newAlong * ux;
    p.vel.z = pz + newAlong * uz;
    capHorizontal(p, speedBefore > wishSpeed ? speedBefore : wishSpeed);
  } else if (wishSpeed > 0) {
    // Steer towards the wish velocity; a step towards a point no faster than `max(|v|, |wish|)` never adds speed.
    const airAccel = groundAccel * m.airAccelFraction * dt;
    let dvx = ux * wishSpeed - vx;
    let dvz = uz * wishSpeed - vz;
    const dvLen = Math.sqrt(dvx * dvx + dvz * dvz);
    if (dvLen > airAccel) {
      const k = airAccel / dvLen;
      dvx *= k;
      dvz *= k;
    }
    p.vel.x += dvx;
    p.vel.z += dvz;
  }

  // Tagging (spec §4.3): being hit caps horizontal speed at a fraction of the maximum.
  if (p.tagScale < 1) capHorizontal(p, maxSpeed * p.tagScale);

  if (input.jump && p.grounded) {
    p.vel.y = Math.sqrt(2 * m.gravity * m.jumpApex);
    p.grounded = false;
    events.emit('playerJumped', { tick });
  }
  const vy0 = p.vel.y;
  p.vel.y -= m.gravity * dt;

  const wasGrounded = p.grounded;
  const preLandVy = p.vel.y;

  // A grounded hull steps up ledges and rides ramps (jumping, `p.grounded` false, does not).
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  if (wasGrounded) {
    if (moveAxisStep(boxes, p.pos, 'x', p.vel.x * dt, hw, p.height, m.stepHeight)) p.vel.x = 0;
    if (moveAxisStep(boxes, p.pos, 'z', p.vel.z * dt, hw, p.height, m.stepHeight)) p.vel.z = 0;
    // Stay on the ground when it falls away by no more than a step (stairs, ramps down).
    if (snapDown(boxes, p.pos, hw, p.height, m.stepHeight)) {
      p.grounded = true;
      p.vel.y = 0;
    } else {
      p.grounded = false;
    }
  } else {
    if (moveAxis(boxes, p.pos, 'x', p.vel.x * dt, hw, p.height)) p.vel.x = 0;
    if (moveAxis(boxes, p.pos, 'z', p.vel.z * dt, hw, p.height)) p.vel.z = 0;
  }

  if (!p.grounded) {
    const dy = 0.5 * (vy0 + p.vel.y) * dt;
    const blockedY = moveAxis(boxes, p.pos, 'y', dy, hw, p.height);
    if (blockedY) {
      p.grounded = dy < 0;
      p.vel.y = 0;
    } else {
      p.grounded = false;
    }
  }

  if (p.grounded && !wasGrounded && preLandVy < -2) {
    events.emit('playerLanded', { tick, impactSpeed: -preLandVy });
  }

  // Footsteps: distance-based, only while grounded.
  if (p.grounded) {
    const dx = p.pos.x - x0;
    const dz = p.pos.z - z0;
    p.stepAccum += Math.sqrt(dx * dx + dz * dz);
    if (p.stepAccum >= m.footstepStride) {
      p.stepAccum -= m.footstepStride;
      events.emit('footstep', { tick, crouching: p.crouching, walking: input.walk });
    }
  } else {
    p.stepAccum = 0;
  }
}
