import { RAD2DEG } from '../core/math';
import { secondsToTicks, TICK_DT } from '../core/time';
import { directionFromAngles, dot, vec3, type Vec3 } from '../core/vec3';
import { medals as defaultMedals, MEDAL_IDS, type MedalId, type MedalTunables } from '../config/medals';
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
 * The two medals that need more than the event stream are pure functions of the finished run:
 * `endOfRunMedals` (Flawless, Quick Study: they read the run's stats and the history of the mode).
 * Ascent (a rank-up) is decided by `progress/ranks.ts`.
 *
 * Pure: no DOM, no clock, no randomness. Allocation-free per event after construction apart from
 * the per-run reset; the engine never allocates per tick.
 *
 * Choices where the design table is open to reading (all on #38): *Needle* counts first-bullet
 * headshots in a row and any other shot breaks it; *Cold Open* counts targets, so a target that
 * left unkilled breaks it too; *Planted* is kills in a row with no moving shot fired in between
 * (Stop & Pop's stance check, which the log does not carry, is not applied); *Hairline* measures
 * where the bullet went, spread included; *Thread* awards once the qualifying spray reaches its
 * minimum length; *Clean Corner* is cumulative within a run.
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
  aimOnTarget: { tick: number; on: boolean };
  contactSettled: { tick: number; outcome: 'cleared' | 'disengaged' | 'avoided' | 'died'; kept: number; enemies: number };
}
export type MedalEventType = keyof MedalEvents;
export const MEDAL_EVENT_TYPES: readonly MedalEventType[] = [
  'runStarted', 'runEnded', 'shotFired', 'shotImpact', 'targetKilled', 'targetExpired', 'aimOnTarget', 'contactSettled',
];

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

/** Are all `k - 1` gaps between `k` times within `tolerance` of their mean (and the mean at least `minMean`)? Times in seconds. */
export function isMetronome(timesSec: ArrayLike<number>, count: number, tolerance: number, minMeanSec: number): boolean {
  if (count < 3) return false;
  const first = timesSec[0]!;
  const mean = (timesSec[count - 1]! - first) / (count - 1);
  if (!(mean >= minMeanSec)) return false;
  for (let i = 1; i < count; i++) {
    const gap = timesSec[i]! - timesSec[i - 1]!;
    if (Math.abs(gap - mean) > mean * tolerance + 1e-9) return false;
  }
  return true;
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

  private needle = 0;
  private coldOpen = 0;
  private planted = 0;
  private cleanCorner = 0;
  // spray (Thread)
  private sprayN = 0;
  private sprayOk = false;
  private sprayAwarded = false;
  private sprayLast = -1;
  // Metronome: kill times (seconds), oldest first
  private readonly kills: Float64Array;
  private killCount = 0;
  // Pendulum: on intervals [start, end) in ticks; end = -1 while open
  private readonly onStart = new Int32Array(RING);
  private readonly onEnd = new Int32Array(RING);
  private onCount = 0;
  private windowFrom = 0;
  private lastTick = -1;

  live = false;

  constructor(
    private readonly award: AwardFn,
    private readonly cfg: MedalTunables = defaultMedals,
    shotAtDeg: number = defaultTargets.shotAtDeg,
  ) {
    this.engageRad = (shotAtDeg * Math.PI) / 180;
    this.windowTicks = secondsToTicks(cfg.pendulumWindowSec);
    this.kills = new Float64Array(Math.max(3, cfg.metronomeKills));
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
    this.needle = this.coldOpen = this.planted = this.cleanCorner = 0;
    this.sprayN = 0;
    this.sprayOk = false;
    this.sprayAwarded = false;
    this.sprayLast = -1;
    this.killCount = 0;
    this.onCount = 0;
    this.windowFrom = 0;
    this.lastTick = -1;
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
    for (let t = this.lastTick + 1; t <= tick; t++) this.checkPendulum(t);
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
    if (e.moving) this.planted = 0;
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

    if (hit && zone === 'head' && this.pAimTarget === hitTarget && this.pHeadDeg <= this.cfg.hairlineDeg && this.on('hairline')) {
      this.award('hairline', tick);
    }

    if (this.on('thread')) this.spray(hit && (zone === 'head' || zone === 'body'), tick);
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
    if (this.on('metronome')) this.metronome(e.tick);
  }

  private metronome(tick: number): void {
    const want = this.kills.length;
    if (this.killCount === want) {
      this.kills.copyWithin(0, 1);
      this.killCount = want - 1;
    }
    this.kills[this.killCount++] = tick * TICK_DT;
    if (this.killCount === want && isMetronome(this.kills, want, this.cfg.metronomeTolerance, this.cfg.metronomeMinMeanSec)) {
      this.killCount = 0;
      this.award('metronome', tick);
    }
  }

  // ---- contacts --------------------------------------------------------------------------------

  private contact(e: MedalEvents['contactSettled']): void {
    if (e.outcome !== 'cleared' || e.kept < this.cfg.untouchedKept) return;
    if (this.on('cleanCorner') && ++this.cleanCorner >= this.cfg.cleanCornerAngles) {
      this.cleanCorner = 0;
      this.award('cleanCorner', e.tick);
    }
    if (e.enemies >= this.cfg.untouchedEnemies && this.on('untouched')) {
      this.award('untouched', e.tick);
    }
  }

  // ---- Pendulum --------------------------------------------------------------------------------

  private aimOn(e: MedalEvents['aimOnTarget']): void {
    if (!this.on('pendulum')) return;
    const open = this.onCount > 0 && this.onEnd[this.onCount - 1] === -1;
    if (e.on && !open) {
      if (this.onCount === RING) this.dropOldest();
      this.onStart[this.onCount] = e.tick;
      this.onEnd[this.onCount] = -1;
      this.onCount++;
    } else if (!e.on && open) {
      this.onEnd[this.onCount - 1] = e.tick;
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

/** What the finished run offers the medals that need the whole run. */
export interface EndOfRunInput {
  mode: string;
  /** Ended by its timer or completed; a quit or a death is not a full run. */
  fullRun: boolean;
  hits: number;
  /** Shots that hit nothing (stats `misses`). */
  misses: number;
  movingShots: number;
  /** Median time to shot of the run, ms, and how many targets it is over. */
  medianRtMs: number | null;
  timedTargets: number;
  /** The median time to shot of each of the mode's previous runs (newest last), ms; runs with none are left out. */
  previousMedianRtMs: readonly number[];
}

function medianOf(values: readonly number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Flawless and Quick Study, as pure functions of the finished run (design §8.4). */
export function endOfRunMedals(input: EndOfRunInput, cfg: MedalTunables = defaultMedals): MedalId[] {
  const out: MedalId[] = [];
  if (input.fullRun && input.misses === 0 && input.movingShots === 0 && input.hits >= cfg.flawlessMinHits) out.push('flawless');
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
 * (`endOfRunMedals` and the rank-up are separate: they need history the log does not hold.)
 */
export function medalsOfLog(log: RunLog, cfg: MedalTunables = defaultMedals, shotAtDeg: number = defaultTargets.shotAtDeg): MedalAward[] {
  const out: MedalAward[] = [];
  const engine = new MedalEngine((id, tick) => out.push({ id, tick }), cfg, shotAtDeg);
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
