/**
 * Persistence, rank and run-record tunables (design §8.4, §14.5).
 */
export interface DialBand {
  id: string;
  /** Lower dial bound (inclusive); the band ends where the next one starts (or at 100). */
  from: number;
}

/**
 * The play journal (design §14.5, #251): a local record of when and how the game was played, so repeat enjoyment
 * (vision principle 10) is measured from real play. A record, never a reward: nothing here is shown as a goal.
 */
export interface JournalTunables {
  /** A gap of this many seconds without a run event starts a new session (the issue: 30 minutes). */
  sessionGapSec: number;
  /** A run readied within this many seconds of the previous run's results card is "pulled back in" (the issue: 10 s). */
  pulledWithinSec: number;
  /** Days of sessions and runs kept (the issue: for example 90); the first day ever played is kept apart. */
  keepDays: number;
  /** Sanity caps on what a save or a hand-edited file may carry, so the journal cannot grow the save without bound. */
  maxSessions: number;
  maxRuns: number;
  maxDays: number;
  /** The window of the one-line summary ("this week"), days including today. */
  summaryDays: number;
  /** Deepest sector kept for a run (a sanity cap: the six sectors plus Overtime). */
  maxDepth: number;
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
  /** The play journal (#251). */
  journal: JournalTunables;
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
  journal: { sessionGapSec: 30 * 60, pulledWithinSec: 10, keepDays: 90, maxSessions: 500, maxRuns: 2000, maxDays: 120, summaryDays: 7, maxDepth: 24 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { progress };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
