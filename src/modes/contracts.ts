import type { Vec3 } from '../core/vec3';
import type { EnemyKind } from '../config/scoring';
import type { StreakEvents } from '../feedback/streaks';
import type { RunEvents, SectorEvents, SprayEvents } from '../sim/runEvents';
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
  /**
   * The matched dial the skill model aims `mode` at now, before any wave or depth offset:
   * θ − s·logit(target success) (design §9.3.1). Absent: the dial a mode schedules itself (Sweep's
   * sectors) falls back to `dialFor(mode, 0, [0])`.
   */
  target?(mode: ModeId): number;
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
  /** A route from `laneA` to `laneB` before the first stop (Sweep's meet sectors): see `StrafeParams.travel`. */
  travel?: boolean;
}

/** What a Peeker needs at spawn (a map's `peek` anchor, design §10.2): its hidden and full-out feet positions and pattern. */
export interface PeekSpawn {
  pattern: 'shoulder' | 'wide' | 'jiggle' | 'hop';
  hold: Vec3;
  out: Vec3;
  /** The dial's wide-peek exposure, seconds. */
  wideSec?: number;
}

/** What an Echo that shoots back needs at spawn (the dial's numbers, design §5.3, and what it expects, #142). */
export interface FireSpawn {
  tellSec: number;
  reactionSec: number;
  hitChance: number;
  expectation?: 'prepared' | 'attending' | 'unaware';
}

/** An Echo that arrives (a hold sector's, design §4.2): spawns at the route's first point and walks it in before it fights. */
export interface ArriveSpawn {
  route: readonly Vec3[];
  /** Metres per second along the route; at or under the footstep audio's silent speed it is a quiet walk. */
  speed: number;
  /** A Strafer stops walking and fights once it sees the player this close, metres. */
  engageM: number;
}

/** Spawn details beyond kind, place and size: a Peeker's anchor, shooting back, a crouched pose, an arrival route. */
export interface EchoSpawn {
  peek?: PeekSpawn;
  fire?: FireSpawn;
  crouched?: boolean;
  arrive?: ArriveSpawn;
}

/** The enemy sim's side (#15): create and remove targets. */
export interface TargetSpawner {
  /**
   * Create a target (humanoid: feet position; orb: centre); `scale` is ×real head size; `strafe`
   * is for a Strafer.
   * `echo` carries a Peeker's anchor, shooting back and a crouched pose (Sweep).
   * Returns its id, or -1 when it could not be created.
   */
  spawn(kind: EnemyKind, pos: Vec3, scale: number, strafe?: StrafeSpawn, echo?: EchoSpawn): number;
  despawn(id: number): void;
  /** Feet position of a live target into `out`; false when it is not alive. Absent: positions are unknown. */
  position?(id: number, out: Vec3): boolean;
  /**
   * The Echo and the player have a line of sight between them now (its shooting model is in
   * contact: an unoccluded line from its muzzle to the player's eye, in range). False for a target
   * that does not shoot, or is gone. Absent: never.
   */
  inSight?(id: number): boolean;
}

/** Read-only view of the player's health (the sim's `PlayerHealth` satisfies it). */
export interface VitalsView {
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  readonly maxShield: number;
  readonly alive: boolean;
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

/** What a mode may read about the player's movement. */
export interface MotionView extends PlayerView {
  /** Velocity, m/s. */
  readonly vel: Vec3;
  readonly crouching: boolean;
  readonly grounded: boolean;
}

export type TrialExtra = Readonly<Record<string, number>>;

/**
 * Where a `skillTrial` belongs: `matched` trials move the player's matched posterior (design §9);
 * `baseline` trials are the cold opener's benchmark (design §8.5) and are never fed to it, so the
 * benchmark stays an independent measurement.
 */
export type TrialSource = 'matched' | 'baseline';

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
  shotFired: {
    tick: number; shotId: number; moving: boolean; speed: number; airborne: boolean; crouching: boolean;
    /** Nearest visible live target to the crosshair (-1 none), the angle to its head and the head-minus-view angles, radians (the sim's stat fields). */
    aimTargetId?: number; aimErr?: number; aimDYaw?: number; aimDPitch?: number;
  };
  /** Horizontal speed first fell to the accuracy threshold; `counterStrafe`: the stop began with the opposite key, not a release. */
  /**
   * The player first saw a target (in view and unoccluded), once per spawn. The sim's payload also
   * carries the pre-aim error and the flick vector to its head (radians); optional here so a test
   * can announce a sighting without them.
   */
  targetVisible: { tick: number; targetId: number; preAim?: number; dYaw?: number; dPitch?: number };
  /** The padded aim ray entered (`on`) or left a visible target (design §3.2 time on target; `sim/runProbe.ts`). */
  aimOnTarget: { tick: number; on: boolean; id: number };
  /** An enemy first got the player in its sight, once per spawn. */
  enemySawPlayer: { tick: number; targetId: number };
  /** An enemy fired at the player. */
  enemyFired: { tick: number; id: number };
  /** The player took a hit: HP lost (`amount`), what the shield absorbed, what is left, and who fired (-1: nobody). */
  playerDamaged: { tick: number; amount: number; absorbed: number; hp: number; shield: number; sourceId: number };
}

/** Run-level facts about the player the runner listens to (not mode events: modes never see them). */
export interface PlayerSourceEvents {
  /** The player's HP reached 0: the run ends with reason `death` (design §14.3). */
  playerDied: { tick: number };
}

/** Events the framework emits. §14.3 names and payloads, plus `beatStarted` and `scoreAwarded`. */
export interface ModeEvents extends StreakEvents, MapEvents, SprayEvents, SectorEvents, Pick<RunEvents, 'contactSettled'> {
  /** The run moved the player (a sector entry, a gate's far side): the view should face `yaw` again. */
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
    /** Absent = `matched`. The mode's `trialSource` (benchmark trials are `baseline`). */
    source?: TrialSource;
    /** The scenario card of the contact the target fought in (Sweep, design §4.4); absent elsewhere. */
    card?: string;
  };
  /**
   * A kill was scored (`+score` floats from the kill), or points that are not a kill were paid (a
   * contact settle, a sector clear: `targetId` -1, the terms 1). `total` is always the run's score.
   */
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

/** `left`: the player walked out of a run's last exit alive (a Leave gate, design §4.9). */
export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit' | 'left';

declare module '../core/gameEvents' {
  interface GameEvents extends ModeEvents {}
}
