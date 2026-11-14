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

export interface WeaponState {
  /** Ticks until the weapon can fire again. */
  cooldown: number;
  shots: number;
}

/** What a static collision box represents (renderer picks materials from this). */
export type BoxTag = 'floor' | 'wall' | 'crate' | 'platform';

export interface BoxDef {
  min: Vec3;
  max: Vec3;
  tag: BoxTag;
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

/** Events the simulation emits. Payloads are read-only and valid only during the callback. */
export interface SimEvents {
  shotFired: { tick: number; origin: Vec3; dir: Vec3 };
  /** Where a shot ended (world surface, target, or max range). */
  shotImpact: {
    tick: number;
    point: Vec3;
    normal: Vec3;
    onTarget: boolean;
    distance: number;
    /** Target and zone struck, or -1 / null. */
    targetId: number;
    zone: HitZone | null;
  };
  /** A target was added to the field (spawn call, level placement or respawn). */
  targetSpawned: { tick: number; t: number; targetId: number; kind: TargetKind; pos: Vec3; tags: readonly string[] };
  /** First tick the target is in the view frustum and unoccluded from the eye. Once per spawn. */
  targetVisible: { tick: number; t: number; targetId: number };
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
  playerJumped: { tick: number };
  playerLanded: { tick: number; impactSpeed: number };
  footstep: { tick: number; crouching: boolean; walking: boolean };
}
