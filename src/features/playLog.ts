import { defineFeature } from '../app/feature';
import type { SkillId } from '../config/dial';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Best scores, finished-run counts and the flagged skill behind the mode cards and Today's session. */
    readonly playLog: {
      best(modeId: string): number | null;
      plays(modeId: string): number;
      /** Record a finished run without playing one (playtests). Returns true for a new best. */
      record(modeId: string, score: number): boolean;
      /** What the last results card flagged; Today's session trains it second. */
      flag(skill: SkillId | null): void;
    };
  }
}

/**
 * Remembers finished runs for the menu: the best score and the run count per mode. A run that
 * ends by quitting (restart, leaving for the menu) is not a finished run and records nothing.
 */
export const feature = defineFeature({
  id: 'playLog',
  stage: 'producer',
  setup(game) {
    game.bus.on('runEnded', (e) => {
      if (e.reason === 'quit') return;
      const id = game.modes.modeId;
      if (id !== null) game.playLog.recordRun(id, game.modes.runner.stats.score);
    });
    game.addDebug({
      playLog: {
        best: (id) => game.playLog.best(id),
        plays: (id) => game.playLog.plays(id),
        record: (id, score) => game.playLog.recordRun(id, score),
        flag: (skill) => game.playLog.setFlaggedSkill(skill),
      },
    });
  },
});
