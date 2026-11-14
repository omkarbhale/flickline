import { defineFeature } from '../app/feature';
import type { Game } from '../app/game';
import type { BotGame } from '../debug/bot/headless';
import { listModes, playMode, type BotReport, type BotRunOptions } from '../debug/bot/play';
import { paramsForSkill, type BotParams } from '../debug/bot/skill';
import { PerfHarness, type PerfOptions, type PerfStatus } from '../debug/perfHarness';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The synthetic player of the harness (src/debug/bot/README.md): play one whole run of `mode` (a
     * registered id (`sweep`, `test`) or `freeplay`) at `skill` 0..100 on THIS
     * page's game, as fast as the CPU allows, then draw the final frame. Deterministic for a seed
     * (`pinDial` too, since the skill model learns from every run). Throws for an unknown mode.
     * Replaces any run in progress.
     */
    botPlay(opts: BotRunOptions): BotReport;
    /** The parameters a bot skill expands to (aim sigma, reaction, overshoot bias, spray control, ...). */
    botParams(skill: number): BotParams;
    /** Ids `botPlay` can play. */
    botModes(): string[];
    /** Start the scripted 20 s perf scene in the real frame loop (`perfStatus()` reports progress and the result). */
    perfRun(opts?: PerfOptions): void;
    /** `idle`, `running` (elapsed seconds) or `done` with the full report: average, 1 % lows, worst frame, heap growth, smoke verdict. */
    perfStatus(): PerfStatus;
  }
}

/** The page as a `BotGame`: the same world, run controller and mode host the player uses. */
function pageGame(game: Game): BotGame {
  return {
    world: game.world,
    tunables: game.tunables,
    run: game.run,
    modes: game.modes,
    reset: (seed) => game.resetWorld(seed),
    advance: (input) => game.advance(input),
  };
}

/**
 * Playtest tools on `window.__flickline`: the bot player (`botPlay`, `botParams`, `botModes`) and the frame-time perf harness
 * (`perfRun`, `perfStatus`, or load the page with `?perf=1` to run it on its own).
 */
export const feature = defineFeature({
  id: 'harness',
  stage: 'tools',
  setup(game) {
    const perf = new PerfHarness(game);

    game.addDebug({
      botPlay(opts) {
        const report = playMode(pageGame(game), opts);
        game.renderNow();
        return report;
      },
      botParams: paramsForSkill,
      botModes: listModes,
      perfRun: (opts) => perf.start(opts),
      perfStatus: () => perf.status(),
    });
    const params = new URLSearchParams(window.location.search);
    if (params.has('perf')) {
      const q = params.get('quality');
      if (q === 'low' || q === 'medium' || q === 'high') game.settings.set({ quality: q });
      const sec = Number(params.get('perfSec'));
      // Let the first frames and the shader compile settle before the scene starts.
      window.setTimeout(() => perf.start({ seconds: Number.isFinite(sec) && sec > 0 ? sec : 20 }), 800);
    }
  },
});
