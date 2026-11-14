import type { Vec3 } from '../core/vec3';

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
}

export interface WeaponState {
  /** Ticks until the weapon can fire again. */
  cooldown: number;
  shots: number;
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
export interface SimEvents {
  shotFired: { tick: number; origin: Vec3; dir: Vec3 };
  /** Where a shot ended (world surface, target, or max range). */
  shotImpact: { tick: number; point: Vec3; normal: Vec3; onTarget: boolean; distance: number };
  targetHit: { tick: number; targetId: number; point: Vec3; damage: number; hpLeft: number; distance: number };
  targetKilled: { tick: number; targetId: number; point: Vec3; distance: number };
  targetRespawned: { tick: number; targetId: number };
  playerJumped: { tick: number };
  playerLanded: { tick: number; impactSpeed: number };
  footstep: { tick: number; crouching: boolean; walking: boolean };
}
