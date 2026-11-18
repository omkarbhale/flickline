import type { WeaponId } from '../config/weapon';
import { vec3, type Vec3 } from '../core/vec3';
import type { Expectation } from './enemyTiming';
import type { PeekPattern } from './mapTypes';

/**
 * The per-enemy state of the moving, shooting Echoes (Strafer, Peeker; design §5.2, §5.3): plain
 * data, preallocated in every target slot, so the FSMs in `strafer.ts` / `peeker.ts` and the shared
 * shooting model in `enemyFire.ts` allocate nothing in the tick. Spawn-time parameters (what the
 * dial decided for this enemy) are the `*Params` types; everything else is runtime state.
 */

/** The shooting model's phases (design §5.3). */
export const FIRE_IDLE = 0;
/** In contact, waiting for the reaction to run out and the movement to open the gate. */
export const FIRE_WAIT = 1;
/** The tell is running: head flare, line, tone. */
export const FIRE_TELL = 2;
/** Shots are leaving at the weapon's rate. */
export const FIRE_BURST = 3;
/** Resting between bursts. */
export const FIRE_COOL = 4;
export type FirePhase = typeof FIRE_IDLE | typeof FIRE_WAIT | typeof FIRE_TELL | typeof FIRE_BURST | typeof FIRE_COOL;

/** The dial's numbers for one Strafer (`DialAxes.strafeSpeed`, `strafeLegSec`, `standStillSec`). */
export interface StrafeParams {
  /** Cruise speed, m/s. */
  speed: number;
  /** Longest leg, seconds (the shortest is `enemies.strafer.legMinSec`). */
  legSec: number;
  /** Longest stand-still, seconds (the shortest is `enemies.strafer.standMinSec`). */
  standStillSec: number;
  /** The line it strafes along (feet height). Default: through the spawn point, square to the player. */
  laneA?: Vec3;
  laneB?: Vec3;
  /**
   * A route, not a strafe line (Sweep's meet sectors, design §4.2): the Echo starts at `laneA` and
   * runs or walks to `laneB` without stopping, keeps moving through its reaction once it sees the
   * player, then brakes (the spec's braking) and shoots from the stop. After its first stop it strafes
   * on the line like any Strafer. `speed` is its gait: a walk is silent, a run is heard.
   */
  travel?: boolean;
}

/** Where and how a Peeker peeks (a map's `peek` anchor, design §10.2). */
export interface PeekParams {
  pattern: PeekPattern;
  /** Feet position hidden behind the cover. */
  hold: Vec3;
  /** Feet position at the full step out. */
  out: Vec3;
  /** The dial's wide-peek exposure, seconds (default: `enemies.peek.wide.defaultSec` with its jitter). */
  wideSec?: number;
  /** Crouched while hidden (low cover); a hop stands up. */
  crouchedHold?: boolean;
}

/** Longest route an arriving Echo walks, in points (the director builds routes from the sector's nav graph). */
export const MAX_ROUTE = 8;

/**
 * An Echo that arrives (Sweep's hold sectors, design §4.2): it spawns at the first point of `route`
 * out of the sector, walks the route at `speed` and then fights as its kind does (`sim/arrival.ts`).
 * A walker at or under `audio.enemy.silentBelowMps` makes no sound; a runner's steps carry.
 */
export interface ArriveParams {
  /** Feet positions, the first being the spawn point. At least two, at most `MAX_ROUTE`. */
  route: readonly Vec3[];
  /** Speed along the route, m/s. */
  speed: number;
  /** Strafer: it stops walking and fights once it sees the player this close, metres. */
  engageM: number;
}

/** The dial's numbers for one enemy's shooting (`DialAxes.tellSec`, `enemyReactionSec`, `enemyHitChance`). */
export interface FireParams {
  /** Tell length at the dial, seconds (floored at `dial.floors.tellSec` when used). */
  tellSec: number;
  /** Reaction from first sight to the tell, seconds (the profile's mean; spread in `enemies.fire`). */
  reactionSec: number;
  /** Hit probability per shot at standstill, close range. */
  hitChance: number;
  /** What the enemy expected: a holder waiting at this spot is 'prepared', the default for a roamer is 'attending'. */
  expectation?: Expectation;
  /** Override the weapon (default: the world's enemy weapon). */
  weapon?: WeaponId;
}

export interface EnemyAi {
  // ---- strafer ---------------------------------------------------------------------------------
  /** Unit horizontal direction of the strafe line. */
  axis: Vec3;
  /** Feet position at lane distance 0. */
  laneOrigin: Vec3;
  laneLen: number;
  /** Distance along the lane, metres, and the signed speed along it, m/s (the body's, read back after each step). */
  s: number;
  vel: number;
  /** Direction of the current / next leg, +1 or -1. */
  dir: number;
  /** Speed the current leg cruises at, and the dial's longest leg / stand-still. */
  speed: number;
  legSec: number;
  standSec: number;
  /** On its route (`StrafeParams.travel`): still heading for the far end of the lane, before its first stop. */
  travel: boolean;

  // ---- peeker ----------------------------------------------------------------------------------
  pattern: PeekPattern;
  hold: Vec3;
  out: Vec3;
  /** Position between hold (0) and out (1), and where the current step is heading. */
  u: number;
  uTarget: number;
  /** Index of the current step of the pattern, and its hold in ticks. */
  step: number;
  stepHoldTicks: number;
  /** The dial's wide exposure (seconds, 0 = use the default) and the exposure drawn for this peek. */
  wideSec: number;
  wideDrawSec: number;
  crouchedHold: boolean;
  /** Tick the current exposure window ends (a second burst must fit before it). */
  windowEndTick: number;

  // ---- arrival (hold sectors) -----------------------------------------------------------------
  /** Walking its route in (the FSM's arrive state); false once it has handed over to its fight behaviour. */
  arriving: boolean;
  /**
   * An arrival: it never starts a contact before the player has had information about it (it came
   * into the player's view, or its running steps were audible), `docs/research/player-like-enemies.md` S9.
   */
  honest: boolean;
  routeN: number;
  routeI: number;
  routeX: Float64Array;
  routeY: Float64Array;
  routeZ: Float64Array;
  routeSpeed: number;
  engageM: number;
  /** Unit horizontal heading of the walk (the strafe lane after it is square to this). */
  headX: number;
  headZ: number;
  /** Tick its steps were first audible to the player (a run within `audio.enemy.maxAudibleM`, one stride), -1 = not yet; and the metres run towards the next stride. */
  audibleTick: number;
  audibleAccum: number;

  // ---- shooting (shared) -----------------------------------------------------------------------
  /** This enemy can shoot at all (spawn option); the world's flag must also be on. */
  fireOn: boolean;
  /** Self-timed (a peeker that decides to peek) rather than reacting to the player appearing. */
  initiator: boolean;
  expectation: Expectation;
  weapon: WeaponId;
  tellSec: number;
  reactionSec: number;
  hitChance: number;
  phase: FirePhase;
  /** Tick the player was first seen this contact. */
  contactTick: number;
  /** Earliest tick the tell may start. */
  readyTick: number;
  /** Tell length in ticks, and the tick it started / ends. */
  tellTicks: number;
  tellStartTick: number;
  tellEndTick: number;
  /** Shots still to fire in this burst, bursts still allowed this peek, tick of the next shot / end of rest. */
  burstLeft: number;
  burstsLeft: number;
  nextShotTick: number;
  coolEndTick: number;
  /** Tick of the last shot, -1 = none yet. */
  lastShotTick: number;
  /** The tell gate: the movement says a tell may start now. */
  gate: boolean;
}

export function createEnemyAi(): EnemyAi {
  return {
    axis: vec3(1, 0, 0), laneOrigin: vec3(), laneLen: 0, s: 0, vel: 0, dir: 1, speed: 0, legSec: 0, standSec: 0, travel: false,
    pattern: 'shoulder', hold: vec3(), out: vec3(), u: 0, uTarget: 0, step: 0, stepHoldTicks: 0, wideSec: 0, wideDrawSec: 0,
    crouchedHold: false, windowEndTick: 0,
    arriving: false, honest: false, routeN: 0, routeI: 0, routeX: new Float64Array(MAX_ROUTE), routeY: new Float64Array(MAX_ROUTE),
    routeZ: new Float64Array(MAX_ROUTE), routeSpeed: 0, engageM: 0, headX: 0, headZ: -1, audibleTick: -1, audibleAccum: 0,
    fireOn: false, initiator: false, expectation: 'attending', weapon: 'kestrel', tellSec: 0, reactionSec: 0, hitChance: 0,
    phase: FIRE_IDLE, contactTick: -1, readyTick: 0, tellTicks: 0, tellStartTick: -1, tellEndTick: -1, burstLeft: 0,
    burstsLeft: 0, nextShotTick: 0, coolEndTick: 0, lastShotTick: -1, gate: false,
  };
}

/** Back to a clean slate for a freshly spawned target (every field, so a reused slot carries nothing over). */
export function resetEnemyAi(a: EnemyAi): void {
  a.axis.x = 1; a.axis.y = 0; a.axis.z = 0;
  a.laneOrigin.x = a.laneOrigin.y = a.laneOrigin.z = 0;
  a.laneLen = 0; a.s = 0; a.vel = 0; a.dir = 1; a.speed = 0; a.legSec = 0; a.standSec = 0; a.travel = false;
  a.pattern = 'shoulder';
  a.hold.x = a.hold.y = a.hold.z = 0;
  a.out.x = a.out.y = a.out.z = 0;
  a.u = 0; a.uTarget = 0; a.step = 0; a.stepHoldTicks = 0; a.wideSec = 0; a.wideDrawSec = 0; a.crouchedHold = false;
  a.windowEndTick = 0;
  a.arriving = false; a.honest = false; a.routeN = 0; a.routeI = 0; a.routeSpeed = 0; a.engageM = 0; a.headX = 0; a.headZ = -1;
  a.audibleTick = -1; a.audibleAccum = 0;
  a.fireOn = false; a.initiator = false; a.expectation = 'attending'; a.weapon = 'kestrel';
  a.tellSec = 0; a.reactionSec = 0; a.hitChance = 0;
  a.phase = FIRE_IDLE; a.contactTick = -1; a.readyTick = 0; a.tellTicks = 0; a.tellStartTick = -1; a.tellEndTick = -1;
  a.burstLeft = 0; a.burstsLeft = 0; a.nextShotTick = 0; a.coolEndTick = 0; a.lastShotTick = -1; a.gate = false;
}
