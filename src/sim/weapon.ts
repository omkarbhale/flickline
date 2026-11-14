import type { EventSink } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import type { Rng } from '../core/rng';
import { TICK_DT } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import type { WeaponDef, WeaponId, WeaponRules, WeaponTable } from '../config/weapon';
import { rayBox } from './collision';
import { createZoneHit, type ZoneHit } from './hitZones';
import type { TargetField } from './targets';
import type { BoxDef, HitZone, PlayerState, SimEvents, TickInput, WeaponState } from './types';
import {
  applyRecoilKick,
  damageFor,
  isMovingShot,
  movementErrorDeg,
  returnRecoil,
  sprayAccumDeg,
  sprayIncrement,
  stepYawSign,
} from './weaponModel';

/** Events the weapon simulation emits (part of `SimEvents`). */
export interface WeaponEvents {
  /** A bullet left the gun (design §14.3). `dir` already includes recoil and spread. */
  shotFired: {
    tick: number;
    t: number;
    shotId: number;
    weapon: WeaponId;
    origin: Vec3;
    dir: Vec3;
    /** Horizontal speed above the weapon's accuracy deadzone, or airborne (design §3). */
    moving: boolean;
    /** Horizontal speed, m/s. */
    speed: number;
    airborne: boolean;
    crouching: boolean;
    /** Total spread half-angle this shot was drawn from, degrees. */
    spreadDeg: number;
    /** 0-based bullet index in the spray (recoil pattern row). */
    recoilIndex: number;
    /** Recoil aim offset this bullet was fired with, degrees (pitch + = up, yaw + = right). */
    recoilPitchDeg: number;
    recoilYawDeg: number;
    /** Rounds left in the magazine after this shot. */
    ammo: number;
  };
  /**
   * Where a shot ended: emitted once per shot that hit a surface or a target, right after its
   * `shotFired` (a shot into empty space past `weaponRules.rangeM` has no impact).
   */
  shotImpact: {
    tick: number;
    t: number;
    shotId: number;
    result: 'hit' | 'miss';
    /** Target and zone struck, or -1 / null. */
    targetId: number;
    zone: HitZone | null;
    /** Damage dealt (0 on a miss) and whether it killed. */
    damage: number;
    killed: boolean;
    point: Vec3;
    normal: Vec3;
    onTarget: boolean;
    distance: number;
  };
  /** A reload began (manual, or automatic on an empty magazine). */
  reloadStarted: { tick: number; weapon: WeaponId; durationSec: number };
  reloadCompleted: { tick: number; weapon: WeaponId; ammo: number; reserve: number };
  /** A reload was cancelled by a weapon swap; the magazine keeps what it had. */
  reloadCancelled: { tick: number; weapon: WeaponId };
  /** A swap began; the weapon can fire after `equipSec`. */
  weaponSwitched: { tick: number; weapon: WeaponId; slot: number; equipSec: number };
}

declare module './types' {
  interface SimEvents extends WeaponEvents {}
}

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
  out.zone = 'body';
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

/** Timers count down in float seconds; this absorbs rounding so whole-tick durations stay exact. */
const EPS = 1e-9;
/** "Never" for times, finite so hashes and JSON snapshots stay well-defined. */
const LONG_AGO = -1e9;

/**
 * Reused per-world buffers: event payloads and the trace result. Nothing is allocated per shot.
 * (`targetHit` / `targetKilled` payloads belong to the target field, which emits them.)
 */
export interface WeaponScratch {
  trace: TraceResult;
  origin: Vec3;
  dir: Vec3;
  fired: SimEvents['shotFired'];
  impact: SimEvents['shotImpact'];
  reloadStarted: SimEvents['reloadStarted'];
  reloadCompleted: SimEvents['reloadCompleted'];
  reloadCancelled: SimEvents['reloadCancelled'];
  switched: SimEvents['weaponSwitched'];
}

export function createWeaponScratch(): WeaponScratch {
  const t = createTraceResult();
  const origin = vec3();
  const dir = vec3();
  const weapon: WeaponId = 'kestrel';
  return {
    trace: t,
    origin,
    dir,
    fired: {
      tick: 0, t: 0, shotId: 0, weapon, origin, dir, moving: false, speed: 0, airborne: false,
      crouching: false, spreadDeg: 0, recoilIndex: 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: 0,
    },
    impact: {
      tick: 0, t: 0, shotId: 0, result: 'miss', targetId: -1, zone: null, damage: 0, killed: false,
      point: t.point, normal: t.normal, onTarget: false, distance: 0,
    },
    reloadStarted: { tick: 0, weapon, durationSec: 0 },
    reloadCompleted: { tick: 0, weapon, ammo: 0, reserve: 0 },
    reloadCancelled: { tick: 0, weapon },
    switched: { tick: 0, weapon, slot: 0, equipSec: 0 },
  };
}

export function createWeaponState(loadout: readonly WeaponId[], table: WeaponTable): WeaponState {
  const w: WeaponState = {
    slots: [],
    active: 0,
    shots: 0,
    cooldown: 0,
    equipLeft: 0,
    reloadLeft: 0,
    sprayCount: 0,
    lastShotTime: LONG_AGO,
    recoilIndex: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    yawSign: 1,
    yawTarget: 1,
    fireWasDown: false,
    wasGrounded: true,
    landTime: LONG_AGO,
    infiniteMagazine: false,
    infiniteReserve: false,
  };
  resetWeaponState(w, loadout, table);
  return w;
}

/**
 * Back to a fresh, equipped first slot with full magazines and reserves. Keeps the
 * `infiniteMagazine` / `infiniteReserve` options (they belong to the mode, not the run).
 */
export function resetWeaponState(w: WeaponState, loadout: readonly WeaponId[], table: WeaponTable): void {
  w.slots.length = 0;
  for (let i = 0; i < loadout.length; i++) {
    const def = table[loadout[i]!];
    w.slots.push({ id: loadout[i]!, mag: def.magazine, reserve: def.reserve });
  }
  w.active = 0;
  w.shots = 0;
  w.cooldown = 0;
  w.equipLeft = 0;
  w.reloadLeft = 0;
  w.fireWasDown = false;
  w.wasGrounded = true;
  w.landTime = LONG_AGO;
  resetSpray(w);
}

/** Forget the current spray: spread, recoil offset and pattern position. */
function resetSpray(w: WeaponState): void {
  w.sprayCount = 0;
  w.lastShotTime = LONG_AGO;
  w.recoilIndex = 0;
  w.recoilPitch = 0;
  w.recoilYaw = 0;
  w.yawSign = 1;
  w.yawTarget = 1;
}

/** Can the active weapon start a reload now. */
function canReload(w: WeaponState, def: WeaponDef): boolean {
  const slot = w.slots[w.active]!;
  return (
    w.reloadLeft === 0 &&
    w.equipLeft === 0 &&
    slot.mag < def.magazine &&
    (w.infiniteReserve || slot.reserve > 0)
  );
}

function startReload(w: WeaponState, def: WeaponDef, tick: number, events: EventSink<SimEvents>, s: WeaponScratch): void {
  w.reloadLeft = def.reloadSec;
  const e = s.reloadStarted;
  e.tick = tick;
  e.weapon = w.slots[w.active]!.id;
  e.durationSec = def.reloadSec;
  events.emit('reloadStarted', e);
}

/** Everything the weapon simulation reads besides its own state. */
export interface WeaponWorld {
  boxes: readonly BoxDef[];
  /** The target registry: hit zones, shot bookkeeping, damage application and kill events. */
  field: TargetField;
  table: WeaponTable;
  rules: WeaponRules;
  rng: Rng;
}

/**
 * One tick of the active weapon (spec §3): swap and equip, reload, spray recovery, recoil return,
 * then at most one shot (semi-auto on a fresh press, auto while held) traced as hitscan with
 * spread and recoil, damaging targets by zone and range.
 *
 * Timing: every timer is float seconds counted down by TICK_DT. An action started on tick T is
 * first counted down on tick T+1, so a 1.0 s equip set on tick T allows a shot on tick T+128.
 */
export function stepWeapon(
  w: WeaponState,
  input: TickInput,
  p: PlayerState,
  world: WeaponWorld,
  tick: number,
  events: EventSink<SimEvents>,
  s: WeaponScratch,
): void {
  const dt = TICK_DT;
  const time = tick * dt;
  let def = world.table[w.slots[w.active]!.id];

  // Landing (spec §2.6 landing spread) from the movement result of this tick.
  if (p.grounded && !w.wasGrounded) w.landTime = time;
  w.wasGrounded = p.grounded;

  // Timers.
  if (w.cooldown > 0) w.cooldown -= dt;
  if (w.equipLeft > 0) {
    w.equipLeft -= dt;
    if (w.equipLeft <= EPS) w.equipLeft = 0;
  }
  if (w.reloadLeft > 0) {
    w.reloadLeft -= dt;
    if (w.reloadLeft <= EPS) {
      w.reloadLeft = 0;
      const slot = w.slots[w.active]!;
      const need = def.magazine - slot.mag;
      const take = w.infiniteReserve ? need : Math.min(need, slot.reserve);
      slot.mag += take;
      if (!w.infiniteReserve) slot.reserve -= take;
      const e = s.reloadCompleted;
      e.tick = tick;
      e.weapon = slot.id;
      e.ammo = slot.mag;
      e.reserve = slot.reserve;
      events.emit('reloadCompleted', e);
    }
  }

  // Swap (design §6: a swap cancels a reload exactly as the spec says; spec §3.1 equip time).
  const to = input.switchTo;
  if (to >= 0 && to < w.slots.length && to !== w.active) {
    if (w.reloadLeft > 0) {
      w.reloadLeft = 0;
      const e = s.reloadCancelled;
      e.tick = tick;
      e.weapon = w.slots[w.active]!.id;
      events.emit('reloadCancelled', e);
    }
    w.active = to;
    def = world.table[w.slots[to]!.id];
    w.equipLeft = def.equipSec;
    w.cooldown = 0;
    resetSpray(w);
    const e = s.switched;
    e.tick = tick;
    e.weapon = w.slots[to]!.id;
    e.slot = to;
    e.equipSec = def.equipSec;
    events.emit('weaponSwitched', e);
  }

  // Recoil: yaw direction swing (switch time) and return towards the crosshair (spec §3.5).
  stepYawSign(def, w, dt);
  if (time - w.lastShotTime >= def.recoilReturnDelaySec - EPS && (w.recoilPitch !== 0 || w.recoilYaw !== 0)) {
    returnRecoil(w, def.recoilReturnDegPerSec * dt);
  }

  if (input.reload && canReload(w, def)) startReload(w, def, tick, events, s);

  // Trigger: auto fires while held, semi-auto only on a fresh press (no buffering).
  const pressed = input.fire && (def.fireMode === 'auto' || !w.fireWasDown);
  w.fireWasDown = input.fire;
  const slot = w.slots[w.active]!;
  let fired = false;
  if (pressed && w.equipLeft === 0 && w.reloadLeft === 0 && w.cooldown <= EPS) {
    if (slot.mag > 0 || w.infiniteMagazine) {
      fire(w, def, p, world, tick, time, events, s);
      fired = true;
      if (slot.mag === 0 && canReload(w, def)) startReload(w, def, tick, events, s); // auto-reload on empty
    } else if (canReload(w, def)) {
      startReload(w, def, tick, events, s);
    }
  }
  // Fractional carry only between held shots: an idle gun is simply ready.
  if (!fired && w.cooldown < 0) w.cooldown = 0;
}

function fire(
  w: WeaponState,
  def: WeaponDef,
  p: PlayerState,
  world: WeaponWorld,
  tick: number,
  time: number,
  events: EventSink<SimEvents>,
  s: WeaponScratch,
): void {
  const rules = world.rules;
  const slot = w.slots[w.active]!;

  // Spray count and stationary spread (spec §3.3).
  const sinceLast = time - w.lastShotTime;
  if (sinceLast >= def.recoverySec - EPS) {
    w.sprayCount = 0;
    w.recoilIndex = 0;
    w.yawSign = 1;
    w.yawTarget = 1;
  }
  const accum = sprayAccumDeg(def, w.sprayCount);
  w.sprayCount += sprayIncrement(def, rules, sinceLast);
  w.lastShotTime = time;
  w.cooldown += 1 / def.fireRateHz;

  // Movement state and total spread (spec §3.3 final formula, §3.4, §2.6).
  const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  const airborne = !p.grounded;
  const moving = isMovingShot(def, speed, airborne);
  const stanceMult = p.crouching ? def.crouchSpreadMult : 1;
  const landing = time - w.landTime < rules.landingSpreadSec - EPS ? rules.landingSpreadAddDeg : 0;
  const spreadDeg =
    accum * stanceMult +
    movementErrorDeg(def, rules, speed / def.runSpeedMps, p.crouching, airborne) +
    landing;

  // Direction: view + recoil offset, then a random point in the spread cone (half-angle, spec §3.3;
  // centre-biased when still, uniform over the disc when moving). Always two draws: deterministic.
  const recoilPitch = w.recoilPitch;
  const recoilYaw = w.recoilYaw;
  const yaw = p.yaw - recoilYaw * DEG2RAD; // + recoil yaw = right = smaller view yaw
  const pitch = p.pitch + recoilPitch * DEG2RAD;
  const u = world.rng.next();
  const phi = world.rng.next() * Math.PI * 2;
  const power = moving ? rules.centreBiasPowerMoving : rules.centreBiasPowerStill;
  const r = spreadDeg * Math.pow(u, power) * DEG2RAD;
  const d = directionFromAngles(s.dir, yaw, pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  // right = (cos y, 0, -sin y); up = (sin y sin p, cos p, cos y sin p): orthonormal with d.
  const cr = Math.cos(r), sr = Math.sin(r);
  const a = sr * Math.cos(phi), b = sr * Math.sin(phi);
  d.x = d.x * cr + a * cy + b * sy * sp;
  d.y = d.y * cr + b * cp;
  d.z = d.z * cr - a * sy + b * cy * sp;

  // Kick for this bullet (moves the next ones), spec §3.5.
  const recoilIndex = w.recoilIndex;
  applyRecoilKick(def, w, world.rng, moving, p.crouching);

  if (!w.infiniteMagazine) slot.mag--;
  w.shots++;
  const shotId = w.shots;

  const o = s.origin;
  o.x = p.pos.x;
  o.y = p.pos.y + p.eyeHeight;
  o.z = p.pos.z;

  const f = s.fired;
  f.tick = tick;
  f.t = time;
  f.shotId = shotId;
  f.weapon = slot.id;
  f.moving = moving;
  f.speed = speed;
  f.airborne = airborne;
  f.crouching = p.crouching;
  f.spreadDeg = spreadDeg;
  f.recoilIndex = recoilIndex;
  f.recoilPitchDeg = recoilPitch;
  f.recoilYawDeg = recoilYaw;
  f.ammo = slot.mag;
  events.emit('shotFired', f);

  const field = world.field;
  const tr = trace(world.boxes, field, o.x, o.y, o.z, d.x, d.y, d.z, rules.rangeM, s.trace);
  // Shot bookkeeping for the kill stats (bullets at a target, near misses, moving shots).
  const hitId = tr.kind === 2 ? field.slots[tr.targetIndex]!.id : -1;
  field.registerShot(o.x, o.y, o.z, d.x, d.y, d.z, hitId, moving, tick, events);
  if (tr.kind === 0) return;

  const im = s.impact;
  im.tick = tick;
  im.t = time;
  im.shotId = shotId;
  im.distance = tr.distance;
  im.onTarget = tr.kind === 2;
  if (tr.kind !== 2) {
    im.result = 'miss';
    im.targetId = -1;
    im.zone = null;
    im.damage = 0;
    im.killed = false;
    events.emit('shotImpact', im);
    return;
  }

  const damage = damageFor(def, tr.zone, tr.distance);
  im.result = 'hit';
  im.targetId = hitId;
  im.zone = tr.zone;
  im.damage = damage;
  im.killed = field.slots[tr.targetIndex]!.hp - damage <= 0;
  events.emit('shotImpact', im);
  // Emits targetHit (and targetKilled) and frees the slot or schedules the respawn.
  field.applyHit(tr.targetIndex, tr.zone, tr.point, tr.distance, damage, tick, events);
}

