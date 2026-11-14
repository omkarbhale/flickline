/**
 * Spray Wall tunables (design §4.5). The mode's rules and the data its spray trace records; every
 * number the design states is here, none is inline in `modes/sprayWall.ts`.
 *
 * Distances are not a dial axis: the Range's three spray alcoves stand at 12, 20 and 28 m
 * (design §10.1), and the mode cycles through them, one per spray.
 */

export interface SprayWallTunables {
  /** Sprays in a run; the run completes after the last one (design §4.5: five sprays or 60 s). */
  sprays: number;
  /** Alcove distances in the order they are used, metres; the cycle repeats if `sprays` exceeds its length. */
  distanceOrderM: number[];
  /**
   * Burst length by dial (design §4.5): the first band whose `below` exceeds the dial gives its
   * bullets; at or above the last `below` the burst is the full magazine.
   */
  burstBands: { below: number; bullets: number }[];
  /** Seconds from the stand being taken (run start, or the reload finishing) to the Post appearing. */
  postAppearSec: number;
  /** A bullet counts as a hit on the wall when it struck the Post's head or body (legs do not count, design §4.5). */
  countedZones: ('head' | 'body' | 'leg')[];
  /** Seconds between the last spray ending and the run ending, so the wall's decals can be read. */
  finishDelaySec: number;
  /** Spray trace: the "falls apart" bullet is the first bullet index whose hit rate over the run's sprays is below this. */
  collapseHitRate: number;
  /** Spray trace: the pull "falls apart" at the first bullet index whose mean vertical pull error (degrees) stays above this. */
  pullToleranceDeg: number;
  /** Mark radius per metre of the alcove's distance (a mark must read from the stand: ~0.35 degrees across). */
  decalRadiusPerM: number;
  /** A mark floats this far off the wall, metres, so it never z-fights the panel. */
  decalLiftM: number;
  /** A bullet's mark is placed where its ray meets the panel within this reach, metres. */
  panelReachM: number;
  /** Decal pool size (bullets drawn on the wall at once): at least the largest magazine. */
  decalCapacity: number;
}

export const sprayWall: SprayWallTunables = {
  sprays: 5,
  distanceOrderM: [12, 20, 28],
  burstBands: [
    { below: 30, bullets: 3 },
    { below: 60, bullets: 7 },
  ],
  postAppearSec: 0.5,
  countedZones: ['head', 'body'],
  finishDelaySec: 1.2,
  collapseHitRate: 0.5,
  pullToleranceDeg: 0.5,
  decalRadiusPerM: 0.007,
  decalLiftM: 0.012,
  panelReachM: 60,
  decalCapacity: 64,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { sprayWall };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
