import type { EventSink, Subscribable } from '../core/eventBus';
import { secondsToTicks, TICK_DT } from '../core/time';
import type { RunTunables } from '../config/run';
import { EventLog } from '../feedback/eventLog';
import { StatTracker, type RunStats } from '../feedback/statTracker';
import type { RunEndReason } from '../sim/runEvents';
import type { RunAndSimEvents, TickInput } from '../sim/types';
import type { World } from '../sim/world';

/**
 * `idle`: no run (free play, nothing recorded; the foundation's behaviour).
 * `ready` -> `live` -> `result` is the lifecycle of design §2.
 */
export type RunState = 'idle' | 'ready' | 'live' | 'result';

export interface StartRunOptions {
  /** Mode id ('cold-start', 'orbit', ...). Modes arrive with the mode framework; any string works. */
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
  durationSec: number;
}

export type RunBus = EventSink<RunAndSimEvents> & Subscribable<RunAndSimEvents>;

/**
 * The run lifecycle: seeded reset, `ready` (0.8 s, movement only), `live` (timer), `result`
 * (frozen: the sim stops ticking). All ticking goes through `step()`. Restart is a world reset from
 * the run seed: no scene rebuild, no allocation beyond a fresh log. Pure; wall-clock timing of
 * restart is measured by the composition root (`app/game.ts`).
 *
 * It owns the run's event log and live stat tracker, both fed from the shared bus, so any
 * consumer (HUD, results card, bot harness) reads one source of truth.
 */
export class RunController {
  state: RunState = 'idle';
  info: RunInfo | null = null;
  readonly log: EventLog;
  readonly tracker: StatTracker;
  /** Final stats once `state === 'result'`, else null (read `liveStats()` during the run). */
  finalStats: RunStats | null = null;

  private ticksInState = 0;
  private durationTicks = 0;
  private readyTicks: number;
  /** World tick at which the run went live. */
  liveStartTick = 0;

  constructor(
    private readonly world: World,
    private readonly bus: RunBus,
    private readonly rt: RunTunables,
  ) {
    this.readyTicks = secondsToTicks(rt.readySec);
    this.log = new EventLog(rt.logMaxEvents);
    this.tracker = new StatTracker(rt, bus);
    this.log.attach(bus);
    this.tracker.attach(bus);
  }

  /** Seconds of `live` elapsed (0 before live). */
  get elapsedSec(): number {
    return this.state === 'live' || this.state === 'result' ? (this.world.tick - this.liveStartTick) * TICK_DT : 0;
  }

  /** Begin a run: seeded world reset, then `ready`. Replaces any run in progress. */
  startRun(opts: StartRunOptions): void {
    const durationSec = opts.durationSec ?? this.rt.defaultDurationSec;
    this.info = { mode: opts.mode, seed: opts.seed, dial: opts.dial, durationSec };
    this.durationTicks = secondsToTicks(durationSec);
    this.finalStats = null;
    this.world.reset(opts.seed);
    this.world.live = false;
    this.ticksInState = 0;
    this.log.begin(opts.mode, opts.seed, opts.dial);
    this.tracker.reset(opts.mode, opts.seed, opts.dial);
    this.state = 'ready';
    this.bus.emit('runReady', { tick: this.world.tick, mode: opts.mode, seed: opts.seed, dial: opts.dial });
  }

  /**
   * Instant restart: the same mode, dial and (unless given) seed, straight back to `ready`.
   * Only resets state: the scene, level and tunables are untouched. Returns false when there is
   * no run to restart.
   */
  restartRun(seed?: number): boolean {
    const i = this.info;
    if (!i) return false;
    this.startRun({ mode: i.mode, seed: seed ?? i.seed, dial: i.dial, durationSec: i.durationSec });
    return true;
  }

  /** End the run (timer, death, completion, or quit) and freeze the sim. No-op outside ready/live. */
  endRun(reason: RunEndReason): void {
    if (this.state !== 'ready' && this.state !== 'live') return;
    this.state = 'result';
    this.bus.emit('runEnded', { tick: this.world.tick, reason });
    this.log.stop();
    this.finalStats = this.tracker.result();
  }

  /** Abandon the run and return to free play (no log, no stats). */
  cancel(seed?: number): void {
    this.state = 'idle';
    this.finalStats = null;
    this.log.stop();
    this.tracker.reset();
    this.world.reset(seed);
  }

  /**
   * Advance the simulation by one tick if the state allows it. Returns whether a tick ran
   * (`result` freezes the world so the results card shows the last frame).
   */
  step(input: TickInput): boolean {
    switch (this.state) {
      case 'idle':
        this.world.step(input, this.bus);
        return true;
      case 'ready':
        this.world.step(input, this.bus);
        if (++this.ticksInState >= this.readyTicks) this.goLive();
        return true;
      case 'live':
        this.world.step(input, this.bus);
        if (++this.ticksInState >= this.durationTicks) this.endRun('timer');
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
    this.state = 'live';
    this.ticksInState = 0;
    this.liveStartTick = this.world.tick;
    this.bus.emit('runStarted', { tick: this.world.tick });
    this.world.beginLive(this.bus);
  }
}
