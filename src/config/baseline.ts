import type { AxisDef } from './dial';

/**
 * The benchmark behind the cold opener (design §8.5, `docs/research/transfer.md` §5). Tunables here;
 * the stored item lists are generated data in `baselineItems.ts` (`scripts/gen-baseline-items.mjs`).
 *
 * The item recipe below is the benchmark's own copy of what the retired drills drew from (the Orbit drill's flick
 * angles, Beacon scale and exposure, the Cold Start drill's angles, distances and exposure; design §4.10): the drills
 * and their dial axes are gone from the game, the stored lists are frozen content, and the generator
 * (`modes/baselineGen.ts`) stays so a new version can be written from the same recipe.
 *
 * `version` names the content: the item lists, the trial engines they drive and the dial axes they
 * are generated from. Any change to any of them is a new version and a new series on the profile
 * (§5.7). `modes/baselineItems.test.ts` fails if a stored list changes without a bump.
 */

/** The skills Baseline version 1 measures (`footwork` and `angles` join in version 2, after #47 and #50). */
export const BASELINE_SKILLS = ['flick', 'precision'] as const;
export type BaselineSkill = (typeof BASELINE_SKILLS)[number];

/** One stored item: angle from the crosshair, pitch of the target, distance, Beacon scale and exposure. */
export type BaselineItemTuple = readonly [angleDeg: number, pitchDeg: number, distance: number, scale: number, exposureSec: number];

/** Stored lists by skill and level (`BASELINE_ITEMS[skill][level]`, `trialsPerSkill` tuples each). */
export type BaselineItemTable = Readonly<Record<BaselineSkill, Readonly<Record<number, readonly BaselineItemTuple[]>>>>;

export interface BaselineTunables {
  /** Content version (see the file comment). Bump it, and record the new frozen hash, with any content change. */
  version: number;
  /** A Baseline is due after this many hours without a finished run (§5.1; H1 may raise it). */
  gapHours: number;
  /** Dial value of each Baseline level, ascending (§5.3): every level has its own stored list per skill. */
  levels: readonly number[];
  /** Trials per skill in one run (20 + 20 = 40, alternating). */
  trialsPerSkill: number;
  /** Seed the item lists are generated from, once (`scripts/gen-baseline-items.mjs`). */
  generatorSeed: number;
  /**
   * Success rate the matched dial of a skill aims for, §5.3's "highest level at or below
   * `θ − s × logit(p)`". The same 70% as `dial.modes.sweep`
   * (a test keeps them equal).
   */
  matchedTargetSuccess: Readonly<Record<BaselineSkill, number>>;
  /**
   * Farthest a precision-item Post is stored: the Range's Beacon shell (25 m). The dial's 35 m
   * end of the distance axis does not fit the hall, so the top levels are as far as the hall allows.
   */
  maxDistanceM: number;
  /** Nearest a precision-item Post is stored: just outside the 5 m view-cone fairness floor (§9.3.5). */
  minPostDistanceM: number;
  /**
   * Lowest an orb's centre is stored above the floor (m). The shell's pitch law reaches -20 degrees,
   * which at 8 m or more is under the floor: such orbs are left out of the lists.
   */
  minBeaconHeightM: number;
  /** How the lists are drawn (above). */
  recipe: BaselineRecipe;
}

/**
 * How the stored lists are drawn (the retired drills' ranges and dial curves, moved here unchanged so the
 * content of version 1 is unchanged). Axis curves map a level (a dial value) to a value like `config/dial.ts`
 * axes do; each exposure is floored like the dial did (`floors`).
 */
export interface BaselineRecipe {
  /** Flick items (the retired Orbit drill's draw): the angle band from the crosshair, the Beacon's scale and its exposure, by level. */
  flick: {
    angleMinDeg: AxisDef;
    angleMaxDeg: AxisDef;
    beaconScale: AxisDef;
    exposureSec: AxisDef;
    /** The Beacon's distance band on the shell (m), and the shell's pitch law (degrees from the horizon, biased towards `pitchBiasDeg`). */
    minDistM: number;
    maxDistM: number;
    pitchMinDeg: number;
    pitchMaxDeg: number;
    pitchBiasDeg: number;
  };
  /** Precision items (the retired Cold Start drill's draw): the angle band, the exposure by level and the distance band as multiples of the dial's `distance` axis. */
  precision: {
    angleMinDeg: number;
    angleMaxDeg: number;
    exposureSec: AxisDef;
    distanceLoMult: number;
    distanceHiMult: number;
  };
  /** Floors on the exposures (the minimum feasible time, #12 §4.1) and on the Beacon's scale (the spec's real head size). */
  floors: { flickExposureSec: number; precisionExposureSec: number; minBeaconScale: number };
}

export const baseline: BaselineTunables = {
  version: 1,
  gapHours: 8,
  levels: [15, 30, 45, 60, 75, 90],
  trialsPerSkill: 20,
  generatorSeed: 0xba5e1150,
  matchedTargetSuccess: { flick: 0.7, precision: 0.7 },
  maxDistanceM: 25,
  minPostDistanceM: 5.05,
  minBeaconHeightM: 0.8,
  recipe: {
    flick: {
      // 60-120 degrees at level 100, not 90-180: off-screen targets are found by sound, not sight (#12 P5).
      angleMinDeg: { at0: 20, at100: 60, curve: 'linear' },
      angleMaxDeg: { at0: 40, at100: 120, curve: 'linear' },
      beaconScale: { at0: 3.0, at100: 1.0, curve: 'linear' },
      exposureSec: { at0: 2.5, at100: 1.6, curve: 'geometric' },
      minDistM: 8,
      maxDistM: 25,
      pitchMinDeg: -20,
      pitchMaxDeg: 25,
      pitchBiasDeg: 2,
    },
    precision: {
      angleMinDeg: 5,
      angleMaxDeg: 25,
      // Generous on purpose (#170): a failed item should be a missed head, not a Post that left before the first bullet.
      exposureSec: { at0: 2.5, at100: 1.35, curve: 'geometric' },
      distanceLoMult: 0.7,
      distanceHiMult: 1.4,
    },
    floors: { flickExposureSec: 1.25, precisionExposureSec: 0.8, minBeaconScale: 1.0 },
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { baseline };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
