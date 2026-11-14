/**
 * Medal tunables (design §8.4 "Medals", §7.3). Thresholds are the design's numbers; the few extras
 * (minimum sample sizes) exist so a medal cannot be earned from a degenerate run, and are noted next
 * to each. The medals are about fights in a Sweep run (#217): none is tied to a drill any more, so `modes`
 * is empty and every medal counts wherever the run has the facts it reads. (Metronome, a drill-rhythm medal, is
 * retired with the drills.)
 */
export const MEDAL_IDS = [
  'needle', 'coldOpen', 'planted', 'hairline', 'pendulum',
  'thread', 'quickStudy', 'cleanCorner', 'untouched', 'flawless', 'closer', 'cashed', 'ascent',
] as const;
export type MedalId = (typeof MEDAL_IDS)[number];

export interface MedalTunables {
  /** Needle: consecutive first-bullet headshots (a miss, a body or leg hit, or a later bullet at a target resets it). */
  needleHeadshots: number;
  /** Cold Open: consecutive targets (killed or expired) that each died to the first bullet at them. */
  coldOpenKills: number;
  /** Planted: kills in a run with no moving shot between them (a moving shot, at anything, restarts the count). */
  plantedKills: number;
  /** Hairline: a first-bullet headshot whose bullet passed within this angle of the head centre, degrees ... */
  hairlineDeg: number;
  /** ... on an Echo that was moving: its horizontal speed at the shot at least this, m/s (extra: standing still is Needle's job). */
  movingEchoMps: number;
  /** Pendulum: this fraction of the window on target against a strafing Echo ... */
  pendulumFraction: number;
  /** ... for this many seconds in a row (a sliding window, design: 85% for 2 s). */
  pendulumWindowSec: number;
  /** Thread: bullets after this many (the 3rd) must all land in the head or body zone ... */
  threadFreeBullets: number;
  /** ... over a spray of at least this many bullets inside one fight (design: 8+). */
  threadMinBullets: number;
  /** Quick Study: the run's median time to shot must beat the recent same-mode median by this fraction (design: 10%). */
  quickStudyImprovement: number;
  /** ... over this many previous runs of the mode (design: 20) ... */
  quickStudyWindow: number;
  /** ... needing at least this many of them (extra: a median of one run is not a baseline) ... */
  quickStudyMinRuns: number;
  /** ... and at least this many timed targets in the run itself (extra). */
  quickStudyMinTargets: number;
  /** Clean Corner: contacts cleared with no damage in one run (cumulative; the count restarts after the award). */
  cleanCornerContacts: number;
  /** Untouched: enemies in a Sweep contact cleared without taking damage (design: 3+). */
  untouchedEnemies: number;
  /** A contact counts as "no damage" when the health it kept is at least this (1 = untouched; slack for float error). */
  untouchedKept: number;
  /** Flawless: a sector, cleared, with no missed and no moving shot, and at least this many hits in it (extra: a sector of two taps is luck). */
  flawlessSectorMinHits: number;
  /** Medal -> the modes it counts in. Absent = every mode. */
  modes: Partial<Record<MedalId, readonly string[]>>;
}

export const medals: MedalTunables = {
  needleHeadshots: 5,
  coldOpenKills: 5,
  plantedKills: 10,
  hairlineDeg: 0.15,
  movingEchoMps: 1,
  pendulumFraction: 0.85,
  pendulumWindowSec: 2,
  threadFreeBullets: 3,
  threadMinBullets: 8,
  quickStudyImprovement: 0.1,
  quickStudyWindow: 20,
  quickStudyMinRuns: 5,
  quickStudyMinTargets: 8,
  cleanCornerContacts: 5,
  untouchedEnemies: 3,
  untouchedKept: 0.999,
  flawlessSectorMinHits: 3,
  modes: {},
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { medals };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
