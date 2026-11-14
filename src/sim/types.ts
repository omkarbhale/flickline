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
  /** Total damage taken and healed this life (stats, "you lost 40 HP to ..."). */
  damageTaken: number;
  healed: number;
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
 * Events the simulation emits. Payloads are read-only and valid only during the callback (the
 * weapon reuses its payload objects). `t` is sim seconds since the world was reset.
 */
export interface SimEvents {
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
    /** View angles at the tick (the crosshair, radians); `dir` adds recoil and spread. */
    yaw: number;
    pitch: number;
    /** Nearest visible live target to the view ray (-1 none) and the angle to its head, radians. */
    aimTargetId: number;
    aimErr: number;
    /** Head-centre angles minus view angles for that target, radians. */
    aimDYaw: number;
    aimDPitch: number;
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
  /** A target was added to the field (spawn call, level placement or respawn). */
  targetSpawned: { tick: number; t: number; targetId: number; kind: TargetKind; pos: Vec3; tags: readonly string[] };
  /** First tick the target is in the view frustum and unoccluded from the eye. Once per spawn. */
  targetVisible: {
    tick: number;
    t: number;
    targetId: number;
    /** Angle between the view ray and the target's head centre at that tick, radians (pre-aim error). */
    preAim: number;
    /** Head-centre angles minus view angles at that tick, radians: the flick vector. */
    dYaw: number;
    dPitch: number;
  };
  targetHit: {
    tick: number;
    t: number;
    targetId: number;
    kind: TargetKind;
    zone: HitZone;
    point: Vec3;
    damage: number;
    hpLeft: number;
    distance: number;
    killed: boolean;
  };
  targetKilled: {
    tick: number;
    t: number;
    targetId: number;
    kind: TargetKind;
    zone: HitZone;
    point: Vec3;
    distance: number;
    /** First shot at the target to its death, ms. 0 when the first bullet killed it. */
    ttkMs: number;
    /** From the target becoming visible to the first shot aimed within 5 degrees of it, ms. */
    rtMs: number;
    /** The very first bullet fired at it killed it. */
    firstBullet: boolean;
    /** Bullets fired at it, including the killing one. */
    bullets: number;
    /** No missed shot at it and no moving shot at it. */
    clean: boolean;
  };
  /** A target left the field without being killed (lifetime ran out, or despawned by the mode). */
  targetExpired: { tick: number; t: number; targetId: number; kind: TargetKind };
  /** A level-placed target came back after a kill. Also announced by `targetSpawned`. */
  targetRespawned: { tick: number; targetId: number };
  /** Aim ray entered (`on`) or left the padded hit volume of a visible target (edge events). */
  aimOnTarget: { tick: number; on: boolean; id: number };
  /** Vertical angle (radians) between the aim ray and head-centre height, sampled while moving with no enemy visible. */
  headHeightSampled: { tick: number; err: number };
  /** Horizontal speed first fell to the accuracy threshold after a stop or counter-strafe input. */
  playerStopped: { tick: number; latencyMs: number };
  playerJumped: { tick: number };
  playerLanded: { tick: number; impactSpeed: number };
  footstep: { tick: number; crouching: boolean; walking: boolean };
  /** A reload began (manual, or automatic on an empty magazine). */
  reloadStarted: { tick: number; weapon: WeaponId; durationSec: number };
  reloadCompleted: { tick: number; weapon: WeaponId; ammo: number; reserve: number };
  /** A reload was cancelled by a weapon swap; the magazine keeps what it had. */
  reloadCancelled: { tick: number; weapon: WeaponId };
  /** A swap began; the weapon can fire after `equipSec`. */
  weaponSwitched: { tick: number; weapon: WeaponId; slot: number; equipSec: number };
  /**
   * The player took damage (design §14.3). `dir` is the unit direction to the shooter in the
   * player's yaw frame, camera-local like everything else: +X right, +Y up, -Z straight ahead, so
   * the on-screen angle clockwise from "up the screen" is `atan2(dir.x, -dir.z)`. `yaw` is the
   * player's yaw at the hit, so a presenter can keep the arc on the shooter while the view turns.
   */
  playerDamaged: {
    tick: number;
    t: number;
    /** HP lost (floats, never rounded in the sim). */
    amount: number;
    /** HP left after the hit (0 when it killed). */
    hp: number;
    maxHp: number;
    zone: HitZone;
    dir: Vec3;
    yaw: number;
    /** Who fired (enemy id), or -1 (debug, environment). */
    sourceId: number;
    killed: boolean;
  };
  /** The tagging slow was started or refreshed by a hit (spec §4.3). */
  playerSlowed: { tick: number; t: number; factor: number; durationMs: number };
  /** HP reached 0. The mode runner ends the run with reason `death`. */
  playerDied: { tick: number; t: number; sourceId: number };
  /** HP was restored (kill-heal, design §4.8). `amount` is what was actually added (after the cap). */
  playerHealed: { tick: number; t: number; amount: number; hp: number; maxHp: number; source: 'kill' };
}

/** Everything the simulation and the run machinery put on the bus. */
export type RunAndSimEvents = SimEvents & RunEvents;

/** Every SimEvents key, for loggers and tests. */
export const SIM_EVENT_TYPES: readonly (keyof SimEvents)[] = [
  'shotFired', 'shotImpact', 'targetSpawned', 'targetVisible', 'targetHit', 'targetKilled',
  'targetExpired', 'targetRespawned', 'playerJumped', 'playerLanded', 'footstep',
  'reloadStarted', 'reloadCompleted', 'reloadCancelled', 'weaponSwitched',
  'playerDamaged', 'playerSlowed', 'playerDied', 'playerHealed',
  'aimOnTarget', 'headHeightSampled', 'playerStopped',
];
