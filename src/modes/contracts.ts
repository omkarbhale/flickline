import type { Vec3 } from '../core/vec3';
import type { EnemyKind } from '../config/scoring';
import type { StreakEvents } from '../feedback/streaks';
import type { SprayEvents } from '../sim/runEvents';
import type { MapEvents } from '../sim/mapEvents';

/**
 * Everything the mode framework needs from the rest of the game, as typed contracts: the sim's
 * spawn/despawn and events (#15), the map's anchors (#16), the skill model's dial (#17). The app
 * adapts the real modules to these (`app/modeHost.ts`); the framework and its tests never import
 * them. If a type on the other side changes, adapt it HERE, not in the framework.
 */

export type { EnemyKind };

/** The seven trained skills of design §3. */
export type SkillId = 'precision' | 'flick' | 'track' | 'footwork' | 'spray' | 'switch' | 'angles';
export type ModeId = string;

/**
 * A difficulty axis id from design §9.4 (e.g. `beaconScale`, `distance`, `flickAngleMin`,
 * `flickAngleMax`, `strafeSpeed`, `exposure`, `tell`, `density`). The dial module (#17) owns the
 * table; modes name the axes they use.
 */
export type AxisId = string;
/** Concrete axis values for one dial value, as returned by the dial module's `axes(dial)`. */
export type AxisValues = Readonly<Record<AxisId, number>>;

/** What `dialFor` needs to know about a mode (any `ModeDef` satisfies it). */
export interface ModeRef {
  readonly id: ModeId;
  readonly skills: readonly SkillId[];
}

/** Pre-planned dial offsets (dial points) per beat: warm-up, build, peak, breather (§4.8, §9.3); see `config/dial.ts` `waves`. */
export type WaveCurve = readonly number[];

/** The skill model's side of beat scheduling (#17: `SkillState.dialFor`, `axes`). */
export interface DialSource {
  /** Dial (0-100) for the beat; called exactly once per beat, at its boundary. `mode` is a key of `tunables.dial.modes`. */
  dialFor(mode: ModeId, beatIndex: number, curve: WaveCurve): number;
  /** Concrete axis values for a dial value (fairness floors already applied). */
  axes(dial: number): AxisValues;
}

/** What a Strafer needs at spawn (the dial's numbers and the lane it runs along; design §4.3, §5.2). */
export interface StrafeSpawn {
  /** Cruise speed, m/s. */
  speed: number;
  /** Longest strafe leg and longest stand-still, seconds. */
  legSec: number;
  standStillSec: number;
  /** The strafe line's ends (feet height). */
  laneA: Vec3;
  laneB: Vec3;
}

/** The enemy sim's side (#15): create and remove targets. */
export interface TargetSpawner {
  /**
   * Create a target (humanoid: feet position; orb: centre); `scale` is ×real head size; `strafe`
   * is for a Strafer. `durable` targets take any number of hits without dying (Spray Wall's Post).
   * Returns its id, or -1 when it could not be created.
   */
  spawn(kind: EnemyKind, pos: Vec3, scale: number, strafe?: StrafeSpawn, durable?: boolean): number;
  despawn(id: number): void;
}

/** A map anchor (design §10.2). Structural, so #16's `Anchor` union is assignable. */
export interface AnchorLike {
  readonly id: string;
  /** `post`, `beacon-shell`, `strafe-lane`, `peek`, `gate`, `drone-volume`, ... */
  readonly kind: string;
  readonly tags?: readonly string[];
  /** Point anchors (post, gate, ...). */
  readonly pos?: Vec3;
  /** Shell anchors (`beacon-shell`). */
  readonly centre?: Vec3;
  readonly rMin?: number;
  readonly rMax?: number;
  /** Lane anchors (`strafe-lane`): the scheduler uses the midpoint as the position. */
  readonly a?: Vec3;
  readonly b?: Vec3;
  /** Spray alcoves (`spray-alcove`): where to stand, which way to face (radians), where the Post stands, and the metres between them. */
  readonly stand?: Vec3;
  readonly yaw?: number;
  readonly post?: Vec3;
  readonly distance?: number;
  /** Spray alcoves: the id of the wall panel box behind the Post. */
  readonly panel?: string;
}

/** The map's side (#16): anchors and bounds. */
export interface AnchorSource {
  readonly anchors: readonly AnchorLike[];
  readonly bounds?: { readonly min: Vec3; readonly max: Vec3 };
  /**
   * Line of sight between two points (true = nothing in between). The picker skips candidates that
   * fail it, so nothing is spawned behind a pillar. Absent = everything is visible.
   */
  readonly sightClear?: (from: Vec3, to: Vec3) => boolean;
}

/** Read-only view of the player (the sim's `PlayerState` satisfies it). */
export interface PlayerView {
  readonly pos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly eyeHeight: number;
}

/** What a mode may read about the player's movement (Stop & Pop arms on the sideways speed). */
export interface MotionView extends PlayerView {
  /** Velocity, m/s. */
  readonly vel: Vec3;
  readonly crouching: boolean;
  readonly grounded: boolean;
}

export type TrialExtra = Readonly<Record<string, number>>;

/**
 * The facts the framework reads from the sim: the subset of `SimEvents` (design §14.3) it needs,
 * so the game bus satisfies `Subscribable<SourceEvents>` directly.
 */
export interface SourceEvents {
  targetKilled: {
    tick: number;
    targetId: number;
    kind: EnemyKind;
    zone: 'head' | 'body' | 'leg';
    ttkMs: number;
    rtMs: number;
    firstBullet: boolean;
    bullets: number;
    clean: boolean;
  };
  /** A target left the field unkilled (lifetime, or removed by the mode). */
  targetExpired: { tick: number; targetId: number };
  /** One bullet landed. The sim's payload carries more (`zone`, `point`, ...); `targetId` is -1 on a miss. */
  shotImpact: { tick: number; onTarget: boolean; targetId?: number; zone?: 'head' | 'body' | 'leg' | null; shotId?: number };
  /**
   * A bullet left the gun, with the player's movement state at that tick (the sim's payload carries
   * more). Emitted right before its `shotImpact`, same `shotId`. `moving` = above the accuracy
   * deadzone or airborne (design §3).
   */
  shotFired: { tick: number; shotId: number; moving: boolean; speed: number; airborne: boolean; crouching: boolean };
  /** Horizontal speed first fell to the accuracy threshold; `counterStrafe`: the stop began with the opposite key, not a release. */
  playerStopped: { tick: number; latencyMs: number; counterStrafe: boolean };
}

/**
 * Weapon facts for modes that judge bullets and magazines (Spray Wall). They arrive through
 * `ModeDef.onWeapon`, separate from `ModeEvent`, so a mode that does not care never sees them.
 */
export interface WeaponSourceEvents {
  /** A bullet left the gun: the fields a spray trace needs (the sim's payload carries more). */
  shotFired: {
    tick: number;
    shotId: number;
    /** Weapon id the bullet came from (a mode ignores bullets of a weapon it did not hand out). */
    weapon: string;
    /** Bullet direction, recoil and spread included. */
    dir: Vec3;
    /** View angles at the tick, radians (the crosshair). */
    yaw: number;
    pitch: number;
    /** Recoil aim offset this bullet was fired with, degrees (pitch + = up, yaw + = right). */
    recoilPitchDeg: number;
    recoilYawDeg: number;
    spreadDeg: number;
    /** Rounds left after this shot. */
    ammo: number;
  };
  reloadStarted: { tick: number };
  reloadCompleted: { tick: number };
}

/** Run-level facts about the player the runner listens to (not mode events: modes never see them). */
export interface PlayerSourceEvents {
  /** The player's HP reached 0: the run ends with reason `death` (design §14.3). */
  playerDied: { tick: number };
}

/** Events the framework emits. §14.3 names and payloads, plus `beatStarted` and `scoreAwarded`. */
export interface ModeEvents extends StreakEvents, MapEvents, SprayEvents {
  /** The run moved the player (a mode with several stand points, Spray Wall): the view should face `yaw` again. */
  playerPlaced: { tick: number; x: number; y: number; z: number; yaw: number };
  runReady: { tick: number; mode: ModeId; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; t: number; reason: RunEndReason };
  /** The dial and axis values changed (only ever at a beat boundary). */
  beatStarted: { tick: number; t: number; beat: number; dial: number };
  /** One target resolved: an item for the skill model (design §9.1). */
  skillTrial: {
    tick: number;
    t: number;
    skill: SkillId;
    itemDifficulty: number;
    success: boolean;
    rtMs?: number;
    extra?: TrialExtra;
  };
  /** A kill was scored; `+score` floats from the kill. */
  scoreAwarded: {
    tick: number;
    t: number;
    targetId: number;
    kind: EnemyKind;
    points: number;
    total: number;
    base: number;
    precision: number;
    speed: number;
    streak: number;
    difficulty: number;
    surge: number;
  };
}

export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit';

declare module '../core/gameEvents' {
  interface GameEvents extends ModeEvents {}
}
