/**
 * Difficulty dial and skill-model tunables (design §8.4 tiers, §9.1–9.4). Pure data: the model in
 * `adaptive/` reads everything from here, so balancing (#53) is a data change.
 *
 * The axis end points and floors are the design's values (§9.3.5, §9.4). Research #12
 * (`docs/research/human-performance.md` §4–5, proposals P5/P6) proposes changes to several of them;
 * they are noted per row below and are for the balance pass (#53) to adopt: numbers only, no code.
 */

/** The seven trained skills (design §3). */
export const SKILL_IDS = ['precision', 'flick', 'track', 'footwork', 'spray', 'switch', 'angles'] as const;
export type SkillId = (typeof SKILL_IDS)[number];

/** One-tap self-report before the first run (design §9.2). */
export type SelfReport = 'new' | 'some' | 'experienced' | 'competitive' | 'skip';

/** How an axis interpolates between its dial-0 and dial-100 values. */
export type AxisCurve = 'linear' | 'geometric' | 'step';

export interface AxisDef {
  /** Value at dial 0. */
  at0: number;
  /** Value at dial 100. */
  at100: number;
  /** linear: straight line; geometric: constant ratio per dial point; step: integer in equal bands. */
  curve: AxisCurve;
}

/** Design §9.4. Every axis maps the 0–100 dial to a value; each mode uses a subset. */
export interface DialAxesTunables {
  /** Beacon radius as a multiple of the real head radius (Orbit). */
  beaconScale: AxisDef;
  /** Target distance in metres (humanoid modes). */
  distance: AxisDef;
  /** Orbit: angular distance from the previous Beacon, lower and upper bound (degrees). */
  flickMinDeg: AxisDef;
  flickMaxDeg: AxisDef;
  /** Strafer speed (m/s). */
  strafeSpeed: AxisDef;
  /** Strafer leg duration (s) and stand-still window after the 0.16 s decel (s). */
  strafeLegSec: AxisDef;
  standStillSec: AxisDef;
  /** Time a timed target stays exposed (s). */
  exposureSec: AxisDef;
  /** Peeker wide-peek exposure (s). */
  peekWideSec: AxisDef;
  /** Enemy reaction (first sight to tell start) and tell duration (s). */
  enemyReactionSec: AxisDef;
  tellSec: AxisDef;
  /** Enemy hit probability per shot at standstill. */
  enemyHitChance: AxisDef;
  /** Simultaneous targets. */
  density: AxisDef;
}

/** Design §9.3.5. Applied after the axis mapping, so no tuning of the end points can break them. */
export interface FairnessFloors {
  tellSec: number;
  /** Applies to exposureSec and peekWideSec. */
  exposureSec: number;
  enemyReactionSec: number;
  /** Minimum target scale relative to the spec's real head size (`hit.head_radius`). */
  minTargetScale: number;
  /** No spawn closer than this ... */
  spawnMinDistance: number;
  /** ... inside this angle from the view direction (degrees). */
  spawnViewAngleDeg: number;
}

export interface TierDef {
  name: string;
  /** Lower dial bound (inclusive). The band ends where the next tier starts (or at 100). */
  from: number;
  /** Divisions I–III (thirds of the band); false shows the number only. */
  divisions: boolean;
}

/**
 * Which skill a mode's dial follows and the success rate it aims for (design §9.3.1).
 * `skill: 'line'` follows the Line Rating (mean of all seven), used by Sweep.
 */
export interface ModeDialDef {
  skill: SkillId | 'line';
  targetSuccess: number;
}

export interface DialTunables {
  /** Grid posterior resolution: points from 0 to 100 inclusive (201 = 0.5 dial steps). */
  gridPoints: number;
  /** Logistic scale `s` used to aim the dial at a success rate (design §9.1). */
  scale: number;
  /** Asymmetric likelihood scales (design §9.3.3): faster up than down. */
  scaleSuccess: number;
  scaleFailure: number;
  /**
   * Random-walk drift added to every posterior per trial (dial points, s.d.). Keeps the estimate
   * able to follow a player who improves or declines; 0 freezes it after enough trials.
   * Not in the design: an addition noted on #17.
   */
  driftPerTrial: number;
  /** Likelihood weight applied to skills that have not been played yet (design §9.2: 40 %). */
  correlation: number;
  /** Prior means by self-report and the shared prior s.d. (design §9.2). */
  priorMean: Record<SelfReport, number>;
  priorSd: number;
  /** Rating shown to players = dial x this (design §8.4: 0–3000). */
  ratingPerDial: number;
  /** Placement staircase (design §9.2): 2-up/1-down. */
  staircase: {
    startStep: number;
    minStep: number;
    /** Consecutive successes needed to step up. */
    upAfter: number;
    /** Reversals averaged for the sanity bound. */
    reversalsForBound: number;
    /** Max distance (dial) between the posterior mean and the staircase estimate. */
    sanityBound: number;
  };
  /** Steady-state scheduling (design §9.3.2). */
  beat: {
    /** Seconds per beat in drills (Sweep beats are contacts). */
    drillSec: number;
    /** Max change of the matched dial per beat. */
    maxStep: number;
  };
  /**
   * Wave curves: dial offset per beat, applied on top of the matched dial. Index 0 is the warm-up;
   * past the end the curve repeats from index 1 (build, peak, breather), never the warm-up.
   */
  waves: { drill: number[]; sweep: number[]; flat: number[] };
  modes: Record<string, ModeDialDef>;
  axes: DialAxesTunables;
  floors: FairnessFloors;
  /** Ascending by `from`; first must start at 0 (design §8.4). */
  tiers: TierDef[];
}

export const dial: DialTunables = {
  gridPoints: 201,
  scale: 9,
  scaleSuccess: 8,
  scaleFailure: 10,
  driftPerTrial: 0.2,
  correlation: 0.4,
  priorMean: { new: 15, some: 35, experienced: 55, competitive: 75, skip: 40 },
  priorSd: 25,
  ratingPerDial: 30,
  staircase: { startStep: 16, minStep: 2, upAfter: 2, reversalsForBound: 4, sanityBound: 10 },
  beat: { drillSec: 10, maxStep: 3 },
  waves: {
    // warm-up -8, build, peak +6, breather -6 (design §9.3.2); 6 beats = one 60 s drill
    drill: [-8, -3, 0, 3, 6, -6],
    sweep: [-8, -2, 2, 6, -6],
    flat: [0],
  },
  modes: {
    // `test` is the mode framework's TestMode (`modes/testMode.ts`): a demo/test fixture, not a shipped mode.
    test: { skill: 'precision', targetSuccess: 0.7 },
    coldStart: { skill: 'precision', targetSuccess: 0.55 },
    orbit: { skill: 'flick', targetSuccess: 0.7 },
    strafeTrack: { skill: 'track', targetSuccess: 0.7 },
    stopAndPop: { skill: 'footwork', targetSuccess: 0.7 },
    sprayWall: { skill: 'spray', targetSuccess: 0.7 },
    switchboard: { skill: 'switch', targetSuccess: 0.7 },
    cornerClear: { skill: 'angles', targetSuccess: 0.7 },
    sweep: { skill: 'line', targetSuccess: 0.7 },
  },
  axes: {
    beaconScale: { at0: 3.0, at100: 1.0, curve: 'linear' },
    // #12 proposes 5 -> 35 m (50 m is below the first-shot cone).
    distance: { at0: 5, at100: 50, curve: 'geometric' },
    // #12 proposes 20–40° -> 60–120° (120–180° only above dial 85, rare).
    flickMinDeg: { at0: 20, at100: 90, curve: 'linear' },
    flickMaxDeg: { at0: 40, at100: 180, curve: 'linear' },
    strafeSpeed: { at0: 2.0, at100: 5.4, curve: 'linear' },
    // #12 proposes leg 0.35 s and stand-still 0.25 s at dial 100.
    strafeLegSec: { at0: 1.0, at100: 0.3, curve: 'linear' },
    standStillSec: { at0: 0.4, at100: 0.2, curve: 'linear' },
    // #12 proposes exposure per mode (Orbit 2.5 -> 1.6 s, Cold Start 2.5 -> 1.05 s, Stop & Pop
    // 2.0 -> 0.7 s) instead of one curve, and a wide peek of 1.4 -> 0.45 s.
    exposureSec: { at0: 3.0, at100: 0.45, curve: 'geometric' },
    peekWideSec: { at0: 1.4, at100: 0.3, curve: 'geometric' },
    enemyReactionSec: { at0: 1.2, at100: 0.3, curve: 'linear' },
    // #12 proposes 0.7 -> 0.30 s (0.18 s is below mean simple reaction time).
    tellSec: { at0: 0.5, at100: 0.18, curve: 'linear' },
    enemyHitChance: { at0: 0.15, at100: 0.6, curve: 'linear' },
    density: { at0: 1, at100: 6, curve: 'step' },
  },
  // #12 proposes tell >= 0.25 s, exposure floors per mode, and spawn rules of no visible target
  // closer than 4 m where enemies shoot and none in the view cone closer than 5 m.
  floors: {
    tellSec: 0.15,
    exposureSec: 0.3,
    enemyReactionSec: 0.25,
    minTargetScale: 1.0,
    spawnMinDistance: 3,
    spawnViewAngleDeg: 90,
  },
  tiers: [
    { name: 'Chalk', from: 0, divisions: true },
    { name: 'Brass', from: 14, divisions: true },
    { name: 'Steel', from: 28, divisions: true },
    { name: 'Cobalt', from: 42, divisions: true },
    { name: 'Neon', from: 58, divisions: true },
    { name: 'Prism', from: 72, divisions: true },
    { name: 'Zenith', from: 86, divisions: false },
  ],
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { dial };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
