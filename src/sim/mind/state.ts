import { vec3, type Vec3 } from '../../core/vec3';
import type { Expectation } from '../enemyTiming';
import type { Perceiver } from '../perception';
import { createMindProfile, type MindProfile } from './profile';
import { createLookState, type LookState } from './look';
import { MAX_PATH_NODES } from './nav';

/**
 * Per-enemy state of the mind's decision layer (issue #91): plain data, one per target slot,
 * preallocated, so the FSM in `decision.ts` allocates nothing in the tick. Spawn-time choices
 * (where to hold, what to watch, where else it may go) are `MindParams`.
 */

/** Most alternative spots a mind may reposition to. */
export const MAX_SPOTS = 6;
/** Waypoints of the current move: the nav path's nodes plus the goal. */
export const MAX_WAYPOINTS = MAX_PATH_NODES + 1;

/** How a re-peek comes back (§2.7, S8). */
export const REPEEK_SAME = 0;
export const REPEEK_OTHER_WAY = 1;
export const REPEEK_ELSEWHERE = 2;

/** The duel's rhythm (§2.3, §2.4): legs between stops, shots from the stop. */
export const DUEL_STOP = 0;
export const DUEL_FIRE = 1;
export const DUEL_LEG = 2;

/** What a director (or the debug hook) gives a mind-driven Echo at spawn. */
export interface MindParams {
  /** Mind skill 0-100 (design §9, research §5.4): the profile is interpolated at it and jittered by the Echo's personality. */
  skill: number;
  /** The expected appearance point it holds (feet; the corner edge or doorway the player comes through). Default: the player's position at spawn. */
  watch?: Vec3;
  /** A second angle it glances at while holding (attention switching, §2.2). Default: a seeded angle to one side. */
  watchAlt?: Vec3;
  /** Other spots it may reposition to (feet), at most `MAX_SPOTS`. Default: off-angle spots it finds beside its hold. */
  spots?: readonly Vec3[];
  /** It shoots (the world's `enemiesFire` must also be on). Default true. */
  fire?: boolean;
}

export interface MindStats {
  /** Shots fired, and those fired above the accuracy gate (S5); bursts started, and those on the move. */
  shots: number;
  movingShots: number;
  bursts: number;
  movingBursts: number;
  /** Strafe legs started, crouches on firing, re-peeks and the same-angle-same-way ones (S6, S8). */
  legs: number;
  crouches: number;
  repeeks: number;
  repeekSameWay: number;
  /** Watchdog sidesteps (being stuck is the most bot-like tell). */
  unsticks: number;
}

/** The decision rows of `config/mindDecision.ts` interpolated at this Echo's mind skill. */
export interface DecisionProfile {
  backOutAiming: number;
  repeekChance: number;
  strafeReverse: number;
  glanceIntervalMedianSec: number;
  repositionWalk: number;
}

export interface MindState {
  /** This slot holds a mind-driven Echo. */
  active: boolean;
  profile: MindProfile;
  dec: DecisionProfile;
  /** Its perception (#89): null when the pool was full (it then never sees nor hears, and only holds). */
  perceiver: Perceiver | null;
  /** Its perceiver's decision count when the FSM last looked: a change is a decision point (§5.2). */
  lastDecisions: number;
  /** This tick is a decision point. */
  decide: boolean;
  fire: boolean;

  // --- hold ---------------------------------------------------------------------------------
  /** The hold spot (feet) and the point it watches (feet; it aims at head height above it). */
  hold: Vec3;
  watch: Vec3;
  watchAlt: Vec3;
  /** The point the hold aims at this hold: the watch point, or past it where a wide swing ends. */
  holdAim: Vec3;
  /** It holds crouched (a low-cover hold anchor). */
  holdCrouched: boolean;
  /** Degrees below head height the hold aims (§5.4 vertical crosshair offset, drawn per hold). */
  holdLowDeg: number;
  /** Glancing at the second angle until this tick; the next glance starts at `nextGlanceTick`. */
  glanceUntilTick: number;
  nextGlanceTick: number;
  /** The glance's direction this time, radians. */
  glanceYaw: number;
  /** Spots it may go to (feet), `spotN` of them. */
  spotX: Float64Array;
  spotY: Float64Array;
  spotZ: Float64Array;
  spotN: number;
  /** The spot it holds now (-1: its own hold). */
  spotIndex: number;

  // --- look ---------------------------------------------------------------------------------
  look: LookState;
  /** Remaining aim error after this tick's look, radians. */
  aimErr: number;
  /** The yaw its current move heads along (`steer`), its horizontal speed at the start of the tick, its distance to the player in a duel. */
  headingYaw: number;
  speed: number;
  dist: number;

  // --- contact --------------------------------------------------------------------------------
  contact: Expectation;
  /** Reaction drawn for this contact, seconds; when it ends (aim and tell may start) and when it may fire. */
  reactSec: number;
  reactEndTick: number;
  fireReadyTick: number;
  /** The tell's ticks (`enemyTell`, render reads `ai.phase` too). */
  tellStartTick: number;
  tellEndTick: number;
  tellSent: boolean;
  /** Where it stood when the duel began: the angle a re-peek comes back to. */
  peekSpot: Vec3;
  /** The stance it duelled in. */
  peekCrouched: boolean;
  /** Its last sight of the player (feet, the perceiver's memory at the time) and when, ticks. */
  lastSeenTick: number;
  /** The last hit it took (TargetState.lastHitTick when the FSM last looked); a newer one is damage taken. */
  lastHitSeen: number;
  hitPending: boolean;
  /** The memory stamp it last went on alert for (a newer sound or callout alerts it again). */
  alertStampSec: number;
  /** A teammate went down where it could see or hear it (§5.2 alert): there (feet), at this sim time (-1: never). */
  alarm: Vec3;
  alarmSec: number;
  /** Where it believes the threat is (feet): the memory when it disengaged, what a re-peek pre-aims. */
  threat: Vec3;
  /** The state it is in (`MIND_STATE_NAMES` index), for `enemyStateChanged.from`. */
  stateId: number;

  // --- duel -----------------------------------------------------------------------------------
  duelPhase: number;
  /** The current leg ends at this tick; its direction (+1 right, -1 left, along `legAxis`). */
  legEndTick: number;
  legDir: number;
  legAxisX: number;
  legAxisZ: number;
  /** Seconds of the previous leg (never two legs within 10 ms, S6). */
  lastLegSec: number;
  /** This leg fires on the move (the moving-shot habit), and when it started waiting for speed; its moving burst went out. */
  movingBurst: boolean;
  movingWaitTick: number;
  legFired: boolean;
  /** The tick the current stop began. */
  stopSinceTick: number;
  /** It found no cover: no retreat on damage before this tick. */
  retreatBlockedUntil: number;
  /** Its gun's shot count at the start of the tick, and the gun's accuracy gate (m/s): shot counting (S5). */
  shotsAtPre: number;
  gate: number;
  /** The tick the stop opened the accuracy gate (-1 while above it), and the shot-after-gate delay drawn for it. */
  gateTick: number;
  shotDelayTicks: number;
  /** Shots in the current burst and the gun's shot count when it began. */
  burstN: number;
  burstShots0: number;
  /** Crouches this duel, and the current burst is crouched. */
  crouchCount: number;
  crouchBurst: boolean;

  // --- disengage, re-peek -----------------------------------------------------------------------
  /** Backing out of the angle still aiming at it (else it turns away). */
  backAiming: boolean;
  /** It needs a reload behind cover; it chose to reload in the open. */
  wantReload: boolean;
  reloadInOpen: boolean;
  /** Cover it is heading to (feet), and it has found one. */
  cover: Vec3;
  hasCover: boolean;
  repeekWay: number;
  /** The last re-peek delay, seconds (never within 10% twice in a row, §5.7), -1 before the first. */
  lastRepeekSec: number;
  repeekEndTick: number;

  // --- moving -----------------------------------------------------------------------------------
  /** Waypoints (feet), `wpN` of them, heading for `wpI`; the last is the goal. */
  wpX: Float64Array;
  wpY: Float64Array;
  wpZ: Float64Array;
  wpN: number;
  wpI: number;
  /** A move is in progress, it arrived, or it gave up (stuck past the watchdog's attempts). */
  moving: boolean;
  arrived: boolean;
  moveFailed: boolean;
  /** Walk (silent) rather than run on this move. */
  walkMove: boolean;
  /** Nav path scratch. */
  pathBuf: Int32Array;
  /** Watchdog: ticks stuck, sidestep ticks left and direction, sidesteps on this move. */
  stuckTicks: number;
  sidestepLeft: number;
  sidestepX: number;
  sidestepZ: number;
  attempts: number;
  /** Ticks since the shortcut test last ran. */
  shortcutClock: number;

  /** For tests, the harness (#93) and the death recap (F8). */
  stats: MindStats;
}

export function createMindState(): MindState {
  return {
    active: false, profile: createMindProfile(),
    dec: { backOutAiming: 0, repeekChance: 0, strafeReverse: 0, glanceIntervalMedianSec: 0, repositionWalk: 0 }, perceiver: null, lastDecisions: -1, decide: false, fire: true,
    hold: vec3(), holdCrouched: false, watch: vec3(), watchAlt: vec3(), holdAim: vec3(), holdLowDeg: 0, glanceUntilTick: -1, nextGlanceTick: 0,
    glanceYaw: 0, spotX: new Float64Array(MAX_SPOTS), spotY: new Float64Array(MAX_SPOTS), spotZ: new Float64Array(MAX_SPOTS),
    spotN: 0, spotIndex: -1,
    look: createLookState(), aimErr: 0, headingYaw: 0, speed: 0, dist: 0,
    contact: 'unaware', reactSec: 0, reactEndTick: 0, fireReadyTick: 0, tellStartTick: -1, tellEndTick: -1, tellSent: false,
    peekSpot: vec3(), peekCrouched: false, lastSeenTick: -1, lastHitSeen: -1, hitPending: false, alertStampSec: -1,
    alarm: vec3(), alarmSec: -1, threat: vec3(), stateId: -1,
    duelPhase: DUEL_STOP, legEndTick: 0, legDir: 1, legAxisX: 1, legAxisZ: 0, lastLegSec: -1, movingBurst: false,
    movingWaitTick: -1, legFired: false, stopSinceTick: 0, retreatBlockedUntil: 0, shotsAtPre: 0, gate: 0, gateTick: -1, shotDelayTicks: 0, burstN: 0, burstShots0: 0, crouchCount: 0, crouchBurst: false,
    backAiming: false, wantReload: false, reloadInOpen: false, cover: vec3(), hasCover: false, repeekWay: REPEEK_SAME,
    lastRepeekSec: -1, repeekEndTick: 0,
    wpX: new Float64Array(MAX_WAYPOINTS), wpY: new Float64Array(MAX_WAYPOINTS), wpZ: new Float64Array(MAX_WAYPOINTS),
    wpN: 0, wpI: 0, moving: false, arrived: false, moveFailed: false, walkMove: false, pathBuf: new Int32Array(MAX_PATH_NODES),
    stuckTicks: 0, sidestepLeft: 0, sidestepX: 0, sidestepZ: 0, attempts: 0, shortcutClock: 0,
    stats: { shots: 0, movingShots: 0, bursts: 0, movingBursts: 0, legs: 0, crouches: 0, repeeks: 0, repeekSameWay: 0, unsticks: 0 },
  };
}
