import { lognormal } from '../../core/dist';
import { TICK_DT, TICK_RATE, secondsToTicks } from '../../core/time';
import { FIRE_AIM, FIRE_BURST, FIRE_IDLE, FIRE_TELL, FIRE_WAIT } from '../enemyAi';
import { ceilTicks, seesPlayer } from '../enemySight';
import { createShotTiming, enemyShotTiming, type Expectation, type ReactionDist } from '../enemyTiming';
import type { BehaviourContext } from '../fsm';
import type { RunEvents } from '../runEvents';
import type { TargetState } from '../types';
import {
  AIM_MOVE, aimDisengage, aimEngage, aimEstimateSec, aimReset, aimStep, createAimInput, primaryPast,
} from './aim';
import { profileFor } from './profile';

/**
 * How a mind-driven Echo fights once it has seen the player (`docs/research/player-like-enemies.md`
 * §5.5 steps 1 and 6, F4-F6; issue #90). It replaces the dial's hit roll (`enemyFire.ts`) for
 * Echoes spawned with a `mindSkill`. The mind writes the Echo's command like a player's hands: the
 * look angles from the aim model (`aim.ts`), pulled against the gun's recoil by the profile's spray
 * control, and the trigger. The shared body (#87, `enemyBody.ts`) does the rest with the player's
 * own gun: fire rate, first-shot spread, movement error, recoil, and a bullet that hits whatever it
 * hits on the player's zones behind the level's walls. No hit roll anywhere.
 *
 *   IDLE  - holding; the view rests on its hold direction (drifting), nothing seen.
 *   WAIT  - it sees the player: the reaction runs (the profile's ex-Gaussian, the expectation shift,
 *           the floors; `enemyTiming.ts`). The view does not move yet.
 *   TELL  - the aim phase: the primary submovement and its corrections. The tell starts with it and
 *           lasts max(aim phase, tell floor) (F5): `enemyTell` carries the predicted length, and the
 *           tell stretches if the aim takes longer. A surprised Echo already on target holds fire
 *           for the floor; a prepared holder's tell runs from first sight and never holds fire (#127).
 *   BURST - the trigger is held for 1-3 shots (design §5.3).
 *   AIM   - between bursts: the design's rest, then fire again whenever the rules allow (no new tell).
 *
 * A burst starts only when the crosshair is on the aimed zone (or the primary is swiping through it),
 * the tell floor has passed, the movement commits to a fight, and the body has been under the
 * weapon's accuracy gate for the drawn shot-after-gate delay at a stop, unless the profile's
 * moving-shot habit fires for this opportunity. Draws come only from the Echo's own streams (#86):
 * reaction from `reaction`, the view from `aim`, habits, bursts and the gun's spread and recoil (inside
 * the body) from `decisions`; another enemy never shifts them, and the view never depends on when it fired.
 */

declare module '../types' {
  interface SimEvents extends Pick<RunEvents, 'enemyTell' | 'enemyFired'> {}
}

const DEG = Math.PI / 180;
/** A Strafer lets go of its key once its primary submovement is this far along: the stop lands as the crosshair arrives. */
const STOP_FROM_PROGRESS = 0.5;

const tellEv: RunEvents['enemyTell'] = { tick: 0, id: 0, durationMs: 0 };
const timing = createShotTiming();
const reaction: ReactionDist = { muSec: 0, sigmaSec: 0, tauSec: 0 };
const aimIn = createAimInput();

/**
 * Turn a freshly spawned Strafer or Peeker into a mind-driven one: its profile from the mind skill
 * and its personality stream (#88), and its view (and its body's) on a hold: towards where the player
 * is now (the way it came in: the hold anchor until the decision states, #91, place holds), at head
 * height lowered by the profile's hold offset (§5.4 crosshair placement).
 */
export function mindInit(t: TargetState, ctx: BehaviourContext, mindSkill: number): void {
  const a = t.ai;
  const tun = ctx.tunables;
  a.mind = true;
  profileFor(mindSkill, t.streams.personality, a.profile, tun);
  const p = ctx.world.player;
  const eyeY = t.pos.y + (t.crouched ? tun.movement.crouchEyeHeight : tun.movement.standEyeHeight);
  const dx = p.pos.x - t.pos.x, dz = p.pos.z - t.pos.z;
  const headY = p.pos.y + (p.crouching ? tun.targets.hit.headCentreCrouch : tun.targets.hit.headCentreStand);
  const offsetDeg = a.profile.holdOffsetMeanDeg + a.profile.holdOffsetSdDeg * t.streams.aim.normal();
  aimReset(a.aim, Math.atan2(-dx, -dz), Math.atan2(headY - eyeY, Math.sqrt(dx * dx + dz * dz)) - offsetDeg * DEG);
  const b = t.body;
  b.cmd.yaw = b.kin.yaw = a.aim.yaw;
  b.cmd.pitch = b.kin.pitch = a.aim.pitch;
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
  t.body.cmd.fire = false;
  aimDisengage(a.aim);
}

/** Fill the aim input from the world: the Echo's eye (its body's), the player's aim point (head centre minus the profile's drop), sight. */
function fillAimInput(t: TargetState, ctx: BehaviourContext, sees: boolean): void {
  const a = t.ai;
  const tun = ctx.tunables;
  const hit = tun.targets.hit;
  const p = ctx.world.player;
  aimIn.tick = ctx.tick;
  aimIn.eyeX = t.pos.x;
  aimIn.eyeY = t.pos.y + t.body.kin.eyeHeight;
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

/** The burst is out: rest (design §5.3's gap, seeded from the Echo's decision stream), then a new opportunity. */
function endBurst(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  const cfg = ctx.tunables.enemies.fire;
  a.phase = FIRE_AIM;
  a.burstLeft = 0;
  t.body.cmd.fire = false;
  a.restEndTick = ctx.tick + secondsToTicks(t.streams.decisions.range(cfg.gapMinSec, cfg.gapMaxSec));
  newOpportunity(t, ctx);
}

/**
 * One tick of a mind-driven Echo's aim and trigger, between its movement's keys and its body's step
 * (`TargetField.step`, every tick). What the movement offers comes from its last `fireStep`: `gate`
 * (it is stopping here) and `committed` (it fights here: a Strafer always, a Peeker only on a wide
 * peek; its other patterns are baits and looks). `bodyStep`: the body moves under its command this
 * tick (else its FSM moved the slot already, and only its gun steps).
 */
export function mindFireStep(t: TargetState, ctx: BehaviourContext, bodyStep: boolean): void {
  const a = t.ai;
  const b = t.body;
  const tun = ctx.tunables;
  const def = tun.weapon[a.weapon];
  const tick = ctx.tick;
  if (!(a.fireOn && ctx.world.firing)) {
    if (a.phase !== FIRE_IDLE) mindFireReset(t);
    b.cmd.fire = false;
    return;
  }
  // The body's speed (its last step's velocity, or this tick's motion for a slot its FSM moved) and
  // how long it has been under the accuracy gate (`weaponModel.isMovingShot`, inline: no boxed number).
  let vx: number, vz: number;
  if (bodyStep) {
    vx = b.kin.vel.x;
    vz = b.kin.vel.z;
  } else {
    vx = (t.pos.x - t.prevPos.x) * TICK_RATE;
    vz = (t.pos.z - t.prevPos.z) * TICK_RATE;
  }
  if (Math.sqrt(vx * vx + vz * vz) > def.deadzoneFraction * def.runSpeedMps) a.gateTick = -1;
  else if (a.gateTick < 0) a.gateTick = tick;

  // An arrival (hold sectors, `arrival.ts`) never opens a contact before the player has seen or heard
  // it (design §9.3): until then it looks, but it has not "seen" him for the fight.
  const hidden = a.honest && t.visibleTick < 0 && a.audibleTick < 0;
  const sees = !hidden && seesPlayer(t, ctx);
  if (!sees && a.phase !== FIRE_IDLE) mindFireReset(t);
  fillAimInput(t, ctx, sees);
  aimStep(a.aim, aimIn, a.profile, t.streams.aim, tun.mind);
  if (sees) {
    switch (a.phase) {
      case FIRE_IDLE:
        startContact(t, ctx);
        break;
      case FIRE_WAIT:
        if (tick >= a.readyTick) engage(t, ctx);
        break;
      case FIRE_BURST:
        break;
      default: {
        // TELL or AIM: start a burst when the rules allow. A tell still aiming at its predicted end stretches (F5).
        if (a.phase === FIRE_TELL && tick >= a.tellEndTick) {
          a.tellEndTick = tick + 1;
          a.tellTicks = a.tellEndTick - a.tellStartTick;
        }
        if (!a.committed || tick < a.fireFloorTick || tick < a.restEndTick || !onTarget(t, ctx)) break;
        // From a stop: the movement is stopping here (`gate`) and the body has been under the accuracy
        // gate for the drawn delay. A Strafer pulling away from a stop is under the gate for a few ticks
        // too, but it is not stopping.
        const stopped = a.gate && a.gateTick >= 0 && tick - a.gateTick >= a.shotDelayTicks;
        if (!stopped && !(a.gateTick < 0 && a.movingHabit)) break;
        a.phase = FIRE_BURST;
        a.burstLeft = burstLength(t, ctx);
        a.burstShotsMark = b.weapon.shots;
      }
    }
  }
  writeCommand(t, def.fireMode === 'auto');
}

/**
 * The command, as a player's hands: the view where the aim model has it, pulled against the gun's
 * recoil offset by the profile's spray control (a player pulls the mouse down; the barrel is the view
 * plus the offset, spec §3.5), and the trigger held through a burst (released every other tick for a
 * semi-automatic gun, which fires on a fresh press). The movement keys the FSM set for the old view
 * are turned to the new one, so a Strafer keeps to its lane while it flicks.
 */
function writeCommand(t: TargetState, auto: boolean): void {
  const a = t.ai;
  const b = t.body;
  const c = b.cmd;
  const w = b.weapon;
  const comp = a.profile.sprayCompensation;
  const oldYaw = c.yaw;
  c.yaw = a.aim.yaw + comp * w.recoilYaw * DEG; // + recoil yaw = right = smaller barrel yaw: look left of it
  c.pitch = a.aim.pitch - comp * w.recoilPitch * DEG;
  if (c.moveX !== 0 || c.moveZ !== 0) {
    // World wish direction under the old yaw (right = (cos, -sin), forward = (-sin, -cos)), re-expressed under the new.
    const so = Math.sin(oldYaw), co = Math.cos(oldYaw);
    const wx = c.moveX * co - c.moveZ * so;
    const wz = -c.moveX * so - c.moveZ * co;
    const sn = Math.sin(c.yaw), cn = Math.cos(c.yaw);
    c.moveX = wx * cn - wz * sn;
    c.moveZ = -wx * sn - wz * cn;
  }
  c.fire = a.phase === FIRE_BURST && (auto || !w.fireWasDown);
}

/** After the gun stepped: count the burst's shots (the body's gun emitted `enemyFired` for each); the last ends the burst. */
export function mindAfterGun(t: TargetState, ctx: BehaviourContext): void {
  const a = t.ai;
  if (a.phase !== FIRE_BURST) return;
  const shots = t.body.weapon.shots;
  if (shots === a.burstShotsMark) return;
  a.burstLeft -= shots - a.burstShotsMark;
  a.burstShotsMark = shots;
  if (a.burstLeft <= 0) endBurst(t, ctx);
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
