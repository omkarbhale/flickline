import { defineFeature } from '../app/feature';
import { PLACEMENT_MODE } from '../modes/placement';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * First-run flow for playtests (pointer lock cannot be taken headlessly). `click()` does what the
     * first pointer lock of a first-run player does: remember the visit, start the Placement run and
     * float the hint. `state()` reads whether the first run is done and what the skill model starts from.
     */
    readonly firstRun: {
      click(): void;
      state(): { firstRunDone: boolean; selfReport: string | null; prior: { mean: number; sd: number } };
    };
  }
}

/**
 * A first-run player's first click starts the Placement run (design 13.4, 9.2): the game announces
 * `placementRunRequested` with the prior their self-report implies; this seeds the skill model from
 * it (so the run's staircase starts at a dial that fits them) and launches the run.
 */
export const feature = defineFeature({
  id: 'firstRun',
  stage: 'producer',
  setup(game) {
    game.bus.on('placementRunRequested', ({ priorMean, priorSd }) => {
      game.modes.skills.reseed({ mean: priorMean, sd: priorSd });
      // A link that names a mode (`?mode=orbit`) is an explicit choice: that run is already readied, leave it.
      if (game.modes.modeId === null) game.launchMode(PLACEMENT_MODE);
    });
    game.addDebug({
      firstRun: {
        click: () => game.bus.emit('pointerLockChanged', { locked: true }),
        state: () => ({
          firstRunDone: game.profile.get().firstRunDone,
          selfReport: game.profile.get().selfReport,
          prior: game.profile.prior(game.tunables.dial),
        }),
      },
    });
  },
});
