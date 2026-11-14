/**
 * Persistence, rank and run-record tunables (design §8.4, §14.5).
 */
export interface DialBand {
  id: string;
  /** Lower dial bound (inclusive); the band ends where the next one starts (or at 100). */
  from: number;
}

export interface ProgressTunables {
  /** `localStorage` key of the progress save (design §14.5; the settings and profile keep their own). */
  storageKey: string;
  /** Runs kept in the history, newest last (design §14.5: 200, summaries only). */
  historyMax: number;
  /** Largest save the store writes or an import accepts, bytes of JSON; the history is trimmed to fit. */
  maxSaveBytes: number;
  /** Modes remembered in `plays` / `drillBests` (a sanity cap for a hand-edited file). */
  maxModes: number;
  /** Reserved lists (cold-opener records, reference check-ins): entries kept, so a hand-edited file cannot grow the save. */
  maxColdOpeners: number;
  maxCheckins: number;
  /**
   * Dial bands run bests are kept per (design §8.4: Chalk/Brass, Steel/Cobalt, Neon, Prism/Zenith), so a best
   * at an easier band does not hide a harder band's. Boundaries are tier boundaries (tested).
   */
  bands: DialBand[];
  /** Modes whose runs keep run bests, situation records and the pace bar (design §4: Sweep is the one game). Every other mode is a fixture: history and counts only. */
  runModes: string[];
  /** Most route-strip tiles / pace points kept per run best (a sanity cap: the six sectors plus Overtime). */
  maxStrip: number;
  /** Daily Route bests kept, newest dates first to survive (design §4.8). */
  maxDailyBests: number;
  /** Contacts kept per scenario card for the situation records (design §8.4: the last 50). */
  situationWindow: number;
  /** Scenario cards remembered (design §4.4 names ten; a sanity cap for a hand-edited file). */
  maxCards: number;
  /**
   * Rank buffer (design §8.4): the committed sub-tier moves only after the estimate has stayed across the
   * boundary for this many consecutive runs. Promotion is immediate (a rank-up is the reward and the bar moves
   * every run anyway); demotion needs two runs so one bad evening does not drop a tier.
   */
  promoteAfterRuns: number;
  demoteAfterRuns: number;
}

export const progress: ProgressTunables = {
  storageKey: 'flickline.save.v1',
  historyMax: 200,
  maxSaveBytes: 1_000_000,
  maxModes: 64,
  maxColdOpeners: 400,
  maxCheckins: 100,
  bands: [
    { id: 'chalkBrass', from: 0 },
    { id: 'steelCobalt', from: 28 },
    { id: 'neon', from: 58 },
    { id: 'prismZenith', from: 72 },
  ],
  runModes: ['sweep'],
  maxStrip: 24,
  maxDailyBests: 60,
  situationWindow: 50,
  maxCards: 16,
  promoteAfterRuns: 1,
  demoteAfterRuns: 2,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { progress };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
