import { vec3, type Vec3 } from '../core/vec3';
import type { TargetTunables } from '../config/targets';
import { zoneCentre } from './hitZones';
import type { TargetField } from './targets';
import type { TargetState } from './types';

/** Result of measuring the view ray against a target's aim point. Reused (no allocation). */
export interface AimInfo {
  /** -1 = no candidate. */
  targetId: number;
  /** Angle between the view ray and the direction to the aim point, radians. */
  err: number;
  /** Aim-point angles minus view angles, radians (yaw + = left, pitch + = up). */
  dYaw: number;
  dPitch: number;
}

export function createAimInfo(): AimInfo {
  return { targetId: -1, err: 0, dYaw: 0, dPitch: 0 };
}

/** The point a player is expected to aim at on a target: its head centre (an orb's centre). */
export function targetAimPoint(t: TargetState, tt: TargetTunables, out: Vec3): Vec3 {
  return zoneCentre(out, t, tt.hit, tt.kinds[t.kind], 'head');
}

/** Yaw (radians) of a direction; yaw 0 = -Z, + = left. */
export function yawOf(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  const TWO_PI = Math.PI * 2;
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  else if (r <= -Math.PI) r += TWO_PI;
  return r;
}

/**
 * Measure the unit view ray (dx,dy,dz at yaw/pitch) from the eye (ox,oy,oz) against the point
 * (px,py,pz). Writes err/dYaw/dPitch to `out` (not targetId).
 */
export function measureAim(
  ox: number, oy: number, oz: number,
  yaw: number, pitch: number,
  dx: number, dy: number, dz: number,
  px: number, py: number, pz: number,
  out: AimInfo,
): AimInfo {
  const vx = px - ox, vy = py - oy, vz = pz - oz;
  const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-9;
  let c = (vx * dx + vy * dy + vz * dz) / len;
  c = c > 1 ? 1 : c < -1 ? -1 : c;
  out.err = Math.acos(c);
  out.dYaw = wrapPi(yawOf(vx, vz) - yaw);
  out.dPitch = Math.asin(vy / len) - pitch;
  return out;
}

const scratch: AimInfo = createAimInfo();
const scratchPoint: Vec3 = vec3();

/** Nearest (by angle to the head centre) alive, visible target to the view ray. `out.targetId` = -1 if none. */
export function nearestAimTarget(
  ox: number, oy: number, oz: number,
  yaw: number, pitch: number,
  dx: number, dy: number, dz: number,
  field: TargetField,
  tt: TargetTunables,
  out: AimInfo,
): AimInfo {
  out.targetId = -1;
  out.err = Infinity;
  out.dYaw = 0;
  out.dPitch = 0;
  const slots = field.slots;
  for (let i = 0; i < slots.length; i++) {
    const t = slots[i]!;
    if (!t.alive || t.visibleTick < 0) continue;
    const p = targetAimPoint(t, tt, scratchPoint);
    measureAim(ox, oy, oz, yaw, pitch, dx, dy, dz, p.x, p.y, p.z, scratch);
    if (scratch.err < out.err) {
      out.targetId = t.id;
      out.err = scratch.err;
      out.dYaw = scratch.dYaw;
      out.dPitch = scratch.dPitch;
    }
  }
  return out;
}
