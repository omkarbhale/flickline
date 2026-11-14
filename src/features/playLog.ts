import { defineFeature } from '../app/feature';
import type { SkillId } from '../config/dial';
import { summariseRun } from '../progress/bests';
import type { RunSummary } from '../progress/save';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Best scores, finished-run counts and the flagged skill behind the mode cards and Today's session (read from the progress save). */
    readonly playLog: {
      best(modeId: string): number | null;
      plays(modeId: string): number;
      /** Record a finished run without playing one (playtests), at dial 50. Returns true for a new best. */
      record(modeId: string, score: number): boolean;
      /** What the last results card flagged; Today's session trains it second. */
      flag(skill: SkillId | null): void;
    };
  }
}

/** The debug view of the menu's history reads. Recording real runs is `features/progress.ts`. */
export const feature = defineFeature({
  id: 'playLog',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      playLog: {
        best: (id) => game.progress.best(id),
        plays: (id) => game.progress.plays(id),
        record(id, score) {
          const stats = game.run.liveStats();
          const run: RunSummary = summariseRun({ ...stats, mode: id, seed: 0, dial: 50, endReason: 'timer' }, score, new Date().toISOString(), []);
          return game.progress.recordRun(run, null).newBest;
        },
        flag: (skill) => game.progress.setFlaggedSkill(skill),
      },
    });
  },
});
