import type { Vec3 } from '../core/vec3';
import type { HitZone, RunEvents, TargetKind } from './runEvents';

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
  /** Held or clicked since last tick. */
  fire: boolean;
}

export function createTickInput(): TickInput {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false };
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
  /** Enemy/target kind id (design §5.2). Scaffold targets are 'post'. */
  kind: TargetKind;
  /** Set on the first tick the target is in view and unoccluded; cleared on kill/respawn. */
  visible: boolean;
}

export interface WeaponState {
  /** Ticks until the weapon can fire again. */
  cooldown: number;
  /** Shots fired since the last reset; the `shotId` of the latest shot. */
  shots: number;
  /** Tick of the last shot (-1 = none) and the position of that shot in its burst (recoil index). */
  lastShotTick: number;
  burstIndex: number;
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

/**
 * Events the simulation emits. Payloads are read-only and valid only during the callback.
 * Angles in radians. Shot/target payloads extend the foundation's (nothing renamed); the run
 * vocabulary lives in `runEvents.ts`.
 */
export interface SimEvents {
  shotFired: {
    tick: number;
    /** Unique within the run (the weapon's shot counter). */
    shotId: number;
    weapon: string;
    origin: Vec3;
    dir: Vec3;
    /** View angles at the tick (the crosshair); `dir` may differ later by spread/recoil. */
    yaw: number;
    pitch: number;
    /** Flagged at fire time: airborne, or horizontal speed above the accuracy deadzone (spec §2.4). */
    moving: boolean;
    /** Horizontal speed at fire time, m/s. */
    speed: number;
    airborne: boolean;
    spreadDeg: number;
    /** Position in the burst, 0 = first bullet after a pause. */
    recoilIndex: number;
    /** Rounds left in the magazine; -1 = infinite. */
    ammo: number;
    /** Nearest visible live target to the view ray (-1 none) and the angle to it, radians. */
    aimTargetId: number;
    aimErr: number;
    /** Aim point angles minus view angles for that target, radians. */
    aimDYaw: number;
    aimDPitch: number;
  };
  /** Where a shot ended (world surface, target, or max range). */
  shotImpact: {
    tick: number;
    shotId: number;
    result: 'hit' | 'miss';
    /** True when `result === 'hit'` (kept for the foundation's effects). */
    onTarget: boolean;
    /** -1 when the shot did not hit a target. */
    targetId: number;
    zone: HitZone | 'none';
    damage: number;
    killed: boolean;
    point: Vec3;
    normal: Vec3;
    distance: number;
  };
  targetHit: { tick: number; targetId: number; zone: HitZone; point: Vec3; damage: number; hpLeft: number; distance: number; killed: boolean };
  targetKilled: { tick: number; targetId: number; kind: TargetKind; zone: HitZone; point: Vec3; distance: number };
  targetRespawned: { tick: number; targetId: number };
  playerJumped: { tick: number };
  playerLanded: { tick: number; impactSpeed: number };
  footstep: { tick: number; crouching: boolean; walking: boolean };
}

/** Everything the simulation and the run machinery put on the bus. */
export type RunAndSimEvents = SimEvents & RunEvents;
