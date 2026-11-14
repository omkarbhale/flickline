import type { EventSink, Subscribable } from '../core/eventBus';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import { secondsToTicks, TICK_DT } from '../core/time';
import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import type { EnemyKind } from '../config/scoring';
import { createScoreBreakdown, scoreKill, type ScoreBreakdown } from '../feedback/scoring';
import { StreakTracker } from '../feedback/streaks';
import type {
  AnchorSource, AxisValues, DialSource, ModeEvents, MotionView, PlayerSourceEvents, RunEndReason, SkillId, SourceEvents,
  TargetSpawner,
} from './contracts';
import { effectiveDial } from './itemDifficulty';
import type { ModeContext, ModeDef, ModeEvent, ResolveOptions, RunPhase, RunStats, SpawnOptions } from './modeDef';
import { AnchorIndex, SpawnScheduler } from './scheduler';

export interface RunnerDeps {
  events: EventSink<ModeEvents>;
  tunables: Tunables;
  dial: DialSource;
  spawner: TargetSpawner;
  player: MotionView;
}

export interface RunOptions {
  seed: number;
  /** Pin the dial to a fixed value ("Pin difficulty", design §9.3): the skill model is not asked. */
  pinDial?: number;
  anchors?: AnchorSource;
}

/** One tracked target: where its trial's difficulty and skill were fixed (at spawn). */
interface TargetRecord {
  active: boolean;
  id: number;
  skill: SkillId;
  dial: number;
  itemDifficulty: number;
  /** Live tick at which it leaves unkilled; -1 = never. */
  expireTick: number;
  resolved: boolean;
  rtMs: number;
}

const MAX_TARGETS = 64;

/**
 * Runs one mode: owns the run's timing (`ready` -> `live` -> `result`), beats and the dial, the
 * spawn scheduler, target records, trials, scoring and counters. Pure and deterministic: all
 * randomness comes from the seeded stream, time is the tick count handed to `tick()`.
 *
 * Wiring (done by the app): call `tick(simTick)` once after every `world.step`, `attach(bus)` once
 * to feed it the sim's facts, and subscribe to the `ModeEvents` it emits. It does not allocate
 * per tick or per event after `begin()`.
 */
export class ModeRunner implements ModeContext<unknown> {
  phase: RunPhase = 'idle';
  mode!: ModeDef<unknown>;
  seed = 0;
  rng = new Rng(1);
  state: unknown = undefined;
  scheduler!: SpawnScheduler;
  liveTick = 0;
  beat = 0;
  dial = 0;
  itemDifficulty = 0;
  readonly axes: Record<string, number> = {};
  readonly stats: RunStats = { score: 0, kills: 0, headshotKills: 0, misses: 0, trials: 0, trialsWon: 0 };
  /** Last scored kill's terms (valid until the next kill). */
  readonly lastScore: ScoreBreakdown = createScoreBreakdown();
  surge = false;
  endReason: RunEndReason | null = null;
  /** Spawns refused by the fairness floor or a full pool (debug). */
  refusedSpawns = 0;

  readonly tunables: Tunables;
  readonly player: MotionView;
  private readonly streaks: StreakTracker;
  private readonly records: TargetRecord[] = [];
  private readonly killEv: ModeEvent & { type: 'targetKilled' };
  private readonly expiredEv: ModeEvent & { type: 'targetExpired' };
  private readonly impactEv: ModeEvent & { type: 'shotImpact' };
  private readonly firedEv: ModeEvent & { type: 'shotFired' };
  private readonly stoppedEv: ModeEvent & { type: 'playerStopped' };
  private readonly trialEv: ModeEvents['skillTrial'] = { tick: 0, t: 0, skill: 'precision', itemDifficulty: 0, success: false };
  private readonly scoreEv: ModeEvents['scoreAwarded'] = {
    tick: 0, t: 0, targetId: 0, kind: 'post', points: 0, total: 0, base: 0, precision: 1, speed: 1, streak: 1, difficulty: 1, surge: 1,
  };
  private readonly readyEv = { tick: 0, mode: '', seed: 0, dial: 0 };
  private readonly startEv = { tick: 0 };
  private readonly endEv = { tick: 0, t: 0, reason: 'timer' as RunEndReason };
  private readonly beatEv = { tick: 0, t: 0, beat: 0, dial: 0 };
  private pinDial: number | undefined;
  simTick = 0;
  private liveStartSimTick = 0;
  private readyTicksLeft = 0;
  private durationTicks = Infinity;
  private beatTicks = Infinity;
  private manualBeats = false;
  private recordsUsed = 0;
  private readonly expiredPayload = { tick: 0, targetId: 0 };
  /** Id of a target the runner is removing itself (its `targetExpired` is not a new fact). */
  private quietId = -1;
  /** Stand-in record for a target beyond the pool capacity, so its trial is still emitted. */
  private readonly overflow: TargetRecord = {
    active: false, id: -1, skill: 'precision', dial: 0, itemDifficulty: 0, expireTick: -1, resolved: false, rtMs: -1,
  };

  constructor(private readonly deps: RunnerDeps) {
    this.tunables = deps.tunables;
    this.player = deps.player;
    this.streaks = new StreakTracker(deps.tunables.scoring, deps.events);
    for (let i = 0; i < MAX_TARGETS; i++) {
      this.records.push({ active: false, id: -1, skill: 'precision', dial: 0, itemDifficulty: 0, expireTick: -1, resolved: false, rtMs: -1 });
    }
    this.killEv = { type: 'targetKilled', payload: null as never };
    this.expiredEv = { type: 'targetExpired', payload: null as never };
    this.impactEv = { type: 'shotImpact', payload: null as never };
    this.firedEv = { type: 'shotFired', payload: null as never };
    this.stoppedEv = { type: 'playerStopped', payload: null as never };
  }

  get events(): EventSink<ModeEvents> {
    return this.deps.events;
  }

  get timeSec(): number {
    return this.liveTick * TICK_DT;
  }
  get remainingSec(): number {
    return Number.isFinite(this.durationTicks) ? Math.max(0, (this.durationTicks - this.liveTick) * TICK_DT) : Infinity;
  }
  get cleanStreak(): number {
    return this.streaks.streak;
  }
  get chain(): number {
    return this.streaks.chain;
  }
  get bestStreak(): number {
    return this.streaks.bestStreak;
  }
  get bestChain(): number {
    return this.streaks.bestChain;
  }

  /** Feed the runner the sim's facts (design §14.3 shape). Returns the unsubscribe function. */
  attach(bus: Subscribable<SourceEvents & PlayerSourceEvents>): () => void {
    const offs = [
      bus.on('targetKilled', (e) => this.onKilled(e)),
      bus.on('targetExpired', (e) => this.onExpired(e)),
      bus.on('shotImpact', (e) => this.onImpact(e)),
      bus.on('shotFired', (e) => this.onFired(e)),
      bus.on('playerStopped', (e) => this.onStopped(e)),
      bus.on('playerDied', () => this.end('death')),
    ];
    return () => offs.forEach((f) => f());
  }

  /** Ready a run (`ready` phase starts now). Replaces any run in progress: this is the instant restart. */
  begin<S>(mode: ModeDef<S>, opts: RunOptions): void {
    const m = this.tunables.modes;
    this.mode = mode as ModeDef<unknown>;
    this.seed = opts.seed;
    this.rng = new Rng((opts.seed ^ 0x9e3779b9) >>> 0);
    this.pinDial = opts.pinDial;
    this.scheduler = new SpawnScheduler(m, this.tunables.dial.floors, this.rng, new AnchorIndex(opts.anchors ?? null), this.player);
    this.streaks.reset();
    const s = this.stats;
    s.score = s.kills = s.headshotKills = s.misses = s.trials = s.trialsWon = 0;
    this.surge = false;
    this.endReason = null;
    this.refusedSpawns = 0;
    this.recordsUsed = 0;
    for (let i = 0; i < MAX_TARGETS; i++) this.records[i]!.active = false;
    this.liveTick = 0;
    this.durationTicks = Number.isFinite(mode.durationSec) ? secondsToTicks(mode.durationSec) : Infinity;
    this.manualBeats = mode.beatSec === null;
    this.beatTicks = this.manualBeats ? Infinity : secondsToTicks(mode.beatSec ?? this.tunables.dial.beat.drillSec);
    this.readyTicksLeft = secondsToTicks(m.readySec);
    this.phase = 'ready';
    this.applyBeat(0);
    const r = this.readyEv;
    r.tick = this.simTick;
    r.mode = mode.id;
    r.seed = opts.seed;
    r.dial = this.dial;
    this.deps.events.emit('runReady', r);
    this.state = (mode as ModeDef<unknown>).setup(this);
  }

  /** Advance one sim tick; call right after `world.step`. */
  tick(simTick: number): void {
    this.simTick = simTick;
    if (this.phase === 'ready') {
      if (--this.readyTicksLeft > 0) return;
      this.phase = 'live';
      this.liveStartSimTick = simTick;
      this.startEv.tick = simTick;
      this.deps.events.emit('runStarted', this.startEv);
    }
    if (this.phase !== 'live') return;
    const lt = this.liveTick;
    if (lt > 0 && lt % this.beatTicks === 0) this.applyBeat(this.beat + 1);
    this.expireTargets(lt);
    this.streaks.step(simTick, lt * TICK_DT);
    this.mode.tick(this);
    if (this.phase !== 'live') return;
    this.liveTick = lt + 1;
    if (this.liveTick >= this.durationTicks) this.end('timer');
  }

  end(reason: RunEndReason): void {
    if (this.phase !== 'live' && this.phase !== 'ready') return;
    this.phase = 'result';
    this.endReason = reason;
    const e = this.endEv;
    e.tick = this.simTick;
    e.t = this.timeSec;
    e.reason = reason;
    this.deps.events.emit('runEnded', e);
  }

  advanceBeat(): void {
    if (this.phase === 'live') this.applyBeat(this.beat + 1);
  }

  axesAt(dial: number): AxisValues {
    return this.deps.dial.axes(clamp(dial, 0, 100));
  }

  setSurge(on: boolean): void {
    this.surge = on;
  }

  spawn(kind: EnemyKind, pos: Vec3, opts?: SpawnOptions): number {
    const fl = this.tunables.dial.floors;
    // Spawn fairness (design §9.3.5): the floor distance in any direction and the view-cone rule.
    if (!this.scheduler.fairAt(pos) || this.recordsUsed >= MAX_TARGETS) {
      this.refusedSpawns++;
      return -1;
    }
    const scale = Math.max(opts?.scale ?? 1, fl.minTargetScale);
    const id = this.deps.spawner.spawn(kind, pos, scale, opts?.strafe);
    if (id < 0) {
      this.refusedSpawns++;
      return -1;
    }
    const rec = this.adopt(id);
    rec.skill = opts?.skill ?? this.mode.skills[0]!;
    if (opts?.difficulty !== undefined) rec.itemDifficulty = opts.difficulty;
    if (opts?.lifetimeSec !== undefined) {
      rec.expireTick = this.liveTick + secondsToTicks(Math.max(opts.lifetimeSec, fl.exposureSec));
    }
    return id;
  }

  despawn(id: number): void {
    this.release(id);
    this.removeQuietly(id);
  }

  /** Remove a target from the sim without the `targetExpired` it announces being counted again. */
  private removeQuietly(id: number): void {
    this.quietId = id;
    this.deps.spawner.despawn(id);
    this.quietId = -1;
  }

  resolveTrial(id: number, success: boolean, opts?: ResolveOptions): boolean {
    const rec = this.find(id);
    if (!rec || rec.resolved) return false;
    rec.resolved = true;
    const rt = opts?.rtMs ?? rec.rtMs;
    const t = this.timeSec;
    const e = this.trialEv;
    e.tick = this.simTick;
    e.t = t;
    e.skill = rec.skill;
    e.itemDifficulty = rec.itemDifficulty;
    e.success = success;
    e.rtMs = rt >= 0 ? rt : undefined;
    e.extra = opts?.extra;
    this.deps.events.emit('skillTrial', e);
    this.stats.trials++;
    if (success) this.stats.trialsWon++;
    else this.streaks.onBreak(this.simTick, t);
    return true;
  }

  // ---- facts from the sim ----------------------------------------------------------------

  private onKilled(e: SourceEvents['targetKilled']): void {
    if (this.phase !== 'live') return;
    if (e.tick > this.simTick) this.simTick = e.tick;
    const t = (e.tick - this.liveStartSimTick) * TICK_DT;
    const rec = this.find(e.targetId) ?? this.adopt(e.targetId);
    rec.rtMs = e.rtMs;
    const cfg = this.tunables.scoring;
    // Score with the streak earned going into this kill, then update the counters.
    this.streaks.step(e.tick, t);
    const kill = scoreKill(this.lastScore, {
      kind: e.kind,
      headshot: e.zone === 'head',
      firstBullet: e.firstBullet,
      ttkMs: e.ttkMs,
      parSec: this.mode.parSec ? this.mode.parSec(e.kind, this.axes) : cfg.defaultParSec,
      cleanStreak: this.streaks.streak,
      dial: rec.dial,
      surge: this.surge,
    }, cfg);
    this.streaks.onKill(e.tick, t, e.clean);
    const s = this.stats;
    s.kills++;
    if (e.zone === 'head') s.headshotKills++;
    s.score += kill.total;
    const a = this.scoreEv;
    a.tick = e.tick;
    a.t = t;
    a.targetId = e.targetId;
    a.kind = e.kind;
    a.points = kill.total;
    a.total = s.score;
    a.base = kill.base;
    a.precision = kill.precision;
    a.speed = kill.speed;
    a.streak = kill.streak;
    a.difficulty = kill.difficulty;
    a.surge = kill.surge;
    this.deps.events.emit('scoreAwarded', a);
    this.killEv.payload = e;
    this.mode.onEvent(this, this.killEv);
    this.resolveTrial(e.targetId, true);
    this.release(e.targetId);
  }

  private onExpired(e: SourceEvents['targetExpired']): void {
    if (this.phase !== 'live') return;
    if (e.tick > this.simTick) this.simTick = e.tick;
    if (e.targetId === this.quietId) return; // we removed it ourselves and already accounted for it
    this.resolveTrial(e.targetId, false);
    this.release(e.targetId);
    this.expiredEv.payload = e;
    this.mode.onEvent(this, this.expiredEv);
  }

  private onImpact(e: SourceEvents['shotImpact']): void {
    if (this.phase !== 'live') return;
    if (!e.onTarget) {
      this.stats.misses++;
      if (this.tunables.scoring.missBreaksStreak) this.streaks.onBreak(e.tick, (e.tick - this.liveStartSimTick) * TICK_DT);
    }
    this.impactEv.payload = e;
    this.mode.onEvent(this, this.impactEv);
  }

  private onFired(e: SourceEvents['shotFired']): void {
    if (this.phase !== 'live') return;
    this.firedEv.payload = e;
    this.mode.onEvent(this, this.firedEv);
  }

  private onStopped(e: SourceEvents['playerStopped']): void {
    if (this.phase !== 'live') return;
    this.stoppedEv.payload = e;
    this.mode.onEvent(this, this.stoppedEv);
  }

  // ---- internals ---------------------------------------------------------------------------

  /** Beat boundary: the one place the dial module is asked and axis values change. */
  private applyBeat(index: number): void {
    this.beat = index;
    const d = clamp(this.pinDial ?? this.deps.dial.dialFor(this.mode.id, index, this.mode.waveCurve ?? this.tunables.dial.waves.drill), 0, 100);
    this.dial = d;
    const next: AxisValues = this.deps.dial.axes(d);
    for (const k in next) this.axes[k] = next[k]!;
    this.itemDifficulty = effectiveDial(this.deps.dial, this.axes, this.mode.axes, d);
    const b = this.beatEv;
    b.tick = this.simTick;
    b.t = this.timeSec;
    b.beat = index;
    b.dial = d;
    this.deps.events.emit('beatStarted', b);
  }

  private expireTargets(lt: number): void {
    for (let i = 0; i < MAX_TARGETS; i++) {
      const r = this.records[i]!;
      if (!r.active || r.expireTick < 0 || lt < r.expireTick) continue;
      const id = r.id;
      this.removeQuietly(id);
      this.resolveTrial(id, false);
      this.release(id);
      const p = this.expiredPayload;
      p.tick = this.simTick;
      p.targetId = id;
      this.expiredEv.payload = p;
      this.mode.onEvent(this, this.expiredEv);
    }
  }

  private find(id: number): TargetRecord | null {
    for (let i = 0; i < MAX_TARGETS; i++) {
      const r = this.records[i]!;
      if (r.active && r.id === id) return r;
    }
    return null;
  }

  /** Start tracking a target: its trial takes the dial and item difficulty of the beat in force. */
  private adopt(id: number): TargetRecord {
    const existing = this.find(id);
    if (existing) return existing;
    for (let i = 0; i < MAX_TARGETS; i++) {
      const r = this.records[i]!;
      if (r.active) continue;
      r.active = true;
      r.id = id;
      r.skill = this.mode.skills[0]!;
      r.dial = this.dial;
      r.itemDifficulty = this.itemDifficulty;
      r.expireTick = -1;
      r.resolved = false;
      r.rtMs = -1;
      this.recordsUsed++;
      return r;
    }
    // Pool exhausted by untracked targets: still produce the trial, just untracked afterwards.
    const r = this.overflow;
    r.id = id;
    r.skill = this.mode.skills[0]!;
    r.dial = this.dial;
    r.itemDifficulty = this.itemDifficulty;
    r.expireTick = -1;
    r.resolved = false;
    r.rtMs = -1;
    return r;
  }

  private release(id: number): void {
    const r = this.find(id);
    if (!r) return;
    r.active = false;
    this.recordsUsed--;
  }
}
