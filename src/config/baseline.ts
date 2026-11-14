/**
 * The Daily Baseline (design §8.5, `docs/research/transfer.md` §5). Tunables here; the stored item
 * lists are generated data in `baselineItems.ts` (`scripts/gen-baseline-items.mjs`).
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
   * `θ − s × logit(p)`". The same values as `dial.modes.orbit` and `dial.modes.coldStart`
   * (a test keeps them equal).
   */
  matchedTargetSuccess: Readonly<Record<BaselineSkill, number>>;
  /**
   * Farthest a Cold-Start-style Post is stored: the Range's Beacon shell (25 m). The dial's 35 m
   * end of the distance axis does not fit the hall, so the top levels are as far as the hall allows.
   */
  maxDistanceM: number;
  /** Nearest a Cold-Start-style Post is stored: just outside the 5 m view-cone fairness floor (§9.3.5). */
  minPostDistanceM: number;
  /**
   * Lowest an orb's centre is stored and placed above the floor (m). The shell's pitch law reaches
   * -20 degrees, which at 8 m or more is under the floor: such orbs are left out of the lists and a
   * placement that would go under is lifted to this height.
   */
  minBeaconHeightM: number;
  /** A trial the placement cannot fit in the hall is shrunk towards the player in this many steps (distance only). */
  fitSteps: number;
}

export const baseline: BaselineTunables = {
  version: 1,
  gapHours: 8,
  levels: [15, 30, 45, 60, 75, 90],
  trialsPerSkill: 20,
  generatorSeed: 0xba5e1150,
  matchedTargetSuccess: { flick: 0.7, precision: 0.55 },
  maxDistanceM: 25,
  minPostDistanceM: 5.05,
  minBeaconHeightM: 0.8,
  fitSteps: 6,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { baseline };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
