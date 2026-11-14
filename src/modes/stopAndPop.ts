import { clamp } from '../core/math';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import { modes as modeCfg, type StopAndPopTunables } from '../config/modes';
import type { WeaponId } from '../config/weapon';
import { angleDeg, directionTo, FIRST_HEAD, ShotTracker } from './aim';
import type { SourceEvents } from './contracts';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { createSpawnQuery, gapTicks, type SpawnQuery } from './scheduler';

/**
 * Stop & Pop (design §4.4), trains `footwork`. Lane, Kestrel, no reload.
 *
 * The lane is *armed* while the player strafes at 80% of the equipped run speed or more (the floor
 * stripe lights). A new Post appears at the far end only while it is armed, and carries a stance
 * ring: white = stand still, blue = crouched and still. The first bullet fired at it decides the
 * trial: it must kill, be fired in that stance, and be below the accuracy deadzone, i.e. not a
 * moving shot (`shotFired.moving`, the sim's own flag, so the amber coaching cue and the stat agree
 * with the trial). Above the advanced dial the stop must also have begun with a direction reversal
 * (a true counter-strafe tap), not a release, and some trials are doubles.
 *
 * The mode places targets and judges the first bullet; it draws nothing. Presentation subscribes to
 * `laneArmedChanged` and the `stanceRing*` events.
 */

/** Why a trial ended as it did (`extra.cause` of its `skillTrial`). */
export const CAUSE_OK = 0;
export const CAUSE_TIMEOUT = 1;
export const CAUSE_MOVING = 2;
export const CAUSE_STANCE = 3;
export const CAUSE_NO_COUNTER_STRAFE = 4;
export const CAUSE_NOT_A_KILL = 5;
export const CAUSE_NOT_FIRST_BULLET = 6;

/** Facts the mode announces for presentation (the stance ring at a target's feet). */
export interface StopAndPopEvents {
  /** A target's stance ring went up at its feet (`slot` 0 or 1; a double uses both). `crouch`: blue ring, else white. */
  stanceRingShown: { tick: number; slot: number; crouch: boolean; x: number; y: number; z: number };
  /** The first bullet at the target was judged: `ok` = right stance, below the deadzone (and a counter-strafe where required). */
  stanceRingJudged: { tick: number; slot: number; ok: boolean };
  /** The target is gone (killed, left or timed out): take the ring down. */
  stanceRingHidden: { tick: number; slot: number };
}

declare module './contracts' {
  interface ModeEvents extends StopAndPopEvents {}
}

/** Speed along the view's right axis, m/s (absolute): "moving sideways" is relative to where the player looks. */
export function lateralSpeed(vx: number, vz: number, yaw: number): number {
  return Math.abs(vx * Math.cos(yaw) - vz * Math.sin(yaw));
}

/** The lane is armed: on the ground and strafing at `fraction` of the equipped run speed or more (design §4.4). */
export function isArmed(vx: number, vz: number, yaw: number, grounded: boolean, runSpeed: number, fraction: number): boolean {
  return grounded && lateralSpeed(vx, vz, yaw) >= runSpeed * fraction;
}

/** The stance mix and rules the dial asks for (design §4.4). */
export function stanceRules(dial: number, cfg: StopAndPopTunables): { crouchAllowed: boolean; advanced: boolean } {
  return { crouchAllowed: dial >= cfg.crouchFromDial, advanced: dial > cfg.advancedAboveDial };
}

const MAX_SLOTS = 2;

interface Slot {
  active: boolean;
  id: number;
  crouch: boolean;
  /** Aim point (head centre). */
  readonly head: Vec3;
  readonly feet: Vec3;
  readonly tracker: ShotTracker;
  /** Live tick at which it leaves after its first bullet; -1 = no bullet yet. */
  leaveAt: number;
  judged: boolean;
  ok: boolean;
  cause: number;
  /** The first bullet's movement snapshot, for the trial's extras. */
  firstSpeed: number;
  firstCrouching: boolean;
}

function makeSlot(): Slot {
  return {
    active: false, id: -1, crouch: false, head: vec3(), feet: vec3(), tracker: new ShotTracker(), leaveAt: -1,
    judged: false, ok: false, cause: CAUSE_OK, firstSpeed: 0, firstCrouching: false,
  };
}

/** One Stop & Pop trial: a single target, or a double (two targets that share a stance and an exposure). */
export class StopAndPopTrial {
  readonly slots: Slot[] = [makeSlot(), makeSlot()];
  /** Number of targets of the current trial that are still up. */
  count = 0;
  /** The trial's rule set, fixed at spawn from the dial in force. */
  needReversal = false;
  private readonly query: SpawnQuery = createSpawnQuery('post');
  private readonly view: Vec3 = vec3();
  private readonly dir: Vec3 = vec3();
  private readonly eye: Vec3 = vec3();
  private expireAt = 0;
  private stopSeen = false;
  private stopCounter = false;
  private stopMs = -1;
  // The movement state of the latest bullet, from `shotFired` (it precedes its `shotImpact`).
  private firedId = -1;
  private firedMoving = false;
  private firedCrouching = false;
  private firedSpeed = 0;
  private readonly extra: Record<string, number> = {
    stance: 0, crouching: 0, speed: 0, moving: 0, counterStrafe: 0, reversalRequired: 0, stopMs: -1, shots: 0, firstShotMs: -1,
    errDeg: -1, outcome: 0, cause: 0, double: 0,
  };
  private doubleTrial = false;

  get active(): boolean {
    return this.count > 0;
  }

  /** Try to put the next target (or double) up. False = nothing could be placed this tick. */
  start(ctx: ModeContext<unknown>): boolean {
    const cfg = ctx.tunables.modes.stopAndPop;
    const rules = stanceRules(ctx.dial, cfg);
    // Fixed draw order, so a seed always gives the same trial sequence.
    const crouch = rules.crouchAllowed && ctx.rng.next() < cfg.crouchShare;
    const double = rules.advanced && ctx.rng.next() < cfg.doubleChance;

    const q = this.query;
    const d = clamp(ctx.axes.distance ?? cfg.distanceMaxM, cfg.distanceMinM, cfg.distanceMaxM);
    q.minDist = d * cfg.distanceLoMult;
    q.maxDist = d * cfg.distanceHiMult;
    q.minAngleDeg = 0;
    q.maxAngleDeg = cfg.maxAngleDeg;
    q.refDir = null;
    q.aimOffsetY = ctx.tunables.targets.hit.headCentreStand;

    const a = this.slots[0]!;
    if (!ctx.scheduler.pickAnchor(q, a.head)) return false;
    this.place(a, ctx, crouch);
    if (a.id < 0) return false;
    let n = 1;
    if (double) {
      const b = this.slots[1]!;
      for (let tries = 0; tries < 6; tries++) {
        if (!ctx.scheduler.pickAnchor(q, b.head)) break;
        if (Math.hypot(b.head.x - a.head.x, b.head.z - a.head.z) < cfg.doubleMinSeparationM) continue;
        this.place(b, ctx, crouch);
        if (b.id >= 0) n = 2;
        break;
      }
    }
    this.count = n;
    this.doubleTrial = n === 2;
    this.needReversal = rules.advanced;
    const exposure = Math.max(ctx.axes.stopAndPopExposureSec ?? 1, ctx.tunables.dial.floors.exposureSec) + (n === 2 ? cfg.doubleExtraSec : 0);
    this.expireAt = ctx.liveTick + secondsToTicks(exposure);
    this.stopSeen = false;
    this.stopCounter = false;
    this.stopMs = -1;
    this.firedId = -1;
    for (let i = 0; i < n; i++) this.showRing(ctx, i);
    return true;
  }

  /** Spawn the Post of a slot at its picked head point; `slot.id` stays -1 when the spawn was refused. */
  private place(s: Slot, ctx: ModeContext<unknown>, crouch: boolean): void {
    s.feet.x = s.head.x;
    s.feet.y = s.head.y - ctx.tunables.targets.hit.headCentreStand;
    s.feet.z = s.head.z;
    s.id = ctx.spawn('post', s.feet);
    s.active = s.id >= 0;
    if (!s.active) return;
    s.crouch = crouch;
    s.leaveAt = -1;
    s.judged = false;
    s.ok = false;
    s.cause = CAUSE_OK;
    s.tracker.begin(ctx.player, s.head, ctx.liveTick);
  }

  /** Per-tick deadlines. True when this tick ended the trial. */
  step(ctx: ModeContext<unknown>): boolean {
    if (this.count === 0) return false;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;
      const deadline = s.leaveAt >= 0 ? s.leaveAt : this.expireAt;
      if (ctx.liveTick < deadline) continue;
      const cause = s.tracker.shots === 0 ? CAUSE_TIMEOUT : s.judged && !s.ok ? s.cause : s.judged ? CAUSE_NOT_A_KILL : CAUSE_TIMEOUT;
      this.finish(ctx, i, false, false, cause);
    }
    return this.count === 0;
  }

  /** A sim fact. True when it ended the trial. */
  onEvent(ctx: ModeContext<unknown>, ev: ModeEvent): boolean {
    if (this.count === 0) return false;
    switch (ev.type) {
      case 'playerStopped':
        this.stopSeen = true;
        this.stopCounter = ev.payload.counterStrafe;
        this.stopMs = ev.payload.latencyMs;
        return false;
      case 'shotFired':
        this.firedId = ev.payload.shotId;
        this.firedMoving = ev.payload.moving;
        this.firedCrouching = ev.payload.crouching;
        this.firedSpeed = ev.payload.speed;
        return false;
      case 'shotImpact':
        this.onImpact(ctx, ev.payload);
        return false;
      case 'targetExpired': {
        // Removed by something other than this trial (a debug despawn): the runner already counted the failed trial.
        const i = this.slotOf(ev.payload.targetId);
        if (i < 0) return false;
        this.finish(ctx, i, false, true, CAUSE_TIMEOUT);
        return this.count === 0;
      }
      case 'targetKilled': {
        const i = this.slotOf(ev.payload.targetId);
        if (i < 0) return false;
        const s = this.slots[i]!;
        // The first bullet decides: it must have killed (a head hit at these ranges). A later bullet's kill still pays, but is not the skill.
        const first = s.tracker.shots === 1;
        const won = first && s.judged && s.ok;
        const cause = won ? CAUSE_OK : !first ? CAUSE_NOT_FIRST_BULLET : s.cause;
        this.finish(ctx, i, won, true, cause, ev.payload.rtMs);
        return this.count === 0;
      }
      default:
        return false;
    }
  }

  private slotOf(id: number): number {
    for (let i = 0; i < MAX_SLOTS; i++) if (this.slots[i]!.active && this.slots[i]!.id === id) return i;
    return -1;
  }

  /** Which target a bullet was aimed at: the one it hit, else the one nearest the crosshair. */
  private aimedSlot(ctx: ModeContext<unknown>, ev: SourceEvents['shotImpact']): number {
    if (ev.targetId !== undefined && ev.targetId >= 0) {
      const hit = this.slotOf(ev.targetId);
      if (hit >= 0) return hit;
    }
    if (this.count === 1) return this.slots[0]!.active ? 0 : 1;
    const p = ctx.player;
    this.eye.x = p.pos.x;
    this.eye.y = p.pos.y + p.eyeHeight;
    this.eye.z = p.pos.z;
    directionFromAngles(this.view, p.yaw, p.pitch);
    let best = -1;
    let bestAngle = Infinity;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;
      directionTo(this.dir, this.eye, s.head);
      const a = angleDeg(this.view, this.dir);
      if (a < bestAngle) {
        bestAngle = a;
        best = i;
      }
    }
    return best;
  }

  private onImpact(ctx: ModeContext<unknown>, ev: SourceEvents['shotImpact']): void {
    const i = this.aimedSlot(ctx, ev);
    if (i < 0) return;
    const s = this.slots[i]!;
    s.tracker.onImpact(ctx.player, ctx.liveTick, ev, s.id);
    if (s.tracker.shots !== 1) return;

    // The first bullet: judge it from the player's state when it left the gun.
    let moving: boolean;
    let crouching: boolean;
    let speed: number;
    if (ev.shotId !== undefined && ev.shotId === this.firedId) {
      moving = this.firedMoving;
      crouching = this.firedCrouching;
      speed = this.firedSpeed;
    } else {
      const p = ctx.player;
      speed = Math.hypot(p.vel.x, p.vel.z);
      const def = ctx.tunables.weapon[ctx.mode.weapon as WeaponId];
      moving = !p.grounded || speed > def.deadzoneFraction * def.runSpeedMps;
      crouching = p.crouching;
    }
    s.firstSpeed = speed;
    s.firstCrouching = crouching;
    const reversalOk = !this.needReversal || (this.stopSeen && this.stopCounter);
    if (moving) s.cause = CAUSE_MOVING;
    else if (crouching !== s.crouch) s.cause = CAUSE_STANCE;
    else if (!reversalOk) s.cause = CAUSE_NO_COUNTER_STRAFE;
    else s.cause = CAUSE_OK;
    s.ok = s.cause === CAUSE_OK;
    s.judged = true;
    s.leaveAt = ctx.liveTick + secondsToTicks(ctx.tunables.modes.stopAndPop.leaveAfterFirstBulletSec);
    const e = judgedEv;
    e.tick = ctx.simTick;
    e.slot = i;
    e.ok = s.ok;
    ctx.events.emit('stanceRingJudged', e);
  }

  private showRing(ctx: ModeContext<unknown>, i: number): void {
    const s = this.slots[i]!;
    const e = shownEv;
    e.tick = ctx.simTick;
    e.slot = i;
    e.crouch = s.crouch;
    e.x = s.feet.x;
    e.y = s.feet.y;
    e.z = s.feet.z;
    ctx.events.emit('stanceRingShown', e);
  }

  private finish(ctx: ModeContext<unknown>, i: number, success: boolean, killed: boolean, cause: number, simRtMs = 0): void {
    const s = this.slots[i]!;
    const t = s.tracker;
    const x = this.extra;
    x.stance = s.crouch ? 1 : 0;
    x.crouching = s.firstCrouching ? 1 : 0;
    x.speed = s.firstSpeed;
    x.moving = cause === CAUSE_MOVING ? 1 : 0;
    x.counterStrafe = this.stopSeen && this.stopCounter ? 1 : 0;
    x.reversalRequired = this.needReversal ? 1 : 0;
    x.stopMs = this.stopMs;
    x.shots = t.shots;
    x.firstShotMs = t.firstShotMs();
    x.errDeg = t.errDeg;
    x.outcome = t.shots === 0 ? 0 : t.firstOutcome === FIRST_HEAD ? 2 : t.firstOutcome;
    x.cause = cause;
    x.double = this.doubleTrial ? 1 : 0;
    s.active = false;
    this.count--;
    const hide = hiddenEv;
    hide.tick = ctx.simTick;
    hide.slot = i;
    ctx.events.emit('stanceRingHidden', hide);
    ctx.resolveTrial(s.id, success, { rtMs: t.rtMs(simRtMs, ctx.tunables.targets.reactionAimDeg), extra: x });
    if (!killed) ctx.despawn(s.id);
  }

  /** Take every ring down (the run ended or restarted with a target up). */
  abandon(ctx: ModeContext<unknown>): void {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = this.slots[i]!;
      if (!s.active) continue;
      s.active = false;
      const hide = hiddenEv;
      hide.tick = ctx.simTick;
      hide.slot = i;
      ctx.events.emit('stanceRingHidden', hide);
    }
    this.count = 0;
  }
}

// Reused event payloads (valid only during the emit).
const shownEv = { tick: 0, slot: 0, crouch: false, x: 0, y: 0, z: 0 };
const judgedEv = { tick: 0, slot: 0, ok: false };
const hiddenEv = { tick: 0, slot: 0 };
const armedEv = { tick: 0, armed: false };

interface State {
  trial: StopAndPopTrial;
  /** Live tick at which the lane may arm the next trial. */
  nextAt: number;
  /** The lane's armed state as last announced. */
  armed: boolean;
}

export const stopAndPop: ModeDef<State> = {
  id: 'stopAndPop',
  skills: ['footwork'],
  map: 'lane',
  weapon: 'kestrel',
  player: { infiniteMagazine: true },
  durationSec: modeCfg.drillSec,
  axes: ['distance', 'stopAndPopExposureSec'],

  setup(ctx) {
    const c = ctx.tunables.modes.stopAndPop;
    return { trial: new StopAndPopTrial(), nextAt: gapTicks(ctx.rng, c.gapMinSec, c.gapMaxSec), armed: false };
  },

  tick(ctx: ModeContext<State>) {
    const s = ctx.state;
    const c = ctx.tunables.modes.stopAndPop;
    const p = ctx.player;
    const run = ctx.tunables.weapon[ctx.mode.weapon as WeaponId].runSpeedMps;
    const armed = isArmed(p.vel.x, p.vel.z, p.yaw, p.grounded, run, c.armedFraction);
    if (armed !== s.armed) {
      s.armed = armed;
      armedEv.tick = ctx.simTick;
      armedEv.armed = armed;
      ctx.events.emit('laneArmedChanged', armedEv);
    }
    if (s.trial.active) {
      if (s.trial.step(ctx)) s.nextAt = ctx.liveTick + gapTicks(ctx.rng, c.gapMinSec, c.gapMaxSec);
      return;
    }
    if (!armed || ctx.liveTick < s.nextAt) return;
    s.trial.start(ctx);
  },

  onEvent(ctx: ModeContext<State>, ev) {
    const s = ctx.state;
    if (s.trial.onEvent(ctx, ev)) {
      const c = ctx.tunables.modes.stopAndPop;
      s.nextAt = ctx.liveTick + gapTicks(ctx.rng, c.gapMinSec, c.gapMaxSec);
    }
  },
};
