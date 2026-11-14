/**
 * Spray trace tunables (design §3, §8.2). The per-bullet analysis of a spray (`feedback/sprayTrace.ts`) outlived
 * the Spray Wall mode it was written for (retired with the drills, design §4.10, #211): the results card draws it
 * from real sprays in fights (#39, #213).
 */

export interface SprayTraceTunables {
  /** The "falls apart" bullet is the first bullet index whose hit rate over the run's sprays is below this. */
  collapseHitRate: number;
  /** The pull "falls apart" at the first bullet index whose mean vertical pull error (degrees) stays above this. */
  pullToleranceDeg: number;
}

export const sprayTrace: SprayTraceTunables = {
  collapseHitRate: 0.5,
  pullToleranceDeg: 0.5,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { sprayTrace };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
