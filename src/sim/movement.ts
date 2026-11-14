import { DEG2RAD } from '../core/math';
import type { EventSink } from '../core/eventBus';
import type { MovementTunables } from '../config/movement';
import { moveAxis, moveAxisStep, moveAxisY, snapDown, standBlocked, sweepDelta } from './collision';
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

// Reused event payloads (valid only during the callback, by the event convention): no allocation per event.
const jumpedPayload = { tick: 0 };
const landedPayload = { tick: 0, impactSpeed: 0 };
const stepPayload = { tick: 0, crouching: false, walking: false };

/**
 * Scratch for `brake`: [0] speed, [1] floor, [2] max speed, [3] brake multiplier (in); [4] the
 * braked speed, [5] the seconds left over after it reached its floor, 0 if it did not (out); [6] the speed cap of `capHorizontal`; [7] the tick length `dt`. A
 * typed array because V8 boxes a double that is passed to or returned from a function it does not
 * inline, or stored in a module-level `let` (architecture §7 rule 1), and this runs every tick.
 */
const bk = new Float64Array(8);

/**
 * Spec §2.3 braking: constant deceleration in two bands (`brakeDecelHigh` above `brakeBandFraction`
 * of `maxSpeed`, `brakeDecelLow` at or below), both scaled by `maxSpeed / brakeRefSpeed` and by
 * `mult`. Brakes `speed` (>= 0) for `dt` seconds, never below `floor`; integrates exactly across
 * the band edge, so the stop time does not depend on the tick rate. Reads and writes `bk`.
 */
function brake(m: MovementTunables): void {
  const speed = bk[0]!, floor = bk[1]!, maxSpeed = bk[2]!, mult = bk[3]!, dt = bk[7]!;
  bk[5] = 0;
  if (speed <= floor) { bk[4] = speed; return; }
  const scale = (maxSpeed / m.brakeRefSpeed) * mult;
  const high = m.brakeDecelHigh * scale;
  const low = m.brakeDecelLow * scale;
  const band = m.brakeBandFraction * maxSpeed;
  let t = dt;
  let v = speed;
  if (v > band) {
    const edge = band > floor ? band : floor;
    const tHigh = (v - edge) / high;
    if (tHigh >= t) { bk[4] = v - high * t; return; }
    v = edge;
    t -= tHigh;
  }
  if (v > floor) {
    const tLow = (v - floor) / low;
    if (tLow >= t) { bk[4] = v - low * t; return; }
    t -= tLow;
  }
  bk[5] = t;
  bk[4] = floor;
}

/** `brake` as a function of numbers: the braked speed. */
export function brakeSpeed(speed: number, floor: number, maxSpeed: number, m: MovementTunables, mult: number, dt: number): number {
  bk[0] = speed; bk[1] = floor; bk[2] = maxSpeed; bk[3] = mult; bk[7] = dt;
  brake(m);
  return bk[4]!;
}

/** Scale the horizontal velocity of `p` so its speed is at most `bk[6]` (the cap goes through the scratch: no double argument). */
function capHorizontal(p: PlayerState): void {
  const cap = bk[6]!;
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
  weapon: Readonly<{ runSpeedMps: number }>,
  dt: number,
  tick: number,
  events: EventSink<SimEvents>,
): void {
  const maxSpeed = weapon.runSpeedMps;
  // Snapshot for render interpolation.
  p.prevPos.x = p.pos.x;
  p.prevPos.y = p.pos.y;
  p.prevPos.z = p.pos.z;
  p.prevEyeHeight = p.eyeHeight;

  const maxPitch = m.maxPitchDeg * DEG2RAD;
  p.yaw = input.yaw;
  // The aim punch from being hit (spec §4.4) is added to the view pitch the sim shoots with.
  // `clamp` and `moveTowards` below are written out: V8 boxes a double returned from a function it does not inline (architecture §7).
  const pitch = input.pitch + p.aimPunch;
  p.pitch = pitch < -maxPitch ? -maxPitch : pitch > maxPitch ? maxPitch : pitch;


  // Crouch state. Standing up needs headroom.
  if (input.crouch) {
    if (!p.crouching) {
      p.crouching = true;
      p.height = m.crouchHeight;
    }
  } else if (p.crouching && !standBlocked(boxes, p, m)) {
    p.crouching = false;
    p.height = m.standHeight;
  }
  const targetEye = p.crouching ? m.crouchEyeHeight : m.standEyeHeight;
  const eyeDelta = targetEye - p.eyeHeight;
  const eyeStep = ((m.standEyeHeight - m.crouchEyeHeight) / m.crouchTransitionSec) * dt;
  p.eyeHeight = Math.abs(eyeDelta) <= eyeStep ? targetEye : p.eyeHeight + Math.sign(eyeDelta) * eyeStep;

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
  bk[7] = dt;
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
      bk[0] = -along; bk[1] = 0; bk[2] = maxSpeed; bk[3] = m.counterStrafeBrakeMult;
      brake(m);
      newAlong = bk[4]! > 0 ? -bk[4]! : Math.min(wishSpeed, groundAccel * bk[5]!);
    } else if (along < wishSpeed) {
      newAlong = Math.min(wishSpeed, along + groundAccel * dt);
    } else {
      bk[0] = along; bk[1] = wishSpeed; bk[2] = maxSpeed; bk[3] = 1;
      brake(m);
      newAlong = bk[4]!;
    }
    if (across > 0) {
      bk[0] = across; bk[1] = 0; bk[2] = maxSpeed; bk[3] = 1;
      brake(m);
      const k = bk[4]! / across;
      px *= k;
      pz *= k;
    }
    p.vel.x = px + newAlong * ux;
    p.vel.z = pz + newAlong * uz;
    bk[6] = speedBefore > wishSpeed ? speedBefore : wishSpeed;
    capHorizontal(p);
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
  if (p.tagScale < 1) {
    bk[6] = maxSpeed * p.tagScale;
    capHorizontal(p);
  }

  if (input.jump && p.grounded) {
    p.vel.y = Math.sqrt(2 * m.gravity * m.jumpApex);
    p.grounded = false;
    jumpedPayload.tick = tick;
    events.emit('playerJumped', jumpedPayload);
  }
  const vy0 = p.vel.y;
  p.vel.y -= m.gravity * dt;

  const wasGrounded = p.grounded;
  const preLandVy = p.vel.y;

  // A grounded hull steps up ledges and rides ramps (jumping, `p.grounded` false, does not).
  const x0 = p.pos.x;
  const z0 = p.pos.z;
  if (wasGrounded) {
    if (moveAxisStep(boxes, p, 'x', dt, m)) p.vel.x = 0;
    if (moveAxisStep(boxes, p, 'z', dt, m)) p.vel.z = 0;
    // Stay on the ground when it falls away by no more than a step (stairs, ramps down).
    if (snapDown(boxes, p, m)) {
      p.grounded = true;
      p.vel.y = 0;
    } else {
      p.grounded = false;
    }
  } else {
    if (moveAxis(boxes, p, 'x', dt, m)) p.vel.x = 0;
    if (moveAxis(boxes, p, 'z', dt, m)) p.vel.z = 0;
  }

  if (!p.grounded) {
    sweepDelta[0] = 0.5 * (vy0 + p.vel.y) * dt;
    const blockedY = moveAxisY(boxes, p, m);
    if (blockedY) {
      p.grounded = vy0 + p.vel.y < 0; // the sign of the trapezoid step
      p.vel.y = 0;
    } else {
      p.grounded = false;
    }
  }

  if (p.grounded && !wasGrounded && preLandVy < -2) {
    landedPayload.tick = tick;
    landedPayload.impactSpeed = -preLandVy;
    events.emit('playerLanded', landedPayload);
  }

  // Footsteps: distance-based, only while grounded.
  if (p.grounded) {
    const dx = p.pos.x - x0;
    const dz = p.pos.z - z0;
    p.stepAccum += Math.sqrt(dx * dx + dz * dz);
    if (p.stepAccum >= m.footstepStride) {
      p.stepAccum -= m.footstepStride;
      stepPayload.tick = tick;
      stepPayload.crouching = p.crouching;
      stepPayload.walking = input.walk;
      events.emit('footstep', stepPayload);
    }
  } else {
    p.stepAccum = 0;
  }
}
