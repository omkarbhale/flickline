import type { EventSink, Subscribable } from '../core/eventBus';
import { secondsToTicks, TICK_DT } from '../core/time';
import { EventLog } from '../feedback/eventLog';
import { StatTracker, type RunStats, type StatConfig } from '../feedback/statTracker';
import type { RunEndReason } from '../sim/runEvents';
import type { RunAndSimEvents, TickInput } from '../sim/types';
import type { World } from '../sim/world';

/**
 * `idle`: no run (free play, nothing recorded; the foundation's behaviour).
 * `ready` -> `live` -> `result` is the lifecycle of design §2.
 */
export type RunState = 'idle' | 'ready' | 'live' | 'result';

export interface StartRunOptions {
  /** Mode id ('cold-start', 'orbit', ...). Any string works for a plain run. */
  mode: string;
  seed: number;
  /** Difficulty dial 0..100 in force for the run. */
  dial: number;
  /** `live` length in seconds (default `run.defaultDurationSec`). */
  durationSec?: number;
}

export interface RunInfo {
  mode: string;
  seed: number;
  dial: number;
  /** Null when the run is driven by the mode runner (it owns the timer). */
  durationSec: number | null;
}

export type RunBus = EventSink<RunAndSimEvents> & Subscribable<RunAndSimEvents>;

/**
 * The run lifecycle and its record. It owns the event log and the live stat tracker, both fed
 * from the shared bus, so any consumer (HUD, results card, bot harness) reads one source of truth.
 *
 * Two ways a run starts, with identical events (`runReady` / `runStarted` / `runEnded`):
 *  - **self-driven** (`startRun`): seeded world reset, `ready` (0.8 s, movement only, targets and
 *    weapon not live), `live` (timer), `result`. Restart is a world reset from the run seed: no
 *    scene rebuild, no allocation beyond a fresh log. Used for plain runs and the debug hook.
 *  - **mirrored**: the mode framework's `ModeRunner` owns timing and spawning and emits the same
 *    events; the controller follows them, so the log and stats cover mode runs too, and the sim
 *    freezes in `result` either way. `step()` then only ticks the world.
 * All ticking goes through `step()`. Pure; wall-clock timing of restart is measured by the
 * composition root (`app/game.ts`).
 */
export class RunController {
  state: RunState = 'idle';
  info: RunInfo | null = null;
  readonly log: EventLog;
  readonly tracker: StatTracker;
  /** Final stats once `state === 'result'`, else null (read `liveStats()` during the run). */
  finalStats: RunStats | null = null;
  /** World tick at which the run went live. */
  liveStartTick = 0;

  private selfDriven = true;
  /** True while this controller emits its own run events (so the mirror does not adopt them). */
  private emitting = false;
  private ticksInState = 0;
  private durationTicks = 0;
  private readonly readyTicks: number;

  constructor(
    private readonly world: World,
    private readonly bus: RunBus,
    private readonly cfg: StatConfig,
  ) {
    this.readyTicks = secondsToTicks(cfg.run.readySec);
    this.log = new EventLog(cfg.run.logMaxEvents);
    this.tracker = new StatTracker(cfg);
    // Order matters: follow the run events first, then record, then derive, then finish
    // (a handler subscribed earlier runs earlier for the same event).
    bus.on('runReady', (e) => {
      this.log.begin(e.mode, e.seed, e.dial);
      this.tracker.reset(e.mode, e.seed, e.dial);
      this.finalStats = null;
      this.state = 'ready';
      this.ticksInState = 0;
      if (!this.emitting) {
        this.selfDriven = false;
        this.info = { mode: e.mode, seed: e.seed, dial: e.dial, durationSec: null };
      }
    });
    bus.on('runStarted', (e) => {
      this.state = 'live';
      this.liveStartTick = e.tick;
    });
    this.log.attach(bus);
    this.tracker.attach(bus);
    bus.on('runEnded', () => {
      this.state = 'result';
      this.log.stop();
      this.finalStats = this.tracker.result();
    });
  }

  /** Seconds of `live` elapsed (0 before live). */
  get elapsedSec(): number {
    return this.state === 'live' || this.state === 'result' ? (this.world.tick - this.liveStartTick) * TICK_DT : 0;
  }

  /** Whether this controller (not the mode runner) times the current run. */
  get isSelfDriven(): boolean {
    return this.selfDriven;
  }

  /** Begin a self-driven run: seeded world reset, then `ready`. Replaces any run in progress. */
  startRun(opts: StartRunOptions): void {
    const durationSec = opts.durationSec ?? this.cfg.run.defaultDurationSec;
    this.selfDriven = true;
    this.info = { mode: opts.mode, seed: opts.seed, dial: opts.dial, durationSec };
    this.durationTicks = secondsToTicks(durationSec);
    this.world.reset(opts.seed);
    this.world.live = false;
    this.emitting = true;
    this.bus.emit('runReady', { tick: this.world.tick, mode: opts.mode, seed: opts.seed, dial: opts.dial });
    this.emitting = false;
  }

  /**
   * Instant restart: the same mode, dial and (unless given) seed, straight back to `ready`.
   * Only resets state: the scene, level and tunables are untouched. Returns false when there is
   * no self-driven run to restart (a mode run restarts through the mode host).
   */
  restartRun(seed?: number): boolean {
    const i = this.info;
    if (!i || !this.selfDriven || i.durationSec === null) return false;
    this.startRun({ mode: i.mode, seed: seed ?? i.seed, dial: i.dial, durationSec: i.durationSec });
    return true;
  }

  /**
   * End a self-driven run (timer, death, completion, or quit) and freeze the sim. No-op outside
   * ready/live, and for mirrored runs (end those through their runner).
   */
  endRun(reason: RunEndReason): void {
    if (!this.selfDriven || (this.state !== 'ready' && this.state !== 'live')) return;
    this.emitting = true;
    const t = this.state === 'live' ? (this.world.tick - this.liveStartTick) * TICK_DT : 0;
    this.bus.emit('runEnded', { tick: this.world.tick, t, reason });
    this.emitting = false;
  }

  /** Abandon the run and return to free play (no log, no stats). */
  cancel(seed?: number): void {
    this.state = 'idle';
    this.selfDriven = true;
    this.finalStats = null;
    this.log.stop();
    this.tracker.reset();
    this.world.reset(seed);
  }

  /**
   * Advance the simulation by one tick if the state allows it. Returns whether a tick ran
   * (`result` freezes the world so the results card shows the last frame). For mirrored runs the
   * caller ticks the mode runner after every tick that ran.
   */
  step(input: TickInput): boolean {
    switch (this.state) {
      case 'idle':
        this.world.step(input, this.bus);
        return true;
      case 'ready':
        this.world.step(input, this.bus);
        if (this.selfDriven && ++this.ticksInState >= this.readyTicks) this.goLive();
        return true;
      case 'live':
        this.world.step(input, this.bus);
        if (this.selfDriven && ++this.ticksInState >= this.durationTicks) this.endRun('timer');
        return true;
      default:
        return false;
    }
  }

  /** Live (or final) stats snapshot. Allocates; for HUD events and the debug hook, not per frame. */
  liveStats(): RunStats {
    return this.finalStats ?? this.tracker.result();
  }

  private goLive(): void {
    this.ticksInState = 0;
    this.emitting = true;
    this.bus.emit('runStarted', { tick: this.world.tick });
    this.emitting = false;
    this.world.beginLive(this.bus);
  }
}
