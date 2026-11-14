import { DEG2RAD } from '../core/math';
import type { EventSink } from '../core/eventBus';
import type { MovementTunables } from '../config/movement';
import { moveAxis, moveAxisStep, snapDown, standBlocked } from './collision';
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
 * Placeholder player movement: wish-velocity acceleration on the ground and in the air, gravity,
 * jump, crouch with headroom check, walk modifier. Replace the numbers via config/movement.ts;
 * replace the model by editing stepPlayer (it is the only movement entry point).
 * No allocations: everything works on the PlayerState in place.
 */
export function stepPlayer(
  p: PlayerState,
  input: TickInput,
  boxes: readonly BoxDef[],
  m: MovementTunables,
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
  const eyeStep = m.eyeHeightSpeed * dt;
  p.eyeHeight = Math.abs(eyeDelta) <= eyeStep ? targetEye : p.eyeHeight + Math.sign(eyeDelta) * eyeStep;

  // Wish velocity from input, in world space.
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
  const speed = p.crouching ? m.crouchSpeed : input.walk ? m.walkSpeed : m.runSpeed;
  const wishX = (mx * cos - mz * sin) * speed;
  const wishZ = (-mx * sin - mz * cos) * speed;

  const accel = (p.grounded ? m.groundAccel : m.airAccel) * dt;
  let dvx = wishX - p.vel.x;
  let dvz = wishZ - p.vel.z;
  const dvLen = Math.sqrt(dvx * dvx + dvz * dvz);
  if (dvLen > accel) {
    const k = accel / dvLen;
    dvx *= k;
    dvz *= k;
  }
  p.vel.x += dvx;
  p.vel.z += dvz;

  // Tagging (spec §4.3): being hit caps horizontal speed at a fraction of the maximum.
  if (p.tagScale < 1) {
    const cap = m.runSpeed * p.tagScale;
    const sp2 = p.vel.x * p.vel.x + p.vel.z * p.vel.z;
    if (sp2 > cap * cap) {
      const k = cap / Math.sqrt(sp2);
      p.vel.x *= k;
      p.vel.z *= k;
    }
  }

  if (input.jump && p.grounded) {
    p.vel.y = m.jumpSpeed;
    p.grounded = false;
    jumpedPayload.tick = tick;
    events.emit('playerJumped', jumpedPayload);
  }
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
    const blockedY = moveAxis(boxes, p, 'y', dt, m);
    if (blockedY) {
      p.grounded = p.vel.y < 0;
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
