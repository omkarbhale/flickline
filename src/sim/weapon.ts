import type { EventSink } from '../core/eventBus';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import { secondsToTicks } from '../core/time';
import type { TargetTunables } from '../config/targets';
import type { WeaponTunables } from '../config/weapon';
import { rayBox, raySphere } from './collision';
import type { BoxDef, PlayerState, SimEvents, TargetState, WeaponState } from './types';

/** Result of a hitscan trace. Reused between calls (no per-shot allocation). */
export interface TraceResult {
  /** 0 = nothing within range, 1 = world, 2 = target. */
  kind: 0 | 1 | 2;
  distance: number;
  point: Vec3;
  normal: Vec3;
  targetIndex: number;
}

export function createTraceResult(): TraceResult {
  return { kind: 0, distance: 0, point: vec3(), normal: vec3(), targetIndex: -1 };
}

const scratchNormal = vec3();

/** Nearest hit along a unit-direction ray: static boxes occlude targets. */
export function trace(
  boxes: readonly BoxDef[],
  targets: readonly TargetState[],
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
  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i]!;
    if (!tg.alive) continue;
    const t = raySphere(ox, oy, oz, dx, dy, dz, tg.pos.x, tg.pos.y, tg.pos.z, tg.radius, best);
    if (t >= 0 && t < best) {
      best = t;
      out.kind = 2;
      out.targetIndex = i;
    }
  }
  out.distance = best;
  out.point.x = ox + dx * best;
  out.point.y = oy + dy * best;
  out.point.z = oz + dz * best;
  if (out.kind === 2) {
    const tg = targets[out.targetIndex]!;
    let nx = out.point.x - tg.pos.x;
    let ny = out.point.y - tg.pos.y;
    let nz = out.point.z - tg.pos.z;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    out.normal.x = nx; out.normal.y = ny; out.normal.z = nz;
  }
  return out;
}

const scratchOrigin = vec3();
const scratchDir = vec3();

/** Tick the weapon: cooldown, and fire a hitscan shot from the eye along the view. */
export function stepWeapon(
  w: WeaponState,
  firing: boolean,
  p: PlayerState,
  boxes: readonly BoxDef[],
  targets: TargetState[],
  wt: WeaponTunables,
  tt: TargetTunables,
  tick: number,
  events: EventSink<SimEvents>,
  result: TraceResult,
  runSpeed: number,
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

  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  const airborne = !p.grounded;
  const moving = airborne || speed > wt.deadzoneFraction * runSpeed;
  events.emit('shotFired', { tick, origin: o, dir: d, moving, speed, airborne });
  trace(boxes, targets, o.x, o.y, o.z, d.x, d.y, d.z, wt.range, result);

  if (result.kind !== 0) {
    events.emit('shotImpact', {
      tick,
      point: result.point,
      normal: result.normal,
      onTarget: result.kind === 2,
      distance: result.distance,
    });
  }
  if (result.kind === 2) {
    const tg = targets[result.targetIndex]!;
    tg.hp -= wt.damage;
    tg.lastHitTick = tick;
    events.emit('targetHit', {
      tick,
      targetId: tg.id,
      point: result.point,
      damage: wt.damage,
      hpLeft: Math.max(0, tg.hp),
      distance: result.distance,
      zone: 'body',
      killed: tg.hp <= 0,
    });
    if (tg.hp <= 0) {
      tg.alive = false;
      tg.respawnTick = tick + secondsToTicks(tt.respawnSec);
      events.emit('targetKilled', { tick, targetId: tg.id, point: result.point, distance: result.distance, zone: 'body' });
    }
  }
}
