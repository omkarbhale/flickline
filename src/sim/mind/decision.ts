import { lognormal, lognormalTruncated } from '../../core/dist';
import { DEG2RAD } from '../../core/math';
import type { Rng } from '../../core/rng';
import { secondsToTicks, TICK_DT } from '../../core/time';
import type { Vec3 } from '../../core/vec3';
import type { AnchorSkills, Anchored } from '../../config/mind';
import type { MindDecisionTunables } from '../../config/mindDecision';
import { wrapPi, yawOf } from '../aim';
import { walkReach } from '../arrival';
import { FIRE_IDLE, FIRE_TELL } from '../enemyAi';
import { commandMoveToward } from '../enemyBody';
import { createShotTiming, enemyShotTiming, type Peeker, type ReactionDist } from '../enemyTiming';
import { lineClear } from '../exposure';
import { STAY, type Behaviour, type BehaviourContext, type BehaviourState } from '../fsm';
import { brakeDistance } from '../movement';
import { clampMindSkill, profileFor } from './profile';
import type { RunEvents } from '../runEvents';
import type { Expectation } from '../enemyTiming';
import type { TargetState } from '../types';
import { driftStep, lookStep, resetLookState } from './look';
import { straightWalk } from './nav';
import {
  DUEL_FIRE, DUEL_LEG, DUEL_STOP, MAX_SPOTS, MAX_WAYPOINTS, REPEEK_ELSEWHERE, REPEEK_OTHER_WAY, REPEEK_SAME,
  type DecisionProfile, type MindParams, type MindState,
} from './state';
import type { MindSystem } from './system';

/**
 * The enemy mind's decision layer (issue #91; `docs/research/player-like-enemies.md` §5.2): what a
 * player-like Echo does, as a finite-state machine on #15's base, played through the shared body
 * (#87) so every key and view it sends runs through the player's own movement and weapon code.
 *
 *   hold ──hears──▶ alert ──sees──▶ react ──reaction──▶ duel ──hit / reload / lost──▶ disengage
 *    ▲  ◀──forgets──┘  ▲                                 │                               │
 *    │                 └──────────lost sight─────────────┘          behind cover: repeek or reposition
 *    └──────────── reposition (nav) ◀──────────────────────────────────────────────────┘
 *                                    repeek ──delay──▶ peek ──sees──▶ react
 *
 * - **Decision points** (§5.2): perception-driven transitions happen only when the Echo's perceiver
 *   decides (#89: lognormal intervals, median 0.12 s, jittered per enemy), so a group never acts on
 *   one tick. Timers the mind drew itself (reaction, strafe legs, re-peek delay, shot-after-gate)
 *   run out on their own tick, so their distributions are not quantised.
 * - **F1**: everything it knows of the player is its perceiver's (sight, memory, hearing,
 *   callouts) or a teammate's death it saw or heard. While the player is in sight it aims at him;
 *   otherwise at where it believes he is.
 * - **Aim** is a stand-in (`look.ts`): a capped, braking second-order turn towards the point the
 *   decision chooses. #90's human aim model replaces it and keeps the decision's inputs.
 * - **Not robotic** (§5.7): every duration is a draw, the view drifts and glances, re-peek delays are
 *   never within 10% twice running, legs never within 10 ms twice running, moves use look-ahead
 *   steering and a watchdog that never leaves it pushing a wall.
 *
 * Deterministic per seed: every draw comes from the Echo's own streams (#86): decisions from
 * `decisions` (shared with its perceiver), reactions from `reaction`, view drift from `aim`.
 * Allocation-free in the tick.
 */

export const MIND_HOLD = 0;
export const MIND_ALERT = 1;
export const MIND_REACT = 2;
export const MIND_DUEL = 3;
export const MIND_DISENGAGE = 4;
export const MIND_REPOSITION = 5;
export const MIND_REPEEK = 6;
export const MIND_PEEK = 7;

export const MIND_STATE_NAMES = ['hold', 'alert', 'react', 'duel', 'disengage', 'reposition', 'repeek', 'peek'] as const;
export type MindStateName = (typeof MIND_STATE_NAMES)[number];

export interface MindEvents {
  /** A mind-driven Echo changed decision state (§5.8; stats, the death recap and the harness). `from` is null on spawn. */
  enemyStateChanged: { tick: number; t: number; id: number; state: MindStateName; from: MindStateName | null };
  /**
   * A mind-driven Echo's reaction ran out and its aim phase began (§5.8): `reactMs` is the drawn
   * reaction (from the moment it perceived the player), `contact` how prepared it was and
   * `expected` whether that was `prepared` (#127).
   */
  enemyReacted: { tick: number; t: number; id: number; reactMs: number; contact: Expectation; expected: boolean };
}

declare module '../types' {
  interface SimEvents extends MindEvents, Pick<RunEvents, 'enemyTell'> {}
}

// Reused payloads (valid only during the callback).
const stateEv: MindEvents['enemyStateChanged'] = { tick: 0, t: 0, id: 0, state: 'hold', from: null };
const reactEv: MindEvents['enemyReacted'] = { tick: 0, t: 0, id: 0, reactMs: 0, contact: 'unaware', expected: false };
const tellEv: RunEvents['enemyTell'] = { tick: 0, id: 0, durationMs: 0 };
const timing = createShotTiming();
/** Sample step of the walk tests (`walkReach`), metres: the director's. */
const WALK_STEP_M = 0.25;
const reaction: ReactionDist = { muSec: 0, sigmaSec: 0, tauSec: 0 };

// ---------------------------------------------------------------------------------------------
// Profile helpers.
// ---------------------------------------------------------------------------------------------

/** A row anchored at `skills` (the profile's anchor columns), linear between them. */
export function anchoredAt(row: Anchored, skills: AnchorSkills, m: number): number {
  const s = clampMindSkill(m);
  let seg = 0;
  while (seg < skills.length - 2 && s > skills[seg + 1]!) seg++;
  const lo = skills[seg]!;
  const u = (s - lo) / (skills[seg + 1]! - lo);
  return row[seg]! * (1 - u) + row[seg + 1]! * u;
}

/** The decision rows at mind skill `m`. */
export function decisionProfile(m: number, cfg: MindDecisionTunables, skills: AnchorSkills, out: DecisionProfile): DecisionProfile {
  const a = cfg.anchors;
  out.backOutAiming = anchoredAt(a.backOutAiming, skills, m);
  out.repeekChance = anchoredAt(a.repeekChance, skills, m);
  out.strafeReverse = anchoredAt(a.strafeReverse, skills, m);
  out.glanceIntervalMedianSec = anchoredAt(a.glanceIntervalMedianSec, skills, m);
  out.repositionWalk = anchoredAt(a.repositionWalk, skills, m);
  return out;
}

/**
 * The next strafe leg, seconds (§2.4, S6): the profile's lognormal truncated to the config's range,
 * and never within 10 ms of the previous leg (a second draw, then a nudge), so no two legs repeat.
 */
export function drawLeg(rng: Rng, median: number, cv: number, lastSec: number, cfg: MindDecisionTunables['duel']): number {
  let v = lognormalTruncated(rng, median, cv, cfg.legMinSec, cfg.legMaxSec);
  if (lastSec >= 0 && Math.abs(v - lastSec) < 0.01) {
    v = lognormalTruncated(rng, median, cv, cfg.legMinSec, cfg.legMaxSec);
    if (Math.abs(v - lastSec) < 0.01) v = lastSec + (v >= lastSec ? 0.012 : -0.012);
  }
  return v;
}

/**
 * The re-peek delay, seconds (§2.7): an instant re-peek (uniform in the instant range) with the
 * profile's share, otherwise lognormal around the profile's median; never within `minDifference`
 * (10%) of `lastSec` (§5.7): up to eight redraws, then moved just outside the band.
 */
export function drawRepeekDelay(
  rng: Rng, medianSec: number, instantShare: number, lastSec: number, minDifference: number, cfg: MindDecisionTunables['repeek'],
): number {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    v = rng.next() < instantShare
      ? rng.range(cfg.instantMinSec, cfg.instantMaxSec)
      : lognormalTruncated(rng, medianSec, cfg.delayCv, cfg.delayMinSec, cfg.delayMaxSec);
    if (lastSec < 0 || Math.abs(v - lastSec) >= minDifference * lastSec) return v;
  }
  return v >= lastSec ? lastSec * (1 + minDifference) + 1e-3 : lastSec * (1 - minDifference) - 1e-3;
}

/** How the re-peek comes back (S8): the same angle the same way with the profile's share, else another way or from elsewhere. */
export function chooseRepeekWay(rng: Rng, sameShare: number, otherWayShare: number): number {
  const u = rng.next();
  const v = rng.next();
  if (u < sameShare) return REPEEK_SAME;
  return v < otherWayShare ? REPEEK_OTHER_WAY : REPEEK_ELSEWHERE;
}

// ---------------------------------------------------------------------------------------------
// Spawn.
// ---------------------------------------------------------------------------------------------

function minds(ctx: BehaviourContext): MindSystem {
  return ctx.world.minds!;
}

/** Set a freshly spawned mind-driven Echo up (its body is already reset; before its FSM starts). */
export function mindInit(t: TargetState, ctx: BehaviourContext, slot: number, params: MindParams | undefined): void {
  const m = t.mind;
  const tun = ctx.tunables;
  const sys = minds(ctx);
  m.active = true;
  profileFor(params?.skill ?? 50, t.streams.personality, m.profile, tun);
  decisionProfile(m.profile.mindSkill, tun.mindDecision, tun.mind.anchorSkills, m.dec);
  m.perceiver = sys.perception.add(t.id, t.streams.decisions, m.profile);
  sys.register(slot, t.id);
  m.lastDecisions = -1;
  m.decide = false;
  m.fire = params?.fire ?? true;
  const pl = ctx.world.player;
  set(m.hold, t.pos.x, t.pos.y, t.pos.z);
  m.holdCrouched = t.crouched;
  const w = params?.watch ?? pl.pos;
  set(m.watch, w.x, w.y, w.z);
  set(m.holdAim, w.x, w.y, w.z);
  if (params?.watchAlt) set(m.watchAlt, params.watchAlt.x, params.watchAlt.y, params.watchAlt.z);
  else m.watchAlt.y = Number.NaN; // none: a seeded angle to one side
  m.spotN = 0;
  m.spotIndex = -1;
  const spots = params?.spots;
  if (spots) for (let i = 0; i < spots.length && m.spotN < MAX_SPOTS; i++) addSpot(m, spots[i]!.x, spots[i]!.y, spots[i]!.z);
  resetLookState(m.look);
  m.aimErr = 0;
  m.contact = 'unaware';
  m.reactSec = 0; m.reactEndTick = 0; m.fireReadyTick = 0; m.tellStartTick = -1; m.tellEndTick = -1; m.tellSent = false;
  set(m.peekSpot, t.pos.x, t.pos.y, t.pos.z);
  m.peekCrouched = t.crouched;
  m.lastSeenTick = -1;
  m.gate = gateSpeed(t, ctx);
  m.lastHitSeen = t.lastHitTick;
  m.hitPending = false;
  m.alertStampSec = -1;
  m.alarmSec = -1;
  set(m.threat, w.x, w.y, w.z);
  // A holder spawns facing what it holds (the body was turned towards the player).
  const fx = w.x - t.pos.x, fz = w.z - t.pos.z;
  if (fx * fx + fz * fz > 1e-6) t.body.kin.yaw = t.body.cmd.yaw = Math.atan2(-fx, -fz);
  m.stateId = -1;
  m.duelPhase = DUEL_STOP; m.legEndTick = 0; m.legDir = 1; m.lastLegSec = -1; m.movingBurst = false; m.movingWaitTick = -1;
  m.gateTick = -1; m.shotDelayTicks = 0; m.burstN = 0; m.burstShots0 = 0; m.crouchCount = 0; m.crouchBurst = false;
  m.legFired = false; m.stopSinceTick = 0; m.retreatBlockedUntil = 0; m.shotsAtPre = 0;
  m.backAiming = false; m.wantReload = false; m.reloadInOpen = false; m.hasCover = false;
  m.repeekWay = REPEEK_SAME; m.lastRepeekSec = -1; m.repeekEndTick = 0;
  m.wpN = 0; m.wpI = 0; m.moving = false; m.arrived = false; m.moveFailed = false; m.walkMove = false;
  m.stuckTicks = 0; m.sidestepLeft = 0; m.attempts = 0; m.shortcutClock = 0;
  const s = m.stats;
  s.shots = s.movingShots = s.bursts = s.movingBursts = s.legs = s.crouches = s.repeeks = s.repeekSameWay = s.unsticks = 0;
  t.ai.fireOn = m.fire;
  syncPerceiver(t);
}

function set(v: Vec3, x: number, y: number, z: number): void {
  v.x = x; v.y = y; v.z = z;
}

function addSpot(m: MindState, x: number, y: number, z: number): void {
  const i = m.spotN++;
  m.spotX[i] = x; m.spotY[i] = y; m.spotZ[i] = z;
}

/** Keep the perceiver's eye and view on the body (after every body step, and at spawn). */
function syncPerceiver(t: TargetState): void {
  const p = t.mind.perceiver;
  if (p === null) return;
  const k = t.body.kin;
  p.eye.x = k.pos.x; p.eye.y = k.pos.y + k.eyeHeight; p.eye.z = k.pos.z;
  p.yaw = k.yaw;
  p.alive = t.alive;
}

// ---------------------------------------------------------------------------------------------
// Per-tick helpers.
// ---------------------------------------------------------------------------------------------

function emitState(t: TargetState, ctx: BehaviourContext, state: number): void {
  const m = t.mind;
  const e = stateEv;
  e.tick = ctx.tick;
  e.t = ctx.tick * TICK_DT;
  e.id = t.id;
  e.state = MIND_STATE_NAMES[state]!;
  e.from = m.stateId >= 0 ? MIND_STATE_NAMES[m.stateId]! : null;
  m.stateId = state;
  ctx.events.emit('enemyStateChanged', e);
}

/** Start of every state's tick: is this a decision point, and was it hit since the last look. */
function pre(t: TargetState): void {
  const m = t.mind;
  const p = m.perceiver;
  const d = p === null ? 0 : p.decisions;
  m.decide = d !== m.lastDecisions;
  m.lastDecisions = d;
  if (t.lastHitTick !== m.lastHitSeen) {
    m.lastHitSeen = t.lastHitTick;
    m.hitPending = true;
  }
  t.body.cmd.fire = false;
  m.shotsAtPre = t.body.weapon.shots;
  measureSpeed(t);
}

function sees(t: TargetState): boolean {
  const p = t.mind.perceiver;
  return p !== null && p.sees;
}

/** It has a memory of the player newer than the last one it went on alert for, or a fresh teammate alarm. */
function alertWorthy(t: TargetState): boolean {
  const m = t.mind;
  const p = m.perceiver;
  if (p !== null && p.memory.valid && p.memory.source !== 'prior' && p.memory.stampSec > m.alertStampSec) return true;
  return m.alarmSec > m.alertStampSec;
}

// The look helpers below take and return no numbers: V8 boxes a double passed to or returned from a
// function it does not inline (architecture §7), and they run every tick for every Echo. The target
// angles travel in `m.look`, the distance and speed in `m.dist` / `m.speed`, the heading in `m.headingYaw`.

/** Turn this tick towards `m.look.targetYaw` / `targetPitch` with drift `m.look.sdDeg` (the stand-in for #90's aim). */
function lookNow(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  driftStep(m.look, t.streams.aim, ctx.tunables.mindDecision.hold);
  lookStep(t.body.cmd, m.look, ctx.tunables.mindDecision.look, m.profile);
  m.aimErr = m.look.err;
}

/**
 * Turn towards head height above `feet` (a standing player's head centre). `holding`: the hold's
 * wider drift and its vertical offset below head height (§5.4); else the settle drift, no offset.
 */
function lookAtHead(t: TargetState, ctx: BehaviourContext, feet: Vec3, holding: boolean): void {
  const m = t.mind;
  const k = t.body.kin;
  const dx = feet.x - k.pos.x, dz = feet.z - k.pos.z;
  const dy = feet.y + ctx.tunables.targets.hit.headCentreStand - (k.pos.y + k.eyeHeight);
  const h = Math.sqrt(dx * dx + dz * dz);
  const l = m.look;
  if (h > 1e-6) l.targetYaw = Math.atan2(-dx, -dz);
  l.targetPitch = Math.atan2(dy, h) - (holding ? m.holdLowDeg * DEG2RAD : 0);
  l.sdDeg = holding ? m.profile.settleNoiseDeg * ctx.tunables.mindDecision.hold.driftScale : m.profile.settleNoiseDeg;
  lookNow(t, ctx);
}

/** Look level along `m.headingYaw`: an Echo with nothing to watch looks where it goes. */
function lookAlong(t: TargetState, ctx: BehaviourContext): void {
  const l = t.mind.look;
  l.targetYaw = t.mind.headingYaw;
  l.targetPitch = 0;
  l.sdDeg = t.mind.profile.settleNoiseDeg;
  lookNow(t, ctx);
}

/** The point it believes the player is at (feet): memory, else a teammate's alarm, else what it watches. */
function believed(t: TargetState): Vec3 {
  const m = t.mind;
  const p = m.perceiver;
  if (p !== null && p.memory.valid) return p.memory.pos;
  if (m.alarmSec >= 0) return m.alarm;
  return m.watch;
}

function stopKeys(t: TargetState): void {
  const c = t.body.cmd;
  c.moveX = c.moveZ = 0;
  c.walk = false;
}

/** Horizontal speed into `m.speed` (no double returned from a call). */
function measureSpeed(t: TargetState): void {
  const v = t.body.kin.vel;
  t.mind.speed = Math.sqrt(v.x * v.x + v.z * v.z);
}

/** The accuracy gate of its gun: speed above which its shots carry movement error (spec §2.4). */
function gateSpeed(t: TargetState, ctx: BehaviourContext): number {
  const def = ctx.tunables.weapon[t.body.weapon.slots[0]!.id];
  return def.deadzoneFraction * def.runSpeedMps;
}

function magFraction(t: TargetState, ctx: BehaviourContext): number {
  const w = t.body.weapon;
  const s = w.slots[0]!;
  return s.mag / ctx.tunables.weapon[s.id].magazine;
}

// ---------------------------------------------------------------------------------------------
// Moving: nav path, look-ahead steering, anti-stuck watchdog.
// ---------------------------------------------------------------------------------------------

/** Plan a move to (`gx`, `gy`, `gz`): straight when it can walk there, else through the nav graph. */
export function planTo(t: TargetState, ctx: BehaviourContext, gx: number, gy: number, gz: number, walk: boolean): void {
  const m = t.mind;
  const sys = minds(ctx);
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  m.wpN = 0;
  m.wpI = 0;
  if (!straightWalk(boxes, hull, t.pos.x, t.pos.y, t.pos.z, gx, gz)) {
    const nav = sys.nav;
    const a = nav.nearest(t.pos.x, t.pos.y, t.pos.z, boxes, hull);
    const b = nav.nearest(gx, gy, gz, boxes, hull);
    const n = a >= 0 && b >= 0 ? nav.path(a, b, m.pathBuf) : 0;
    for (let i = 0; i < n && m.wpN < MAX_WAYPOINTS - 1; i++) {
      const j = m.pathBuf[i]!;
      m.wpX[m.wpN] = nav.x[j]!; m.wpY[m.wpN] = nav.y[j]!; m.wpZ[m.wpN] = nav.z[j]!;
      m.wpN++;
    }
  }
  m.wpX[m.wpN] = gx; m.wpY[m.wpN] = gy; m.wpZ[m.wpN] = gz;
  m.wpN++;
  m.moving = true;
  m.arrived = false;
  m.moveFailed = false;
  m.walkMove = walk;
  m.stuckTicks = 0;
  m.sidestepLeft = 0;
  m.attempts = 0;
  m.shortcutClock = 0;
}

function endMove(t: TargetState, arrived: boolean): void {
  const m = t.mind;
  m.moving = false;
  m.arrived = arrived;
  m.moveFailed = !arrived;
  m.sidestepLeft = 0;
  stopKeys(t);
}

/** Replan from where it stands to the move's goal (after a sidestep). Keeps the attempt count. */
function replan(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const g = m.wpN - 1;
  const attempts = m.attempts;
  planTo(t, ctx, m.wpX[g]!, m.wpY[g]!, m.wpZ[g]!, m.walkMove);
  m.attempts = attempts;
}

/**
 * One tick of the current move: skip reached (or now directly walkable) waypoints, steer at a
 * carrot `lookAheadM` ahead (blending into the next leg before a corner rather than touching each
 * node), let go of the keys inside the braking distance of the goal, and watch for being stuck:
 * pushing with no speed for `stuckAfterSec` sidesteps (to the side with more room) and replans,
 * and after `maxAttempts` the move is given up. Writes the movement keys and `walk`, and the yaw it
 * is heading along into `m.headingYaw` (for an Echo that looks where it goes).
 */
function steer(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const c = t.body.cmd;
  const k = t.body.kin;
  if (!m.moving) { m.headingYaw = c.yaw; return; }
  const cfg = ctx.tunables.mindDecision;
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  const wd = cfg.watchdog;

  if (m.sidestepLeft > 0) {
    m.sidestepLeft--;
    commandMoveToward(t.body, m.sidestepX, m.sidestepZ);
    c.walk = false;
    if (m.sidestepLeft === 0) replan(t, ctx);
    m.headingYaw = Math.atan2(-m.sidestepX, -m.sidestepZ);
    return;
  }

  const last = m.wpN - 1;
  // Waypoints reached, or skippable because the next one is in a straight walk.
  while (m.wpI < last) {
    const dx = m.wpX[m.wpI]! - t.pos.x, dz = m.wpZ[m.wpI]! - t.pos.z;
    if (dx * dx + dz * dz > cfg.nav.waypointM * cfg.nav.waypointM) break;
    m.wpI++;
  }
  if (++m.shortcutClock >= cfg.nav.shortcutEveryTicks) {
    m.shortcutClock = 0;
    if (m.wpI < last && straightWalk(boxes, hull, t.pos.x, t.pos.y, t.pos.z, m.wpX[m.wpI + 1]!, m.wpZ[m.wpI + 1]!)) m.wpI++;
  }

  const tx = m.wpX[m.wpI]!, tz = m.wpZ[m.wpI]!;
  let dx = tx - t.pos.x, dz = tz - t.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const speed = t.mind.speed;
  if (m.wpI === last) {
    if (d <= cfg.nav.arriveM || (d <= cfg.nav.arriveM * 2 && speed < wd.stuckSpeedMps && c.moveX === 0 && c.moveZ === 0)) {
      endMove(t, true);
      m.headingYaw = c.yaw;
      return;
    }
    // Let go inside the braking distance: it coasts to a stop on the spot (spec §2.3).
    if (d <= brakeDistance(speed, t.body.gait.runSpeedMps, ctx.tunables.movement) + 0.05) {
      stopKeys(t);
      m.stuckTicks = 0;
      m.headingYaw = Math.atan2(-dx, -dz);
      return;
    }
  }
  if (d > 1e-6) { dx /= d; dz /= d; }
  // Look-ahead: within `lookAheadM` of a corner waypoint, blend towards the leg after it.
  const la = cfg.nav.lookAheadM;
  if (m.wpI < last && d < la) {
    let nx = m.wpX[m.wpI + 1]! - tx, nz = m.wpZ[m.wpI + 1]! - tz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (nl > 1e-6) {
      nx /= nl; nz /= nl;
      const w = (la - d) / la;
      dx = dx * (1 - w) + nx * w;
      dz = dz * (1 - w) + nz * w;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) { dx /= l; dz /= l; }
    }
  }
  commandMoveToward(t.body, dx, dz);
  c.walk = m.walkMove;

  // Watchdog: pushing a key with no speed.
  if (speed < wd.stuckSpeedMps && k.grounded) m.stuckTicks++;
  else m.stuckTicks = 0;
  if (m.stuckTicks >= secondsToTicks(wd.stuckAfterSec)) {
    m.stuckTicks = 0;
    m.attempts++;
    m.stats.unsticks++;
    if (m.attempts > wd.maxAttempts) {
      endMove(t, false);
      m.headingYaw = c.yaw;
      return;
    }
    // Sidestep square to the way it wanted to go, to the side with more room.
    const lx = -dz, lz = dx;
    const left = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, lx, lz, wd.probeM, WALK_STEP_M);
    const right = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, -lx, -lz, wd.probeM, WALK_STEP_M);
    const s = left >= right ? 1 : -1;
    // Away from the wall it pushed as well as sideways.
    m.sidestepX = lx * s - dx * 0.5;
    m.sidestepZ = lz * s - dz * 0.5;
    const l = Math.sqrt(m.sidestepX * m.sidestepX + m.sidestepZ * m.sidestepZ);
    m.sidestepX /= l; m.sidestepZ /= l;
    m.sidestepLeft = secondsToTicks(wd.sidestepSec);
  }
  m.headingYaw = Math.atan2(-dx, -dz);
}


/**
 * A spot beside (`x`, `z`), square to the way to `toward`, `minM`-`maxM` away, that a body walks to
 * straight and that still sees `toward` at head height: an off-angle. Writes `out`; false when no side works.
 */
function sideSpot(t: TargetState, ctx: BehaviourContext, toward: Vec3, minM: number, maxM: number, rng: Rng, out: Vec3): boolean {
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  let fx = toward.x - t.pos.x, fz = toward.z - t.pos.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl < 1e-6) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
  const want = rng.range(minM, maxM);
  const first = rng.next() < 0.5 ? 1 : -1;
  const eye = ctx.tunables.movement.standEyeHeight;
  const hy = toward.y + ctx.tunables.targets.hit.headCentreStand;
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? first : -first;
    const lx = -fz * s, lz = fx * s;
    const room = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, lx, lz, want, WALK_STEP_M);
    if (room < minM) continue;
    const x = t.pos.x + lx * room, z = t.pos.z + lz * room;
    if (!lineClear(boxes, x, t.pos.y + eye, z, toward.x, hy, toward.z)) continue;
    set(out, x, t.pos.y, z);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// hold
// ---------------------------------------------------------------------------------------------

/**
 * Hold placement (§2.2, §5.4): the vertical offset below head height is drawn per hold; with the
 * profile's wide-swing anticipation the aim point moves past the watched corner, to the open side,
 * where a wide swing ends. The attended sector is set for perception (a player appearing in it
 * meets a prepared holder, #127).
 */
function placeHold(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const rng = t.streams.decisions;
  const pr = m.profile;
  const hc = ctx.tunables.mindDecision.hold;
  const low = pr.holdOffsetMeanDeg + pr.holdOffsetSdDeg * rng.normal();
  m.holdLowDeg = low > 0 ? low : 0;
  const wide = rng.next() < pr.wideSwingAnticipation;
  set(m.holdAim, m.watch.x, m.watch.y, m.watch.z);
  const eyeY = t.pos.y + t.body.kin.eyeHeight;
  let fx = m.watch.x - m.hold.x, fz = m.watch.z - m.hold.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (wide && fl > 1e-6) {
    fx /= fl; fz /= fl;
    const lx = -fz, lz = fx;
    const off = hc.wideSwingOffsetM;
    const hy = m.watch.y + ctx.tunables.targets.hit.headCentreStand;
    const boxes = ctx.world.boxes;
    // The open side is the one the holder sees: a peeker comes out of cover into it.
    const plus = lineClear(boxes, t.pos.x, eyeY, t.pos.z, m.watch.x + lx * off, hy, m.watch.z + lz * off);
    const minus = lineClear(boxes, t.pos.x, eyeY, t.pos.z, m.watch.x - lx * off, hy, m.watch.z - lz * off);
    if (plus !== minus) {
      const s = plus ? 1 : -1;
      m.holdAim.x += lx * off * s;
      m.holdAim.z += lz * off * s;
    }
  }
  const p = m.perceiver;
  if (p !== null) {
    minds(ctx).perception.setAttendedSector(p, yawOf(m.holdAim.x - t.pos.x, m.holdAim.z - t.pos.z), hc.sectorHalfWidthDeg * DEG2RAD);
  }
  const now = ctx.tick;
  m.glanceUntilTick = -1;
  m.nextGlanceTick = now + secondsToTicks(lognormal(rng, m.dec.glanceIntervalMedianSec, hc.glanceIntervalCv));
}

const hold: BehaviourState = {
  name: 'hold',
  enter(t, ctx) {
    emitState(t, ctx, MIND_HOLD);
    const m = t.mind;
    placeHold(t, ctx);
    const dx = m.hold.x - t.pos.x, dz = m.hold.z - t.pos.z;
    if (dx * dx + dz * dz > ctx.tunables.mindDecision.nav.arriveM * ctx.tunables.mindDecision.nav.arriveM * 4) {
      planTo(t, ctx, m.hold.x, m.hold.y, m.hold.z, true);
    } else {
      m.moving = false;
      stopKeys(t);
    }
    t.body.cmd.crouch = false;
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    const hc = ctx.tunables.mindDecision.hold;
    steer(t, ctx);
    // A crouched hold (low cover) crouches once it is on its spot.
    t.body.cmd.crouch = m.holdCrouched && !m.moving;
    const rng = t.streams.decisions;
    const now = ctx.tick;
    if (m.glanceUntilTick < 0 && now >= m.nextGlanceTick) {
      // A glance at the second angle (attention switching): real windows for the player.
      if (Number.isNaN(m.watchAlt.y)) {
        const base = yawOf(m.holdAim.x - t.pos.x, m.holdAim.z - t.pos.z);
        const side = rng.next() < 0.5 ? 1 : -1;
        m.glanceYaw = wrapPi(base + side * rng.range(hc.glanceMinDeg, hc.glanceMaxDeg) * DEG2RAD);
      } else {
        m.glanceYaw = yawOf(m.watchAlt.x - t.pos.x, m.watchAlt.z - t.pos.z);
        rng.next(); rng.next(); // same draws either way
      }
      m.glanceUntilTick = now + secondsToTicks(lognormal(rng, hc.glanceMedianSec, hc.glanceCv));
      m.nextGlanceTick = m.glanceUntilTick + secondsToTicks(lognormal(rng, m.dec.glanceIntervalMedianSec, hc.glanceIntervalCv));
    }
    if (m.glanceUntilTick >= 0 && now < m.glanceUntilTick) {
      m.look.targetYaw = m.glanceYaw;
      m.look.targetPitch = 0;
      m.look.sdDeg = m.profile.settleNoiseDeg * hc.driftScale;
      lookNow(t, ctx);
    } else {
      m.glanceUntilTick = -1;
      lookAtHead(t, ctx, m.holdAim, true);
    }
    if (!m.decide) return STAY;
    if (sees(t)) return MIND_REACT;
    if (alertWorthy(t)) return MIND_ALERT;
    return STAY;
  },
};

// ---------------------------------------------------------------------------------------------
// alert
// ---------------------------------------------------------------------------------------------

const alert: BehaviourState = {
  name: 'alert',
  enter(t, ctx) {
    emitState(t, ctx, MIND_ALERT);
    const m = t.mind;
    const p = m.perceiver;
    m.alertStampSec = Math.max(p !== null && p.memory.valid ? p.memory.stampSec : -1, m.alarmSec);
    const b = believed(t);
    const rng = t.streams.decisions;
    // Top tiers may slide to an off-angle before the player arrives (§5.2 alert, §2.2).
    const u = rng.next();
    const hc = ctx.tunables.mindDecision.hold;
    if (u < m.profile.offAngleHold && sideSpot(t, ctx, b, hc.offAngleMinM, hc.offAngleMaxM, rng, m.cover)) {
      planTo(t, ctx, m.cover.x, m.cover.y, m.cover.z, true);
    } else {
      m.moving = false;
      stopKeys(t);
    }
    if (p !== null) {
      minds(ctx).perception.setAttendedSector(p, yawOf(b.x - t.pos.x, b.z - t.pos.z), hc.sectorHalfWidthDeg * DEG2RAD);
    }
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    steer(t, ctx);
    // Turn to the sound and pre-aim it at head height.
    const b = believed(t);
    lookAtHead(t, ctx, b, false);
    if (!m.decide) return STAY;
    if (sees(t)) return MIND_REACT;
    const p = m.perceiver;
    if (alertWorthy(t)) m.alertStampSec = Math.max(p !== null && p.memory.valid ? p.memory.stampSec : -1, m.alarmSec);
    const now = ctx.tick * TICK_DT;
    const remembers = p !== null && p.memory.valid;
    const alarmed = m.alarmSec >= 0 && now - m.alarmSec < ctx.tunables.mindDecision.alarmHoldSec;
    if (!remembers && !alarmed && !m.moving) {
      // It forgot: it holds where it stands now, watching where it last believed the player was.
      set(m.hold, t.pos.x, t.pos.y, t.pos.z);
      set(m.watch, b.x, b.y, b.z);
      m.holdCrouched = false;
      return MIND_HOLD;
    }
    return STAY;
  },
};

// ---------------------------------------------------------------------------------------------
// react
// ---------------------------------------------------------------------------------------------

/** Keep the tell's render state on `ai` and announce it at its start (F5, F7). */
function tellTick(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const a = t.ai;
  if (m.tellStartTick >= 0 && ctx.tick >= m.tellStartTick && ctx.tick < m.tellEndTick) {
    if (!m.tellSent && m.fire && ctx.world.firing) {
      m.tellSent = true;
      a.tellStartTick = m.tellStartTick;
      a.tellEndTick = m.tellEndTick;
      a.tellTicks = Math.max(1, m.tellEndTick - m.tellStartTick);
      const e = tellEv;
      e.tick = ctx.tick;
      e.id = t.id;
      e.durationMs = (m.tellEndTick - ctx.tick) * TICK_DT * 1000;
      ctx.events.emit('enemyTell', e);
    }
    a.phase = m.tellSent ? FIRE_TELL : FIRE_IDLE;
  } else {
    a.phase = FIRE_IDLE;
  }
}

const react: BehaviourState = {
  name: 'react',
  enter(t, ctx) {
    emitState(t, ctx, MIND_REACT);
    const m = t.mind;
    const p = m.perceiver!;
    const pr = m.profile;
    m.contact = p.contact;
    // Who moved into view (peeker's advantage, #127): a moving Echo peeked, else a moving player did.
    const gate = t.mind.gate;
    const peeker: Peeker = t.mind.speed > gate ? 'enemy' : ctx.world.playerMoving() ? 'player' : 'none';
    // The aim phase the stand-in look needs: its angle at a typical flick speed (#90 replaces this with its model's prediction).
    const k = t.body.kin;
    const sp = p.sightPoint;
    const dx = sp.x - k.pos.x, dy = sp.y - (k.pos.y + k.eyeHeight), dz = sp.z - k.pos.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const ey = Math.abs(wrapPi(yawOf(dx, dz) - t.body.cmd.yaw)), ep = Math.abs(Math.atan2(dy, h) - t.body.cmd.pitch);
    const ang = Math.sqrt(ey * ey + ep * ep);
    const lc = ctx.tunables.mindDecision.look;
    const aimSec = ang / (pr.maxAngularSpeedDegPerSec * DEG2RAD * lc.aimSpeedFraction) + lc.aimBaseSec;
    reaction.muSec = pr.reactionMuSec; reaction.sigmaSec = pr.reactionSigmaSec; reaction.tauSec = pr.reactionTauSec;
    enemyShotTiming(
      t.streams.reaction, reaction, m.contact, peeker, aimSec, pr.tellFloorSec, ctx.tunables.dial.floors, ctx.tunables.expectation, timing,
    );
    const now = ctx.tick;
    m.reactSec = timing.reactionSec;
    m.reactEndTick = now + secondsToTicks(timing.perceiveSec + timing.reactionSec);
    m.tellStartTick = now + secondsToTicks(timing.tellStartSec);
    m.fireReadyTick = now + Math.max(1, secondsToTicks(timing.fireReadySec));
    m.tellEndTick = m.fireReadyTick;
    m.tellSent = false;
    m.moving = false;
    // A human mid-step keeps the keys it held until the reaction is over, unless it is pushing a wall.
    if (t.mind.speed < ctx.tunables.mindDecision.watchdog.stuckSpeedMps) stopKeys(t);
    m.lastSeenTick = now;
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    tellTick(t, ctx);
    // No aim movement before the reaction is over: the view only drifts.
    const l = m.look;
    l.targetYaw = t.body.cmd.yaw - l.driftYaw;
    l.targetPitch = t.body.cmd.pitch - l.driftPitch;
    l.sdDeg = m.profile.settleNoiseDeg;
    lookNow(t, ctx);
    if (sees(t)) m.lastSeenTick = ctx.tick;
    if (ctx.tick < m.reactEndTick) return STAY;
    const e = reactEv;
    e.tick = ctx.tick;
    e.t = ctx.tick * TICK_DT;
    e.id = t.id;
    e.reactMs = m.reactSec * 1000;
    e.contact = m.contact;
    e.expected = m.contact === 'prepared';
    ctx.events.emit('enemyReacted', e);
    return MIND_DUEL;
  },
};

// ---------------------------------------------------------------------------------------------
// duel
// ---------------------------------------------------------------------------------------------

/** Start a strafe leg (§2.4): lognormal length, reversal by the profile, never into a wall; the moving-shot habit is drawn for it. */
function startLeg(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const rng = t.streams.decisions;
  const cfg = ctx.tunables.mindDecision.duel;
  const pr = m.profile;
  const sec = drawLeg(rng, pr.strafeLegMedianSec, pr.strafeLegCv, m.lastLegSec, cfg);
  const reverse = rng.next() < m.dec.strafeReverse;
  m.movingBurst = rng.next() < pr.movingShotShare;
  m.movingWaitTick = -1;
  m.legFired = false;
  m.lastLegSec = sec;
  m.legEndTick = ctx.tick + Math.max(1, secondsToTicks(sec));
  if (reverse || m.stats.legs === 0) m.legDir = -m.legDir;
  // Square to the line to the player (believed position).
  const b = believed(t);
  let fx = b.x - t.pos.x, fz = b.z - t.pos.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-6) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
  m.legAxisX = -fz; m.legAxisZ = fx;
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  const room = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, m.legAxisX * m.legDir, m.legAxisZ * m.legDir, cfg.legRoomM + WALK_STEP_M, WALK_STEP_M);
  if (room < cfg.legRoomM) m.legDir = -m.legDir;
  m.duelPhase = DUEL_LEG;
  m.gateTick = -1;
  t.body.cmd.crouch = false;
  m.crouchBurst = false;
  m.stats.legs++;
}

/** Shots in the next burst by distance (§5.4 burst policy): spray close, bursts between, taps far. */
function burstSize(t: TargetState, ctx: BehaviourContext): number {
  const dist = t.mind.dist;
  const m = t.mind;
  const pr = m.profile;
  const w = t.body.weapon.slots[0]!;
  let n: number;
  if (dist < pr.sprayBelowM) n = ctx.tunables.mindDecision.duel.sprayMaxShots;
  else if (dist > pr.tapBeyondM) n = 1;
  else n = pr.burstMin + t.streams.decisions.int(pr.burstMax - pr.burstMin + 1);
  return Math.max(1, Math.min(n, w.mag));
}

function startBurst(t: TargetState, ctx: BehaviourContext, moving: boolean): void {
  const m = t.mind;
  const pr = m.profile;
  const rng = t.streams.decisions;
  m.burstN = burstSize(t, ctx);
  m.burstShots0 = t.body.weapon.shots;
  const u = rng.next();
  // Crouch on firing (§2.4): a habit, at most `crouchMaxPerDuel` times a duel.
  if (!moving && m.crouchCount < pr.crouchMaxPerDuel && u < pr.crouchOnFiring) {
    m.crouchCount++;
    m.crouchBurst = true;
    m.stats.crouches++;
    t.body.cmd.crouch = true;
  }
  m.duelPhase = DUEL_FIRE;
  m.stats.bursts++;
  if (moving) m.stats.movingBursts++;
}

/** It may shoot now: armed, the world fires, a round in the gun and not reloading, the tell is done, the player is in sight. */
function canFire(t: TargetState, ctx: BehaviourContext): boolean {
  const m = t.mind;
  const w = t.body.weapon;
  return m.fire && ctx.world.firing && w.reloadLeft === 0 && w.slots[0]!.mag > 0 && ctx.tick >= m.fireReadyTick && sees(t);
}

/** Within the target's angular radius (a head at this distance) plus the tolerance. */
function onTarget(t: TargetState, ctx: BehaviourContext): boolean {
  const dist = t.mind.dist;
  const r = Math.atan2(ctx.tunables.targets.hit.headRadius * 2, Math.max(dist, 0.5));
  return t.mind.aimErr <= r + ctx.tunables.mindDecision.duel.onTargetToleranceDeg * DEG2RAD;
}

/** Hold the trigger for this tick (an automatic gun fires while held; a semi-auto needs a fresh press). */
function pull(t: TargetState, ctx: BehaviourContext): void {
  const w = t.body.weapon;
  const def = ctx.tunables.weapon[w.slots[0]!.id];
  t.body.cmd.fire = def.fireMode === 'auto' || !w.fireWasDown;
}

const duel: BehaviourState = {
  name: 'duel',
  enter(t, ctx) {
    emitState(t, ctx, MIND_DUEL);
    const m = t.mind;
    m.crouchCount = 0;
    m.crouchBurst = false;
    m.moving = false;
    m.gateTick = -1;
    m.stopSinceTick = ctx.tick;
    m.hitPending = false;
    m.lastLegSec = -1;
    m.legDir = t.streams.decisions.next() < 0.5 ? 1 : -1;
    set(m.peekSpot, t.pos.x, t.pos.y, t.pos.z);
    m.peekCrouched = t.crouched;
    // The moving-shot habit also decides the first shot: a low-tier Echo fires while still running (§2.3).
    if (t.streams.decisions.next() < m.profile.movingShotShare) {
      startLeg(t, ctx);
      m.movingBurst = true;
    } else {
      m.duelPhase = DUEL_STOP;
      stopKeys(t);
    }
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    const pl = ctx.world.player;
    tellTick(t, ctx);
    const seen = sees(t);
    if (seen) m.lastSeenTick = ctx.tick;
    // Aim: at the player's head while it sees him (the stand-in for #90's tracking), else where it believes he is.
    let ax: number, ay: number, az: number;
    if (seen) {
      ax = pl.pos.x; az = pl.pos.z;
      ay = pl.pos.y + (pl.crouching ? ctx.tunables.targets.hit.headCentreCrouch : ctx.tunables.targets.hit.headCentreStand);
    } else {
      const b = believed(t);
      ax = b.x; ay = b.y + ctx.tunables.targets.hit.headCentreStand; az = b.z;
    }
    const k = t.body.kin;
    const dx = ax - k.pos.x, dy = ay - (k.pos.y + k.eyeHeight), dz = az - k.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    m.dist = dist;
    // Spray control: pull against the recoil offset by the profile's share (§5.4 spray compensation).
    const w = t.body.weapon;
    const comp = m.profile.sprayCompensation * DEG2RAD;
    const l = m.look;
    l.targetYaw = (dist > 1e-6 ? Math.atan2(-dx, -dz) : t.body.cmd.yaw) + w.recoilYaw * comp;
    l.targetPitch = Math.atan2(dy, dist) - w.recoilPitch * comp;
    l.sdDeg = m.profile.settleNoiseDeg;
    lookNow(t, ctx);

    const cfg = ctx.tunables.mindDecision.duel;
    const speed = t.mind.speed;
    const gate = t.mind.gate;
    switch (m.duelPhase) {
      case DUEL_STOP: {
        // The stop (§2.3): no keys; once under the gate, the shot-after-gate delay, then the burst.
        stopKeys(t);
        if (speed <= gate && k.grounded) {
          if (m.gateTick < 0) {
            // The gate opened in last tick's body step: the delay runs from there.
            m.gateTick = ctx.tick - 1;
            m.shotDelayTicks = secondsToTicks(lognormal(t.streams.decisions, m.profile.shotAfterGateSec, cfg.shotAfterGateCv));
          }
          if (ctx.tick >= m.gateTick + m.shotDelayTicks) {
            if (canFire(t, ctx) && onTarget(t, ctx)) {
              startBurst(t, ctx, false);
              pull(t, ctx);
            } else if (
              !m.fire || !ctx.world.firing || w.reloadLeft > 0 || ctx.tick - m.gateTick - m.shotDelayTicks >= secondsToTicks(cfg.stopWaitMaxSec)
            ) {
              // Unarmed, reloading, or no shot came (off target, out of sight): it moves on rather than stand.
              startLeg(t, ctx);
              commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
            }
          }
        }
        break;
      }
      case DUEL_FIRE: {
        const fired = w.shots - m.burstShots0;
        const visible = lineClear(ctx.world.boxes, k.pos.x, k.pos.y + k.eyeHeight, k.pos.z, ax, ay, az);
        if (fired >= m.burstN || !canFire(t, ctx) || !visible) {
          // Burst over: the next leg (a moving burst finishes the leg it was fired on).
          if (m.movingBurst) {
            m.movingBurst = false;
            m.legFired = true;
            m.duelPhase = DUEL_LEG;
            commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
          } else {
            startLeg(t, ctx);
            commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
          }
          break;
        }
        if (m.movingBurst) commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
        else stopKeys(t);
        pull(t, ctx);
        break;
      }
      default: {
        // DUEL_LEG.
        commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
        t.body.cmd.walk = false;
        if (m.movingBurst) {
          if (m.movingWaitTick < 0) m.movingWaitTick = ctx.tick;
          const ready = speed > gate || ctx.tick - m.movingWaitTick >= secondsToTicks(cfg.movingShotWaitSec);
          if (ready && canFire(t, ctx) && onTarget(t, ctx)) {
            startBurst(t, ctx, true);
            pull(t, ctx);
            break;
          }
        }
        if (ctx.tick >= m.legEndTick) {
          // A leg whose moving burst went out runs straight into the next one (shooting on the move
          // replaced this cycle's stop, so the moving share of shots is the habit's); otherwise it stops to shoot.
          if (m.legFired) {
            startLeg(t, ctx);
            commandMoveToward(t.body, m.legAxisX * m.legDir, m.legAxisZ * m.legDir);
          } else {
            m.duelPhase = DUEL_STOP;
            m.gateTick = -1;
            m.stopSinceTick = ctx.tick;
            stopKeys(t);
          }
        }
        break;
      }
    }

    if (!m.decide) return STAY;
    if (m.hitPending) {
      m.hitPending = false;
      // Hit without a kill: the retreat habit (§5.4, §2.10), unless it just found it has nowhere to go.
      if (t.streams.decisions.next() < m.profile.retreatAfterDamage && ctx.tick >= m.retreatBlockedUntil) return MIND_DISENGAGE;
    }
    const lost = !seen && ctx.tick - m.lastSeenTick > secondsToTicks(cfg.lostSightSec);
    if (lost) {
      if (magFraction(t, ctx) < ctx.tunables.mindDecision.reloadBelowFrac) {
        m.wantReload = true;
        return MIND_DISENGAGE;
      }
      return MIND_ALERT;
    }
    if (m.duelPhase !== DUEL_FIRE && w.reloadLeft === 0 && magFraction(t, ctx) < ctx.tunables.mindDecision.reloadBelowFrac) {
      // Reload: behind cover, or right here in the open (a low-tier mistake, §5.4).
      if (t.streams.decisions.next() < m.profile.reloadInOpen) {
        t.body.cmd.reload = true;
      } else {
        m.wantReload = true;
        return MIND_DISENGAGE;
      }
    }
    return STAY;
  },
};

// ---------------------------------------------------------------------------------------------
// disengage
// ---------------------------------------------------------------------------------------------

/**
 * Find cover from `threat` (feet): around the Echo, the nearest point it walks to straight from which
 * the threat's head height is out of sight, preferring points away from the threat. Writes `out`.
 * Falls back to the nearest nav node out of sight. False when nothing within reach hides it.
 */
function findCover(t: TargetState, ctx: BehaviourContext, threat: Vec3, out: Vec3): boolean {
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  const cc = ctx.tunables.mindDecision.cover;
  const eye = ctx.tunables.movement.standEyeHeight;
  const ty = threat.y + ctx.tunables.targets.hit.headCentreStand;
  let fx = threat.x - t.pos.x, fz = threat.z - t.pos.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl > 1e-6) { fx /= fl; fz /= fl; }
  let best = Infinity;
  const base = t.streams.decisions.next() * Math.PI * 2;
  for (let i = 0; i < cc.directions; i++) {
    const a = base + (i / cc.directions) * Math.PI * 2;
    const ux = Math.cos(a), uz = Math.sin(a);
    const towards = ux * fx + uz * fz;
    for (let j = 0; j < cc.distancesM.length; j++) {
      const d = cc.distancesM[j]!;
      const score = d + cc.towardsPenalty * (towards > 0 ? towards : 0) * d;
      if (score >= best) break;
      const x = t.pos.x + ux * d, z = t.pos.z + uz * d;
      if (!straightWalk(boxes, hull, t.pos.x, t.pos.y, t.pos.z, x, z)) break;
      // Hidden there and a margin short of it (it may stop a little early): not on the shadow's edge.
      const sx = x - ux * cc.marginM, sz = z - uz * cc.marginM;
      if (lineClear(boxes, threat.x, ty, threat.z, x, t.pos.y + eye, z) || lineClear(boxes, threat.x, ty, threat.z, sx, t.pos.y + eye, sz)) continue;
      best = score;
      set(out, x, t.pos.y, z);
      break;
    }
  }
  if (best < Infinity) return true;
  const nav = minds(ctx).nav;
  let bd = Infinity;
  for (let i = 0; i < nav.n; i++) {
    const dx = nav.x[i]! - t.pos.x, dz = nav.z[i]! - t.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bd || d2 > cc.navRadiusM * cc.navRadiusM) continue;
    if (lineClear(boxes, threat.x, ty, threat.z, nav.x[i]!, nav.y[i]! + eye, nav.z[i]!)) continue;
    bd = d2;
    set(out, nav.x[i]!, nav.y[i]!, nav.z[i]!);
  }
  return bd < Infinity;
}

/** Out of the threat's sight from where it stands (eye to the threat's head height). */
function hidden(t: TargetState, ctx: BehaviourContext): boolean {
  const m = t.mind;
  const k = t.body.kin;
  return !lineClear(ctx.world.boxes, m.threat.x, (m.threat.y + ctx.tunables.targets.hit.headCentreStand), m.threat.z, k.pos.x, k.pos.y + k.eyeHeight, k.pos.z);
}

const disengage: BehaviourState = {
  name: 'disengage',
  enter(t, ctx) {
    emitState(t, ctx, MIND_DISENGAGE);
    const m = t.mind;
    const rng = t.streams.decisions;
    const b = believed(t);
    set(m.threat, b.x, b.y, b.z);
    m.backAiming = rng.next() < m.dec.backOutAiming;
    m.hasCover = findCover(t, ctx, m.threat, m.cover);
    t.body.cmd.crouch = false;
    t.ai.phase = FIRE_IDLE;
    if (m.hasCover) planTo(t, ctx, m.cover.x, m.cover.y, m.cover.z, false);
    else { m.moving = false; stopKeys(t); }
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    steer(t, ctx);
    // Backing out still aiming at the angle (top), or turned away running (low).
    if (m.backAiming || !m.moving) lookAtHead(t, ctx, m.threat, false);
    else lookAlong(t, ctx);
    const out = hidden(t, ctx);
    if (out && m.moving) {
      // In cover: stop here.
      m.moving = false;
      stopKeys(t);
    }
    const w = t.body.weapon;
    const settled = !m.moving && t.mind.speed <= t.mind.gate;
    if (settled && w.reloadLeft === 0 && (m.wantReload || magFraction(t, ctx) < ctx.tunables.mindDecision.reloadBelowFrac)
      && w.slots[0]!.mag < ctx.tunables.weapon[w.slots[0]!.id].magazine) {
      t.body.cmd.reload = true;
      m.wantReload = false;
    }
    if (!m.decide) return STAY;
    if (!m.hasCover) {
      // Nowhere to hide: it reloads where it stands if it must and fights from here.
      if (m.wantReload && w.reloadLeft === 0) t.body.cmd.reload = true;
      m.wantReload = false;
      m.retreatBlockedUntil = ctx.tick + secondsToTicks(ctx.tunables.mindDecision.cover.noCoverRetrySec);
      return sees(t) ? MIND_DUEL : MIND_ALERT;
    }
    if (!settled || w.reloadLeft > 0) return STAY;
    if (!out && sees(t)) return MIND_DUEL;
    return t.streams.decisions.next() < m.dec.repeekChance ? MIND_REPEEK : MIND_REPOSITION;
  },
};

// ---------------------------------------------------------------------------------------------
// reposition
// ---------------------------------------------------------------------------------------------

/** A spot to go to other than where it is: one of its spots (not the current one), else an off-angle beside it. */
function pickSpot(t: TargetState, ctx: BehaviourContext, out: Vec3): boolean {
  const m = t.mind;
  const rng = t.streams.decisions;
  const u = rng.next();
  if (m.spotN > 0) {
    const n = m.spotN - (m.spotIndex >= 0 ? 1 : 0);
    if (n > 0) {
      let i = Math.min(n - 1, Math.floor(u * n));
      if (m.spotIndex >= 0 && i >= m.spotIndex) i++;
      m.spotIndex = i;
      set(out, m.spotX[i]!, m.spotY[i]!, m.spotZ[i]!);
      return true;
    }
  }
  const hc = ctx.tunables.mindDecision.hold;
  return sideSpot(t, ctx, believed(t), hc.offAngleMinM, hc.offAngleMaxM, rng, out);
}

const reposition: BehaviourState = {
  name: 'reposition',
  enter(t, ctx) {
    emitState(t, ctx, MIND_REPOSITION);
    const m = t.mind;
    const walk = t.streams.decisions.next() < m.dec.repositionWalk;
    if (pickSpot(t, ctx, m.cover)) planTo(t, ctx, m.cover.x, m.cover.y, m.cover.z, walk);
    else { m.moving = false; m.arrived = true; stopKeys(t); }
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    steer(t, ctx);
    const p = m.perceiver;
    // A top-tier Echo keeps its eyes on where the player was; a low one looks where it walks.
    if (p !== null && p.memory.valid && m.dec.backOutAiming >= 0.5) {
      const b = believed(t);
      lookAtHead(t, ctx, b, false);
    } else lookAlong(t, ctx);
    if (!m.decide) return STAY;
    if (sees(t)) return MIND_REACT;
    if (m.moving) return STAY;
    // Arrived (or gave the move up): hold here, watching where it believes the player is.
    const b = believed(t);
    set(m.hold, t.pos.x, t.pos.y, t.pos.z);
    set(m.watch, b.x, b.y, b.z);
    m.holdCrouched = false;
    return MIND_HOLD;
  },
};

// ---------------------------------------------------------------------------------------------
// repeek, peek
// ---------------------------------------------------------------------------------------------

const repeek: BehaviourState = {
  name: 'repeek',
  enter(t, ctx) {
    emitState(t, ctx, MIND_REPEEK);
    const m = t.mind;
    const rng = t.streams.decisions;
    const pr = m.profile;
    const rc = ctx.tunables.mindDecision.repeek;
    const delay = drawRepeekDelay(rng, pr.repeekDelayMedianSec, pr.repeekInstantShare, m.lastRepeekSec, ctx.tunables.mind.variety.repeekDelayMinDifference, rc);
    m.lastRepeekSec = delay;
    m.repeekEndTick = ctx.tick + Math.max(1, secondsToTicks(delay));
    m.repeekWay = chooseRepeekWay(rng, pr.repeekSame, rc.otherWayShare);
    m.stats.repeeks++;
    if (m.repeekWay === REPEEK_SAME) m.stats.repeekSameWay++;
    m.moving = false;
    stopKeys(t);
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    // Pre-aim the angle it will come back on.
    lookAtHead(t, ctx, m.threat, false);
    if (ctx.tick >= m.repeekEndTick) return MIND_PEEK;
    if (m.decide && sees(t)) return MIND_REACT;
    return STAY;
  },
};

/**
 * The re-peek itself (§2.7): back to the spot it duelled from the same way, the same angle another
 * way (crouched if it stood, else a wider swing), or from elsewhere. Peek *patterns* (jiggle,
 * shoulder, jump, ...) are #92; this walks out at a run and lets perception find the player.
 */
const peek: BehaviourState = {
  name: 'peek',
  enter(t, ctx) {
    emitState(t, ctx, MIND_PEEK);
    const m = t.mind;
    const rng = t.streams.decisions;
    const u = rng.next();
    let gx = m.peekSpot.x, gz = m.peekSpot.z;
    const gy = m.peekSpot.y;
    let crouch = m.peekCrouched;
    if (m.repeekWay === REPEEK_OTHER_WAY) {
      if (!m.peekCrouched && u < 0.5) crouch = true;
      else {
        // Wider: further out along the way from cover to the old spot.
        let ox = m.peekSpot.x - t.pos.x, oz = m.peekSpot.z - t.pos.z;
        const ol = Math.sqrt(ox * ox + oz * oz);
        if (ol > 1e-6) {
          ox /= ol; oz /= ol;
          const hull = ctx.tunables.movement.hullHalfWidth;
          const extra = walkReach(ctx.world.boxes, hull, m.peekSpot.x, m.peekSpot.y, m.peekSpot.z, ox, oz, ctx.tunables.mindDecision.repeek.widerM, WALK_STEP_M);
          gx += ox * extra; gz += oz * extra;
        }
        crouch = false;
      }
    } else if (m.repeekWay === REPEEK_ELSEWHERE) {
      if (pickSpot(t, ctx, m.cover)) { gx = m.cover.x; gz = m.cover.z; }
      crouch = false;
    }
    m.peekCrouched = crouch;
    planTo(t, ctx, gx, gy, gz, false);
  },
  update(t, ctx) {
    pre(t);
    const m = t.mind;
    steer(t, ctx);
    // Crouch for the last metre of a crouched re-peek (a crouch-walk all the way would be slow and odd).
    const g = m.wpN - 1;
    const dx = m.wpX[g]! - t.pos.x, dz = m.wpZ[g]! - t.pos.z;
    const cw = ctx.tunables.mindDecision.repeek.crouchWithinM;
    t.body.cmd.crouch = m.peekCrouched && dx * dx + dz * dz < cw * cw;
    lookAtHead(t, ctx, m.threat, false);
    if (!m.decide) return STAY;
    if (sees(t)) return MIND_REACT;
    if (m.moving) return STAY;
    // Out and nobody there: hold the angle from here.
    set(m.hold, t.pos.x, t.pos.y, t.pos.z);
    set(m.watch, m.threat.x, m.threat.y, m.threat.z);
    m.holdCrouched = false;
    return MIND_HOLD;
  },
};

/** After the body stepped: the perceiver's eye on the body, and this tick's shots counted above or below the gate (S5). */
function bodyMoved(t: TargetState): void {
  syncPerceiver(t);
  const m = t.mind;
  const n = t.body.weapon.shots - m.shotsAtPre;
  if (n <= 0) return;
  m.shotsAtPre = t.body.weapon.shots;
  m.stats.shots += n;
  measureSpeed(t);
  if (m.speed > m.gate || !t.body.kin.grounded) m.stats.movingShots += n;
}

export const mindBehaviour: Behaviour = {
  name: 'mind',
  states: [hold, alert, react, duel, disengage, reposition, repeek, peek],
  initial: MIND_HOLD,
  drivesBody: true,
  bodyMoved,
};
