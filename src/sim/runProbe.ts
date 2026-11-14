import type { EventSink } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { secondsToTicks, TICK_DT } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import type { MovementTunables } from '../config/movement';
import type { RunTunables } from '../config/run';
import type { ViewTunables } from '../config/view';
import type { WeaponTunables } from '../config/weapon';
import { createAimInfo, measureAim, targetAimPoint } from './aim';
import { rayBox } from './collision';
import type { RunEvents } from './runEvents';
import type { BoxDef, PlayerState, TargetState, TickInput } from './types';

/**
 * Measurement facts the stat definitions need that no other system produces: when a target first
 * becomes visible (and how well the player was pre-aimed), when the aim ray enters/leaves a
 * target, head-height crosshair samples while moving, and how long a stop takes. All of it is
 * deterministic sim state emitted as events; the stat tracker turns them into numbers.
 * Runs once per tick while a run is `live`; allocates nothing (scratch objects, reused payloads).
 */
export interface ProbeState {
  aimOn: boolean;
  aimOnId: number;
  nextHeadSampleTick: number;
  /** Tick the current stop began (-1 = not stopping). */
  stopTick: number;
  prevInputMag: number;
  prevWishDot: number;
}

export function createProbeState(): ProbeState {
  return { aimOn: false, aimOnId: -1, nextHeadSampleTick: 0, stopTick: -1, prevInputMag: 0, prevWishDot: 0 };
}

export function resetProbe(p: ProbeState): void {
  p.aimOn = false;
  p.aimOnId = -1;
  p.nextHeadSampleTick = 0;
  p.stopTick = -1;
  p.prevInputMag = 0;
  p.prevWishDot = 0;
}

/**
 * Horizontal speed at or below which a shot is accurate: `deadzone_fraction` x the equipped
 * weapon's run speed (spec §2.4; 0.275, sniper 0.15).
 */
export function accuracyThreshold(wt: WeaponTunables, mt: MovementTunables): number {
  return (wt.sniper ? mt.deadzoneFractionSniper : mt.deadzoneFraction) * wt.runSpeed;
}

/** The moving-shot flag, evaluated at fire time. Strictly above the threshold, or airborne. */
export function isMovingShot(p: PlayerState, wt: WeaponTunables, mt: MovementTunables): boolean {
  if (!p.grounded) return true;
  return Math.hypot(p.vel.x, p.vel.z) > accuracyThreshold(wt, mt);
}

const aimPoint = vec3();
const dir = vec3();
const aim = createAimInfo();
const scratchNormal = vec3();

const visiblePayload = { tick: 0, id: 0, preAim: 0, dYaw: 0, dPitch: 0 };
const aimPayload = { tick: 0, on: false, id: -1 };
const headPayload = { tick: 0, err: 0 };
const stopPayload = { tick: 0, latencyMs: 0 };

function occluded(boxes: readonly BoxDef[], ox: number, oy: number, oz: number, px: number, py: number, pz: number): boolean {
  const dx = px - ox, dy = py - oy, dz = pz - oz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return false;
  const ix = dx / dist, iy = dy / dist, iz = dz / dist;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, ix, iy, iz, boxes[i]!, dist - 1e-3, scratchNormal);
    if (t >= 0) return true;
  }
  return false;
}

export function stepRunProbe(
  s: ProbeState,
  p: PlayerState,
  targets: readonly TargetState[],
  boxes: readonly BoxDef[],
  input: TickInput,
  mt: MovementTunables,
  wt: WeaponTunables,
  view: ViewTunables,
  rt: RunTunables,
  tick: number,
  events: EventSink<RunEvents>,
): void {
  const ox = p.pos.x, oy = p.pos.y + p.eyeHeight, oz = p.pos.z;
  const d = directionFromAngles(dir, p.yaw, p.pitch);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const thr = accuracyThreshold(wt, mt);

  // Basis for the frustum test: forward = d, right = (cos yaw, 0, -sin yaw), up = right x forward.
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const ux = -rz * d.y, uy = rz * d.x - rx * d.z, uz = rx * d.y;
  const tanH = Math.tan((view.hfovDeg * DEG2RAD) / 2);
  const tanV = tanH / rt.visibilityAspect;
  const padTan = Math.tan(rt.timeOnTargetPadDeg * DEG2RAD);

  let anyVisible = false;
  let onId = -1;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    if (!t.alive) continue;
    const a = targetAimPoint(t, aimPoint);
    const vx = a.x - ox, vy = a.y - oy, vz = a.z - oz;

    if (!t.visible) {
      const cz = vx * d.x + vy * d.y + vz * d.z;
      const cx = vx * rx + vz * rz;
      const cy = vx * ux + vy * uy + vz * uz;
      if (cz > 0 && Math.abs(cx) <= tanH * cz && Math.abs(cy) <= tanV * cz && !occluded(boxes, ox, oy, oz, a.x, a.y, a.z)) {
        t.visible = true;
        measureAim(ox, oy, oz, p.yaw, p.pitch, d.x, d.y, d.z, a.x, a.y, a.z, aim);
        visiblePayload.tick = tick;
        visiblePayload.id = t.id;
        visiblePayload.preAim = aim.err;
        visiblePayload.dYaw = aim.dYaw;
        visiblePayload.dPitch = aim.dPitch;
        events.emit('targetVisible', visiblePayload);
      }
    }
    if (!t.visible) continue;
    anyVisible = true;

    // Aim ray vs the target sphere padded by an angle (so the pad grows with distance).
    const along = vx * d.x + vy * d.y + vz * d.z;
    if (along > 0 && onId < 0) {
      const perp2 = vx * vx + vy * vy + vz * vz - along * along;
      const r = t.radius + along * padTan;
      if (perp2 <= r * r) onId = t.id;
    }
  }

  if ((onId >= 0) !== s.aimOn || (onId >= 0 && onId !== s.aimOnId)) {
    s.aimOn = onId >= 0;
    s.aimOnId = onId;
    aimPayload.tick = tick;
    aimPayload.on = s.aimOn;
    aimPayload.id = onId;
    events.emit('aimOnTarget', aimPayload);
  }

  // Head-height discipline: sampled while moving fast with nobody in view.
  if (tick >= s.nextHeadSampleTick) {
    s.nextHeadSampleTick = tick + secondsToTicks(rt.headHeightSampleSec);
    if (!anyVisible && speed > thr) {
      const ideal = Math.atan2(rt.headCentreHeight - oy, rt.headHeightRefDistance);
      headPayload.tick = tick;
      headPayload.err = Math.abs(p.pitch - ideal);
      events.emit('headHeightSampled', headPayload);
    }
  }

  // Stop latency: from the stop/counter-strafe input to speed first at or below the threshold.
  const mag = Math.hypot(input.moveX, input.moveZ);
  const wx = rx * input.moveX + -Math.sin(p.yaw) * input.moveZ;
  const wz = rz * input.moveX + -Math.cos(p.yaw) * input.moveZ;
  const wishDot = mag > 0 ? wx * p.vel.x + wz * p.vel.z : 0;
  if (s.stopTick < 0) {
    if (speed > thr && ((mag === 0 && s.prevInputMag > 0) || (mag > 0 && wishDot < 0 && s.prevWishDot >= 0))) {
      s.stopTick = tick;
    }
  } else if (speed <= thr) {
    stopPayload.tick = tick;
    stopPayload.latencyMs = (tick - s.stopTick) * TICK_DT * 1000;
    s.stopTick = -1;
    events.emit('playerStopped', stopPayload);
  } else if (mag > 0 && wishDot > 0) {
    s.stopTick = -1;
  }
  s.prevInputMag = mag;
  s.prevWishDot = wishDot;
}
