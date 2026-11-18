import { DEG2RAD, RAD2DEG } from '../../core/math';
import { Rng } from '../../core/rng';
import { TICK_RATE, secondsToTicks } from '../../core/time';
import { vec3, type Vec3 } from '../../core/vec3';
import type { Tunables } from '../../config/tunables';
import { targetAimPoint, wrapPi, yawOf } from '../../sim/aim';
import type { TargetState, TickInput } from '../../sim/types';
import type { World } from '../../sim/world';
import type { BotParams } from './skill';

/**
 * A synthetic player. Each tick it looks at the world the way a person would (which targets are
 * up, where the crosshair is, what the recoil is doing), and writes a `TickInput`: view angles and
 * trigger. It never touches the world's state, and every random draw comes from its own seeded
 * `Rng`, so a seed gives the same run every time. It allocates nothing per tick.
 *
 * One engagement, the way a human aimer moves (the two-submovement model of aimed movements):
 *
 *   react    the target appears; the bot waits out its reaction time (and any engagement in progress)
 *   flick    a minimum-jerk primary movement towards the head, lasting a Fitts time and landing
 *            `overshootBias x distance` past it plus a random fraction of the distance
 *   correct  if the flick landed outside the tolerance, a short corrective movement onto the head
 *            plus the final aim error (a 2-D Gaussian with sigma `aimSigmaDeg`)
 *   engage   the crosshair follows the head (with a short lag, so a moving target is trailed);
 *            the bot clicks after its click delay, fires bursts, pulls the recoil back out of the
 *            view in proportion to `sprayControl`, and lets go when the target is gone
 *
 * Out of scope (documented in the README): leading moving targets, movement, weapon swaps, cover.
 */

const IDLE = 0;
const REACT = 1;
const FLICK = 2;
const CORRECT = 3;
const ENGAGE = 4;
type Phase = typeof IDLE | typeof REACT | typeof FLICK | typeof CORRECT | typeof ENGAGE;

/** Share of the Fitts time the primary flick takes; the rest is the budget of a correction. */
const PRIMARY_SHARE = 0.8;
const MIN_FLICK_SEC = 0.04;
const MIN_CORRECT_SEC = 0.06;
const MIN_REACTION_SEC = 0.1;
/** Share of the primary flick's overshoot (or undershoot) that survives the correction: nobody corrects perfectly. */
const RESIDUAL_SHARE = 0.15;
/** The flick counts as landed (no correction) within this share of the target's angular radius. */
const LANDED_SHARE = 0.5;
/** Time constant of the crosshair following the head while engaged, seconds (the bot's tracking lag). */
const FOLLOW_TAU_SEC = 0.03;
const FOLLOW_K = 1 - Math.exp(-1 / (TICK_RATE * FOLLOW_TAU_SEC));

export interface BotStats {
  engagements: number;
  flicks: number;
  corrections: number;
  bursts: number;
  giveUps: number;
}

export class Bot {
  readonly stats: BotStats = { engagements: 0, flicks: 0, corrections: 0, bursts: 0, giveUps: 0 };
  /** Commanded view, radians. */
  yaw = 0;
  pitch = 0;

  private readonly rng: Rng;
  private readonly aimPoint: Vec3 = vec3();
  private started = false;
  private phase: Phase = IDLE;
  private phaseStart = 0;
  private phaseTicks = 1;
  private fromYaw = 0;
  private fromPitch = 0;
  private toYaw = 0;
  private toPitch = 0;
  private targetId = -1;
  private reactAt = 0;
  private freeAt = 0;
  private noiseYaw = 0;
  private noisePitch = 0;
  /** The primary flick's endpoint error (overshoot + spread), radians, which the correction mostly removes. */
  private flickErrYaw = 0;
  private flickErrPitch = 0;
  private engageStart = 0;
  private fireReadyAt = 0;
  private pauseUntil = 0;
  private firing = false;
  private burstStartShots = 0;
  /** Shots and the target's HP as last seen while firing: a bullet that took no HP missed. */
  private seenShots = 0;
  private seenHp = 0;
  private lastFire = false;
  /** Cached per-target geometry, set when an engagement begins (degrees). */
  private halfWidthDeg = 1;
  // Derived from the parameters once.
  private readonly sigmaRad: number;
  private readonly recoveryTicks: number;
  private readonly giveUpTicks: number;
  private readonly clickTicks: number;

  /**
   * Only targets the player has seen count (`visibleTick`): no search turn towards one that has never
   * been in view. A target in the open (the Lobby's) needs no sight check, so it is left off; a run where Echoes
   * hold behind cover (Sweep) turns it on, or the bot would know where they are through walls.
   */
  visibleOnly = false;
  /** With `visibleOnly`: whether a seen target is in plain sight now (a target that went back behind cover is not picked). */
  inSight: ((t: TargetState) => boolean) | null = null;

  constructor(
    readonly params: BotParams,
    seed: number,
    private readonly tunables: Tunables,
  ) {
    this.rng = new Rng(seed >>> 0 || 1);
    this.sigmaRad = params.aimSigmaDeg * DEG2RAD;
    this.recoveryTicks = secondsToTicks(params.recoverySec);
    this.giveUpTicks = secondsToTicks(params.giveUpSec);
    this.clickTicks = secondsToTicks(params.clickDelaySec);
  }

  /** Gaussian(0, 1) from the seeded stream (Box-Muller; one pair per call, the second value is dropped to stay simple). */
  private gauss(): number {
    return Math.sqrt(-2 * Math.log(1 - this.rng.next())) * Math.cos(2 * Math.PI * this.rng.next());
  }

  /**
   * Decide this tick's input. `world.tick` is the tick that has run so far; the returned input is
   * for the next one. Movement keys stay released: the bot stands and aims.
   */
  step(world: World, out: TickInput): TickInput {
    const p = world.player;
    out.moveX = out.moveZ = 0;
    out.jump = out.crouch = out.walk = out.reload = false;
    out.switchTo = -1;
    if (!this.started) {
      this.started = true;
      this.yaw = p.yaw;
      this.pitch = p.pitch;
      this.freeAt = world.tick;
    }
    if (!world.health.alive || !world.live) return this.write(out, false);

    const now = world.tick;
    if (this.phase === IDLE && !this.pickTarget(world, now)) {
      out.reload = this.wantsReload(world);
      return this.write(out, false);
    }

    // The target must still be there; if not, the engagement is over.
    const t = this.targetId >= 0 ? world.targetField.byId(this.targetId) : null;
    if (!t) {
      this.finish(now, false);
      return this.write(out, false);
    }
    targetAimPoint(t, this.tunables.targets, this.aimPoint);

    switch (this.phase) {
      case REACT:
        if (now >= this.reactAt) this.beginFlick(world, t, now);
        return this.write(out, false);
      case FLICK:
        if (this.advance(now)) {
          // Landed: close enough to fire at once, or a correction first.
          if (this.errorDeg(world) <= this.halfWidthDeg * LANDED_SHARE) this.beginEngage(world, now, true);
          else this.beginCorrect(world, now);
        }
        return this.write(out, false);
      case CORRECT:
        // Re-aim the move at the head's present position: a moving target is chased.
        this.retarget(world, this.noiseYaw, this.noisePitch);
        if (this.advance(now)) this.beginEngage(world, now, false);
        return this.write(out, false);
      default:
        return this.engage(world, t, now, out);
    }
  }

  /** No engagement in progress (nothing picked, or the last one is over). */
  get idle(): boolean {
    return this.phase === IDLE;
  }

  /** Id of the target being engaged, -1 when idle. */
  get target(): number {
    return this.targetId;
  }

  /** With nothing to shoot at, a player tops up a part-empty magazine (a player does it after every spray). */
  private wantsReload(world: World): boolean {
    const w = world.weapon;
    const slot = w.slots[w.active]!;
    return !w.infiniteMagazine && w.reloadLeft <= 0 && w.equipLeft <= 0 && slot.mag < this.tunables.weapon[slot.id].magazine;
  }

  private write(out: TickInput, fire: boolean): TickInput {
    out.yaw = this.yaw;
    out.pitch = this.pitch;
    out.fire = fire;
    this.lastFire = fire;
    return out;
  }

  // --- target choice ---------------------------------------------------------------------------

  /** Choose the next target: the visible one nearest the crosshair, else (a search turn) the one nearest in yaw. */
  private pickTarget(world: World, now: number): boolean {
    const slots = world.targets;
    const eyeY = world.player.pos.y + world.player.eyeHeight;
    const ex = world.player.pos.x;
    const ez = world.player.pos.z;
    let best: TargetState | null = null;
    let bestVisible = false;
    let bestScore = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      if (!t.alive) continue;
      const visible = t.visibleTick >= 0;
      if (this.visibleOnly && (!visible || (this.inSight !== null && !this.inSight(t)))) continue;
      if (bestVisible && !visible) continue;
      targetAimPoint(t, this.tunables.targets, this.aimPoint);
      const vx = this.aimPoint.x - ex;
      const vy = this.aimPoint.y - eyeY;
      const vz = this.aimPoint.z - ez;
      const dY = Math.abs(wrapPi(yawOf(vx, vz) - this.yaw));
      const dP = Math.abs(Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) - this.pitch);
      const score = dY + dP;
      if ((visible && !bestVisible) || score < bestScore) {
        best = t;
        bestVisible = visible;
        bestScore = score;
      }
    }
    if (!best) return false;
    this.targetId = best.id;
    this.stats.engagements++;
    const notice = best.visibleTick >= 0 ? best.visibleTick : best.spawnTick;
    const reaction = Math.max(MIN_REACTION_SEC, this.params.reactionMeanSec + this.gauss() * this.params.reactionSdSec);
    this.reactAt = Math.max(notice, this.freeAt) + secondsToTicks(reaction);
    this.phase = REACT;
    this.phaseStart = now;
    this.engageStart = now;
    return true;
  }

  private finish(now: number, gaveUp: boolean): void {
    if (gaveUp) this.stats.giveUps++;
    this.phase = IDLE;
    this.targetId = -1;
    this.firing = false;
    this.freeAt = now + this.recoveryTicks;
  }

  // --- movements -------------------------------------------------------------------------------

  /** Angle from the crosshair to the aim point, degrees. */
  private errorDeg(world: World): number {
    const p = world.player;
    const vx = this.aimPoint.x - p.pos.x;
    const vy = this.aimPoint.y - (p.pos.y + p.eyeHeight);
    const vz = this.aimPoint.z - p.pos.z;
    const dY = wrapPi(yawOf(vx, vz) - this.yaw) * Math.cos(this.pitch);
    const dP = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) - this.pitch;
    return Math.sqrt(dY * dY + dP * dP) * RAD2DEG;
  }

  private beginFlick(world: World, t: TargetState, now: number): void {
    const p = world.player;
    const vx = this.aimPoint.x - p.pos.x;
    const vy = this.aimPoint.y - (p.pos.y + p.eyeHeight);
    const vz = this.aimPoint.z - p.pos.z;
    const dist = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1e-6;
    const dY = wrapPi(yawOf(vx, vz) - this.yaw);
    const dP = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) - this.pitch;
    const dYc = dY * Math.cos(this.pitch);
    const ampRad = Math.sqrt(dYc * dYc + dP * dP);
    // Angular radius of the thing being aimed at: the head, or the orb.
    const r = t.kind === 'beacon' ? t.radius : this.tunables.targets.hit.headRadius;
    const radiusDeg = Math.asin(Math.min(1, r / dist)) * RAD2DEG;
    this.halfWidthDeg = radiusDeg;
    const idBits = Math.log2((ampRad * RAD2DEG) / (2 * radiusDeg) + 1);
    const total = idBits / this.params.throughputBitsPerSec;
    let sec = Math.max(MIN_FLICK_SEC, total * PRIMARY_SHARE);
    sec = Math.max(sec, ampRad / (this.params.searchDegPerSec * DEG2RAD)); // a turn is limited by how fast the bot can swing
    const eps = this.params.overshootBias + this.gauss() * this.params.overshootSpread;
    this.fromYaw = this.yaw;
    this.fromPitch = this.pitch;
    this.toYaw = this.yaw + dY * (1 + eps);
    this.toPitch = this.pitch + dP * (1 + eps);
    this.flickErrYaw = dY * eps;
    this.flickErrPitch = dP * eps;
    this.phase = FLICK;
    this.phaseStart = now;
    this.phaseTicks = secondsToTicks(sec);
    this.stats.flicks++;
  }

  private beginCorrect(world: World, now: number): void {
    this.noiseYaw = this.gauss() * this.sigmaRad + this.flickErrYaw * RESIDUAL_SHARE;
    this.noisePitch = this.gauss() * this.sigmaRad + this.flickErrPitch * RESIDUAL_SHARE;
    this.fromYaw = this.yaw;
    this.fromPitch = this.pitch;
    this.phase = CORRECT;
    this.phaseStart = now;
    this.phaseTicks = secondsToTicks(Math.max(MIN_CORRECT_SEC, (this.phaseTicks / TICK_RATE) * ((1 - PRIMARY_SHARE) / PRIMARY_SHARE)));
    this.retarget(world, this.noiseYaw, this.noisePitch);
    this.stats.corrections++;
  }

  /** Point the end of the current movement at the head now, plus the final aim error. */
  private retarget(world: World, noiseYaw: number, noisePitch: number): void {
    const p = world.player;
    const vx = this.aimPoint.x - p.pos.x;
    const vy = this.aimPoint.y - (p.pos.y + p.eyeHeight);
    const vz = this.aimPoint.z - p.pos.z;
    this.toYaw = this.fromYaw + wrapPi(yawOf(vx, vz) - this.fromYaw) + noiseYaw;
    this.toPitch = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) + noisePitch;
  }

  /** Move the commanded view along the minimum-jerk profile; true once the movement is complete. */
  private advance(now: number): boolean {
    const x = Math.min(1, (now - this.phaseStart) / this.phaseTicks);
    const s = x * x * x * (10 + x * (-15 + 6 * x));
    this.yaw = this.fromYaw + (this.toYaw - this.fromYaw) * s;
    this.pitch = this.fromPitch + (this.toPitch - this.fromPitch) * s;
    return x >= 1;
  }

  private beginEngage(world: World, now: number, landed: boolean): void {
    if (landed) {
      // The flick landed within tolerance: keep that error (the crosshair does not jump again).
      const p = world.player;
      const vx = this.aimPoint.x - p.pos.x;
      const vy = this.aimPoint.y - (p.pos.y + p.eyeHeight);
      const vz = this.aimPoint.z - p.pos.z;
      this.noiseYaw = this.yaw - (this.yaw + wrapPi(yawOf(vx, vz) - this.yaw));
      this.noisePitch = this.pitch - Math.atan2(vy, Math.sqrt(vx * vx + vz * vz));
    }
    this.phase = ENGAGE;
    this.phaseStart = now;
    this.fireReadyAt = now + this.clickTicks;
    this.pauseUntil = 0;
    this.firing = false;
  }

  // --- engaged: follow, click, burst, control the spray ----------------------------------------

  private engage(world: World, t: TargetState, now: number, out: TickInput): TickInput {
    const p = world.player;
    const w = world.weapon;
    const def = this.tunables.weapon[w.slots[w.active]!.id];

    if (now - this.engageStart > this.giveUpTicks) {
      this.finish(now, true);
      return this.write(out, false);
    }

    // Aim: head + this burst's error + the recoil pulled back out. The view follows with a short lag.
    const vx = this.aimPoint.x - p.pos.x;
    const vy = this.aimPoint.y - (p.pos.y + p.eyeHeight);
    const vz = this.aimPoint.z - p.pos.z;
    const q = this.params.sprayControl;
    const wantYaw = this.yaw + wrapPi(yawOf(vx, vz) - this.yaw) + this.noiseYaw + w.recoilYaw * DEG2RAD * q;
    const wantPitch = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) + this.noisePitch - w.recoilPitch * DEG2RAD * q;
    this.yaw += (wantYaw - this.yaw) * FOLLOW_K;
    this.pitch += (wantPitch - this.pitch) * FOLLOW_K;

    // Trigger.
    const canShoot = w.equipLeft <= 0 && w.reloadLeft <= 0;
    if (!canShoot || now < this.fireReadyAt || now < this.pauseUntil) return this.write(out, false);
    const auto = def.fireMode === 'auto';
    if (!this.firing) {
      this.firing = true;
      this.burstStartShots = this.seenShots = w.shots;
      this.seenHp = t.hp;
      this.stats.bursts++;
    }
    const fired = w.shots - this.burstStartShots;
    const bullets = auto ? this.params.burstBullets : 1;
    // The bot sees where its bullets go: one that took no HP off the target missed, so it lets go and re-aims.
    let missed = false;
    if (w.shots > this.seenShots) {
      missed = t.hp >= this.seenHp;
      this.seenShots = w.shots;
      this.seenHp = t.hp;
    }
    if (fired >= bullets || missed) {
      // Burst over: let go, wait, then re-aim with a fresh error.
      this.firing = false;
      this.pauseUntil = now + this.recoveryTicks;
      this.noiseYaw = this.gauss() * this.sigmaRad;
      this.noisePitch = this.gauss() * this.sigmaRad;
      return this.write(out, false);
    }
    // Semi-auto needs a fresh press: the trigger is released on alternate ticks.
    return this.write(out, auto ? true : !this.lastFire && w.cooldown <= 0);
  }
}
