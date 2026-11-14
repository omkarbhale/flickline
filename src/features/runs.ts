import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import type { RunStats } from '../feedback/statTracker';
import type { RunEndReason } from '../modes/contracts';
import type { RunState, StartRunOptions } from '../modes/runController';

/** `__flickline.run`: drive the run lifecycle and read its stats (seconds, degrees, plain data). */
export interface FlicklineRunApi {
  /** Start a run (seeded reset -> ready). Defaults: mode 'freeplay', current seed, dial 50. Returns the run info. */
  start(opts?: Partial<StartRunOptions>): unknown;
  /** End the run (default reason 'quit') and return the final stats. */
  end(reason?: RunEndReason): RunStats;
  /** Instant restart; returns the measured synchronous cost in ms (-1 if there is no run). */
  restart(seed?: number): number;
  /** idle | ready | live | result */
  state(): RunState;
  /** Live stats during a run, final stats once ended. */
  stats(): RunStats;
  /** Measured restart timing: `sync` = reset cost, `toFrame` = call to the next rendered frame (-1 until drawn). */
  restartMs(): { sync: number; toFrame: number; budget: number };
  /** The run's logged events (oldest first), newest `count` entries. */
  log(count?: number): unknown[];
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Run lifecycle (reset-only restart, event log, stats). Runs started by `mode.start` are mirrored here too. */
    readonly run: FlicklineRunApi;
    /** Mode framework: start/stop a mode run and read its state (`step()` advances it like any tick). */
    readonly mode: {
      /** Ready a run (ready phase 0.8 s, then live). `pinDial` fixes the dial. Returns false for an unknown id. */
      start(id?: string, opts?: { seed?: number; pinDial?: number }): boolean;
      stop(): void;
      /** Phase, beat, dial, axes, score, streak, chain, trials, timing. */
      status(): unknown;
      /** Ids of the registered modes. */
      list(): string[];
    };
  }
}

/**
 * Playtest access to runs: the plain run lifecycle (`game.run`) and mode runs (`game.modes`) as
 * debug commands, overlay lines and the `run` section of `state()`.
 */
export const feature = defineFeature({
  id: 'runs',
  stage: 'tools',
  setup(game) {
    const run = game.run;
    const modes = game.modes;
    game.addOverlayLines(() => {
      if (run.state === 'idle') return '';
      const tr = run.tracker;
      const acc = tr.accuracy === null ? '--' : `${(tr.accuracy * 100).toFixed(0)}%`;
      const dur = run.info?.durationSec != null ? `/${run.info.durationSec}s` : '';
      const rs = game.lastRestartMs >= 0 ? `  restart ${game.lastRestartMs.toFixed(1)} ms` : '';
      return `run ${run.state} ${run.elapsedSec.toFixed(1)}${dur}  acc ${acc} (${tr.hits}/${tr.shots})${rs}`;
    });
    game.addOverlayLines(() => {
      const m = modes.status();
      if (m.mode === null) return '';
      return (
        `mode ${m.mode} ${m.phase}  beat ${m.beat} dial ${m.dial.toFixed(0)}  ${m.timeSec.toFixed(1)}s\n` +
        `score ${m.score}  kills ${m.kills}  trials ${m.trialsWon}/${m.trials}  streak ${m.streak}  chain ${m.chain}`
      );
    });
    game.addSnapshot('run', () => ({
      state: run.state,
      info: run.info ? { ...run.info } : null,
      elapsedSec: run.elapsedSec,
      shots: run.tracker.shots,
      hits: run.tracker.hits,
      accuracy: run.tracker.accuracy,
      kills: run.tracker.kills,
    }));
    game.addDebug({
      run: {
        start(opts = {}) {
          game.startRun({
            mode: opts.mode ?? 'freeplay',
            seed: opts.seed ?? game.world.seed,
            dial: opts.dial ?? 50,
            durationSec: opts.durationSec,
          });
          return { state: run.state, ...run.info };
        },
        end(reason = 'quit') {
          game.endRun(reason);
          return run.liveStats();
        },
        restart(seed) {
          return game.restartRun(seed) ? game.lastRestartMs : -1;
        },
        state: () => run.state,
        stats: () => run.liveStats(),
        restartMs: () => ({
          sync: game.lastRestartMs,
          toFrame: game.lastRestartToFrameMs,
          budget: game.tunables.run.restartBudgetMs,
        }),
        log: (count = 64) => run.log.events.slice(-count),
      },
      mode: {
        start: (id = 'test', opts = {}) => game.startMode(id, opts),
        stop: () => modes.stop(),
        status: () => modes.status(),
        list: () => Object.keys(MODES),
      },
    });
  },
});
