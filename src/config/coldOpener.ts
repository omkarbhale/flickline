import type { SweepCard } from './sweep';

/**
 * The cold opener (design §8.5, `docs/research/transfer.md` §5, #209): Flickline's learning
 * measurement, the Opener of the day's first run drawn from a calibrated pool. Tunables here; the pool
 * itself is generated data in `coldOpenerPool.ts` (`npm run cold:pool`, from `generatorSeed`).
 *
 * `version` names the content: the pool, the placement rules it was generated with and the dial axes
 * its Echo profiles were read from. Any change to any of them is a new version and a new series on the
 * profile (§8.5 guards). `modes/coldOpenerPool.test.ts` fails if the pool changes without a bump.
 */

/** The Echo numbers a pool contact plays with: the level's dial axes, stored with the pool so a change of the dial is a change of content. */
export interface ColdProfile {
  tellSec: number;
  reactionSec: number;
  hitChance: number;
  strafeSpeed: number;
  strafeLegSec: number;
  standStillSec: number;
  peekWideSec: number;
}

/** A stored position: x, y, z (metres, feet height). */
export type ColdV3 = readonly [x: number, y: number, z: number];

/** One stored Echo of a pool contact: where and how the Sweep director placed it (`modes/sweepDirector.ts` `EchoPlan`). */
export interface ColdEcho {
  /** The hold anchor it stands on. */
  readonly spot: string;
  readonly kind: 'strafer' | 'peeker';
  readonly feet: ColdV3;
  readonly crouched: boolean;
  readonly expectation: 'prepared' | 'attending' | 'unaware';
  /** Strafer: its lane's ends (equal ends: it stands still). */
  readonly lane?: readonly [a: ColdV3, b: ColdV3];
  /** Peeker: its path and pattern. */
  readonly peek?: { readonly hold: ColdV3; readonly out: ColdV3; readonly pattern: 'shoulder' | 'wide' | 'jiggle' | 'hop' };
  /**
   * Its personality seed, drawn with the pool. The Echo minds (#88) read it when they land; until then
   * an Echo's own randomness comes from the run's stream. Stored now so the pool needs no new version then.
   */
  readonly seed: number;
}

/** One stored opener contact: a take sector of a shipped map (unmirrored), its card and its Echoes. */
export interface ColdContact {
  readonly map: string;
  readonly sector: string;
  readonly card: SweepCard;
  /** The anchors the card puts in play (a `clear` has two, one of them empty). */
  readonly spots: readonly string[];
  readonly echoes: readonly ColdEcho[];
}

/** One level of the pool: its Echo profile and `variants` stored contacts per slot (`slots[slot][variant]`). */
export interface ColdLevelPool {
  readonly profile: ColdProfile;
  readonly slots: readonly (readonly ColdContact[])[];
}

/** The whole pool by level dial (`COLD_POOL[level]`). */
export type ColdPool = Readonly<Record<number, ColdLevelPool>>;

export interface ColdOpenerTunables {
  /**
   * Content version (see the file comment). Version 1 was the Range item lists of the retired Daily
   * Baseline run (#150, #190), never shipped as a measurement; version 2 is the contact pool.
   */
  version: number;
  /** A cold opener is due after this many hours without a finished run (§8.5; transfer.md H1 may raise it). */
  gapHours: number;
  /** Finished runs ever before the first cold opener: the clean opener's rule (design §7.4, `cues.cleanRun.minRuns`). */
  minRuns: number;
  /** Dial of each level, ascending: every level has its own stored contacts. */
  levels: readonly number[];
  /**
   * The cards of one cold opener, one per slot, in slot order. Every day plays exactly these cards (one
   * stored variant per slot, the order shuffled), so two days' item statistics are identical (#209).
   * Only the Opener's cards: crossfire never opens a run (design §4.4).
   */
  slots: readonly SweepCard[];
  /**
   * Take sectors (`<map>/<sector>`) the pool never uses: a sector whose exit can be reached without
   * meeting its Echoes would let a measured contact pass unplayed. `elbow/elbow-take-west`: its exit sits
   * beside its entry (#230); taking it out of this list is a new pool and a new version.
   */
  excludeSectors: readonly string[];
  /** Stored variants per slot and level (slots x variants = the pool of a level, design: about 30). */
  variants: number;
  /** Seed the pool is generated from, once (`scripts/gen-cold-pool.mjs`). */
  generatorSeed: number;
  /**
   * The first level: the level nearest the dial where the player's matched rating wins `firstLevelSuccess`
   * of the time (`θ − s·logit(p)`; `firstLevelRule: 'atOrBelow'` takes the highest level at or below it
   * instead, transfer.md §5.3's rule).
   */
  firstLevelSuccess: number;
  firstLevelRule: 'nearest' | 'atOrBelow';
  /**
   * How the cold score is made from the trials: `skills` = the mean of the per-skill flat-prior estimates
   * (design §8.5's wording); `pooled` = one flat-prior estimate over every trial of the cold opener (the
   * per-skill estimates are still recorded).
   */
  aggregate: 'skills' | 'pooled';
  /** Level moves (§8.5, transfer.md §5.3): up when contacts won exceed `upAbove` in `moveOf` of the last `moveWindow` valid cold openers; down below `downBelow`. */
  upAbove: number;
  downBelow: number;
  moveOf: number;
  moveWindow: number;
  /** Logistic scale of the cold estimate (design §9.1 `s`, symmetric: the cold opener does not use the matched model's asymmetry). */
  scale: number;
  /** Grid of the flat-prior estimate: points over the dial 0..100. */
  gridPoints: number;
  /**
   * The verdict (design §8.5, transfer.md §5.6): the last `k` valid cold openers against the `k` before,
   * `k = min(kMax, floor(n / 2))`, no verdict before `minValid` valid ones or with `k < kMin`; the band is
   * `z · σ · √(2 / k)` with σ from successive differences (`sigmaDefault` dial points until `sigmaFromN`
   * valid ones). `confirm`: a verdict other than Steady is reported only when the same comparison also
   * held on the previous valid day (a single noisy day cannot flip it).
   */
  trend: { kMax: number; kMin: number; minValid: number; z: number; sigmaDefault: number; sigmaFromN: number; confirm: boolean };
}

export const coldOpener: ColdOpenerTunables = {
  version: 2,
  gapHours: 8,
  minRuns: 3,
  levels: [15, 30, 45, 60, 75, 90],
  slots: ['take-unaware', 'take-expected', 'clear', 'take-unaware', 'take-expected', 'clear'],
  excludeSectors: ['elbow/elbow-take-west'],
  variants: 5,
  generatorSeed: 0xc01d0b37,
  firstLevelSuccess: 0.7,
  firstLevelRule: 'atOrBelow',
  aggregate: 'pooled',
  upAbove: 0.85,
  downBelow: 0.35,
  moveOf: 3,
  moveWindow: 5,
  scale: 9,
  gridPoints: 201,
  trend: { kMax: 10, kMin: 4, minValid: 8, z: 1.96, sigmaDefault: 11, sigmaFromN: 6, confirm: true },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { coldOpener };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
