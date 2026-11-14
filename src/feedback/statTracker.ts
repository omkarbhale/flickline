import type { Subscribable } from '../core/eventBus';
import { DEG2RAD, RAD2DEG, mean, median } from '../core/math';
import { TICK_DT } from '../core/time';
import { run as defaultRun, type RunTunables } from '../config/run';
import { scoring as defaultScoring, type ScoringTunables } from '../config/scoring';
import { sprayTrace as defaultSprayTrace, type SprayTraceTunables } from '../config/sprayTrace';
import { targets as defaultTargets, type TargetTunables } from '../config/targets';
import { wrapPi, yawOf } from '../sim/aim';
import type { RunEndReason, RunEvents } from '../sim/runEvents';
import type { HitZone, SimEvents, TargetKind } from '../sim/types';

/** A target kind, or 'unknown' when the log has no spawn event for it. */
type StatKind = TargetKind | 'unknown';

/** The tunables the stat definitions read (`Tunables` satisfies it). */
export interface StatConfig {
  run: RunTunables;
  targets: Pick<TargetTunables, 'shotAtDeg' | 'reactionAimDeg'>;
  scoring: Pick<ScoringTunables, 'chainWindowSec'>;
  sprayTrace: SprayTraceTunables;
}

export const defaultStatConfig: StatConfig = { run: defaultRun, targets: defaultTargets, scoring: defaultScoring, sprayTrace: defaultSprayTrace };
import type { LoggedEvent, RunLog } from './eventLog';
import {
  collapseIndex, sprayHitRateByIndex, sprayPullErrorByIndex, type SprayBulletTrace, type SprayRecord,
} from './sprayTrace';

type AllEvents = SimEvents & RunEvents;

/** Per-target engagement summary (one per spawn): the timeline strip and per-kill numbers. */
export interface TargetStat {
  id: number;
  kind: StatKind;
  /** Tick it became visible (-1 never). */
  visibleTick: number;
  /** Visible -> first shot aimed within the RT cone, ms; null if never shot at. */
  rtMs: number | null;
  /** First shot at it (hit, or within the engage cone) -> death, ms; null unless killed. */
  ttkMs: number | null;
  /** Shots at it (hit, or aimed within the engage cone). */
  bullets: number;
  hits: number;
  misses: number;
  /** Moving shots among `bullets`. */
  movingShots: number;
  killed: boolean;
  expired: boolean;
  /** Killed by the first bullet at it. */
  firstBullet: boolean;
  /** Killed with no missed and no moving shot at it. */
  clean: boolean;
  /** Zone of the killing shot (null if not killed). */
  zone: HitZone | null;
  /** The target had a shield (spec §4.1): bullet counts against it are not the unarmoured ones. */
  armoured: boolean;
  /** Angle between aim and aim point when it became visible, degrees. */
  preAimDeg: number | null;
  /** Signed overshoot (+) / undershoot (-) along the flick axis at the first aimed shot, degrees. */
  flickErrorDeg: number | null;
}

/** One bullet of a burst, relative to the aim point of the burst's first bullet (degrees). */
export interface SprayBullet {
  /** Recoil index = position in the burst (0 = first bullet). */
  index: number;
  /** Where the bullet went (view + spread/recoil) minus where the first bullet's view pointed. */
  impactYawDeg: number;
  impactPitchDeg: number;
  /** How far the player's view has been pulled since the first bullet. */
  pullYawDeg: number;
  pullPitchDeg: number;
  hit: boolean;
}

/**
 * Every stat of design §3, for one run. `null` = undefined for this run (no shots, no hits, no
 * samples): UI shows a dash, never a fake zero.
 */
export interface RunStats {
  mode: string;
  seed: number;
  dial: number;
  endReason: RunEndReason | null;
  liveTicks: number;
  durationSec: number;

  shots: number;
  hits: number;
  misses: number;
  headHits: number;
  bodyHits: number;
  legHits: number;
  kills: number;
  cleanKills: number;
  movingShots: number;

  /** hits / shots. */
  accuracy: number | null;
  /** head hits / hits. */
  headshotRate: number | null;
  /** Median of per-target RT. */
  medianRtMs: number | null;
  /** Median of per-kill TTK. */
  medianTtkMs: number | null;
  /** Fraction of live ticks the aim ray was within the padded hit volume of a visible target. */
  timeOnTarget: number | null;
  /** Median ms from stop/counter-strafe input to speed at or below the accuracy threshold. */
  medianStopLatencyMs: number | null;
  stopCount: number;
  /** Median over targets of the aim error at the tick the target became visible. */
  preAimErrorDeg: number | null;
  /** Mean absolute vertical angle between the aim ray and head-centre height while moving, nobody in view. */
  headHeightDisciplineDeg: number | null;
  headHeightSamples: number;
  /**
   * Mean signed lead error against a strafing target and mean absolute lead error, degrees. + = the crosshair
   * ran AHEAD of the Strafer (leading), - = BEHIND it (lagging). Null with no samples.
   */
  leadErrorBiasDeg: number | null;
  leadErrorMeanAbsDeg: number | null;
  leadSamples: number;
  /** Mean signed flick error (+ overshoot) and mean absolute flick error, degrees. */
  flickErrorBiasDeg: number | null;
  flickErrorMeanAbsDeg: number | null;
  flickCount: number;
  /** Longest chain (kills each within the chain window of the previous; a lone kill is 1). */
  maxChain: number;
  maxCleanStreak: number;
  /** Clean streak when the run ended. */
  cleanStreak: number;

  targets: TargetStat[];
  sprayBursts: SprayBullet[][];
  /**
   * The run's sprays (design §3), in order: one record each with the per-bullet spray trace
   * (impact offset, the player's pull and the spec's required counter-pull, see `sprayTrace.ts`).
   * Empty in every other mode. For the results card (#39).
   */
  sprays: SprayRecord[];
  /** Hit rate of each bullet index over the sprays (null = no spray reached it). */
  sprayHitRateByIndex: (number | null)[];
  /** Mean absolute vertical pull error (degrees) of each bullet index. */
  sprayPullErrorByIndex: (number | null)[];
  /** First bullet index where the hit rate falls below the limit and stays there; null if it never does. */
  sprayCollapseIndex: number | null;
  /** First bullet index where the pull error rises above the tolerance and stays there; null if it never does. */
  sprayPullFallsApartIndex: number | null;
  /**
   * Sweep (design §4): sectors entered (the depth reached, 1-based) out of the run's sectors, and
   * sectors cleared; contacts won (cleared) and lost (died in, or left while losing, design §8.1).
   * All 0 outside Sweep.
   */
  sectorsReached: number;
  sectorsTotal: number;
  sectorsCleared: number;
  contactsWon: number;
  contactsLost: number;
}

interface Engagement {
  id: number;
  kind: StatKind;
  visibleTick: number;
  preAim: number;
  visDYaw: number;
  visDPitch: number;
  rtTick: number;
  firstEngageTick: number;
  bullets: number;
  hits: number;
  misses: number;
  moving: number;
  flickError: number | null;
  killed: boolean;
  expired: boolean;
  zone: HitZone | null;
  armoured: boolean;
  firstBullet: boolean;
  clean: boolean;
  ttkMs: number | null;
}

function openEngagement(id: number, kind: StatKind): Engagement {
  return {
    id, kind, visibleTick: -1, preAim: 0, visDYaw: 0, visDPitch: 0, rtTick: -1, firstEngageTick: -1,
    bullets: 0, hits: 0, misses: 0, moving: 0, flickError: null, killed: false, expired: false,
    zone: null, armoured: false, firstBullet: false, clean: false, ttkMs: null,
  };
}

/**
 * The single implementation of every stat definition (design §3). It is incremental, so the HUD
 * reads live numbers from it during a run, and `computeStats(log)` replays a recorded log into a
 * fresh one, so the live and the end-of-run numbers cannot disagree. Pure: no DOM, no clock.
 *
 * Chain and clean streak are tracked here for the stats; the live counters that drive the score
 * multiplier and their events belong to `feedback/streaks.ts` (mode framework).
 *
 * Allocation: per shot / kill / spawn (small objects, bounded by the run), never per tick or
 * per frame. Events before `runStarted` and after `runEnded` are ignored.
 *
 * Attribution rules (documented because they are judgment calls on the design text):
 *  - A shot is "at" a target if it hit it, or its view ray passed within `targets.shotAtDeg` of the
 *    target's head centre (nearest visible target only). RT uses `targets.reactionAimDeg` the same way.
 *  - A clean streak breaks on a non-clean kill or on a target expiring; a miss at no target
 *    cannot be attributed and does not break it.
 */
export class StatTracker {
  mode = '';
  seed = 0;
  dial = 0;

  private started = false;
  private ended = false;
  private endReason: RunEndReason | null = null;
  private liveStartTick = 0;
  private endTick = 0;
  private lastTick = 0;

  shots = 0;
  hits = 0;
  kills = 0;
  cleanKills = 0;
  movingShots = 0;
  private headHits = 0;
  private bodyHits = 0;
  private legHits = 0;

  /** Current chain count (0 before the first kill) and clean streak. */
  chain = 0;
  streak = 0;
  private maxChain = 0;
  private maxStreak = 0;
  private lastKillTick = -1;

  private readonly open = new Map<number, Engagement>();
  private finished: Engagement[] = [];
  private bursts: SprayBullet[][] = [];
  private burstFirstYaw = 0;
  private burstFirstPitch = 0;
  private lastShot = { id: -1, aimedId: -1, moving: false };
  private sprays: SprayRecord[] = [];
  /** The spray in progress (between `sprayStarted` and `sprayEnded`), or null. */
  private spray: SprayRecord | null = null;
  private sprayShotId = -1;
  private sprayFirstTick = 0;
  private sprayFirstYaw = 0;
  private sprayFirstPitch = 0;
  private sprayFirstRecoilX = 0;
  private sprayFirstRecoilY = 0;

  private aimOn = false;
  private aimOnStart = 0;
  private aimOnTicks = 0;
  private headHeightSum = 0;
  private headHeightN = 0;
  private leadSum = 0;
  private leadAbsSum = 0;
  private leadN = 0;
  private stopLatencies: number[] = [];
  private sectorsReached = 0;
  private sectorsTotal = 0;
  private sectorsCleared = 0;
  private contactsWon = 0;
  private contactsLost = 0;

  constructor(private readonly cfg: StatConfig = defaultStatConfig) {}

  get accuracy(): number | null {
    return this.shots === 0 ? null : this.hits / this.shots;
  }

  /** True between `runStarted` and `runEnded`. */
  get isLive(): boolean {
    return this.started && !this.ended;
  }

  reset(mode = '', seed = 0, dial = 0): void {
    this.mode = mode;
    this.seed = seed;
    this.dial = dial;
    this.started = this.ended = false;
    this.endReason = null;
    this.liveStartTick = this.endTick = this.lastTick = 0;
    this.shots = this.hits = this.kills = this.cleanKills = this.movingShots = 0;
    this.headHits = this.bodyHits = this.legHits = 0;
    this.chain = this.streak = this.maxChain = this.maxStreak = 0;
    this.lastKillTick = -1;
    this.open.clear();
    this.finished = [];
    this.bursts = [];
    this.lastShot = { id: -1, aimedId: -1, moving: false };
    this.sprays = [];
    this.spray = null;
    this.aimOn = false;
    this.aimOnStart = this.aimOnTicks = 0;
    this.headHeightSum = this.headHeightN = 0;
    this.leadSum = this.leadAbsSum = this.leadN = 0;
    this.stopLatencies = [];
    this.sectorsReached = this.sectorsTotal = this.sectorsCleared = this.contactsWon = this.contactsLost = 0;
  }

  /** Live subscription to the bus. Returns the unsubscribe function. */
  attach(bus: Subscribable<AllEvents>): () => void {
    const offs = [
      bus.on('runStarted', (e) => this.onRunStarted(e)),
      bus.on('runEnded', (e) => this.onRunEnded(e)),
      bus.on('targetSpawned', (e) => this.onTargetSpawned(e)),
      bus.on('targetVisible', (e) => this.onTargetVisible(e)),
      bus.on('shotFired', (e) => this.onShotFired(e)),
      bus.on('shotImpact', (e) => this.onShotImpact(e)),
      bus.on('targetKilled', (e) => this.onTargetKilled(e)),
      bus.on('targetExpired', (e) => this.onTargetExpired(e)),
      bus.on('aimOnTarget', (e) => this.onAimOnTarget(e)),
      bus.on('leadSampled', (e) => this.onLead(e)),
      bus.on('headHeightSampled', (e) => this.onHeadHeight(e)),
      bus.on('playerStopped', (e) => this.onPlayerStopped(e)),
      bus.on('sprayStarted', (e) => this.onSprayStarted(e)),
      bus.on('sprayEnded', (e) => this.onSprayEnded(e)),
      bus.on('sectorEntered', (e) => this.onSectorEntered(e)),
      bus.on('sectorEnded', (e) => this.onSectorEnded(e)),
      bus.on('contactSettled', (e) => this.onContactSettled(e)),
    ];
    return () => offs.forEach((f) => f());
  }

  /** Feed one logged event (replay). */
  consume(ev: LoggedEvent): void {
    switch (ev.type) {
      case 'runStarted': this.onRunStarted(ev.data); break;
      case 'runEnded': this.onRunEnded(ev.data); break;
      case 'targetSpawned': this.onTargetSpawned(ev.data); break;
      case 'targetVisible': this.onTargetVisible(ev.data); break;
      case 'shotFired': this.onShotFired(ev.data); break;
      case 'shotImpact': this.onShotImpact(ev.data); break;
      case 'targetKilled': this.onTargetKilled(ev.data); break;
      case 'targetExpired': this.onTargetExpired(ev.data); break;
      case 'aimOnTarget': this.onAimOnTarget(ev.data); break;
      case 'leadSampled': this.onLead(ev.data); break;
      case 'headHeightSampled': this.onHeadHeight(ev.data); break;
      case 'playerStopped': this.onPlayerStopped(ev.data); break;
      case 'sprayStarted': this.onSprayStarted(ev.data); break;
      case 'sprayEnded': this.onSprayEnded(ev.data); break;
      case 'sectorEntered': this.onSectorEntered(ev.data); break;
      case 'sectorEnded': this.onSectorEnded(ev.data); break;
      case 'contactSettled': this.onContactSettled(ev.data); break;
      default: break;
    }
  }

  // --- handlers -----------------------------------------------------------------------------

  private live(tick: number): boolean {
    if (!this.started || this.ended) return false;
    if (tick > this.lastTick) this.lastTick = tick;
    return true;
  }

  private onRunStarted(e: AllEvents['runStarted']): void {
    if (this.started) return;
    this.started = true;
    this.liveStartTick = this.lastTick = e.tick;
  }

  private onRunEnded(e: AllEvents['runEnded']): void {
    if (this.ended) return;
    this.lastTick = Math.max(this.lastTick, e.tick);
    this.endTick = e.tick;
    this.endReason = e.reason;
    this.ended = true;
    if (this.aimOn) {
      this.aimOnTicks += e.tick - this.aimOnStart;
      this.aimOn = false;
    }
  }

  private engagement(id: number, kind: StatKind = 'unknown'): Engagement {
    let g = this.open.get(id);
    if (!g) {
      g = openEngagement(id, kind);
      this.open.set(id, g);
    }
    return g;
  }

  private onTargetSpawned(e: AllEvents['targetSpawned']): void {
    if (!this.live(e.tick)) return;
    const prev = this.open.get(e.targetId);
    if (prev && (prev.visibleTick >= 0 || prev.bullets > 0)) this.finished.push(prev);
    this.open.set(e.targetId, openEngagement(e.targetId, e.kind));
  }

  private onTargetVisible(e: AllEvents['targetVisible']): void {
    if (!this.live(e.tick)) return;
    const g = this.engagement(e.targetId);
    if (g.visibleTick >= 0) return;
    g.visibleTick = e.tick;
    g.preAim = e.preAim;
    g.visDYaw = e.dYaw;
    g.visDPitch = e.dPitch;
  }

  private onShotFired(e: AllEvents['shotFired']): void {
    if (!this.live(e.tick)) return;
    this.shots++;
    if (e.moving) this.movingShots++;

    // Spray trace: bullets of a burst relative to the first bullet's aim.
    if (e.recoilIndex === 0 || this.bursts.length === 0) {
      this.bursts.push([]);
      this.burstFirstYaw = e.yaw;
      this.burstFirstPitch = e.pitch;
    }
    const bulletYaw = yawOf(e.dir.x, e.dir.z);
    const bulletPitch = Math.asin(Math.max(-1, Math.min(1, e.dir.y)));
    this.bursts[this.bursts.length - 1]!.push({
      index: e.recoilIndex,
      impactYawDeg: wrapPi(bulletYaw - this.burstFirstYaw) * RAD2DEG,
      impactPitchDeg: (bulletPitch - this.burstFirstPitch) * RAD2DEG,
      pullYawDeg: wrapPi(e.yaw - this.burstFirstYaw) * RAD2DEG,
      pullPitchDeg: (e.pitch - this.burstFirstPitch) * RAD2DEG,
      hit: false,
    });

    this.recordSprayBullet(e, bulletYaw, bulletPitch);

    let aimedId = -1;
    if (e.aimTargetId >= 0) {
      const g = this.engagement(e.aimTargetId);
      if (e.aimErr <= this.cfg.targets.reactionAimDeg * DEG2RAD && g.visibleTick >= 0 && g.rtTick < 0) {
        g.rtTick = e.tick;
        g.flickError = this.flickError(g, e);
      }
      if (e.aimErr <= this.cfg.targets.shotAtDeg * DEG2RAD) {
        aimedId = e.aimTargetId;
        g.bullets++;
        g.misses++; // provisional: a hit impact for this shot converts it
        if (e.moving) g.moving++;
        if (g.firstEngageTick < 0) g.firstEngageTick = e.tick;
      }
    }
    this.lastShot = { id: e.shotId, aimedId, moving: e.moving };
  }

  // --- Sprays (design §3): cut the shots into sprays and fill the spray trace ----------

  private onSprayStarted(e: AllEvents['sprayStarted']): void {
    if (!this.live(e.tick)) return;
    this.spray = {
      index: e.index, station: e.station, distanceM: e.distanceM, burst: e.burst, requiredFraction: e.requiredFraction,
      fired: 0, hits: 0, headHits: 0, bodyHits: 0, fraction: 0, success: false, reason: 'burst', trace: [],
    };
    this.sprayShotId = -1;
  }

  private onSprayEnded(e: AllEvents['sprayEnded']): void {
    const r = this.spray;
    if (!r || !this.live(e.tick)) return;
    r.fired = e.bullets;
    r.hits = e.hits;
    r.headHits = e.headHits;
    r.bodyHits = e.bodyHits;
    r.fraction = e.fraction;
    r.success = e.success;
    r.reason = e.reason;
    this.sprays.push(r);
    this.spray = null;
  }

  /** The bullet just fired belongs to the spray in progress: its impact, the player's pull and the required pull. */
  private recordSprayBullet(e: AllEvents['shotFired'], bulletYaw: number, bulletPitch: number): void {
    const r = this.spray;
    if (!r || r.trace.length >= r.burst) return;
    if (r.trace.length === 0) {
      this.sprayFirstTick = e.tick;
      this.sprayFirstYaw = e.yaw;
      this.sprayFirstPitch = e.pitch;
      this.sprayFirstRecoilX = e.recoilYawDeg;
      this.sprayFirstRecoilY = e.recoilPitchDeg;
    }
    const cosP = Math.cos(this.sprayFirstPitch);
    const b: SprayBulletTrace = {
      index: r.trace.length,
      tMs: (e.tick - this.sprayFirstTick) * TICK_DT * 1000,
      impactXDeg: -wrapPi(bulletYaw - this.sprayFirstYaw) * RAD2DEG * cosP,
      impactYDeg: (bulletPitch - this.sprayFirstPitch) * RAD2DEG,
      pullXDeg: -wrapPi(e.yaw - this.sprayFirstYaw) * RAD2DEG * cosP,
      pullYDeg: (e.pitch - this.sprayFirstPitch) * RAD2DEG,
      requiredPullXDeg: -(e.recoilYawDeg - this.sprayFirstRecoilX),
      requiredPullYDeg: -(e.recoilPitchDeg - this.sprayFirstRecoilY),
      spreadDeg: e.spreadDeg,
      hit: false,
      zone: null,
    };
    r.trace.push(b);
    this.sprayShotId = e.shotId;
  }

  private markSprayImpact(e: AllEvents['shotImpact']): void {
    const r = this.spray;
    if (!r || e.shotId !== this.sprayShotId) return;
    const b = r.trace[r.trace.length - 1];
    if (!b || e.result !== 'hit' || e.targetId < 0) return;
    b.zone = e.zone;
    b.hit = e.zone === 'head' || e.zone === 'body';
  }

  private flickError(g: Engagement, e: AllEvents['shotFired']): number | null {
    const len = Math.hypot(g.visDYaw, g.visDPitch);
    if (len < this.cfg.run.flickMinDeg * DEG2RAD) return null;
    // aim - target = -(aimD*); project on the flick axis (the direction the crosshair had to travel).
    const along = (-e.aimDYaw * g.visDYaw - e.aimDPitch * g.visDPitch) / len;
    return along * RAD2DEG;
  }

  private onShotImpact(e: AllEvents['shotImpact']): void {
    if (!this.live(e.tick) || e.shotId !== this.lastShot.id) return;
    this.markSprayImpact(e);
    if (e.result !== 'hit') return;
    this.hits++;
    if (e.zone === 'head') this.headHits++;
    else if (e.zone === 'leg') this.legHits++;
    else this.bodyHits++;
    const burst = this.bursts[this.bursts.length - 1];
    if (burst && burst.length > 0) burst[burst.length - 1]!.hit = true;

    if (e.targetId < 0) return;
    const g = this.engagement(e.targetId);
    if (this.lastShot.aimedId === e.targetId) {
      g.misses--;
    } else {
      g.bullets++;
      if (this.lastShot.moving) g.moving++;
      if (g.firstEngageTick < 0) g.firstEngageTick = e.tick;
      if (g.rtTick < 0 && g.visibleTick >= 0) g.rtTick = e.tick;
    }
    g.hits++;
  }

  private onTargetKilled(e: AllEvents['targetKilled']): void {
    if (!this.live(e.tick)) return;
    const g = this.engagement(e.targetId, e.kind);
    g.kind = e.kind;
    g.killed = true;
    g.zone = e.zone;
    g.armoured = e.shield > 0;
    g.ttkMs = g.firstEngageTick >= 0 ? (e.tick - g.firstEngageTick) * TICK_DT * 1000 : null;
    g.firstBullet = g.bullets === 1;
    g.clean = g.bullets > 0 && g.misses === 0 && g.moving === 0;
    this.kills++;
    if (g.clean) this.cleanKills++;

    const chainTicks = this.cfg.scoring.chainWindowSec / TICK_DT;
    this.chain = this.lastKillTick >= 0 && e.tick - this.lastKillTick <= chainTicks ? this.chain + 1 : 1;
    this.lastKillTick = e.tick;
    if (this.chain > this.maxChain) this.maxChain = this.chain;

    this.streak = g.clean ? this.streak + 1 : 0;
    if (this.streak > this.maxStreak) this.maxStreak = this.streak;

    this.finished.push(g);
    this.open.delete(e.targetId);
  }

  private onTargetExpired(e: AllEvents['targetExpired']): void {
    if (!this.live(e.tick)) return;
    const g = this.engagement(e.targetId);
    g.expired = true;
    this.open.delete(e.targetId);
    // A target the player never saw or shot at is not a miss (and leaves no record).
    if (g.visibleTick < 0 && g.bullets === 0) return;
    this.finished.push(g);
    if (this.streak > 0) {
      this.streak = 0;
      }
  }

  private onAimOnTarget(e: AllEvents['aimOnTarget']): void {
    if (!this.live(e.tick)) return;
    if (e.on && !this.aimOn) {
      this.aimOn = true;
      this.aimOnStart = e.tick;
    } else if (!e.on && this.aimOn) {
      this.aimOn = false;
      this.aimOnTicks += e.tick - this.aimOnStart;
    }
  }

  private onLead(e: AllEvents['leadSampled']): void {
    if (!this.live(e.tick)) return;
    this.leadSum += e.err;
    this.leadAbsSum += Math.abs(e.err);
    this.leadN++;
  }

  private onHeadHeight(e: AllEvents['headHeightSampled']): void {
    if (!this.live(e.tick)) return;
    this.headHeightSum += e.err;
    this.headHeightN++;
  }

  private onPlayerStopped(e: AllEvents['playerStopped']): void {
    if (!this.live(e.tick)) return;
    this.stopLatencies.push(e.latencyMs);
  }

  // --- result -------------------------------------------------------------------------------

  /** Snapshot of every stat so far (final once the run has ended). Allocates; not for per-frame use. */
  private onSectorEntered(e: AllEvents['sectorEntered']): void {
    this.sectorsReached = Math.max(this.sectorsReached, e.index + 1);
    this.sectorsTotal = e.of;
  }

  private onSectorEnded(e: AllEvents['sectorEnded']): void {
    if (e.cleared) this.sectorsCleared++;
  }

  private onContactSettled(e: AllEvents['contactSettled']): void {
    if (e.outcome === 'cleared') this.contactsWon++;
    else if (e.outcome === 'died' || e.outcome === 'disengaged') this.contactsLost++;
  }

  result(): RunStats {
    const end = this.ended ? this.endTick : this.lastTick;
    const liveTicks = this.started ? Math.max(0, end - this.liveStartTick) : 0;
    let onTicks = this.aimOnTicks;
    if (this.aimOn) onTicks += end - this.aimOnStart;
    const hitRates = sprayHitRateByIndex(this.sprays);
    const pullErrors = sprayPullErrorByIndex(this.sprays);

    const all: Engagement[] = this.finished.slice();
    this.open.forEach((g) => {
      if (g.visibleTick >= 0 || g.bullets > 0) all.push(g);
    });
    const targets: TargetStat[] = all.map((g) => ({
      id: g.id,
      kind: g.kind,
      visibleTick: g.visibleTick,
      rtMs: g.rtTick >= 0 && g.visibleTick >= 0 ? (g.rtTick - g.visibleTick) * TICK_DT * 1000 : null,
      ttkMs: g.ttkMs,
      bullets: g.bullets,
      hits: g.hits,
      misses: g.misses,
      movingShots: g.moving,
      killed: g.killed,
      expired: g.expired,
      firstBullet: g.firstBullet,
      clean: g.clean,
      zone: g.zone,
      armoured: g.armoured,
      preAimDeg: g.visibleTick >= 0 ? g.preAim * RAD2DEG : null,
      flickErrorDeg: g.flickError,
    }));

    const rts: number[] = [];
    const ttks: number[] = [];
    const preAims: number[] = [];
    const flicks: number[] = [];
    for (const t of targets) {
      if (t.rtMs !== null) rts.push(t.rtMs);
      if (t.killed && t.ttkMs !== null) ttks.push(t.ttkMs);
      if (t.preAimDeg !== null) preAims.push(t.preAimDeg);
      if (t.flickErrorDeg !== null) flicks.push(t.flickErrorDeg);
    }

    return {
      mode: this.mode,
      seed: this.seed,
      dial: this.dial,
      endReason: this.endReason,
      liveTicks,
      durationSec: liveTicks * TICK_DT,
      shots: this.shots,
      hits: this.hits,
      misses: this.shots - this.hits,
      headHits: this.headHits,
      bodyHits: this.bodyHits,
      legHits: this.legHits,
      kills: this.kills,
      cleanKills: this.cleanKills,
      movingShots: this.movingShots,
      accuracy: this.shots === 0 ? null : this.hits / this.shots,
      headshotRate: this.hits === 0 ? null : this.headHits / this.hits,
      medianRtMs: median(rts),
      medianTtkMs: median(ttks),
      timeOnTarget: liveTicks === 0 ? null : onTicks / liveTicks,
      medianStopLatencyMs: median(this.stopLatencies),
      stopCount: this.stopLatencies.length,
      preAimErrorDeg: median(preAims),
      headHeightDisciplineDeg: this.headHeightN === 0 ? null : (this.headHeightSum / this.headHeightN) * RAD2DEG,
      headHeightSamples: this.headHeightN,
      leadErrorBiasDeg: this.leadN === 0 ? null : (this.leadSum / this.leadN) * RAD2DEG,
      leadErrorMeanAbsDeg: this.leadN === 0 ? null : (this.leadAbsSum / this.leadN) * RAD2DEG,
      leadSamples: this.leadN,
      flickErrorBiasDeg: mean(flicks),
      flickErrorMeanAbsDeg: mean(flicks.map(Math.abs)),
      flickCount: flicks.length,
      maxChain: this.maxChain,
      maxCleanStreak: this.maxStreak,
      cleanStreak: this.streak,
      targets,
      sprayBursts: this.bursts.map((b) => b.map((x) => ({ ...x }))),
      sprays: this.sprays.map((r) => ({ ...r, trace: r.trace.map((b) => ({ ...b })) })),
      sprayHitRateByIndex: hitRates,
      sprayPullErrorByIndex: pullErrors,
      sprayCollapseIndex: collapseIndex(hitRates, this.cfg.sprayTrace.collapseHitRate, true),
      sprayPullFallsApartIndex: collapseIndex(pullErrors, this.cfg.sprayTrace.pullToleranceDeg, false),
      sectorsReached: this.sectorsReached,
      sectorsTotal: this.sectorsTotal,
      sectorsCleared: this.sectorsCleared,
      contactsWon: this.contactsWon,
      contactsLost: this.contactsLost,
    };
  }
}

/**
 * Every stat of design §3 as a pure function of a run's event log. Replays the log through a
 * fresh `StatTracker` (the same code the live HUD reads), so it is exact by construction.
 */
export function computeStats(log: RunLog, cfg: StatConfig = defaultStatConfig): RunStats {
  const t = new StatTracker(cfg);
  t.reset(log.mode, log.seed, log.dial);
  for (let i = 0; i < log.events.length; i++) t.consume(log.events[i]!);
  return t.result();
}
