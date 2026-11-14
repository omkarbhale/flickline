import type { EventSink } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT, TICK_RATE } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { createExpectedHead, expectedHead } from './headHeight';
import { wrapPi } from './aim';
import { createRay, createZoneHit } from './hitZones';
import type { TargetField } from './targets';
import type { LevelDef, PlayerState, SimEvents, TickInput, WeaponState } from './types';

/** Measurement events the run probe emits (part of `SimEvents`). */
export interface ProbeEvents {
  /** Aim ray entered (`on`) or left the padded hit volume of a visible target (edge events). */
  aimOnTarget: { tick: number; on: boolean; id: number };
  /**
   * Signed horizontal aim offset (radians) from a cruising Strafer's centre of mass, sampled at
   * `run.leadSampleSec` while the view is within `run.leadMaxOffDeg` of it and was on it within
   * `run.leadEngageSec` (tracking, not the flick onto it): positive = the
   * crosshair is AHEAD of the target in its direction of travel (leading), negative = BEHIND it
   * (lagging).
   */
  leadSampled: { tick: number; id: number; err: number };
  /** Vertical angle (radians) between the aim ray and head-centre height, sampled while moving with no enemy visible. */
  headHeightSampled: { tick: number; err: number };
  /**
   * Horizontal speed first fell to the accuracy threshold after a stop or counter-strafe input.
   * `counterStrafe`: the stop began with a direction reversal (the opposite key pressed), not a release.
   */
  playerStopped: { tick: number; latencyMs: number; counterStrafe: boolean };
}

declare module './types' {
  interface SimEvents extends ProbeEvents {}
}

/**
 * Measurement facts the stat definitions need that no other system produces: when the aim ray
 * enters/leaves a target, head-height crosshair samples while moving, and how long a stop takes.
 * (Target sightings, pre-aim and kill bookkeeping live in `TargetField`.) All of it is
 * deterministic sim state emitted as events; the stat tracker turns it into numbers. Runs once
 * per tick while a run is `live`; allocates nothing (scratch objects, reused payloads).
 */
export interface ProbeState {
  aimOn: boolean;
  aimOnId: number;
  nextHeadSampleTick: number;
  nextLeadSampleTick: number;
  /** The target the aim was last on and the tick it last was (-1 never): the engagement gate of the lead error. */
  lastOnId: number;
  lastOnTick: number;
  /** Tick the current stop began (-1 = not stopping). */
  stopTick: number;
  /** The current stop began with a direction reversal (the opposite key pressed) rather than a release. */
  stopCounter: boolean;
  prevInputMag: number;
  prevWishDot: number;
}

export function createProbeState(): ProbeState {
  return {
    aimOn: false, aimOnId: -1, nextHeadSampleTick: 0, nextLeadSampleTick: 0, lastOnId: -1, lastOnTick: -1, stopTick: -1,
    stopCounter: false, prevInputMag: 0, prevWishDot: 0,
  };
}

export function resetProbe(p: ProbeState): void {
  p.aimOn = false;
  p.aimOnId = -1;
  p.nextHeadSampleTick = 0;
  p.nextLeadSampleTick = 0;
  p.lastOnId = -1;
  p.lastOnTick = -1;
  p.stopTick = -1;
  p.stopCounter = false;
  p.prevInputMag = 0;
  p.prevWishDot = 0;
}

/**
 * Horizontal speed at or below which a shot is accurate for the equipped weapon: its
 * `deadzoneFraction` x `runSpeedMps` (spec §2.4; 0.275 for the first weapons, sniper 0.15). The
 * moving-shot flag itself is set by the weapon at fire time (`isMovingShot` in `weaponModel.ts`).
 */
export function accuracyThreshold(w: WeaponState, t: Tunables): number {
  const def = t.weapon[w.slots[w.active]!.id];
  return def.deadzoneFraction * def.runSpeedMps;
}

const dir = vec3();
const probeRay = createRay();
const zone = createZoneHit();
const aimPayload = { tick: 0, on: false, id: -1 };
const leadPayload = { tick: 0, id: -1, err: 0 };
const headPayload = { tick: 0, err: 0 };
const stopPayload = { tick: 0, latencyMs: 0, counterStrafe: false };
const head = createExpectedHead();

/**
 * Id of the visible target the padded aim ray touches (-1 none). The "hit volume padded by 0.5
 * degrees" is tested with the exact zone shapes by casting the view ray plus four rays offset by
 * the pad angle (left/right/up/down). Takes the player and the tunables rather than the eye and
 * the angles as numbers, and builds each ray's direction inline: V8 boxes every double passed to a
 * function it does not inline (architecture §7 rule 1).
 */
function aimedTarget(field: TargetField, p: PlayerState, t: Tunables): number {
  const padRad = t.run.timeOnTargetPadDeg * DEG2RAD;
  probeRay.ox = p.pos.x;
  probeRay.oy = p.pos.y + p.eyeHeight;
  probeRay.oz = p.pos.z;
  probeRay.maxDist = 1e9;
  for (let k = 0; k < 5; k++) {
    const yaw = p.yaw + (k === 3 ? padRad : k === 4 ? -padRad : 0);
    const pitch = p.pitch + (k === 1 ? padRad : k === 2 ? -padRad : 0);
    const cp = Math.cos(pitch);
    probeRay.dx = -Math.sin(yaw) * cp;
    probeRay.dy = Math.sin(pitch);
    probeRay.dz = -Math.cos(yaw) * cp;
    const slot = field.traceNearestRay(probeRay, zone);
    if (slot >= 0) {
      const t = field.slots[slot]!;
      if (t.visibleTick >= 0) return t.id;
    }
  }
  return -1;
}

/**
 * Lead error of the Strafer the aim was last on (design §3, §4.3), written to `leadPayload`; false
 * when the aim has not been on it for `leadEngageSec`, it is not cruising, or the view is further
 * than `leadMaxOffDeg` from it. The offset is the view yaw minus the yaw to the target's centre of
 * mass, signed by the direction the target moves across the view (its yaw now minus its yaw at the
 * start of the tick), so + is ahead of it. Inline maths (`secondsToTicks`, `yawOf`) rather than
 * calls: a double passed to or returned from a function V8 does not inline is boxed.
 */
function leadOf(s: ProbeState, field: TargetField, p: PlayerState, t: Tunables, tick: number): boolean {
  const run = t.run;
  const ox = p.pos.x, oy = p.pos.y + p.eyeHeight, oz = p.pos.z;
  if (s.lastOnId < 0 || tick - s.lastOnTick > Math.max(1, Math.round(run.leadEngageSec * TICK_RATE))) return false;
  const tg = field.byId(s.lastOnId);
  if (!tg || !tg.alive || tg.kind !== 'strafer' || tg.visibleTick < 0 || Math.abs(tg.ai.vel) < run.leadMinSpeedMps) return false;
  const yawNow = Math.atan2(ox - tg.pos.x, oz - tg.pos.z);
  const across = wrapPi(yawNow - Math.atan2(ox - tg.prevPos.x, oz - tg.prevPos.z));
  if (across === 0) return false;
  const off = wrapPi(p.yaw - yawNow);
  const fx = tg.pos.x - ox, fz = tg.pos.z - oz;
  const flat = Math.sqrt(fx * fx + fz * fz);
  const pitchOff = p.pitch - Math.atan2(tg.pos.y + tg.boundsY - oy, flat);
  if (Math.sqrt(off * off + pitchOff * pitchOff) > run.leadMaxOffDeg * DEG2RAD) return false;
  leadPayload.id = tg.id;
  leadPayload.err = across > 0 ? off : -off;
  return true;
}

export function stepRunProbe(
  s: ProbeState,
  p: PlayerState,
  w: WeaponState,
  field: TargetField,
  input: TickInput,
  t: Tunables,
  tick: number,
  events: EventSink<SimEvents>,
  level: LevelDef,
): void {
  const oy = p.pos.y + p.eyeHeight;
  directionFromAngles(dir, p.yaw, p.pitch);
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z); // not Math.hypot: V8 boxes its result (#152)
  // `accuracyThreshold` inline: a double returned from a function V8 does not inline is boxed.
  const def = t.weapon[w.slots[w.active]!.id];
  const thr = def.deadzoneFraction * def.runSpeedMps;

  let anyVisible = false;
  const slots = field.slots;
  for (let i = 0; i < slots.length; i++) {
    const tg = slots[i]!;
    if (tg.alive && tg.visibleTick >= 0) { anyVisible = true; break; }
  }

  // Time on target: edges as the aim ray enters / leaves a padded hit volume.
  const onId = anyVisible ? aimedTarget(field, p, t) : -1;
  if (onId >= 0) {
    s.lastOnId = onId;
    s.lastOnTick = tick;
  }
  if ((onId >= 0) !== s.aimOn || (onId >= 0 && onId !== s.aimOnId)) {
    s.aimOn = onId >= 0;
    s.aimOnId = onId;
    aimPayload.tick = tick;
    aimPayload.on = s.aimOn;
    aimPayload.id = onId;
    events.emit('aimOnTarget', aimPayload);
  }

  // Lead error: signed aim offset from a cruising Strafer, sampled at a fixed rate.
  if (anyVisible && tick >= s.nextLeadSampleTick) {
    s.nextLeadSampleTick = tick + Math.max(1, Math.round(t.run.leadSampleSec * TICK_RATE));
    if (leadOf(s, field, p, t, tick)) {
      leadPayload.tick = tick;
      events.emit('leadSampled', leadPayload);
    }
  }

  // Head-height discipline: sampled while moving fast with nobody in view.
  if (tick >= s.nextHeadSampleTick) {
    s.nextHeadSampleTick = tick + Math.max(1, Math.round(t.run.headHeightSampleSec * TICK_RATE));
    if (!anyVisible && speed > thr) {
      // Against the head of the enemy the player is facing (its own floor height), not the player's eye level.
      expectedHead(head, level, p, t.run, t.targets.hit.headCentreStand);
      const ideal = Math.atan2(head.headY - oy, head.dist);
      headPayload.tick = tick;
      headPayload.err = Math.abs(p.pitch - ideal);
      events.emit('headHeightSampled', headPayload);
    }
  }

  // Stop latency: from the stop/counter-strafe input to speed first at or below the threshold.
  const mag = Math.sqrt(input.moveX * input.moveX + input.moveZ * input.moveZ); // not Math.hypot (#152)
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const wx = rx * input.moveX + -Math.sin(p.yaw) * input.moveZ;
  const wz = rz * input.moveX + -Math.cos(p.yaw) * input.moveZ;
  const wishDot = mag > 0 ? wx * p.vel.x + wz * p.vel.z : 0;
  if (s.stopTick < 0) {
    if (speed > thr && ((mag === 0 && s.prevInputMag > 0) || (mag > 0 && wishDot < 0 && s.prevWishDot >= 0))) {
      s.stopTick = tick;
      s.stopCounter = mag > 0; // the opposite key was pressed (a release has no input magnitude)
    }
  } else if (speed <= thr) {
    stopPayload.tick = tick;
    stopPayload.latencyMs = (tick - s.stopTick) * TICK_DT * 1000;
    stopPayload.counterStrafe = s.stopCounter;
    s.stopTick = -1;
    events.emit('playerStopped', stopPayload);
  } else if (mag > 0 && wishDot > 0) {
    s.stopTick = -1;
  }
  s.prevInputMag = mag;
  s.prevWishDot = wishDot;
}
