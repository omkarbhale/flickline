import { defineFeature } from '../app/feature';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * First-run flow for playtests (pointer lock cannot be taken headlessly). `play()` does what the first
     * panel's Play button does: apply the self-report to the skill model, remember the visit and start the
     * first Sweep run. `state()` reads whether the first run is done, the self-report, the prior it implies,
     * the skill model's rating and the dial of the Sweep run in progress (null when there is none), and the
     * hints shown so far. (`timeline()` has the page-load marks: `runReady`, `runLive`.)
     */
    readonly firstRun: {
      play(): void;
      state(): {
        firstRunDone: boolean;
        selfReport: string | null;
        prior: { mean: number; sd: number };
        rating: number;
        dial: number | null;
        hintsSeen: readonly string[];
      };
    };
  }
}

/**
 * Debug access to the first-run flow (design 13.4, 9.2). The flow itself lives in the game's `playRun`
 * (the first panel's Play applies the self-report prior, then starts the first Sweep run); this is the
 * handle a playtest uses to press Play and to read what it did.
 */
export const feature = defineFeature({
  id: 'firstRun',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      firstRun: {
        play: () => game.playRun(),
        state: () => ({
          firstRunDone: game.profile.get().firstRunDone,
          selfReport: game.profile.get().selfReport,
          prior: game.profile.prior(game.tunables.dial),
          rating: game.modes.skills.rating('line'),
          dial: game.modes.modeId === 'sweep' ? game.modes.status().dial : null,
          hintsSeen: game.profile.get().hintsSeen,
        }),
      },
    });
  },
});
