import type { EventSink } from '../core/eventBus';
import { TICK_DT } from '../core/time';
import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import type { WeaponId } from '../config/weapon';
import { lineBlockedRay } from './collision';
import type { BehaviourContext } from './fsm';
import { createRay, createZoneHit, traceHumanoidRay } from './hitZones';
import { stepBody } from './movement';
import type { RunEvents } from './runEvents';
import {
  createTickInput, type BodyState, type EnemyCommand, type SimEvents, type TargetState, type WeaponState,
} from './types';
import {
  createWeaponScratch, createWeaponState, resetWeaponState, stepWeapon, type ShotResolver, type WeaponScratch, type WeaponWorld,
} from './weapon';

/**
 * The shared kinematic body of a humanoid Echo (#87, `docs/research/player-like-enemies.md` §5.1,
 * rule F6): whatever decides what an Echo does writes one `EnemyCommand` per tick, the same keys
 * and view a player sends, and `stepEnemyBody` runs it through the player's own code: `stepBody`
 * for movement, collision, crouch and jump, `stepWeapon` for fire rate, first-shot spread,
 * movement error, landing spread, recoil and reloads. So an Echo's stop is the player's stop (the
 * accuracy gate 0.10 s and a full stop 0.16 s after it lets go of a key), and its shots are as
 * inaccurate on the move as the player's.
 *
 * Only the end of a bullet differs: the player's bullets trace the targets, an Echo's trace the
 * player's hull (the same humanoid zones, `traceHumanoidRay`) behind the level's walls, and a hit
 * damages by zone and range through `EnemyWorld.hitPlayer` (#31). Every humanoid slot owns a body,
 * preallocated; its `pos` / `prevPos` are the slot's own vectors, so the renderer interpolates a
 * body-driven Echo exactly like the player, and nothing is copied or allocated per tick.
 */
export interface EnemyBody {
  /** Position, velocity, view, stance: the player's fields. `pos` / `prevPos` are the target slot's. */
  kin: BodyState;
  /** Its gun: the player's weapon state, one slot, never out of reserve ammo. */
  weapon: WeaponState;
  /** This tick's command: written by the Echo's behaviour (or the debug hook), read by `stepEnemyBody`. */
  cmd: EnemyCommand;
  /**
   * The run speed movement scales from, m/s (the "weapon run speed" of `stepBody`, spec §2.1): the
   * gun's by default. A Strafer runs at the dial's strafe speed instead (design §9.4); walking,
   * acceleration and braking are the player's fractions and rates of it either way.
   */
  gait: { runSpeedMps: number };
  /** The debug hook is driving this body (`__flickline.drive`): the behaviour does not run, the hook's command does. */
  driven: boolean;
}

/** One weapon slot, reused for every arming (no array is allocated at a respawn). */
const oneGun: WeaponId[] = ['kestrel'];

/** A body around a slot's position vectors, armed with `weapon` (`resetEnemyBody` re-arms it at every spawn). */
export function createEnemyBody(pos: Vec3, prevPos: Vec3, tunables: Tunables, weapon: WeaponId = 'kestrel'): EnemyBody {
  const m = tunables.movement;
  oneGun[0] = weapon;
  const w = createWeaponState(oneGun, tunables.weapon);
  w.infiniteReserve = true;
  return {
    kin: {
      pos, prevPos, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, grounded: true, crouching: false,
      height: m.standHeight, eyeHeight: m.standEyeHeight, prevEyeHeight: m.standEyeHeight, stepAccum: 0, tagScale: 1, aimPunch: 0,
    },
    weapon: w,
    cmd: createTickInput(),
    gait: { runSpeedMps: tunables.weapon[weapon].runSpeedMps },
    driven: false,
  };
}

/**
 * A fresh spawn: at rest on its feet where the slot's `pos` already is, standing or crouched,
 * facing `yaw`, no keys held, carrying `weapon` with a full magazine and a fresh spray.
 */
export function resetEnemyBody(b: EnemyBody, crouched: boolean, yaw: number, weapon: WeaponId, tunables: Tunables): void {
  const m = tunables.movement;
  const k = b.kin;
  k.prevPos.x = k.pos.x; k.prevPos.y = k.pos.y; k.prevPos.z = k.pos.z;
  k.vel.x = k.vel.y = k.vel.z = 0;
  k.yaw = yaw;
  k.pitch = 0;
  // Spawned standing on the floor: no fall, so no landing spread on its first shots.
  k.grounded = true;
  k.crouching = crouched;
  k.height = crouched ? m.crouchHeight : m.standHeight;
  k.eyeHeight = k.prevEyeHeight = crouched ? m.crouchEyeHeight : m.standEyeHeight;
  k.stepAccum = 0;
  k.tagScale = 1;
  k.aimPunch = 0;
  const c = b.cmd;
  c.moveX = c.moveZ = 0;
  c.yaw = yaw;
  c.pitch = 0;
  c.jump = c.walk = c.fire = c.reload = false;
  c.crouch = crouched;
  c.switchTo = -1;
  oneGun[0] = weapon;
  resetWeaponState(b.weapon, oneGun, tunables.weapon);
  b.weapon.infiniteReserve = true;
  b.gait.runSpeedMps = tunables.weapon[weapon].runSpeedMps;
  b.driven = false;
}

/**
 * Point the command's view at a world point from the body's eye (yaw 0 looks down -Z, + = left;
 * pitch + = up). A stand-in for the human aim model (#90): it turns in one tick.
 */
export function commandLookAt(b: EnemyBody, x: number, y: number, z: number): void {
  const k = b.kin;
  const dx = x - k.pos.x, dy = y - (k.pos.y + k.eyeHeight), dz = z - k.pos.z;
  const h = Math.sqrt(dx * dx + dz * dz);
  if (h > 1e-9) b.cmd.yaw = Math.atan2(-dx, -dz);
  b.cmd.pitch = Math.atan2(dy, h);
}

/**
 * Set the command's movement keys so the wish direction is the horizontal world direction
 * (`wx`, `wz`) (unit length, or zero to let go of every key) under the command's current yaw. A
 * player holds digital keys; a direction square to the view is a single key (`moveX` = ±1), one
 * along it is `moveZ` = ±1, and anything else is the analog mix `stepBody` normalises, so an Echo
 * on a lane that is not square to its view still runs along the lane.
 */
export function commandMoveToward(b: EnemyBody, wx: number, wz: number): void {
  const c = b.cmd;
  const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
  // right = (cos, -sin), forward = (-sin, -cos): project the world direction on both.
  c.moveX = wx * cos - wz * sin;
  c.moveZ = -wx * sin - wz * cos;
}

// ---------------------------------------------------------------------------------------------
// An Echo's bullets.
// ---------------------------------------------------------------------------------------------

const NULL_SINK: EventSink<SimEvents> = { emit() {} };
const shotRay = createRay();
const zoneHit = createZoneHit();
const firedEv: RunEvents['enemyFired'] = { tick: 0, id: 0, hit: false, dir: { x: 0, y: 0, z: 0 }, audibleToPlayer: false };
/** The Echo whose gun is stepping, and its context (the sim is single-threaded; set by `stepEnemyBody`). */
let shooter: TargetState | null = null;
let shooterCtx: BehaviourContext | null = null;

/**
 * Resolves an Echo's bullet against the player: the ray from its eye along the spread direction
 * against the player's humanoid zones, unless a wall of the level comes first. Emits
 * `enemyFired` (hit or miss, with the bullet's direction, for the tracer, the whiz and the audio's
 * side) and damages a hit zone by the gun's damage band at that range through `hitPlayer`.
 * Reports only through these events: the player's own gun events (`shotFired`, `reloadStarted`,
 * ...) never carry an Echo's shot.
 */
const enemyShots: ShotResolver = {
  // A thin wrapper (as `PlayerShots.resolve` is): the gun's optimised `fire` inlines it and keeps its
  // inlining budget for the random draws, which would otherwise return boxed doubles.
  resolve(s: WeaponScratch): void {
    resolveEchoShot(s);
  },
};

function resolveEchoShot(s: WeaponScratch): void {
  const t = shooter!;
  const ctx = shooterCtx!;
  const w = ctx.world;
  const p = w.player;
  const o = s.origin, d = s.dir;
  const r = shotRay;
  r.ox = o.x; r.oy = o.y; r.oz = o.z;
  r.dx = d.x; r.dy = d.y; r.dz = d.z;
  r.maxDist = ctx.tunables.weaponRules.rangeM;
  let hit = traceHumanoidRay(p.pos, p.crouching, ctx.tunables.targets.hit, r, zoneHit);
  if (hit) {
    r.maxDist = zoneHit.distance;
    hit = !lineBlockedRay(w.boxes, r);
  }
  const e = firedEv;
  e.tick = ctx.tick;
  e.id = t.id;
  e.hit = hit;
  e.dir.x = d.x; e.dir.y = d.y; e.dir.z = d.z;
  e.audibleToPlayer = w.soundAudible('shot', o.x, o.z);
  ctx.events.emit('enemyFired', e);
  t.ai.lastShotTick = ctx.tick;
  if (hit) w.hitPlayer(s.fired.weapon, zoneHit.zone, o.x, o.y, o.z, t.id, ctx.events);
}

/** The gun's view of the world for an Echo (refreshed from the context before each step). */
const gunWorld: WeaponWorld = {
  boxes: [],
  shots: enemyShots,
  table: null!,
  rules: null!,
  move: null!,
  rng: null!,
  swapLocked: true,
};
const gunScratch: WeaponScratch = createWeaponScratch();

/**
 * One tick of an Echo's body under its current command: movement through `stepBody` (the slot's
 * `prevPos` is snapshotted there, for interpolation), then its gun through `stepWeapon`, exactly
 * the order `World.step` uses for the player. The command's `jump` and `reload` are edges, as
 * the player's are: they apply to this tick and are cleared after it. The player's movement
 * events (`footstep`, `playerJumped`, ...) are the player's, so the body's are dropped; enemy
 * footsteps are positioned sounds the audio derives from the motion. Allocates nothing.
 */
export function stepEnemyBody(t: TargetState, ctx: BehaviourContext): void {
  const b = t.body;
  const tun = ctx.tunables;
  const w = ctx.world;
  stepBody(b.kin, b.cmd, w.boxes, tun.movement, b.gait, TICK_DT, ctx.tick, NULL_SINK);
  t.crouched = b.kin.crouching;
  stepEnemyGun(t, ctx);
  b.cmd.jump = false;
  b.cmd.reload = false;
}

/**
 * The gun of an Echo whose slot its FSM moves itself (a Peeker sliding out of cover, an arrival
 * walking in): the body is brought in step with the slot (velocity from this tick's motion, so its
 * shots carry the real movement error; stance and eye height; the command's view), then only its
 * gun steps. Used by the enemy mind (#90) so every mind-driven Echo shoots through the one gun.
 */
export function stepKinematicGun(t: TargetState, ctx: BehaviourContext): void {
  const b = t.body;
  const k = b.kin;
  const m = ctx.tunables.movement;
  k.vel.x = (k.pos.x - k.prevPos.x) / TICK_DT;
  k.vel.y = 0;
  k.vel.z = (k.pos.z - k.prevPos.z) / TICK_DT;
  k.grounded = true;
  k.crouching = t.crouched;
  k.height = t.crouched ? m.crouchHeight : m.standHeight;
  k.eyeHeight = k.prevEyeHeight = t.crouched ? m.crouchEyeHeight : m.standEyeHeight;
  k.yaw = b.cmd.yaw;
  k.pitch = b.cmd.pitch;
  stepEnemyGun(t, ctx);
  b.cmd.reload = false;
}

/** One tick of an Echo's gun (`stepWeapon`) under its command, its bullets resolved against the player. */
function stepEnemyGun(t: TargetState, ctx: BehaviourContext): void {
  const b = t.body;
  const tun = ctx.tunables;
  const w = ctx.world;
  const g = gunWorld;
  g.boxes = w.boxes;
  g.table = tun.weapon;
  g.rules = tun.weaponRules;
  g.move = tun.movement;
  // Its spread and recoil draws come from its own decision stream (#86): its shots never shift the world's
  // draws or another Echo's, and never its own view's (the aim model draws from `aim`, #90).
  g.rng = t.streams.decisions;
  shooter = t;
  shooterCtx = ctx;
  stepWeapon(b.weapon, b.cmd, b.kin, g, ctx.tick, NULL_SINK, gunScratch);
  shooter = null;
  shooterCtx = null;
}
