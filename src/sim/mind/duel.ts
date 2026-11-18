import { lognormal } from '../../core/dist';
import { TICK_DT, TICK_RATE, secondsToTicks } from '../../core/time';
import { vec3 } from '../../core/vec3';
import { FIRE_AIM, FIRE_BURST, FIRE_IDLE, FIRE_TELL, FIRE_WAIT } from '../enemyAi';
import { ceilTicks, seesPlayer } from '../enemySight';
import { createShotTiming, enemyShotTiming, type Expectation, type ReactionDist } from '../enemyTiming';
import type { BehaviourContext } from '../fsm';
import { createRay, createZoneHit, traceTargetRay, type ZoneBody } from '../hitZones';
import { lineClear } from '../exposure';
import type { RunEvents } from '../runEvents';
import type { TargetState } from '../types';
import {
  AIM_MOVE, aimDisengage, aimEngage, aimEstimateSec, aimReset, aimStep, createAimInput, primaryPast,
} from './aim';
import { createMindShot, gunReset, gunShoot, gunTick, type Shooter } from './gun';
import { profileFor } from './profile';

/**
 * How a mind-driven Echo fights once it has seen the player (`docs/research/player-like-enemies.md`
 * §5.5 steps 1 and 6, F4-F6; issue #90). It replaces the dial's hit roll (`enemyFire.ts`) for
 * Echoes spawned with a `mindSkill`: every shot leaves the Echo's simulated crosshair (`aim.ts`)
 * through the real spread (`gun.ts`) and hits whatever it hits on the player's own zones.
 *
 *   IDLE  - holding; the view rests on its hold direction (drifting), nothing seen.
 *   WAIT  - it sees the player: the reaction runs (the profile's ex-Gaussian, the expectation shift,
 *           the floors; `enemyTiming.ts`). The view does not move yet.
 *   TELL  - the aim phase: the primary submovement and its corrections. The tell starts with it and
 *           lasts max(aim phase, tell floor) (F5): `enemyTell` carries the predicted length, and the
 *           tell stretches if the aim takes longer. A surprised Echo already on target holds fire
 *           for the floor; a prepared holder's tell runs from first sight and never holds fire (#127).
 *   BURST - 1-3 shots at the weapon's rate (design §5.3).
 *   AIM   - between bursts: the design's rest, then fire again whenever the rules allow (no new tell).
 *
 * A shot leaves only when the crosshair is on the aimed zone (or the primary is swiping through it),
 * the tell floor has passed, the movement commits to a fight, and the body has been under the
 * weapon's accuracy gate for the drawn shot-after-gate delay, unless the profile's moving-shot
 * habit fires for this opportunity. Draws come only from the Echo's own streams (#86): reaction from
 * `reaction`, the view from `aim`, habits, bursts, spread and recoil from `decisions`; another enemy
 * never shifts them, and the view's trace never depends on when it fired.
 */

declare module '../types' {
  interface SimEvents extends Pick<RunEvents, 'enemyTell' | 'enemyFired'> {}
}

const DEG = Math.PI / 180;
const EPS = 1e-9;
/** A Strafer brakes once its primary submovement is this far along: the stop lands as the crosshair arrives. */
const STOP_FROM_PROGRESS = 0.5;

const tellEv: RunEvents['enemyTell'] = { tick: 0, id: 0, durationMs: 0 };
const firedEv: RunEvents['enemyFired'] = { tick: 0, id: 0, hit: false, dir: vec3(), audibleToPlayer: false };
const timing = createShotTiming();
const reaction: ReactionDist = { muSec: 0, sigmaSec: 0, tauSec: 0 };
const aimIn = createAimInput();
const shot = createMindShot();
const body: Shooter = { yaw: 0, pitch: 0, speed: 0, crouching: false, compensation: 0 };
const playerBody: ZoneBody = { pos: vec3(), crouched: false, scale: 1 };
const ray = createRay();
const zoneHit = createZoneHit();

/**
 * Turn a freshly spawned Strafer or Peeker into a mind-driven one: its profile from the mind skill
 * and its personality stream (#88), its gun clean, and its view on a hold: towards where the player
 * is now (the way it came in: the hold anchor until the decision states, #91, place holds), at head
 * height lowered by the profile's hold offset (§5.4 crosshair placement).
 */
export function mindInit(t: TargetState, ctx: BehaviourContext, mindSkill: number): void {
  const a = t.ai;
  const tun = ctx.tunables;
  a.mind = true;
  profileFor(mindSkill, t.streams.personality, a.profile, tun);
  gunReset(a.gun);
  const p = ctx.world.player;
  const eyeY = t.pos.y + (t.crouched ? tun.movement.crouchEyeHeight : tun.movement.standEyeHeight);
  const dx = p.pos.x - t.pos.x, dz = p.pos.z - t.pos.z;
  const headY = p.pos.y + (p.crouching ? tun.targets.hit.headCentreCrouch : tun.targets.hit.headCentreStand);
  const offsetDeg = a.profile.holdOffsetMeanDeg + a.profile.holdOffsetSdDeg * t.streams.aim.normal();
  aimReset(a.aim, Math.atan2(-dx, -dz), Math.atan2(headY - eyeY, Math.sqrt(dx * dx + dz * dz)) - offsetDeg * DEG);
  mindFireReset(t);
}

/** Back to holding: the contact is over (lost sight, ducked back, the run stopped). */
export function mindFireReset(t: TargetState): void {
  const a = t.ai;
  a.phase = FIRE_IDLE;
  a.contactTick = -1;
  a.tellStartTick = -1;
  a.tellEndTick = -1;
  a.burstLeft = 0;
  a.gateTick = -1;
  a.restEndTick = 0;
  aimDisengage(a.aim);
}

/** Fill the aim input from the world: the Echo's eye, the player's aim point (head centre minus the profile's drop), sight. */
function fillAimInput(t: TargetState, ctx: BehaviourContext, sees: boolean): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const hit = tun.targets.hit;
  const p = ctx.world.player;
  aimIn.tick = ctx.tick;
  aimIn.eyeX = t.pos.x;
  aimIn.eyeY = t.pos.y + (t.crouched ? tun.movement.crouchEyeHeight : tun.movement.standEyeHeight);
  aimIn.eyeZ = t.pos.z;
  aimIn.sees = sees;
  const drop = a.profile.aimDropM;
  aimIn.pointX = p.pos.x;
  aimIn.pointY = p.pos.y + (p.crouching ? hit.headCentreCrouch : hit.headCentreStand) - drop;
  aimIn.pointZ = p.pos.z;
  // The aimed zone: the head while the point is inside it, else the torso.
  aimIn.zoneRadiusM = drop <= hit.headRadius ? hit.headRadius : hit.torsoWidth / 2;
}

/** Draw the habits of a new shooting opportunity: the moving-shot habit and the shot-after-gate delay. */
function newOpportunity(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const rng = t.streams.decisions;
  a.movingHabit = rng.next() < a.profile.movingShotShare;
  a.shotDelayTicks = Math.round(lognormal(rng, a.profile.shotAfterGateSec, ctx.tunables.mind.shoot.shotAfterGateCv) * TICK_RATE);
}

function emitTell(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  tellEv.tick = ctx.tick;
  tellEv.id = t.id;
  tellEv.durationMs = a.tellTicks * TICK_DT * 1000;
  ctx.events.emit('enemyTell', tellEv);
}

/** First sight: classify the expectation, draw the reaction, and start a prepared holder's tell. */
function startContact(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const p = a.profile;
  // Off its attention (§5.3): a prepared holder was expecting elsewhere; anyone else is caught unaware.
  let exp: Expectation = a.expectation;
  if (a.aim.err > tun.mind.perception.attentionHalfAngleDeg * DEG) exp = exp === 'prepared' ? 'attending' : 'unaware';
  a.contactExpectation = exp;
  reaction.muSec = p.reactionMuSec;
  reaction.sigmaSec = p.reactionSigmaSec;
  reaction.tauSec = p.reactionTauSec;
  enemyShotTiming(t.streams.reaction, reaction, exp, 'none', 0, a.tellSec, tun.dial.floors, tun.expectation, timing);
  a.contactTick = ctx.tick;
  a.reactionDrawSec = timing.reactionSec;
  a.readyTick = ctx.tick + secondsToTicks(timing.reactionSec);
  a.phase = FIRE_WAIT;
  if (exp === 'prepared') {
    // Its tell runs from first sight to its shot (#127): reaction plus the aim it expects to need.
    a.tellStartTick = ctx.tick;
    a.tellTicks = ceilTicks(timing.reactionSec + aimEstimateSec(a.aim, p, tun.mind.aim));
    a.tellEndTick = ctx.tick + a.tellTicks;
    emitTell(t, ctx);
  }
}

/** The reaction is over: the aim phase (and a surprised Echo's tell) starts now. */
function engage(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const predicted = aimEngage(a.aim, aimIn, a.profile, t.streams.aim, tun.mind.aim);
  a.swipe = t.streams.decisions.next() < a.profile.swipeShare;
  newOpportunity(t, ctx);
  a.restEndTick = 0;
  if (a.contactExpectation === 'prepared') {
    a.fireFloorTick = ctx.tick;
  } else {
    const floor = Math.max(a.tellSec, tun.dial.floors.tellSec);
    a.tellStartTick = ctx.tick;
    a.tellTicks = ceilTicks(Math.max(predicted, floor));
    a.tellEndTick = ctx.tick + a.tellTicks;
    a.fireFloorTick = ctx.tick + ceilTicks(floor);
    emitTell(t, ctx);
  }
  a.phase = FIRE_TELL;
}

/** Whether the aim is on the zone it aims at (or swiping through it on the primary's final approach). */
function onTarget(t: TargetState, ctx: BehaviourContext): boolean {
  const a = t.ai;
  const s = a.aim;
  const sh = ctx.tunables.mind.shoot;
  if (!s.hasTarget || s.err > s.zoneAngle * sh.onTargetZones) return false;
  if (s.phase !== AIM_MOVE) return true;
  return a.swipe && primaryPast(s, sh.swipeFromProgress);
}

/**
 * Shots in the next burst: design §5.3's 1-3 (`enemies.fire.burstMin..burstMax`). The profile's
 * distance policy (spray close, taps far, §5.4) belongs to the duel state of the decision FSM (#91).
 */
function burstLength(t: TargetState, ctx: BehaviourContext): number {
  const cfg = ctx.tunables.enemies.fire;
  return cfg.burstMin + t.streams.decisions.int(cfg.burstMax - cfg.burstMin + 1);
}

/** One aimed bullet: through the gun's spread from the view, traced against walls and the player's zones. */
function shoot(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const w = ctx.world;
  const def = tun.weapon[a.weapon];
  body.yaw = a.aim.yaw;
  body.pitch = a.aim.pitch;
  body.compensation = a.profile.sprayCompensation;
  // Spread and recoil draw from the decision stream: the view's own stream never depends on when it fires.
  gunShoot(a.gun, def, tun.weaponRules, tun.movement, body, t.streams.decisions, ctx.tick, shot);
  const p = w.player;
  playerBody.pos.x = p.pos.x;
  playerBody.pos.y = p.pos.y;
  playerBody.pos.z = p.pos.z;
  playerBody.crouched = p.crouching;
  const ox = aimIn.eyeX, oy = aimIn.eyeY, oz = aimIn.eyeZ;
  const d = shot.dir;
  ray.ox = ox; ray.oy = oy; ray.oz = oz;
  ray.dx = d.x; ray.dy = d.y; ray.dz = d.z;
  ray.maxDist = tun.weaponRules.rangeM;
  // The player wears the humanoid zones (spec §5.1); any humanoid kind's def says "humanoid", the sizes are `hit`.
  let hit = traceTargetRay(playerBody, tun.targets.hit, tun.targets.kinds.post, ray, zoneHit);
  if (hit) {
    const r = zoneHit.distance;
    hit = lineClear(w.boxes, ox, oy, oz, ox + d.x * r, oy + d.y * r, oz + d.z * r);
  }
  firedEv.tick = ctx.tick;
  firedEv.id = t.id;
  firedEv.hit = hit;
  firedEv.audibleToPlayer = w.soundAudible('shot', ox, oz);
  firedEv.dir.x = d.x; firedEv.dir.y = d.y; firedEv.dir.z = d.z;
  ctx.events.emit('enemyFired', firedEv);
  a.lastShotTick = ctx.tick;
  if (hit) w.hitPlayer(a.weapon, zoneHit.zone, ox, oy, oz, t.id, ctx.events);
}

/** One bullet of the burst, the next one scheduled at the weapon's rate; the last one starts the rest and a new opportunity. */
function fireBullet(t: TargetState, ctx: BehaviourContext, fireRateHz: number): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  shoot(t, ctx);
  a.burstLeft--;
  a.nextShotTime = ctx.tick * TICK_DT + 1 / fireRateHz;
  if (a.burstLeft > 0) return;
  a.phase = FIRE_AIM;
  // Design §5.3's rest between bursts (seeded uniform), from the Echo's own decision stream.
  a.restEndTick = ctx.tick + secondsToTicks(t.streams.decisions.range(cfg.gapMinSec, cfg.gapMaxSec));
  newOpportunity(t, ctx);
}

/**
 * Advance one tick of a mind-driven Echo's aim and shots, after its body moved. Called every tick by
 * the target field (`TargetField.step`). What the movement offers comes from its last `fireStep`:
 * `gate` (it is stopping here) and `committed` (it commits to a fight here: a Strafer always, a Peeker
 * only on a wide peek; its other patterns are baits and looks).
 */
export function mindFireStep(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const def = tun.weapon[a.weapon];
  const tick = ctx.tick;
  if (!(a.fireOn && ctx.world.firing)) {
    if (a.phase !== FIRE_IDLE) mindFireReset(t);
    return;
  }
  // The body: horizontal speed this tick, and how long it has been under the accuracy gate.
  const vx = t.pos.x - t.prevPos.x, vz = t.pos.z - t.prevPos.z;
  body.speed = Math.sqrt(vx * vx + vz * vz) * TICK_RATE;
  body.crouching = t.crouched;
  // `weaponModel.isMovingShot`, inline: a number passed to a helper may be boxed every tick.
  if (body.speed > def.deadzoneFraction * def.runSpeedMps) a.gateTick = -1;
  else if (a.gateTick < 0) a.gateTick = tick;

  const sees = seesPlayer(t, ctx);
  if (!sees && a.phase !== FIRE_IDLE) mindFireReset(t);
  fillAimInput(t, ctx, sees);
  aimStep(a.aim, aimIn, a.profile, t.streams.aim, tun.mind);
  gunTick(a.gun, def, tick);
  if (!sees) return;

  switch (a.phase) {
    case FIRE_IDLE:
      startContact(t, ctx);
      return;
    case FIRE_WAIT:
      if (tick >= a.readyTick) engage(t, ctx);
      return;
    case FIRE_BURST:
      if (tick * TICK_DT >= a.nextShotTime - EPS) fireBullet(t, ctx, def.fireRateHz);
      return;
    default: {
      // TELL or AIM: shoot when the rules allow. A tell still aiming at its predicted end stretches (F5).
      if (a.phase === FIRE_TELL && tick >= a.tellEndTick) {
        a.tellEndTick = tick + 1;
        a.tellTicks = a.tellEndTick - a.tellStartTick;
      }
      if (!a.committed || tick < a.fireFloorTick || tick < a.restEndTick || !onTarget(t, ctx)) return;
      // From a stop: the movement is stopping here (`gate`) and the body has been under the accuracy
      // gate for the drawn delay. A Strafer pulling away from a stop is under the gate for a few ticks
      // too, but it is not stopping.
      const stopped = a.gate && a.gateTick >= 0 && tick - a.gateTick >= a.shotDelayTicks;
      if (!stopped && !(a.gateTick < 0 && a.movingHabit)) return;
      a.phase = FIRE_BURST;
      a.burstLeft = burstLength(t, ctx);
      fireBullet(t, ctx, def.fireRateHz);
    }
  }
}

/**
 * A mind-driven Strafer wants to stop now: it has reacted and its aim is arriving (or there),
 * its rest is over, and the moving-shot habit did not fire for this opportunity. Counter-strafing
 * as the crosshair lands is the reference game's stop-shoot rhythm (§2.3).
 */
export function mindWantsStop(t: TargetState, tick: number): boolean {
  const a = t.ai;
  if (!a.mind || a.movingHabit || tick < a.restEndTick) return false;
  if (a.phase !== FIRE_TELL && a.phase !== FIRE_AIM) return false;
  return a.aim.phase !== AIM_MOVE || primaryPast(a.aim, STOP_FROM_PROGRESS);
}
