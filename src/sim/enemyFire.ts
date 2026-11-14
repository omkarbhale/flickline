import type { EnemyFireTunables } from '../config/enemies';
import type { Rng } from '../core/rng';
import { TICK_RATE, TICK_DT, secondsToTicks } from '../core/time';
import { vec3 } from '../core/vec3';
import type { FireParams } from './enemyAi';
import { createShotTiming, enemyShotTiming, type ReactionDist } from './enemyTiming';
import {
  FIRE_BURST, FIRE_COOL, FIRE_IDLE, FIRE_TELL, FIRE_WAIT, type EnemyAi,
} from './enemyAi';
import { lineClear } from './exposure';
import type { BehaviourContext } from './fsm';
import type { HitZone, TargetState } from './types';
import type { RunEvents } from './runEvents';

/**
 * How enemies shoot back (design §5.3), shared by every Echo that fires. One small state machine
 * per enemy, advanced by its movement FSM once per tick:
 *
 *   IDLE -> (sees the player) -> WAIT -> (reaction over, movement opens the gate) -> TELL
 *        -> BURST (1-3 shots at the weapon's rate, seeded hit roll each) -> COOL -> WAIT ...
 *
 * - **Tell.** `enemyTell` fires at its start with its length; the head node flares and a line
 *   runs to the player (`render/enemyTell.ts` reads `phase` and the tick range). It is never
 *   shorter than `dial.floors.tellSec` (0.15 s), rounded up to whole ticks.
 * - **Reaction.** First sight to the tell, from `enemyShotTiming` (the fairness floors and the
 *   prepared-holder rule of #127). A self-timed enemy (a Peeker that decided to peek) has none.
 * - **Hit roll.** `enemyHitChance`: the dial's chance, falling with distance, halved when the
 *   player is above the accuracy deadzone (strafing is a real defence), x0.7 when crouched at
 *   range. A hit picks a zone by weight and goes through the world's player-damage entry point
 *   (shield, tagging, flinch, the damage arc); a miss passes the player's head at a seeded offset
 *   and the `enemyFired` direction lets the audio place the whiz on the right side.
 * - Every shot draws the same four numbers from the seeded stream, hit or miss, so a run replays.
 * - Nothing fires unless the world's `firing` flag is on (drills never set it).
 */

declare module './types' {
  interface SimEvents extends Pick<RunEvents, 'enemyTell' | 'enemyFired'> {}
}

/** Whole ticks that last at least `sec` (the tell floor must not round down). */
export function ceilTicks(sec: number): number {
  return Math.max(1, Math.ceil(sec * TICK_RATE - 1e-9));
}

/**
 * Probability that one enemy shot hits (design §5.3): `base` at standstill and close range,
 * falling in a line to `falloffFarMult` between `falloffNearM` and `falloffFarM`, x`movingMult`
 * when the player is moving above the accuracy threshold, x`crouchMult` when crouched at range.
 */
export function enemyHitChance(
  base: number, distance: number, playerMoving: boolean, playerCrouched: boolean, cfg: EnemyFireTunables,
): number {
  let p = base;
  if (distance > cfg.falloffNearM) {
    const k = Math.min(1, (distance - cfg.falloffNearM) / Math.max(1e-6, cfg.falloffFarM - cfg.falloffNearM));
    p *= 1 + (cfg.falloffFarMult - 1) * k;
  }
  if (playerMoving) p *= cfg.movingMult;
  if (playerCrouched && distance >= cfg.crouchRangeM) p *= cfg.crouchMult;
  return Math.min(1, Math.max(0, p));
}

/** The zone a landed bullet strikes for a roll `u` in [0, 1): weights head, body, leg. */
export function rollZone(u: number, cfg: EnemyFireTunables): HitZone {
  const total = cfg.zoneHead + cfg.zoneBody + cfg.zoneLeg;
  const x = u * total;
  return x < cfg.zoneHead ? 'head' : x < cfg.zoneHead + cfg.zoneBody ? 'body' : 'leg';
}

/** One shot's seeded outcome: hit or miss, the zone a hit strikes, and where a miss passes the head. */
export interface ShotRoll {
  hit: boolean;
  zone: HitZone;
  /** Direction (radians) and distance (metres) of a miss's offset from the aim point, square to the line of fire. */
  theta: number;
  miss: number;
}

export function createShotRoll(): ShotRoll {
  return { hit: false, zone: 'body', theta: 0, miss: 0 };
}

/** Roll one shot. Always draws four numbers from `rng`, hit or miss, so the stream does not depend on the outcome. */
export function rollShot(rng: Rng, pHit: number, cfg: EnemyFireTunables, out: ShotRoll): ShotRoll {
  const roll = rng.next();
  const zoneRoll = rng.next();
  out.theta = rng.next() * Math.PI * 2;
  out.miss = rng.range(cfg.missMinM, cfg.missMaxM);
  out.hit = roll < pHit;
  out.zone = rollZone(zoneRoll, cfg);
  return out;
}

const shotRoll = createShotRoll();
const tellEv: RunEvents['enemyTell'] = { tick: 0, id: 0, durationMs: 0 };
const firedEv: RunEvents['enemyFired'] = { tick: 0, id: 0, hit: false, dir: vec3(), audibleToPlayer: false };
const timing = createShotTiming();
const reactionScratch: ReactionDist = { muSec: 0, sigmaSec: 0, tauSec: 0 };

/** Back to idle: nothing in progress (the contact is forgotten, the reaction runs again on the next sight). */
export function fireReset(a: EnemyAi): void {
  a.phase = FIRE_IDLE;
  a.contactTick = -1;
  a.tellStartTick = -1;
  a.tellEndTick = -1;
  a.burstLeft = 0;
  a.burstsLeft = 0;
  a.gate = false;
}

/** Muzzle position of a target (chest height, lower when crouched) into the scratch outputs. */
function muzzleY(t: TargetState, cfg: EnemyFireTunables): number {
  return t.pos.y + (t.crouched ? cfg.muzzleHeightCrouch : cfg.muzzleHeightStand);
}

/** Whether the enemy can see (and is in range of) the player's eye. */
export function seesPlayer(t: TargetState, ctx: BehaviourContext): boolean {
  const cfg = ctx.tunables.enemies.fire;
  const p = ctx.world.player;
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
  const mx = t.pos.x, my = muzzleY(t, cfg), mz = t.pos.z;
  const dx = ex - mx, dy = ey - my, dz = ez - mz;
  if (dx * dx + dy * dy + dz * dz > cfg.acquireRangeM * cfg.acquireRangeM) return false;
  return lineClear(ctx.world.boxes, mx, my, mz, ex, ey, ez);
}

/** Whether this enemy may shoot right now (it can, the mode lets enemies fire, the run is live). */
function active(a: EnemyAi, ctx: BehaviourContext): boolean {
  return a.fireOn && ctx.world.firing;
}

function startContact(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  const floors = ctx.tunables.dial.floors;
  a.contactTick = ctx.tick;
  if (a.initiator) {
    // Self-timed: it chose the moment, so there is no reaction; only the tell, floored.
    a.readyTick = ctx.tick;
    a.tellTicks = ceilTicks(Math.max(a.tellSec, floors.tellSec));
  } else {
    reactionScratch.muSec = a.reactionSec;
    reactionScratch.sigmaSec = a.reactionSec * cfg.reactionSpread;
    enemyShotTiming(ctx.rng, reactionScratch, a.expectation, 'none', 0, a.tellSec, floors, ctx.tunables.expectation, timing);
    a.readyTick = ctx.tick + secondsToTicks(timing.tellStartSec);
    // The tell runs from its start to the first shot; never below the floor (it also binds a prepared holder's tell).
    a.tellTicks = ceilTicks(Math.max(timing.fireReadySec - timing.tellStartSec, floors.tellSec));
  }
  a.phase = FIRE_WAIT;
}

function startTell(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  a.phase = FIRE_TELL;
  a.tellStartTick = ctx.tick;
  a.tellEndTick = ctx.tick + a.tellTicks;
  tellEv.tick = ctx.tick;
  tellEv.id = t.id;
  tellEv.durationMs = a.tellTicks * TICK_DT * 1000;
  ctx.events.emit('enemyTell', tellEv);
}

function startBurst(t: TargetState, ctx: BehaviourContext, first: boolean): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  a.phase = FIRE_BURST;
  // One draw per burst, always: the stream does not depend on how the fight goes.
  a.burstLeft = cfg.burstMin + ctx.rng.int(cfg.burstMax - cfg.burstMin + 1);
  a.nextShotTick = ctx.tick;
  if (first) a.burstsLeft = a.initiator ? 1 + ctx.rng.int(cfg.peekBurstsMax) : 1;
}

/** One shot: roll, emit `enemyFired`, apply damage on a hit. */
function shoot(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  const w = ctx.world;
  const p = w.player;
  const mx = t.pos.x, my = muzzleY(t, cfg), mz = t.pos.z;
  const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
  const dist = Math.sqrt((ex - mx) ** 2 + (ey - my) ** 2 + (ez - mz) ** 2);
  const pHit = enemyHitChance(a.hitChance, dist, w.playerMoving(), p.crouching, cfg);
  const { hit, zone, theta, miss } = rollShot(ctx.rng, pHit, cfg, shotRoll);

  // Aim point: the head (eye), body or legs on a hit; the head offset sideways/up on a miss.
  let ax = ex, ay = ey, az = ez;
  if (hit) {
    if (zone === 'body') ay = p.pos.y + p.height * cfg.bodyAimFraction;
    else if (zone === 'leg') ay = p.pos.y + p.height * cfg.legAimFraction;
  } else {
    // Perpendicular to the line of fire, so the closest approach is exactly `miss`.
    let rx = -(ez - mz), rz = ex - mx;
    const rl = Math.sqrt(rx * rx + rz * rz) || 1;
    rx /= rl; rz /= rl;
    const side = Math.cos(theta) * miss;
    ax += rx * side;
    az += rz * side;
    ay += Math.sin(theta) * miss;
  }
  let dx = ax - mx, dy = ay - my, dz = az - mz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= len; dy /= len; dz /= len;
  firedEv.tick = ctx.tick;
  firedEv.id = t.id;
  firedEv.hit = hit;
  firedEv.audibleToPlayer = w.soundAudible('shot', mx, mz);
  firedEv.dir.x = dx; firedEv.dir.y = dy; firedEv.dir.z = dz;
  ctx.events.emit('enemyFired', firedEv);
  a.lastShotTick = ctx.tick;
  if (hit) w.hitPlayer(a.weapon, zone, mx, my, mz, t.id, ctx.events);
}

/**
 * Advance one tick of the shooting model. `gate` is the movement's permission to start a tell
 * now (a Strafer while it brakes, a Peeker at the top of a wide peek). `windowEndTick` (Peeker)
 * bounds a second burst. Call once per tick from the movement FSM, after it moved.
 */
export function fireStep(t: TargetState, ctx: BehaviourContext, gate: boolean): void {
  const a = t.ai;
  if (!active(a, ctx)) {
    if (a.phase !== FIRE_IDLE) fireReset(a);
    return;
  }
  const cfg = ctx.tunables.enemies.fire;
  const tick = ctx.tick;
  a.gate = gate;
  if (a.phase === FIRE_IDLE) {
    // An arrival waits until the player has had information about it: it came into view, or its steps carried (S9).
    if (a.honest && t.visibleTick < 0 && a.audibleTick < 0) return;
    if (seesPlayer(t, ctx)) startContact(t, ctx);
    return;
  }
  // From here the enemy is in a contact: losing the player drops it (the reaction runs again on the next sight).
  if (!seesPlayer(t, ctx)) {
    fireReset(a);
    return;
  }
  switch (a.phase) {
    case FIRE_WAIT:
      if (tick >= a.readyTick && gate) startTell(t, ctx);
      break;
    case FIRE_TELL:
      if (tick >= a.tellEndTick) startBurst(t, ctx, true);
      break;
    case FIRE_BURST:
      if (tick >= a.nextShotTick) {
        shoot(t, ctx);
        a.burstLeft--;
        const def = ctx.tunables.weapon[a.weapon];
        a.nextShotTick = tick + Math.max(1, Math.round(TICK_RATE / def.fireRateHz));
        if (a.burstLeft <= 0) endBurst(t, ctx, cfg);
      }
      break;
    case FIRE_COOL:
      if (tick >= a.coolEndTick) {
        a.phase = FIRE_WAIT;
        a.readyTick = tick;
      }
      break;
  }
}

/** A burst is done: another one in this peek if there is time, else the rest before the next tell. */
function endBurst(t: TargetState, ctx: BehaviourContext, cfg: EnemyFireTunables): void {
  const a = t.ai;
  a.burstsLeft--;
  if (a.burstsLeft > 0) {
    const gap = secondsToTicks(ctx.rng.range(cfg.burstGapMinSec, cfg.burstGapMaxSec));
    const def = ctx.tunables.weapon[a.weapon];
    const burstTicks = Math.round((cfg.burstMax * TICK_RATE) / def.fireRateHz);
    if (ctx.tick + gap + burstTicks <= a.windowEndTick) {
      startBurst(t, ctx, false);
      a.nextShotTick = ctx.tick + gap;
      return;
    }
  }
  a.phase = FIRE_COOL;
  a.coolEndTick = ctx.tick + secondsToTicks(ctx.rng.range(cfg.gapMinSec, cfg.gapMaxSec));
}

/** Whether a tell or burst is in progress (the movement holds still until it is done). */
export function fireBusy(a: EnemyAi): boolean {
  return a.phase === FIRE_TELL || a.phase === FIRE_BURST;
}

/** Arm a freshly spawned Strafer or Peeker with the dial's shooting numbers (none = it never fires). */
export function fireInit(t: TargetState, ctx: BehaviourContext, p: FireParams | undefined): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  a.fireOn = p !== undefined;
  a.initiator = t.kind === 'peeker';
  a.tellSec = p?.tellSec ?? cfg.defaultTellSec;
  a.reactionSec = p?.reactionSec ?? cfg.defaultReactionSec;
  a.hitChance = p?.hitChance ?? cfg.defaultHitChance;
  a.expectation = p?.expectation ?? 'attending';
  a.weapon = p?.weapon ?? ctx.world.enemyWeapon;
  fireReset(a);
}
