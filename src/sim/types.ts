import type { Vec3 } from '../core/vec3';
import type { WeaponId } from '../config/weapon';

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
}

export interface TargetState {
  id: number;
  home: Vec3;
  pos: Vec3;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Tick at which a dead target respawns. */
  respawnTick: number;
  /** Tick of the last hit (for presentation flashes). -1 = never. */
  lastHitTick: number;
}

/** Hit zone of a target (design §5.1, spec §5.1). Sphere targets report `body` until #15. */
export type HitZone = 'head' | 'body' | 'leg';

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
}

/** Pure-data map. Later maps/level editors produce this shape. */
export interface LevelDef {
  name: string;
  boxes: BoxDef[];
  spawn: { pos: Vec3; yaw: number };
  targets: TargetSpawn[];
}

/** Events the simulation emits. Payloads are read-only and valid only during the callback. */
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
    /** -1 when the shot did not hit a target. */
    targetId: number;
    zone: HitZone | null;
    damage: number;
    killed: boolean;
    point: Vec3;
    normal: Vec3;
    onTarget: boolean;
    distance: number;
  };
  targetHit: {
    tick: number;
    targetId: number;
    shotId: number;
    zone: HitZone;
    point: Vec3;
    damage: number;
    hpLeft: number;
    distance: number;
    killed: boolean;
  };
  targetKilled: { tick: number; targetId: number; point: Vec3; distance: number };
  targetRespawned: { tick: number; targetId: number };
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
}

/** Every SimEvents key, for loggers and tests. */
export const SIM_EVENT_TYPES: readonly (keyof SimEvents)[] = [
  'shotFired', 'shotImpact', 'targetHit', 'targetKilled', 'targetRespawned',
  'playerJumped', 'playerLanded', 'footstep',
  'reloadStarted', 'reloadCompleted', 'reloadCancelled', 'weaponSwitched',
];
