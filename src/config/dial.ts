/**
 * Difficulty dial and skill-model tunables (design §8.4 tiers, §9.1–9.4). Pure data: the model in
 * `adaptive/` reads everything from here, so balancing (#53) is a data change.
 *
 * The axis end points and floors are the design's values (§9.3.5, §9.4), which adopt research #12
 * (`docs/research/human-performance.md` §4–5, proposals P5/P6) and #52 (`docs/research/cues.md` R8)
 * (#130). Tuning beyond those values is the balance pass (#53): numbers only, no code.
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
  /**
   * Time a timed target stays exposed (s); counted from its spawn today, from `targetVisible` once
   * #143 lands (design §9.3.5). `exposureSec` is the
   * generic curve for pre-aimed targets; a target that needs the crosshair to move gets its own
   * axis, because the time it needs covers reaction plus the aiming movement (design §9.4, #12 §4.1).
   */
  exposureSec: AxisDef;
  /** Orbit Beacon time to live (also the Placement run's Orbit-style trials). */
  orbitExposureSec: AxisDef;
  /** Cold Start Post exposure (also the Placement run's Cold-Start-style trials). */
  coldStartExposureSec: AxisDef;
  /** Stop & Pop target exposure (#47). */
  stopAndPopExposureSec: AxisDef;
  /** Peeker wide-peek exposure (s). */
  peekWideSec: AxisDef;
  /** Enemy reaction (first sight to tell start) and tell duration (s). */
  enemyReactionSec: AxisDef;
  tellSec: AxisDef;
  /** Enemy hit probability per shot at standstill. */
  enemyHitChance: AxisDef;
  /** Simultaneous targets. */
  density: AxisDef;
  /** Spray Wall: the share of a spray's bullets that must land in the head or body zone (design §4.5). */
  sprayHitFraction: AxisDef;
}

/**
 * Design §9.3.5. Applied after the axis mapping, so no tuning of the end points can break them.
 * The enemy reaction and tell floors are split by expectation (#127): `tellSec` and
 * `enemyReactionSec` bind an enemy the player surprised; a prepared holder (expects the player at
 * this spot) is bound only by `preparedReactionSec` and never holds fire for a tell
 * (`sim/enemyTiming.ts`).
 */
export interface FairnessFloors {
  tellSec: number;
  /** Pre-aimed minimum: applies to every exposure axis and to every timed target the runner spawns. */
  exposureSec: number;
  /** Per-mode exposure floors: the minimum feasible time (reaction + aiming movement, #12 §4.1). */
  orbitExposureSec: number;
  coldStartExposureSec: number;
  stopAndPopExposureSec: number;
  enemyReactionSec: number;
  /**
   * Reaction floor for a prepared holder: no ordinary mouse click answers a visual onset faster
   * (`docs/research/human-performance.md` §1.1), so a prepared enemy is never superhuman.
   */
  preparedReactionSec: number;
  /** Minimum target scale relative to the spec's real head size (`hit.head_radius`). */
  minTargetScale: number;
  /** No target spawns (or becomes armed) closer than this to the player's eye, in any direction (m). */
  spawnMinDistance: number;
  /** No target spawns closer than this (m) ... */
  spawnViewConeDistance: number;
  /** ... inside the view cone, this many degrees either side of the view direction (half the 103° FOV). */
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

/**
 * The tell-cue axis (design §5.3, §7.4, issue #129): how loud the *added* tell cues (head-node flare,
 * laser line, rising tone) are, 1 = full, 0 = gone. Full up to `fullBelow`, then a straight ramp to
 * nothing at `goneAbove`. Above that only the true cues remain (weapon raise, stop, muzzle flash), as
 * in the reference game. It scales the cues only, never the tell *duration* (`tellSec`, floored).
 */
export interface TellCueAxis {
  fullBelow: number;
  goneAbove: number;
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
  tellCue: TellCueAxis;
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
    // The Placement run's own dial is the staircase; this entry only gives it a sensible starting dial (design §9.2).
    placement: { skill: 'flick', targetSuccess: 0.7 },
    strafeTrack: { skill: 'track', targetSuccess: 0.7 },
    stopAndPop: { skill: 'footwork', targetSuccess: 0.7 },
    sprayWall: { skill: 'spray', targetSuccess: 0.7 },
    switchboard: { skill: 'switch', targetSuccess: 0.7 },
    cornerClear: { skill: 'angles', targetSuccess: 0.7 },
    sweep: { skill: 'line', targetSuccess: 0.7 },
  },
  axes: {
    beaconScale: { at0: 3.0, at100: 1.0, curve: 'linear' },
    // 35 m (a 0.46° head) at dial 100, not 50 m: a 50 m head (0.32°) is inside the first-shot
    // spread cone, so success there measures luck (#12 P5).
    distance: { at0: 5, at100: 35, curve: 'geometric' },
    // 60–120° at dial 100, not 90–180°: off-screen targets are found by sound, not sight, and no
    // evidence covers them (#12 P5). The rare 120–180° extreme above dial 85 is #136.
    flickMinDeg: { at0: 20, at100: 60, curve: 'linear' },
    flickMaxDeg: { at0: 40, at100: 120, curve: 'linear' },
    strafeSpeed: { at0: 2.0, at100: 5.4, curve: 'linear' },
    // A 0.20 s stand-still is shorter than mean simple reaction time (0.218 s); 0.25 s is at it,
    // and 0.35 s legs leave time to re-acquire a reversal (#12 P5).
    strafeLegSec: { at0: 1.0, at100: 0.35, curve: 'linear' },
    standStillSec: { at0: 0.4, at100: 0.25, curve: 'linear' },
    // Exposure per mode (#12 §4.1): about 1.3x the minimum feasible time (reaction + aiming
    // movement for the mode's angles and sizes). The generic curve is for pre-aimed targets.
    exposureSec: { at0: 3.0, at100: 0.45, curve: 'geometric' },
    orbitExposureSec: { at0: 2.5, at100: 1.6, curve: 'geometric' },
    coldStartExposureSec: { at0: 2.5, at100: 1.05, curve: 'geometric' },
    stopAndPopExposureSec: { at0: 2.0, at100: 0.7, curve: 'geometric' },
    // A 0.3 s wide peek is shorter than a pre-aimed player's time to shot (#12 §4.1).
    peekWideSec: { at0: 1.4, at100: 0.45, curve: 'geometric' },
    enemyReactionSec: { at0: 1.2, at100: 0.3, curve: 'linear' },
    // 0.30 s at dial 100: the first tell where a typical player's strafe clears the accuracy
    // deadzone before the shot (#12 P5 row 7, #52 R8); 0.18 s was below mean simple reaction time.
    tellSec: { at0: 0.7, at100: 0.3, curve: 'linear' },
    enemyHitChance: { at0: 0.15, at100: 0.6, curve: 'linear' },
    density: { at0: 1, at100: 6, curve: 'step' },
    // Design §4.5: 60% at dial 0 up to 85% at dial 100.
    sprayHitFraction: { at0: 0.6, at100: 0.85, curve: 'linear' },
  },
  // HYPOTHESIS (#129): tells fade over Steel-Cobalt; the settling experiment (#164) moves these.
  tellCue: { fullBelow: 35, goneAbove: 60 },
  // #12 P6 and #52 R8: tell >= 0.25 s (one mean reaction time plus one shot), exposure floors per
  // mode (minimum feasible time, #12 §4.1), and the spawn rule split in two unambiguous parts.
  floors: {
    tellSec: 0.25,
    exposureSec: 0.45,
    orbitExposureSec: 1.25,
    coldStartExposureSec: 0.8,
    stopAndPopExposureSec: 0.55,
    enemyReactionSec: 0.25,
    preparedReactionSec: 0.15,
    minTargetScale: 1.0,
    spawnMinDistance: 4,
    spawnViewConeDistance: 5,
    spawnViewAngleDeg: 51.5,
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
