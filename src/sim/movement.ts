import { clamp, moveTowards, DEG2RAD } from '../core/math';
import type { EventSink } from '../core/eventBus';
import type { MovementTunables } from '../config/movement';
import { hullBlocked, moveAxis } from './collision';
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
  p.eyeHeight = moveTowards(p.eyeHeight, targetEye, m.eyeHeightSpeed * dt);

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
    events.emit('playerJumped', { tick });
  }
  p.vel.y -= m.gravity * dt;

  const wasGrounded = p.grounded;
  const preLandVy = p.vel.y;

  const x0 = p.pos.x;
  const z0 = p.pos.z;
  if (moveAxis(boxes, p.pos, 'x', p.vel.x * dt, hw, p.height)) p.vel.x = 0;
  if (moveAxis(boxes, p.pos, 'z', p.vel.z * dt, hw, p.height)) p.vel.z = 0;

  const dy = p.vel.y * dt;
  const blockedY = moveAxis(boxes, p.pos, 'y', dy, hw, p.height);
  if (blockedY) {
    p.grounded = dy < 0;
    p.vel.y = 0;
  } else {
    p.grounded = false;
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
