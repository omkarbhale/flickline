import type { EventSink } from '../core/eventBus';
import type { Rng } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import type { Economy } from '../config/economy';
import type { EnemyKind } from '../config/scoring';
import type {
  ArriveSpawn, AxisId, AxisValues, FireSpawn, ModeEvents, ModeId, ModeRef, MotionView, PeekSpawn, RunEndReason, SkillId, SourceEvents, StrafeSpawn, TrialExtra,
  TrialSource, VitalsView, WaveCurve, WeaponSourceEvents,
} from './contracts';
import type { SpawnScheduler } from './scheduler';

/**
 * What the app does to the player when the run is readied (design §4.1, §4.2). Declarative: the
 * mode never touches the sim; the host applies it.
 */
export interface PlayerSetup {
  /** Stand at the first anchor of this kind (a `beacon-shell`'s centre on the floor); default: the map's spawn point. */
  standAt?: string;
  /** Movement keys, jump and crouch are ignored for the run; look and fire still work. */
  lockMovement?: boolean;
  /** No reload (the design's "infinite magazine"). */
  infiniteMagazine?: boolean;
  /** Reloads always find a full magazine's worth of spare ammo (real magazines, no running out: Spray Wall). */
  infiniteReserve?: boolean;
  /** The run has a loadout: `1` / `2` swap primary and sidearm (default false; Sweep only, design §4). */
  allowSwap?: boolean;
  /**
   * The player's primary is the one picked on the `ready` screen (design §4.1: `1`..`3`, last pick by
   * default, sidearm always Pace) instead of `ModeDef.weapon`; movement is held and the Echoes do not
   * fire until the run goes live, so the screen can wait for the pick (Sweep).
   */
  pickPrimary?: boolean;
}

/**
 * The mode contract (design §4 intro): a mode is data plus a small scheduler. It never owns
 * rendering, input or audio; it places targets through the context, reacts to facts, and the
 * framework does the rest (run timing, beats and the dial, scoring, streaks, `skillTrial`).
 */
export interface ModeDef<S = unknown> extends ModeRef {
  /** Trained skills; `skills[0]` is the default skill of a trial. Sweep lists all seven. */
  readonly skills: readonly SkillId[];
  /** Map id (e.g. `range`). The framework does not load maps; the app does. */
  readonly map: string;
  /** Weapon id (e.g. `kestrel`). */
  readonly weapon: string;
  /** Player placement, movement lock and ammo rules for the run. */
  readonly player?: PlayerSetup;
  /**
   * Shields for the run (design §5.1, `config/economy.ts`): the player and every humanoid Echo get
   * the economy's shield tier. Modes where enemies shoot (Corner Clear, Vigil, Sweep) set
   * `tunables.economy.defaultEnemyFire`; drills leave it unset (no shields; nothing hits the player).
   * A scenario card's own `economy` overrides it.
   */
  readonly economy?: Economy;
  /** Length of the `ready` phase in seconds (default `tunables.modes.readySec`). */
  readonly readySec?: number;
  /** Live-phase length in seconds; `Infinity` = the mode ends the run itself (`ctx.end`). */
  readonly durationSec: number;
  /**
   * The mind skill (0-100) of the run's mind-driven Echoes (`docs/research/player-like-enemies.md` §5.4,
   * `sim/mind/profile.ts`). Default: the dial in force. A number pins it; a function maps the dial
   * (a mode that wants its Echoes a little sharper or softer than the player). Read it as
   * `ctx.mindSkill`, which applies this and the 0-100 range.
   */
  readonly mindSkill?: number | ((dial: number) => number);
  /** Difficulty axes (design §9.4 ids) this mode uses; they define each item's difficulty. */
  readonly axes: readonly AxisId[];
  /** Beat length in seconds (default `tunables.dial.beat.drillSec`); `null` = the mode calls `ctx.advanceBeat()`. */
  readonly beatSec?: number | null;
  /** Pre-planned dial offsets per beat (warm-up, peaks, breathers); default `tunables.dial.waves.drill`. */
  readonly waveCurve?: WaveCurve;
  /** Par time in seconds for the speed term of a kill (default `scoring.defaultParSec`). */
  parSec?(kind: EnemyKind, axes: AxisValues): number;
  /**
   * Which stream the run's `skillTrial` events belong to (default `matched`). `baseline` trials (the
   * cold opener's, design §8.5) are tagged so the matched posterior never consumes them.
   */
  readonly trialSource?: TrialSource;
  /**
   * Reference-like presentation (design §8.5, the cold opener): while this run is on it is a clean
   * run whatever the settings say, and the rewards the reference game lacks (clock, score and streak
   * counters, floating points, screen pulse, kill ladder and chain sounds) are off too. The shot, the
   * target's reaction and the hit and kill sounds stay.
   */
  readonly referenceLike?: boolean;
  /**
   * Whether a shot that misses breaks the clean streak (default: `scoring.missBreaksStreak`). A
   * mode where misses are expected and judged per trial (Spray Wall) turns it off, so its streak
   * counts trials won.
   */
  readonly missBreaksStreak?: boolean;

  /** Build the mode's state when the run is readied. Targets are not live yet. */
  setup(ctx: ModeContext<S>): S;
  /** Called once per sim tick while the run is live (after the framework's own bookkeeping). */
  tick(ctx: ModeContext<S>): void;
  /** Called for each fact the framework reads from the sim, after counters are updated. */
  onEvent(ctx: ModeContext<S>, ev: ModeEvent): void;
  /** Weapon facts (bullets fired, reloads); only modes that judge them implement it. */
  onWeapon?(ctx: ModeContext<S>, ev: WeaponEvent): void;
  /**
   * The run is ending (any reason, the player's death included), before `runEnded` is emitted: a
   * mode settles what is still open (Sweep's contacts). Phase is still `live` or `ready`.
   */
  onEnd?(ctx: ModeContext<S>, reason: RunEndReason): void;
}

/** The mind skill of a run on `mode` at `dial` (#88): the mode's override if it has one, else the dial; always within 0-100. */
export function mindSkillFor(mode: { readonly mindSkill?: number | ((dial: number) => number) }, dial: number): number {
  const m = mode.mindSkill;
  const v = m === undefined ? dial : typeof m === 'number' ? m : m(dial);
  return v >= 0 ? (v <= 100 ? v : 100) : 0;
}

/** One sim fact. The runner reuses these wrapper objects: copy what you keep. */
export type ModeEvent = { [K in keyof SourceEvents]: { type: K; payload: SourceEvents[K] } }[keyof SourceEvents];

/** One weapon fact, like `ModeEvent`: the runner reuses these wrapper objects, copy what you keep. */
export type WeaponEvent = { [K in keyof WeaponSourceEvents]: { type: K; payload: WeaponSourceEvents[K] } }[keyof WeaponSourceEvents];

export interface SpawnOptions {
  /** ×real head size (default 1). Floored at `dial.floors.minTargetScale`. */
  scale?: number;
  /** Seconds until the target leaves unkilled (a failed trial). Floored at `dial.floors.exposureSec`. */
  lifetimeSec?: number;
  /** Skill of the trial this target produces (default `mode.skills[0]`). */
  skill?: SkillId;
  /** Strafer only: its speed, leg, stand-still and lane (default: the sim's dial-50 numbers on a line square to the player). */
  strafe?: StrafeSpawn;
  /** Item difficulty override (default: the beat's, derived from the axis values in force). */
  difficulty?: number;
  /** The target takes any number of hits without dying (Spray Wall's Post). */
  durable?: boolean;
  /** Peeker only: its anchor and pattern. */
  peek?: PeekSpawn;
  /** The Echo shoots back with these numbers (the host's enemy-fire switch must be on too, see `ModeDef.economy`). */
  fire?: FireSpawn;
  /** Crouched humanoid pose. */
  crouched?: boolean;
  /** The Echo arrives: it spawns at the route's first point (the `pos` given is replaced) and walks it in (Sweep's hold sectors). */
  arrive?: ArriveSpawn;
  /** Scenario card of the contact the target belongs to: carried on its `skillTrial` (Sweep). */
  card?: string;
  /**
   * The target produces a trial of its own (default true: killed = success, expired = failure). A
   * mode that classifies its fights into trials itself (Sweep, `recordTrial`) turns it off.
   */
  trial?: boolean;
  /**
   * Placed out of the player's sight by the caller (Sweep's director checks it against the level):
   * the spawn fairness floors, which guard targets appearing in view, do not apply.
   */
  placed?: boolean;
}

/** What a mode tells the scoring table about a result that is not a kill (Spray Wall's spray). */
export interface AwardOptions {
  /** Enemy kind whose base points the result is worth (default `post`). */
  kind?: EnemyKind;
  /** Multiplies the whole score, 0-1 (a partial result pays less). */
  weight: number;
  /** Seconds the result took, for the speed term; omitted = no speed term. */
  durationSec?: number;
  headshot?: boolean;
  firstBullet?: boolean;
  /** Extends the clean streak (default true). */
  clean?: boolean;
}

export interface ResolveOptions {
  rtMs?: number;
  extra?: TrialExtra;
}

/** A trial that is not one target's fate (Sweep's classified contact trials, `recordTrial`). */
export interface TrialOptions {
  /** Item difficulty on the dial scale (design §9.1). */
  difficulty: number;
  /** Scenario card of its contact. */
  card?: string;
  rtMs?: number;
  extra?: TrialExtra;
}

export interface RunStats {
  score: number;
  kills: number;
  headshotKills: number;
  misses: number;
  trials: number;
  trialsWon: number;
}

export type RunPhase = 'idle' | 'ready' | 'live' | 'result';

/** What a mode may read and do. Everything else about the run belongs to the framework. */
export interface ModeContext<S = unknown> {
  readonly mode: ModeDef<S>;
  readonly seed: number;
  /** The run's seeded stream: use it for every random choice, never `Math.random`. */
  readonly rng: Rng;
  /** The scenario cards the run leans toward (design §4.4, #210); empty for no lean. Only Sweep reads it. */
  readonly lean: readonly string[];
  readonly tunables: Tunables;
  readonly player: MotionView;
  /** The player's health and shield (read-only). */
  readonly vitals: VitalsView;
  /**
   * Where a mode announces facts about its own state for presentation to draw (the Lane's armed
   * stripe, a stance ring). Payloads are read-only and valid only during the call.
   */
  readonly events: EventSink<ModeEvents>;
  /** Anchor picker bound to the run's rng and the player. */
  readonly scheduler: SpawnScheduler;
  state: S;

  readonly phase: RunPhase;
  /** The sim tick of the call in progress: the `tick` of the events a mode emits. */
  readonly simTick: number;
  /** Live ticks completed before this one (0 on the first live tick). */
  readonly liveTick: number;
  /** Seconds since the run went live. */
  readonly timeSec: number;
  readonly remainingSec: number;

  /** Beat index, dial and axis values in force. These change ONLY at beat boundaries. */
  readonly beat: number;
  readonly dial: number;
  /** The mind skill for Echoes that use the enemy mind: the dial unless `ModeDef.mindSkill` says otherwise (#88). */
  readonly mindSkill: number;
  readonly axes: AxisValues;
  /** Concrete axis values for any dial value (fairness floors applied); allocates, so call it per trial, not per tick. */
  axesAt(dial: number): AxisValues;
  /** Difficulty (dial scale) of an item spawned now, derived from the axis values in force. */
  readonly itemDifficulty: number;

  readonly stats: Readonly<RunStats>;
  readonly cleanStreak: number;
  readonly chain: number;

  /** Create a target at `pos` with fairness floors applied; returns its id or -1 if refused (too close, pool full). */
  spawn(kind: EnemyKind, pos: Vec3, opts?: SpawnOptions): number;
  /** Remove a target without resolving it. */
  despawn(id: number): void;
  /**
   * Decide the trial of a target yourself (default: killed = success, expired = failure). Emits
   * `skillTrial` once per target; a failure also breaks the clean streak. Returns false if the
   * target is unknown or already resolved.
   */
  resolveTrial(id: number, success: boolean, opts?: ResolveOptions): boolean;
  /**
   * Manual-beat modes (`beatSec: null`): start the next beat now. Without `dial` the dial module is
   * asked; with one, that dial is the beat's (a mode that schedules its own dial: Sweep's sectors and
   * its Opener staircase). A pinned run keeps its pin either way.
   */
  advanceBeat(dial?: number): void;
  /** Replace the current beat's dial (a mode that schedules its own dial, from `setup` on). Pinned runs keep the pin. */
  setDial(dial: number): void;
  /**
   * The matched dial the skill model aims this mode at now, before any wave or depth offset
   * (θ − s·logit(target), design §9.3.1). Reads the posterior: call it at beat boundaries only.
   */
  targetDial(): number;
  /** The run was started for a profile the skill model has never measured (design §9.2: its first Opener places it). */
  readonly newProfile: boolean;
  /** The run's dial is pinned ("Pin difficulty", design §9.3.6): the mode's own dial schedule is ignored. */
  readonly pinned: boolean;
  /**
   * Emit a `skillTrial` that is not a target's fate (Sweep's trials from contacts, design §3.1):
   * counted in the run's trials like any other; a failure breaks the clean streak.
   */
  recordTrial(skill: SkillId, success: boolean, opts: TrialOptions): void;
  /**
   * Score a result that is not a kill (the table of design §8.1 applied to a spray) and count it
   * in the streak. Emits `scoreAwarded` for target `id`; returns the points.
   */
  awardScore(id: number, opts: AwardOptions): number;
  /** Stand the player at a feet position facing `yaw` (radians), at rest, and tell the view to follow (`playerPlaced`). */
  placePlayer(x: number, y: number, z: number, yaw: number): void;
  /** Surge multiplier hook (the meter itself is the Sweep work). */
  setSurge(on: boolean): void;
  /**
   * Multiply every point earned from now on (kills, awards, `awardPoints`) by `mult`: Sweep's depth
   * multiplier (design §8.1). Default 1; reset to 1 at every run start.
   */
  setPointsMultiplier(mult: number): void;
  /**
   * Pay points that are not a kill (a contact settle, a sector clear; already multiplied by the
   * caller, the points multiplier is NOT applied again). Emits `scoreAwarded` with `targetId` -1.
   * Returns the points paid (rounded, never negative).
   */
  awardPoints(points: number): number;
  /**
   * Take `points` back off the run's score (Sweep's Overtime: points that were never banked, design §4.7, #206). Clamped so the score never goes
   * below 0; returns what was taken. It emits nothing: the caller reports it (`overtimeLost`), and the runner's score is final once the run ends.
   */
  forfeitPoints(points: number): number;
  /** Feet position of a live target into `out`; false when it is gone (or the host cannot tell). */
  targetPosition(id: number, out: Vec3): boolean;
  /** An Echo that shoots back and the player can see each other now (line of sight either way, in range). */
  targetInSight(id: number): boolean;
  /**
   * Load another shipped map now, mid-run (Sweep moving between sectors): collision, anchors and the
   * level visuals switch, the player and the run are untouched. No-op when it is already loaded.
   * Returns false for an unknown map.
   */
  loadMap(id: string): boolean;
  /** Fill the player's shield up to `to` (Sweep's Shield door); returns what was added (0 when it was already there). */
  refillShield(to: number): number;
  /** Put another primary weapon in the player's primary slot and in hand (Sweep's Arms door); false when it is not a primary. */
  setPrimary(weaponId: string): boolean;
  /**
   * Equip both sides as `economy` does (design §4.6, `config/economy.ts`) from now on: the Echoes spawned
   * after this carry its shield and weapon, the player wears its shield (never more than the shield he
   * carried in) and, with no shield tier at all, holsters the primary for the Pace. Calling it again
   * first undoes the last call: what the player carried in comes back minus what the sector took off
   * it, the primary comes back in hand. A no-op without a host.
   */
  setEconomy(economy: Economy): void;
  /** End the run (`death`, `complete`, `quit`, `left`; the timer ends it by itself). */
  end(reason: RunEndReason): void;
}

export type { ModeId };
