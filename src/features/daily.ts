import { defineFeature } from '../app/feature';
import { playMode, type BotReport, type BotRunOptions } from '../debug/bot/play';
import { dailySeed } from '../modes/dailyRoute';
import { SWEEP_MODE } from '../modes/sweep';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The Daily Route (#208, design §4.8) for playtests. `state()`: today's date key and seed, the day best so far,
     * and the date of the Daily Route now playing (null for any other run). `launch()` presses the Daily Route
     * button. `setDate(key)` pretends today is `key` (`YYYY-MM-DD`; null reads the clock) so the day best can be
     * looked at across local midnight. `bests()` lists every stored day best by date.
     */
    readonly daily: {
      state(): { today: string; seed: number; best: number | null; running: string | null };
      launch(): void;
      setDate(key: string | null): void;
      bests(): Record<string, { score: number; depth: number; seed: number }>;
      /** The bot plays today's Daily Route (seed of today's date), so a finished run records a day best like a player's would. */
      bot(opts?: Pick<BotRunOptions, 'skill' | 'pinDial' | 'maxSeconds'>): BotReport;
    };
  }
}

/** Debug access to the Daily Route; the button, the seed and the day best live in the game, the menu and the progress store. */
export const feature = defineFeature({
  id: 'daily',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      daily: {
        state() {
          const today = game.today();
          return { today, seed: dailySeed(today, game.tunables.daily), best: game.progress.dailyBest(today)?.score ?? null, running: game.dailyKey };
        },
        launch: () => game.launchDailyRoute(),
        setDate: (key) => game.setToday(key),
        bot(opts = {}) {
          const date = game.today();
          const report = playMode(
            {
              world: game.world, tunables: game.tunables, run: game.run, modes: game.modes,
              reset: (seed) => {
                game.resetWorld(seed);
                game.markDailyRun(date);
              },
              advance: (input) => game.advance(input),
            },
            { ...opts, mode: SWEEP_MODE, seed: dailySeed(date, game.tunables.daily) },
          );
          game.renderNow();
          return report;
        },
        bests() {
          const out: Record<string, { score: number; depth: number; seed: number }> = {};
          const d = game.progress.snapshot.dailyBests;
          for (const k of Object.keys(d)) out[k] = { score: d[k]!.score, depth: d[k]!.depth, seed: d[k]!.seed };
          return out;
        },
      },
    });
  },
});
