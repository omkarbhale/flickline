import { RAD2DEG } from '../core/math';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, dot, vec3, type Vec3 } from '../core/vec3';
import { medals as defaultMedals, MEDAL_IDS, type MedalId, type MedalTunables } from '../config/medals';
import { sweep as defaultSweep } from '../config/sweep';
import { targets as defaultTargets } from '../config/targets';
import type { RunLog } from './eventLog';
import type { HitZone } from '../sim/types';

/**
 * # Medals (design §8.4, §7.3)
 *
 * Every medal is a pure criterion over the run's facts. One incremental engine (`MedalEngine`)
 * evaluates them, and it serves two callers with the same code, so they cannot disagree (the same
 * idea as `StatTracker`/`computeStats`):
 *  - live: `features/medals.ts` feeds it the bus's events and turns each award into `medalAwarded`;
 *  - replay: `medalsOfLog(log)` runs a recorded log through a fresh engine (tests, the bot harness).
 *
 * The medals are about fights in a Sweep run (design §8.4, #217): Planted, Hairline, Pendulum, Thread, Clean Corner and
 * Untouched read contacts and shots; Flawless is a *sector* with no miss and no moving shot; Closer is the Finale cleared and
 * Cashed is leaving Overtime with points banked. The one medal that needs more than the event stream is a pure
 * function of the finished run: `endOfRunMedals` (Quick Study reads the run's stats and the history of the mode).
 * Ascent (a rank-up) is decided by `progress/ranks.ts`. Metronome, a drill-rhythm medal, is retired.
 *
 * Pure: no DOM, no clock, no randomness. Allocation-free per event after construction apart from
 * the per-run reset; the engine never allocates per tick.
 *
 * Choices where the design table is open to reading (all on #38): *Needle* counts first-bullet
 * headshots in a row and any other shot breaks it; *Cold Open* counts targets, so a target that
 * left unkilled breaks it too; *Planted* is kills in a row with no moving shot fired in between
 * (the stance check of the retired Stop & Pop drill, which the log does not carry, is not applied); *Hairline* measures
 * where the bullet went, spread included, and needs the Echo to have been moving when the shot left; *Pendulum*
 * counts only time on a strafing Echo (a Strafer in a leg, not standing); *Thread* awards once the qualifying spray
 * inside one fight reaches its minimum length; *Clean Corner* is cumulative within a run.
 */

/** The facts the engine reads: a subset of the game's events, so the bus (or a log) can feed it directly. */
export interface MedalEvents {
  runStarted: { tick: number };
  runEnded: { tick: number };
  shotFired: {
    tick: number;
    shotId: number;
    moving: boolean;
    recoilIndex: number;
    /** The bullet's direction (recoil and spread included). */
    dir: Vec3;
    /** View angles at the tick, radians. */
    yaw: number;
    pitch: number;
    /** Nearest visible live target to the view ray (-1 none), its angle to the view ray, and its head-centre angles minus the view angles; radians. */
    aimTargetId: number;
    aimErr: number;
    aimDYaw: number;
    aimDPitch: number;
  };
  shotImpact: { tick: number; shotId: number; result: 'hit' | 'miss'; targetId: number; zone: HitZone | null };
  targetKilled: { tick: number; targetId: number; firstBullet: boolean };
  targetExpired: { tick: number; targetId: number };
  aimOnTarget: { tick: number; on: boolean; id: number };
  contactSettled: { tick: number; outcome: 'cleared' | 'disengaged' | 'avoided' | 'died'; kept: number; enemies: number };
  /** Sector `index` (0-based, as the run director emits it) began / ended (design §14.3); the Flawless and Closer medals are about sectors. */
  sectorEntered: { tick: number; index: number };
  sectorEnded: { tick: number; cleared: boolean };
  /** A Leave gate banked the run: `points` of Overtime were at risk (design §4.7). */
  runBanked: { tick: number; points: number; overtimeSectors: number };
}
export type MedalEventType = keyof MedalEvents;
export const MEDAL_EVENT_TYPES: readonly MedalEventType[] = [
  'runStarted', 'runEnded', 'shotFired', 'shotImpact', 'targetKilled', 'targetExpired', 'aimOnTarget', 'contactSettled',
  'sectorEntered', 'sectorEnded', 'runBanked',
];

/**
 * What the sim knows of an Echo's motion, read when a shot leaves (the target is still alive then): the event log does
 * not carry it, so the live game passes the target field and a replay passes its own (or `NO_MOTION`, where nothing moves).
 */
export interface TargetMotion {
  /** Horizontal speed, m/s (0 for an unknown id). */
  speed(id: number): number;
  /** A Strafer in a strafe leg (not standing, not braking to a stop). */
  strafing(id: number): boolean;
}
export const NO_MOTION: TargetMotion = { speed: () => 0, strafing: () => false };

/** Award callback: the medal and the tick it was earned on. */
export type AwardFn = (id: MedalId, tick: number) => void;

const RING = 64;

/** The bullets fired at the most recent targets (a bounded ring: a medal never needs an old target). */
class BulletTally {
  private readonly ids = new Int32Array(RING).fill(-1);
  private readonly counts = new Int32Array(RING);
  private next = 0;

  clear(): void {
    this.ids.fill(-1);
    this.counts.fill(0);
    this.next = 0;
  }

  count(id: number): number {
    for (let i = 0; i < RING; i++) if (this.ids[i] === id) return this.counts[i]!;
    return 0;
  }

  add(id: number): void {
    for (let i = 0; i < RING; i++) {
      if (this.ids[i] === id) {
        this.counts[i]!++;
        return;
      }
    }
    this.ids[this.next] = id;
    this.counts[this.next] = 1;
    this.next = (this.next + 1) % RING;
  }
}

/** Angle in degrees between the bullet's direction and the head centre of the target the view was nearest. */
export function bulletAngleToHeadDeg(
  dir: Vec3, yaw: number, pitch: number, aimDYaw: number, aimDPitch: number, scratch: Vec3 = vec3(),
): number {
  directionFromAngles(scratch, yaw + aimDYaw, pitch + aimDPitch);
  const c = Math.min(1, Math.max(-1, dot(dir, scratch)));
  return Math.acos(c) * RAD2DEG;
}

export class MedalEngine {
  private readonly active = {} as Record<MedalId, boolean>;
  private readonly engageRad: number;
  private readonly scratch = vec3();
  private readonly tally = new BulletTally();
  private readonly windowTicks: number;

  // shot in flight (shotFired seen, shotImpact not yet)
  private pending = false;
  private pId = 0;
  private pIndex = 0;
  private pAimTarget = -1;
  private pEngaged = false;
  private pHeadDeg = 0;
  private pAimMoving = false;

  private needle = 0;
  private coldOpen = 0;
  private planted = 0;
  private cleanContacts = 0;
  // the sector being played (Flawless, Closer)
  private sectorIndex = 0;
  private sectorHits = 0;
  private sectorMisses = 0;
  private sectorMoving = 0;
  // spray (Thread)
  private sprayN = 0;
  private sprayOk = false;
  private sprayAwarded = false;
  private sprayLast = -1;
  // Pendulum: on intervals [start, end) in ticks; end = -1 while open (time on a strafing Echo)
  private readonly onStart = new Int32Array(RING);
  private readonly onEnd = new Int32Array(RING);
  private onCount = 0;
  private windowFrom = 0;
  private lastTick = -1;
  /** The Echo the aim ray is on now (-1 none), whether or not it is strafing. */
  private aimId = -1;

  live = false;

  constructor(
    private readonly award: AwardFn,
    private readonly cfg: MedalTunables = defaultMedals,
    shotAtDeg: number = defaultTargets.shotAtDeg,
    private readonly finaleSector: number = defaultSweep.finaleSector,
    private readonly motion: TargetMotion = NO_MOTION,
  ) {
    this.engageRad = (shotAtDeg * Math.PI) / 180;
    this.windowTicks = secondsToTicks(cfg.pendulumWindowSec);
    this.begin('');
  }

  /** A new run of `mode`: clear every counter, and decide which medals count in it. */
  begin(mode: string): void {
    for (const id of MEDAL_IDS) {
      const only = this.cfg.modes[id];
      this.active[id] = only === undefined || only.includes(mode);
    }
    this.live = false;
    this.pending = false;
    this.tally.clear();
    this.needle = this.coldOpen = this.planted = this.cleanContacts = 0;
    this.sectorIndex = this.sectorHits = this.sectorMisses = this.sectorMoving = 0;
    this.resetSpray();
    this.onCount = 0;
    this.windowFrom = 0;
    this.lastTick = -1;
    this.aimId = -1;
  }

  private on(id: MedalId): boolean {
    return this.active[id];
  }

  /** Feed one event. Unknown event types are ignored. */
  observe<K extends MedalEventType>(type: K, e: MedalEvents[K]): void {
    switch (type) {
      case 'runStarted':
        this.live = true;
        this.windowFrom = (e as MedalEvents['runStarted']).tick;
        this.lastTick = this.windowFrom;
        return;
      case 'runEnded':
        this.flushPending();
        this.live = false;
        return;
      case 'shotFired':
        if (this.live) this.shotFired(e as MedalEvents['shotFired']);
        return;
      case 'shotImpact':
        if (this.live) this.shotImpact(e as MedalEvents['shotImpact']);
        return;
      case 'targetKilled':
        if (this.live) this.killed(e as MedalEvents['targetKilled']);
        return;
      case 'targetExpired':
        if (this.live) this.coldOpen = 0;
        return;
      case 'aimOnTarget':
        if (this.live) this.aimOn(e as MedalEvents['aimOnTarget']);
        return;
      case 'contactSettled':
        if (this.live) this.contact(e as MedalEvents['contactSettled']);
        return;
      case 'sectorEntered':
        this.sectorBegan(e as MedalEvents['sectorEntered']); // also while `ready`: the first sector begins before the run is live
        return;
      case 'sectorEnded':
        if (this.live) this.sectorEnd(e as MedalEvents['sectorEnded']);
        return;
      case 'runBanked':
        if (this.live) this.banked(e as MedalEvents['runBanked']);
        return;
    }
  }

  /**
   * Time moved on to `tick` (call once per sim tick while a run is live; harmless to skip ticks: the
   * gap is walked). Only Pendulum, a window over time, needs it.
   */
  advance(tick: number): void {
    if (!this.live || !this.on('pendulum')) {
      this.lastTick = tick;
      return;
    }
    for (let t = this.lastTick + 1; t <= tick; t++) {
      this.trackOn(t);
      this.checkPendulum(t);
    }
    this.lastTick = tick;
  }

  // ---- shots -----------------------------------------------------------------------------------

  private shotFired(e: MedalEvents['shotFired']): void {
    this.flushPending();
    this.pending = true;
    this.pId = e.shotId;
    this.pIndex = e.recoilIndex;
    this.pAimTarget = e.aimTargetId;
    this.pEngaged = e.aimTargetId >= 0 && e.aimErr <= this.engageRad;
    this.pHeadDeg = e.aimTargetId >= 0 ? bulletAngleToHeadDeg(e.dir, e.yaw, e.pitch, e.aimDYaw, e.aimDPitch, this.scratch) : Infinity;
    // Read now: a killing shot's target is dead by the time its impact arrives.
    this.pAimMoving = e.aimTargetId >= 0 && this.motion.speed(e.aimTargetId) >= this.cfg.movingEchoMps;
    if (e.moving) {
      this.planted = 0;
      this.sectorMoving++;
    }
  }

  private shotImpact(e: MedalEvents['shotImpact']): void {
    if (!this.pending || e.shotId !== this.pId) return;
    this.pending = false;
    this.resolveShot(e.result === 'hit' && e.targetId >= 0 ? e.targetId : -1, e.zone, e.tick);
  }

  /** A shot with no impact event (it left the range): resolved as a miss. */
  private flushPending(): void {
    if (!this.pending) return;
    this.pending = false;
    this.resolveShot(-1, null, this.lastTick);
  }

  private resolveShot(hitTarget: number, zone: HitZone | null, tick: number): void {
    const hit = hitTarget >= 0;
    const at = hit ? hitTarget : this.pEngaged ? this.pAimTarget : -1;
    const first = at >= 0 && this.tally.count(at) === 0;
    if (at >= 0) this.tally.add(at);

    if (this.on('needle')) {
      if (hit && zone === 'head' && first) {
        if (++this.needle >= this.cfg.needleHeadshots) {
          this.needle = 0;
          this.award('needle', tick);
        }
      } else this.needle = 0;
    }

    if (hit) this.sectorHits++;
    else this.sectorMisses++;

    if (hit && zone === 'head' && first && this.pAimMoving && this.pAimTarget === hitTarget && this.pHeadDeg <= this.cfg.hairlineDeg && this.on('hairline')) {
      this.award('hairline', tick);
    }

    if (this.on('thread')) this.spray(hit && (zone === 'head' || zone === 'body'), tick);
  }

  private resetSpray(): void {
    this.sprayN = 0;
    this.sprayOk = false;
    this.sprayAwarded = false;
    this.sprayLast = -1;
  }

  private spray(landed: boolean, tick: number): void {
    const i = this.pIndex;
    if (i === 0 || i <= this.sprayLast) {
      this.sprayN = 0;
      this.sprayOk = true;
      this.sprayAwarded = false;
    }
    this.sprayLast = i;
    this.sprayN++;
    if (i >= this.cfg.threadFreeBullets && !landed) this.sprayOk = false;
    if (this.sprayOk && !this.sprayAwarded && this.sprayN >= this.cfg.threadMinBullets) {
      this.sprayAwarded = true;
      this.award('thread', tick);
    }
  }

  // ---- kills and targets -----------------------------------------------------------------------

  private killed(e: MedalEvents['targetKilled']): void {
    if (this.on('coldOpen')) {
      if (e.firstBullet) {
        if (++this.coldOpen >= this.cfg.coldOpenKills) {
          this.coldOpen = 0;
          this.award('coldOpen', e.tick);
        }
      } else this.coldOpen = 0;
    }
    if (this.on('planted') && ++this.planted >= this.cfg.plantedKills) {
      this.planted = 0;
      this.award('planted', e.tick);
    }
  }

  // ---- contacts --------------------------------------------------------------------------------

  private contact(e: MedalEvents['contactSettled']): void {
    this.flushPending();
    this.resetSpray(); // a spray belongs to one fight
    if (e.outcome !== 'cleared' || e.kept < this.cfg.untouchedKept) return;
    if (this.on('cleanCorner') && ++this.cleanContacts >= this.cfg.cleanCornerContacts) {
      this.cleanContacts = 0;
      this.award('cleanCorner', e.tick);
    }
    if (e.enemies >= this.cfg.untouchedEnemies && this.on('untouched')) {
      this.award('untouched', e.tick);
    }
  }

  // ---- sectors and the run's end ----------------------------------------------------------------

  private sectorBegan(e: MedalEvents['sectorEntered']): void {
    this.flushPending();
    this.sectorIndex = e.index + 1; // 1-based from here: the Finale is sector 6
    this.sectorHits = this.sectorMisses = this.sectorMoving = 0;
  }

  private sectorEnd(e: MedalEvents['sectorEnded']): void {
    this.flushPending();
    if (!e.cleared) return;
    if (this.on('flawless') && this.sectorMisses === 0 && this.sectorMoving === 0 && this.sectorHits >= this.cfg.flawlessSectorMinHits) {
      this.award('flawless', e.tick);
    }
    if (this.on('closer') && this.sectorIndex === this.finaleSector) this.award('closer', e.tick);
  }

  private banked(e: MedalEvents['runBanked']): void {
    if (this.on('cashed') && e.overtimeSectors > 0 && e.points > 0) this.award('cashed', e.tick);
  }

  // ---- Pendulum --------------------------------------------------------------------------------

  private aimOn(e: MedalEvents['aimOnTarget']): void {
    this.aimId = e.on ? e.id : -1;
    this.trackOn(e.tick);
  }

  /** Time on target only counts against a strafing Echo: open or close the on-interval as the state at `tick` says. */
  private trackOn(tick: number): void {
    if (!this.on('pendulum')) return;
    const want = this.aimId >= 0 && this.motion.strafing(this.aimId);
    const open = this.onCount > 0 && this.onEnd[this.onCount - 1] === -1;
    if (want && !open) {
      if (this.onCount === RING) this.dropOldest();
      this.onStart[this.onCount] = tick;
      this.onEnd[this.onCount] = -1;
      this.onCount++;
    } else if (!want && open) {
      this.onEnd[this.onCount - 1] = tick;
    }
  }

  private dropOldest(): void {
    this.onStart.copyWithin(0, 1);
    this.onEnd.copyWithin(0, 1);
    this.onCount--;
  }

  /** Is the aim on target for `pendulumFraction` of the `pendulumWindowSec` ending at `tick`? */
  private checkPendulum(tick: number): void {
    const from = tick - this.windowTicks;
    if (from < this.windowFrom || this.onCount === 0) return;
    let on = 0;
    for (let i = 0; i < this.onCount; i++) {
      const s = this.onStart[i]!;
      const end = this.onEnd[i]!;
      const e = end === -1 ? tick : end;
      const lo = s > from ? s : from;
      const hi = e < tick ? e : tick;
      if (hi > lo) on += hi - lo;
    }
    if (on >= this.windowTicks * this.cfg.pendulumFraction) {
      this.windowFrom = tick; // a fresh window: the next award needs another full window
      this.onCount = this.onCount > 0 && this.onEnd[this.onCount - 1] === -1 ? 1 : 0;
      if (this.onCount === 1) {
        this.onStart[0] = tick;
        this.onEnd[0] = -1;
      }
      this.award('pendulum', tick);
    }
  }
}

// ---------------------------------------------------------------- end-of-run medals

/** What the finished run offers the medal that needs the whole run. */
export interface EndOfRunInput {
  /** Median time to shot of the run, ms, and how many targets it is over. */
  medianRtMs: number | null;
  timedTargets: number;
  /** The median time to shot of each of the player's previous runs (newest last), ms; runs with none are left out. */
  previousMedianRtMs: readonly number[];
}

function medianOf(values: readonly number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Quick Study, as a pure function of the finished run (design §8.4): the median time to shot beats the recent median by 10%. */
export function endOfRunMedals(input: EndOfRunInput, cfg: MedalTunables = defaultMedals): MedalId[] {
  const out: MedalId[] = [];
  if (input.medianRtMs !== null && input.timedTargets >= cfg.quickStudyMinTargets) {
    const recent = input.previousMedianRtMs.slice(-cfg.quickStudyWindow);
    if (recent.length >= cfg.quickStudyMinRuns && input.medianRtMs < medianOf(recent) * (1 - cfg.quickStudyImprovement)) out.push('quickStudy');
  }
  return out;
}

// ---------------------------------------------------------------- replay

export interface MedalAward {
  id: MedalId;
  tick: number;
}

/**
 * Replay a recorded run through a fresh engine: the in-run medals it would have awarded, in order.
 * (`endOfRunMedals` and the rank-up are separate: they need history the log does not hold; Hairline and Pendulum need `motion`, which the log does not carry.)
 */
export function medalsOfLog(
  log: RunLog, cfg: MedalTunables = defaultMedals, shotAtDeg: number = defaultTargets.shotAtDeg,
  finaleSector: number = defaultSweep.finaleSector, motion: TargetMotion = NO_MOTION,
): MedalAward[] {
  const out: MedalAward[] = [];
  const engine = new MedalEngine((id, tick) => out.push({ id, tick }), cfg, shotAtDeg, finaleSector, motion);
  engine.begin(log.mode);
  for (const ev of log.events) {
    const type = ev.type as string;
    if (!(MEDAL_EVENT_TYPES as readonly string[]).includes(type)) continue;
    const data = ev.data as { tick: number };
    engine.advance(data.tick);
    engine.observe(type as MedalEventType, data as never);
  }
  return out;
}
