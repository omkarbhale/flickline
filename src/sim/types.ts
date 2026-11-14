import type { Vec3 } from '../core/vec3';
import type { WeaponId } from '../config/weapon';
import type { RunEvents } from './runEvents';

/** Per-tick player command. The only way input reaches the simulation. Angles in radians. */
export interface TickInput {
  /** Strafe: +1 = right, -1 = left. */
  moveX: number;
  /** Forward: +1 = forward, -1 = back. */
  moveZ: number;
  /** Absolute view angles at this tick (yaw 0 = looking down -Z, + = left; pitch + = up). */
  yaw: number;
  pitch: number;
  /** Edge: jump was pressed since the last tick that consumed it. */
  jump: boolean;
  /** Held. */
  crouch: boolean;
  /** Held: slow silent-walk modifier. */
  walk: boolean;
  /** Held or clicked since last tick. Semi-auto weapons fire on the press, auto weapons while held. */
  fire: boolean;
  /** Edge: reload was pressed since the last tick that consumed it. */
  reload: boolean;
  /** Loadout slot to switch to (0 = primary, 1 = sidearm), or -1 for none. Idempotent. */
  switchTo: number;
}

export function createTickInput(): TickInput {
  return {
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false,
    reload: false, switchTo: -1,
  };
}

export interface PlayerState {
  /** Feet centre. `prevPos` is the position at the start of the latest tick (for interpolation). */
  pos: Vec3;
  prevPos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  /** Current hull height (stand/crouch). */
  height: number;
  /** Eye height above the feet, smoothed between stand/crouch. */
  eyeHeight: number;
  prevEyeHeight: number;
  /** Horizontal distance since last footstep event. */
  stepAccum: number;
  /** Speed multiplier from being tagged (spec §4.3): 1 = free, `tag.speed_scale` = fully tagged. Set by the health step. */
  tagScale: number;
  /** Aim punch from being hit (spec §4.4), radians added to the view pitch (+ = up). Set by the health step. */
  aimPunch: number;
}

/** The player's health and the timers behind tagging and flinch. Plain data (hashable, snapshot-able). */
export interface PlayerHealth {
  hp: number;
  maxHp: number;
  /** Shield points left and the level this life started at (spec §4.1; 0/0 = unshielded). Kill-heal never restores it. */
  shield: number;
  maxShield: number;
  /** False after `playerDied`; the world no longer steps until it is reset. */
  alive: boolean;
  /** Seconds since the last tagging hit; Infinity = not tagged. */
  tagSince: number;
  /** Ramp-in progress 0..1 (reaches 1 over `tag.ramp_in`). */
  tagRise: number;
  /** Current aim punch, degrees (+ = up). */
  flinchDeg: number;
  /** Tick of the last damage taken, -1 = never. */
  lastDamageTick: number;
  /** Total damage taken as HP and healed this life (stats, "you lost 40 HP to ..."), and what the shield soaked. */
  damageTaken: number;
  healed: number;
  shieldAbsorbed: number;
}

/** The three humanoid damage zones (design §5.1). Orbs are a single `head` zone. */
export type HitZone = 'head' | 'body' | 'leg';

/** Roster kinds (design §5.2). More arrive with #32/#33. */
export type TargetKind = 'post' | 'beacon';

/** Allocation-free finite-state-machine cursor (see `sim/fsm.ts`). */
export interface FsmState {
  /** Current state id (index into the behaviour's state table). */
  state: number;
  /** Tick the current state was entered. */
  enteredTick: number;
  /** Ticks left on the state timer; -1 = no timer running. */
  timerTicks: number;
}

/**
 * One slot of the target registry. Slots are preallocated and reused; `alive` says whether the
 * slot currently holds a target. Humanoids: `pos` is the feet centre. Orbs: `pos` is the centre.
 * Hit detection reads only this state (`sim/hitZones.ts`), never any render mesh.
 */
export interface TargetState {
  /** Unique per spawn (monotonic within a world), stable across the target's life. */
  id: number;
  kind: TargetKind;
  /** Level spawn point this target belongs to (it comes back after a kill), or -1. */
  spawner: number;
  home: Vec3;
  pos: Vec3;
  /** Humanoid pose: hit zones follow it. */
  crouched: boolean;
  /** Bounding sphere around (`pos.x`, `pos.y + boundsY`, `pos.z`): a cheap early-out for hitscan. */
  radius: number;
  boundsY: number;
  /** Orbs: radius multiplier over the roster's `orbRadius` (Beacon scale, design §9.4). Humanoids ignore it (spec hit volumes). */
  scale: number;
  hp: number;
  maxHp: number;
  /** Shield points left and at spawn (spec §4.1). Humanoid Echoes only: 0/0 for orbs and unshielded fights. */
  shield: number;
  maxShield: number;
  alive: boolean;
  /** Tick of the last hit (for presentation flashes). -1 = never. */
  lastHitTick: number;
  /** Tick the target was spawned. */
  spawnTick: number;
  /** Tick after which it expires (`targetExpired`), or -1 = never. */
  expireTick: number;
  /** Presentation-only idle sway offset (metres, +X) and last tick's value for interpolation. */
  sway: number;
  prevSway: number;
  /** Where the sway is easing towards. */
  swayTarget: number;
  fsm: FsmState;
  // --- bookkeeping for the kill event (design §3 stat definitions) ---
  /** First tick the target was in view and unoccluded; -1 until `targetVisible` fired. */
  visibleTick: number;
  /** Tick of the first shot at it (hit, or landed within `shotAtDeg`); -1 = none yet. */
  firstShotTick: number;
  /** Tick of the first shot aimed within `reactionAimDeg` after it became visible; -1 = none. */
  reactionShotTick: number;
  /** Bullets fired at it (hits + near misses). */
  bullets: number;
  /** A shot at it missed. */
  missedShot: boolean;
  /** A shot at it was a moving shot. */
  movingShot: boolean;
}

/** Per-weapon ammo, kept for every weapon in the loadout (it persists across swaps). */
export interface WeaponSlot {
  id: WeaponId;
  mag: number;
  reserve: number;
}

/**
 * The player's weapons: loadout ammo plus the state of the active weapon's simulation.
 * Plain data (hashable, snapshot-able). Times are sim seconds (`tick * TICK_DT`).
 */
export interface WeaponState {
  slots: WeaponSlot[];
  /** Index into `slots` of the equipped weapon. */
  active: number;
  /** Total shots fired (also the next shot's id minus one). */
  shots: number;
  /** Seconds until the next shot is allowed; <= 0 means ready (fractional carry keeps the fire rate exact). */
  cooldown: number;
  /** Seconds of equip time left (0 = equipped). */
  equipLeft: number;
  /** Seconds of reload left (0 = not reloading). */
  reloadLeft: number;
  /** Spec §3.3 spray count `n` (float; taps add 1/tapEfficiency). */
  sprayCount: number;
  /** Sim time of the last shot, seconds (very negative = never). */
  lastShotTime: number;
  /** 0-based index of the next bullet in the current spray (recoil pattern row). */
  recoilIndex: number;
  /** Current aim offset from recoil, degrees: pitch + = up, yaw + = right. */
  recoilPitch: number;
  recoilYaw: number;
  /** Yaw direction multiplier in [-1, 1]; swings towards `yawTarget` over the flip time. */
  yawSign: number;
  yawTarget: number;
  /** Fire was held on the previous tick (semi-auto needs a fresh press). */
  fireWasDown: boolean;
  /** Grounded on the previous tick (landing detection for the landing spread). */
  wasGrounded: boolean;
  /** Sim time of the last landing, seconds. */
  landTime: number;
  /** Option (drills): shots never use ammo, so the magazine never empties. Survives reset(). */
  infiniteMagazine: boolean;
  /** Option: reloads never use reserve ammo. Survives reset(). */
  infiniteReserve: boolean;
}

/** What a static collision box represents (renderer picks materials from this). */
export const BOX_TAGS = ['floor', 'wall', 'crate', 'platform', 'cover', 'pillar', 'panel', 'ceiling'] as const;
export type BoxTag = (typeof BOX_TAGS)[number];

export interface BoxDef {
  min: Vec3;
  max: Vec3;
  tag: BoxTag;
  /** Optional stable name; map anchors (peek cover, spray panel) refer to boxes by id. */
  id?: string;
}

export interface TargetSpawn {
  pos: Vec3;
  /** Which roster entry to place; default `beacon`. Level-placed targets respawn after a kill. */
  kind?: TargetKind;
  crouched?: boolean;
}

/** Pure-data map. Later maps/level editors produce this shape. */
export interface LevelDef {
  name: string;
  boxes: BoxDef[];
  spawn: { pos: Vec3; yaw: number };
  targets: TargetSpawn[];
}

/**
 * Events the simulation emits: an open interface. Each sim area declares its own map next to the
 * code that emits it (`PlayerEvents` in movement.ts, `WeaponEvents` in weapon.ts, `TargetEvents`
 * in targets.ts, `HealthEvents` in playerHealth.ts, ...) and merges it in with
 * `declare module './types' { interface SimEvents extends XEvents {} }`. Payloads are read-only and valid only during the callback (the weapon reuses its
 * payload objects). `t` is sim seconds since the world was reset.
 */
export interface SimEvents {}

declare module '../core/gameEvents' {
  interface GameEvents extends SimEvents {}
}

/** Everything the simulation and the run machinery put on the bus. */
export type RunAndSimEvents = SimEvents & RunEvents;
