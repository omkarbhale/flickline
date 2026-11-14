/**
 * Persistence, rank and personal-best tunables (design §8.4, §14.5).
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
  /** Modes remembered in `plays` / `bests` (a sanity cap for a hand-edited file). */
  maxModes: number;
  /** Reserved lists (Daily Baseline records, reference check-ins): entries kept, so a hand-edited file cannot grow the save. */
  maxBaselines: number;
  maxCheckins: number;
  /**
   * Dial bands personal bests are kept per (design §8.4: Chalk/Brass, Steel/Cobalt, Neon, Prism/Zenith), so a best
   * at an easier band does not hide a harder band's. Boundaries are tier boundaries (tested).
   */
  bands: DialBand[];
  /** Modes that never keep a personal best (the Placement run is a measurement, not a score to beat). */
  noBestModes: string[];
  /** Spacing of the stored score curve the ghost-pace bar reads, seconds (one sample per second keeps a 5:00 run at 301 numbers). */
  curveStepSec: number;
  /** Most curve samples stored per best (a sanity cap: 600 = ten minutes). */
  curveMaxSamples: number;
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
  maxBaselines: 400,
  maxCheckins: 100,
  bands: [
    { id: 'chalkBrass', from: 0 },
    { id: 'steelCobalt', from: 28 },
    { id: 'neon', from: 58 },
    { id: 'prismZenith', from: 72 },
  ],
  noBestModes: ['placement'],
  curveStepSec: 1,
  curveMaxSamples: 600,
  promoteAfterRuns: 1,
  demoteAfterRuns: 2,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { progress };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
