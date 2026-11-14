/**
 * End-of-run results card tunables and copy (design §8.2, §8.3). Pure data: thresholds, the key
 * metrics each mode shows, and every sentence the one-thing-to-fix stub can say (placeholders in
 * `{braces}`), so balance and wording are data changes, not code changes.
 *
 * The one-thing-to-fix here is the STUB of #26: it surfaces moving shots and slow time to shot
 * only. The ranked fix engine with its twelve diagnostics replaces it in #39.
 */

/** Stats the card can show as a "key metric" (design §4 "Key metrics shown"); extractors live in `feedback/results.ts`. */
export type MetricId =
  | 'firstShotRate'
  | 'preAimError'
  | 'flickBias'
  | 'flickError'
  | 'timeOnTarget'
  | 'leadError'
  | 'stopLatency'
  | 'headHeight'
  | 'bestChain'
  | 'cleanKills'
  | 'cleanStreak'
  | 'depth'
  | 'contacts';

export interface FixCopy {
  title: string;
  /** What the run showed. */
  evidence: string;
  /** What to do about it. */
  action: string;
}

export interface ResultsTunables {
  /** The card must be on screen this long after `runEnded` at the latest (design §2), ms. */
  appearBudgetMs: number;
  /** Window size the card layout is designed for; on bigger windows the card scales up to 2x. */
  designWidth: number;
  designHeight: number;
  /** Moving-shot fix: fires when moving shots exceed this share of all shots (issue #26: 15%). */
  movingShotShare: number;
  /** Fewest shots before accuracy-style advice means anything. */
  minShotsForFix: number;
  /** Slow-time-to-shot fix: needs this many targets with a measured time to shot. */
  minTimedTargets: number;
  /**
   * Time-to-shot baseline by dial: linear from `dial0Ms` (dial 0) to `dial100Ms` (dial 100). A
   * median above `baseline × slackFactor` counts as slow. HYPOTHESIS: ranges from
   * `docs/research/human-performance.md` §1 (small relocation 0.45–0.9 s, pre-aimed 0.25–0.35 s);
   * to be replaced by the player's own rating baseline in #39.
   */
  slowTimeToShot: { dial0Ms: number; dial100Ms: number; slackFactor: number };
  /** Where the next run's seed comes from: `seed * mul + add` (mod 2^32), so every "play again" is a fresh layout. */
  nextSeed: { mul: number; add: number };
  /** Display names by mode id; unknown ids are title-cased. */
  modeLabels: Record<string, string>;
  /** The two key metrics of a mode; `defaultKeyMetrics` for modes not listed. */
  keyMetrics: Record<string, readonly [MetricId, MetricId]>;
  defaultKeyMetrics: readonly [MetricId, MetricId];
  /**
   * Modes whose kills are one bullet by design (a one-tap headshot on a Post or a Beacon): their "Time to kill"
   * (first shot to death) is ~0 ms and says nothing, so the card shows `oneBulletTile` in its place (#175).
   */
  oneBulletModes: readonly string[];
  oneBulletTile: MetricId;
  /** Badge colour per tier, lowest first (design §8.4: Chalk, Brass, Steel, Cobalt, Neon, Prism, Zenith). The badge always carries the tier name too. */
  tierColours: readonly string[];
  /** Why the run ended, shown above the mode name (`left` = a Leave gate, design §4.7). */
  endLabels: Record<string, string>;
  /**
   * The run results card (design §8.2). `modes` are the modes whose runs are sector runs: they get the six headline
   * stats of §8.2 and the route and situation rows; `routeSectors` is the sector count before Overtime (the Finale is
   * the last); `maxSectors` caps the route strip.
   */
  run: {
    modes: readonly string[];
    routeSectors: number;
    maxSectors: number;
    /** The six headline stats, in order (`StatCell` ids). */
    headline: readonly string[];
    /** Tiles wrap to a second row above this many. */
    tilesPerRow: number;
    /** A sector that cost at least this much health shows its HP in the damage colour. */
    hurtHp: number;
  };
  /** Words on the route strip and the fights row; unknown ids are title-cased, an empty string hides the word. */
  roleLabels: Record<string, string>;
  conditionLabels: Record<string, string>;
  stakeLabels: Record<string, string>;
  /** Scenario cards (design §4.4). */
  cardLabels: Record<string, string>;
  /** The header's depth line. */
  depthCopy: { sector: string; finale: string; finaleDied: string; overtime: string; routeDone: string };
  /** Display names of the skills the rating row names (`line` = the mean of all seven). */
  skillLabels: Record<string, string>;
  /** Display names of medal ids (design §8.4); unknown ids are title-cased. */
  medalLabels: Record<string, string>;
  copy: {
    movingShots: FixCopy;
    /** Same, when the stopped-vs-moving hit rates cannot be compared (no stopped shots, or no moving hits to compare). */
    movingShotsNoSplit: FixCopy;
    slowTimeToShot: FixCopy;
    /** Nothing stood out, or there was too little to judge. */
    placeholder: FixCopy;
    /** No shots were fired at all. */
    empty: FixCopy;
  };
}

export const results: ResultsTunables = {
  appearBudgetMs: 100,
  designWidth: 1280,
  designHeight: 720,
  movingShotShare: 0.15,
  minShotsForFix: 8,
  minTimedTargets: 3,
  slowTimeToShot: { dial0Ms: 950, dial100Ms: 450, slackFactor: 1.2 },
  nextSeed: { mul: 1664525, add: 1013904223 },
  modeLabels: {
    coldStart: 'Cold Start',
    orbit: 'Orbit',
    placement: 'Placement',
    strafeTrack: 'Strafe Track',
    stopAndPop: 'Stop & Pop',
    sprayWall: 'Spray Wall',
    switchboard: 'Switchboard',
    cornerClear: 'Corner Clear',
    sweep: 'Sweep',
    freeplay: 'Free run',
  },
  keyMetrics: {
    coldStart: ['firstShotRate', 'preAimError'],
    placement: ['firstShotRate', 'flickBias'],
    orbit: ['flickBias', 'flickError'],
    strafeTrack: ['timeOnTarget', 'leadError'],
    stopAndPop: ['stopLatency', 'cleanKills'],
    cornerClear: ['preAimError', 'headHeight'],
    sweep: ['depth', 'contacts'],
  },
  defaultKeyMetrics: ['firstShotRate', 'preAimError'],
  oneBulletModes: ['coldStart', 'orbit', 'placement'],
  oneBulletTile: 'cleanStreak',
  tierColours: ['#aab4c2', '#d9a35a', '#9fb4cc', '#5b8cff', '#38e8ff', '#c792ff', '#ffd23f'],
  endLabels: { timer: "Time's up", death: 'Eliminated', complete: 'Run complete', left: 'Made it out', quit: 'Run ended early' },
  run: {
    modes: ['sweep'],
    routeSectors: 6,
    maxSectors: 16,
    headline: ['accuracy', 'headshotRate', 'timeToShot', 'ttk', 'movingShots', 'stopLatency'],
    tilesPerRow: 8,
    hurtHp: 30,
  },
  roleLabels: { take: 'Take', hold: 'Hold', meet: 'Meet' },
  conditionLabels: { full: '', light: 'Light', eco: 'Eco', cold: 'Cold' },
  stakeLabels: { plain: '', shield: 'Shield', arms: 'Arms', hot: 'Hot' },
  cardLabels: {
    'take-expected': 'Take, expected',
    'take-unaware': 'Take, unaware',
    hold: 'Hold',
    clear: 'Clear',
    trade: 'Trade',
    meet: 'Meet',
    breach: 'Breach',
    crossfire: 'Crossfire',
    flank: 'Flank',
    'known-duel': 'Known duel',
  },
  depthCopy: {
    sector: 'Sector {n} of {total}',
    finale: 'Finale cleared',
    finaleDied: 'Fell in the Finale',
    overtime: 'Overtime {k}',
    routeDone: 'Route cleared, {n} sectors',
  },
  skillLabels: {
    precision: 'Precision', flick: 'Flick', track: 'Tracking', footwork: 'Footwork', spray: 'Spray control',
    switch: 'Target switching', angles: 'Angles', line: 'Line rating',
  },
  medalLabels: {
    needle: 'Needle',
    coldOpen: 'Cold Open',
    planted: 'Planted',
    hairline: 'Hairline',
    pendulum: 'Pendulum',
    thread: 'Thread',
    quickStudy: 'Quick Study',
    cleanCorner: 'Clean Corner',
    untouched: 'Untouched',
    flawless: 'Flawless',
    closer: 'Closer',
    cashed: 'Cashed',
    ascent: 'Ascent',
    // The 14th medal (a cold opener whose trend reports "Improved"): its criterion lives with the cold-opener series (#209, #151, #153).
    retained: 'Retained',
  },
  copy: {
    movingShots: {
      title: 'Stop before you shoot',
      evidence: '{share} of your shots ({moving} of {shots}) were fired while moving. Those hit {movingAcc}; shots fired stopped hit {stoppedAcc}.',
      action: 'Tap the opposite strafe key and fire only once your speed has dropped, about 0.1 s later.',
    },
    movingShotsNoSplit: {
      title: 'Stop before you shoot',
      evidence: '{share} of your shots ({moving} of {shots}) were fired while moving, where your aim is far less accurate.',
      action: 'Tap the opposite strafe key and fire only once your speed has dropped, about 0.1 s later.',
    },
    slowTimeToShot: {
      title: 'Get to the first shot sooner',
      evidence: 'Your median time to shot was {rt}, about {over} slower than a typical {baseline} at this difficulty.',
      action: 'Park your crosshair at head height where targets tend to appear, so the flick is short, and click the moment it lands.',
    },
    placeholder: {
      title: 'Play again',
      evidence: 'Nothing stood out this run.',
      action: 'Another run sharpens your rating: press Enter.',
    },
    empty: {
      title: 'Play again',
      evidence: 'No shots were fired this run.',
      action: 'Shoot the first target that appears: your rating needs a few shots to place you. Press Enter.',
    },
  },
};

export const tunableGroups = { results };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
