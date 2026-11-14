import type { EventSink } from '../core/eventBus';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import { secondsToTicks } from '../core/time';
import type { WeaponTunables } from '../config/weapon';
import { rayBox } from './collision';
import { zoneDamage } from './damage';
import { createZoneHit, type ZoneHit } from './hitZones';
import type { TargetField } from './targets';
import type { BoxDef, HitZone, PlayerState, SimEvents, WeaponState } from './types';

/** Result of a hitscan trace. Reused between calls (no per-shot allocation). */
export interface TraceResult {
  /** 0 = nothing within range, 1 = world, 2 = target. */
  kind: 0 | 1 | 2;
  distance: number;
  point: Vec3;
  normal: Vec3;
  /** Registry slot of the struck target (kind 2), else -1. */
  targetIndex: number;
  /** Zone struck on the target (kind 2). */
  zone: HitZone;
}

export function createTraceResult(): TraceResult {
  return { kind: 0, distance: 0, point: vec3(), normal: vec3(), targetIndex: -1, zone: 'body' };
}

const scratchNormal = vec3();
const scratchZone: ZoneHit = createZoneHit();

/** Nearest hit along a unit-direction ray: static boxes occlude targets; targets use hit zones. */
export function trace(
  boxes: readonly BoxDef[],
  field: TargetField,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  out: TraceResult,
): TraceResult {
  let best = maxDist;
  out.kind = 0;
  out.targetIndex = -1;
  out.normal.x = 0;
  out.normal.y = 0;
  out.normal.z = 0;

  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]!, best, scratchNormal);
    if (t >= 0 && t < best) {
      best = t;
      out.kind = 1;
      out.normal.x = scratchNormal.x;
      out.normal.y = scratchNormal.y;
      out.normal.z = scratchNormal.z;
    }
  }
  const slot = field.traceNearest(ox, oy, oz, dx, dy, dz, best, scratchZone);
  if (slot >= 0) {
    best = scratchZone.distance;
    out.kind = 2;
    out.targetIndex = slot;
    out.zone = scratchZone.zone;
    out.normal.x = scratchZone.nx;
    out.normal.y = scratchZone.ny;
    out.normal.z = scratchZone.nz;
  }
  out.distance = best;
  out.point.x = ox + dx * best;
  out.point.y = oy + dy * best;
  out.point.z = oz + dz * best;
  return out;
}

// Reused event payload (valid only during the callback).
const impactPayload: SimEvents['shotImpact'] = {
  tick: 0, point: vec3(), normal: vec3(), onTarget: false, distance: 0, targetId: -1, zone: null,
};

const scratchOrigin = vec3();
const scratchDir = vec3();

/** Tick the weapon: cooldown, and fire a hitscan shot from the eye along the view. */
export function stepWeapon(
  w: WeaponState,
  firing: boolean,
  p: PlayerState,
  boxes: readonly BoxDef[],
  field: TargetField,
  wt: WeaponTunables,
  tick: number,
  events: EventSink<SimEvents>,
  result: TraceResult,
  movingSpeed: number,
): void {
  if (w.cooldown > 0) w.cooldown--;
  if (!firing || w.cooldown > 0) return;

  w.cooldown = secondsToTicks(wt.fireIntervalSec);
  w.shots++;

  const o = scratchOrigin;
  o.x = p.pos.x;
  o.y = p.pos.y + p.eyeHeight;
  o.z = p.pos.z;
  const d = directionFromAngles(scratchDir, p.yaw, p.pitch);

  // Design §3: a shot fired while airborne also counts as a moving shot.
  const moving = !p.grounded || p.vel.x * p.vel.x + p.vel.z * p.vel.z > movingSpeed * movingSpeed;
  events.emit('shotFired', { tick, origin: o, dir: d, moving });
  trace(boxes, field, o.x, o.y, o.z, d.x, d.y, d.z, wt.range, result);

  // A moving shot also counts when airborne (design §3); it breaks a clean kill.
  const hitId = result.kind === 2 ? field.slots[result.targetIndex]!.id : -1;
  field.registerShot(o.x, o.y, o.z, d.x, d.y, d.z, hitId, moving || !p.grounded, tick, events);

  if (result.kind !== 0) {
    const im = impactPayload;
    im.tick = tick;
    im.point = result.point;
    im.normal = result.normal;
    im.onTarget = result.kind === 2;
    im.distance = result.distance;
    im.targetId = hitId;
    im.zone = result.kind === 2 ? result.zone : null;
    events.emit('shotImpact', im);
  }
  if (result.kind === 2) {
    const damage = zoneDamage(wt.damageBands, result.zone, result.distance);
    field.applyHit(result.targetIndex, result.zone, result.point, result.distance, damage, tick, events);
  }
}
