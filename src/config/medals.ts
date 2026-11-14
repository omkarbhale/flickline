/**
 * Medal tunables (design §8.4 "Medals", §7.3). Thresholds are the design's numbers; the few extras
 * (minimum sample sizes) exist so a medal cannot be earned from a degenerate run, and are noted next
 * to each. `modes` gates a medal to the modes the design names it for; a medal with no entry counts
 * in every mode. Mode ids are the registry's (`app/modeHost.ts`); a mode that does not exist yet
 * simply never awards its medal.
 */
export const MEDAL_IDS = [
  'needle', 'coldOpen', 'planted', 'hairline', 'metronome', 'pendulum',
  'thread', 'quickStudy', 'cleanCorner', 'untouched', 'flawless', 'ascent',
] as const;
export type MedalId = (typeof MEDAL_IDS)[number];

export interface MedalTunables {
  /** Needle: consecutive first-bullet headshots (a miss, a body or leg hit, or a later bullet at a target resets it). */
  needleHeadshots: number;
  /** Cold Open: consecutive targets (killed or expired) that each died to the first bullet at them. */
  coldOpenKills: number;
  /** Planted: kills in a row with no moving shot fired in between (a moving shot at nothing resets it too). */
  plantedKills: number;
  /** Hairline: a headshot whose bullet passed within this angle of the head centre, degrees. */
  hairlineDeg: number;
  /** Metronome: kills in a row (so `kills - 1` intervals) ... */
  metronomeKills: number;
  /** ... whose intervals are all within this fraction of their mean (design: ±12%). */
  metronomeTolerance: number;
  /** ... and whose mean interval is at least this long, seconds (extra: a simultaneous burst has no rhythm). */
  metronomeMinMeanSec: number;
  /** Pendulum: this fraction of the window on target ... */
  pendulumFraction: number;
  /** ... for this many seconds in a row (a sliding window, design: 85% for 4 s). */
  pendulumWindowSec: number;
  /** Thread: bullets after this many (the 3rd) must all land in the head or body zone ... */
  threadFreeBullets: number;
  /** ... over a spray of at least this many bullets (extra: "a full spray"; the Kestrel's magazine is 30, so 20 is most of it). */
  threadMinBullets: number;
  /** Quick Study: the run's median time to shot must beat the recent same-mode median by this fraction (design: 10%). */
  quickStudyImprovement: number;
  /** ... over this many previous runs of the mode (design: 20) ... */
  quickStudyWindow: number;
  /** ... needing at least this many of them (extra: a median of one run is not a baseline) ... */
  quickStudyMinRuns: number;
  /** ... and at least this many timed targets in the run itself (extra). */
  quickStudyMinTargets: number;
  /** Clean Corner: angles cleared with no damage in one run (cumulative; the count restarts after the award). */
  cleanCornerAngles: number;
  /** Untouched: enemies in a Sweep contact cleared without taking damage (design: 3+). */
  untouchedEnemies: number;
  /** A contact counts as "no damage" when the health it kept is at least this (1 = untouched; slack for float error). */
  untouchedKept: number;
  /** Flawless: a full run (ended by its timer or completed) with no missed and no moving shot, and at least this many hits (extra). */
  flawlessMinHits: number;
  /** Medal -> the modes it counts in. Absent = every mode. */
  modes: Partial<Record<MedalId, readonly string[]>>;
}

export const medals: MedalTunables = {
  needleHeadshots: 5,
  coldOpenKills: 5,
  plantedKills: 10,
  hairlineDeg: 0.15,
  metronomeKills: 6,
  metronomeTolerance: 0.12,
  metronomeMinMeanSec: 0.35,
  pendulumFraction: 0.85,
  pendulumWindowSec: 4,
  threadFreeBullets: 3,
  threadMinBullets: 20,
  quickStudyImprovement: 0.1,
  quickStudyWindow: 20,
  quickStudyMinRuns: 5,
  quickStudyMinTargets: 8,
  cleanCornerAngles: 5,
  untouchedEnemies: 3,
  untouchedKept: 0.999,
  flawlessMinHits: 10,
  modes: {
    hairline: ['coldStart', 'orbit'],
    pendulum: ['strafeTrack'],
    thread: ['sprayWall'],
    cleanCorner: ['cornerClear', 'sweep'],
    untouched: ['sweep'],
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { medals };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
