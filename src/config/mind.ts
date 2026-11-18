/**
 * The enemy mind's numbers (`docs/research/player-like-enemies.md` §5.4 profiles by anchor, §5.3
 * perception and memory, §5.5 caps, §5.6 floors, §5.8 data; issue #88). Pure data read by
 * `sim/mind/profile.ts`; changing a value here never needs a code change. Tuning is the balance
 * pass (#53, #95): every number is a calibration hypothesis, the table's own evidence tags are in
 * the research document.
 *
 * Units: seconds, metres, degrees only in names ending `Deg`, probabilities and shares 0..1.
 * Angles stay in degrees in the profile (the aim model converts once). Nothing here is `Infinity`
 * (tunables are cloned through JSON): "never" is a distance beyond any engagement, `NEVER_M`.
 *
 * Where a number already has one home it is not copied here: the reaction and tell floors are
 * `dial.floors` (#17, #127), the shift for an expecting enemy and the orientation cost are
 * `expectation` (#127), and how far a sound carries is `attribution.soundRadiusM` (#99), scaled by
 * `hearing.radiusScale` (1 = the enemy hears the player exactly as far as the player hears it).
 */

/** The four anchor positions of the mind skill (§5.4 column heads). Ascending, first 0, last 100. */
export type AnchorSkills = readonly [number, number, number, number];

/** One parameter's value at the four anchors. */
export type Anchored = readonly [number, number, number, number];

/** A distance meaning "never" for the burst policy: beyond the farthest engagement the maps allow. */
export const NEVER_M = 60;

/**
 * Every anchored parameter, in the order of the research table (§5.4). This list is the profile's
 * shape: `profileFor` fills one number per entry, with no allocation.
 */
export const MIND_PARAMS = [
  // Reaction: ex-Gaussian mu / sigma / tau (seconds), before the expectation shift and the floor.
  'reactionMuSec', 'reactionSigmaSec', 'reactionTauSec',
  // Where the crosshair rests while holding: degrees below head centre, mean and SD.
  'holdOffsetMeanDeg', 'holdOffsetSdDeg',
  'wideSwingAnticipation', 'offAngleHold',
  // Aim: Fitts throughput, primary-submovement amplitude error, correction, settle, swipe.
  'flickThroughputBps', 'amplitudeBias', 'amplitudeSd', 'correctionDelaySec', 'settleNoiseDeg', 'swipeShare',
  'trackingDelaySec', 'trackingLeadGain',
  // Aim model (#90): how far below the head centre the duel aim point sits, and how much the mind leads
  // through a reversal it has learnt from a regular strafe rhythm. Not in the research table: see `anchors`.
  'aimDropM', 'rhythmGain',
  // Shooting: moving-shot habit, the delay after the accuracy gate opens, recoil control, burst policy.
  'movingShotShare', 'shotAfterGateSec', 'sprayCompensation',
  'sprayBelowM', 'tapBeyondM', 'burstMin', 'burstMax',
  // Movement habits.
  'strafeLegMedianSec', 'strafeLegCv', 'crouchOnFiring', 'crouchMaxPerDuel',
  // Peek mix when contesting (weights, sum 1).
  'peekWide', 'peekJiggle', 'peekShoulder', 'peekJump', 'peekCrouch', 'peekWalk',
  // After contact.
  'retreatAfterDamage', 'reloadInOpen', 'repeekSame', 'repeekDelayMedianSec', 'repeekInstantShare',
  'tradeChance', 'tradeSwingDelayMedianSec', 'preFire',
  // Hearing: error of the estimated position is `max(floor, fraction x distance)` metres (§5.3).
  'hearErrorFloorM', 'hearErrorFrac',
  // Calibration target for signature S7 (harness #53), not behaviour: headshot share of the enemy's hits.
  'calibrationHeadshotShare',
] as const;
export type MindParam = (typeof MIND_PARAMS)[number];

/** A bound applied to one parameter after interpolation and jitter. */
export interface ParamBound {
  param: MindParam;
  value: number;
}

export interface MindTunables {
  /** Mind skill value of each anchor column. */
  anchorSkills: AnchorSkills;
  /** The §5.4 table: one row per parameter, one value per anchor. Linear between anchors. */
  anchors: Record<MindParam, Anchored>;

  /**
   * Personality (§5.4): a multiplicative factor `1 + spread x (2u - 1)`, `u` uniform, drawn per enemy
   * at spawn from its personality stream. `reaction`, `aimNoise` and `aggression` are one draw each
   * and move every parameter of their group together; `habit` is one independent draw per habit rate.
   * A spread of 0 turns a trait off without changing the stream. (Reaction ±12%, aim noise ±20%,
   * aggression ±25%, habit rates ±20%; the ±20% mirrors the P25-P75 width of headshot rate in a rank.)
   */
  spread: { reaction: number; aimNoise: number; aggression: number; habit: number };
  groups: {
    /** Scaled by the reaction factor. */
    reaction: readonly MindParam[];
    /** Scaled by the aim-noise factor (more noise = a worse aim). */
    aimNoise: readonly MindParam[];
    /** Scaled by the aggression factor: willingness to contest, so a keener enemy trades, pre-fires, swipes more. */
    aggressionUp: readonly MindParam[];
    /** Scaled by `2 - factor`: what a keener enemy does less (backing out after damage). */
    aggressionDown: readonly MindParam[];
    /** Each scaled by its own independent draw; the peek mix is renormalised to sum 1 afterwards. */
    habit: readonly MindParam[];
    /** Clamped to 0..1 after jitter. */
    probabilities: readonly MindParam[];
    /** The weights that are renormalised to sum 1 after jitter. */
    peekMix: readonly MindParam[];
  };

  /**
   * Floors and ceilings applied after interpolation and jitter, so no tuning of the table or the
   * spreads can make an enemy superhuman (§5.4 "never superhuman", §5.6 F4). The reaction and tell
   * floors are not here: they are `dial.floors`, copied into the profile.
   */
  minimums: readonly ParamBound[];
  maximums: readonly ParamBound[];

  /** Caps on the view (§5.5 step 7): no instantaneous view change, ever. */
  caps: {
    /** Fastest the view turns, degrees per second. */
    angularSpeedDegPerSec: number;
    /** Fastest the turning rate changes, degrees per second squared. Keeps a flick from beating its Fitts time. */
    angularAccelDegPerSec2: number;
  };

  /** What the enemy perceives (§5.3). */
  perception: {
    /** Half angle of the attention cone around the view direction (±15°). */
    attentionHalfAngleDeg: number;
    /** Seconds in which a remembered position loses half its confidence; never refreshed without new perception. */
    memoryHalfLifeSec: number;
    /** A teammate's sighting reaches this enemy after a lognormal delay with this median (a human callout). */
    shareDelayMedianSec: number;
    shareDelayCv: number;
    /** Decision points are drawn per enemy from a lognormal with this median and CV (§5.2), so groups never decide on one tick. */
    decisionIntervalMedianSec: number;
    decisionIntervalCv: number;
  };

  hearing: {
    /** Multiplies `attribution.soundRadiusM` per sound kind; 1 = symmetric with the player's hearing. */
    radiusScale: { footstep: number; landing: number; reload: number; shot: number };
  };

  /**
   * The aim model (§5.5, `sim/mind/aim.ts`, #90): how a mind turns its view. The per-profile numbers
   * (throughput, amplitude error, correction delay, settle noise, tracking delay and lead) are anchor
   * rows; these are the shared shape constants. HYPOTHESIS values, tuned with the signatures S2-S4.
   */
  aim: {
    /** Motor noise SD along the movement, as a fraction of the current angular speed (Yoon et al.: signal-dependent). */
    noiseAlong: number;
    /** Across-movement noise SD as a share of the along SD (Yoon et al.: 0.192). */
    noiseAcrossRatio: number;
    /** Correlation time of the motor noise, seconds: smooth like a hand, not a per-tick buzz. */
    noiseTauSec: number;
    /** Shortest submovement, seconds (a Fitts time below this is not a human movement). */
    minMoveSec: number;
    /** Corrective submovements after the primary, at most (§5.5 step 3: up to three). */
    maxCorrections: number;
    /** Coefficient of variation of the lognormal correction delay (its median is the profile's `correctionDelaySec`). */
    correctionDelayCv: number;
    /** A correction is needed when the error exceeds the aimed zone's angular radius times this. */
    correctTolerance: number;
    /** Settle drift (§5.5 step 4): one knot of value noise per segment, the segment length drawn uniform in this range, seconds. */
    driftMinSec: number;
    driftMaxSec: number;
    /** Pursuit while settled: the error to the aim point closes with this time constant, seconds. */
    pursuitTauSec: number;
    /** While settled, an error beyond this many zone radii (and at least `catchUpMinDeg`) starts a catch-up submovement. */
    catchUpZones: number;
    catchUpMinDeg: number;
    /** Velocity of the observed point is estimated over this window of observations, seconds. */
    velocityWindowSec: number;
    /** After an observed reversal the lead grows back over this long (a human needs time to read a new velocity), seconds. */
    leadRampSec: number;
    /** Lateral speed (m/s) above which the observed point counts as moving one way (reversal detection). */
    reversalSpeedMps: number;
    /** Two strafe legs are "regular" when they differ by at most this fraction of their mean. */
    rhythmTolerance: number;
    /** Observations kept per enemy (ring length, ticks): must cover the longest tracking delay plus the velocity window. */
    historyTicks: number;
  };

  /**
   * When a mind shoots (§5.5 step 6, `sim/mind/duel.ts`, #90). Profile rows give the habits (moving-shot
   * share, shot-after-gate delay, swipe share, spray compensation); these are shared. Bursts and the
   * rest between them are design §5.3's (`enemies.fire`) until the duel state (#91) uses the profile's
   * burst policy.
   */
  shoot: {
    /** Fires when the error to its aim point is within the aimed zone's angular radius times this. */
    onTargetZones: number;
    /** CV of the lognormal shot-after-gate delay (the median is the profile's `shotAfterGateSec`). */
    shotAfterGateCv: number;
    /** A swipe may fire once the primary submovement is this far along (0..1) and on target. */
    swipeFromProgress: number;
  };

  /** Not looking robotic (§5.7). */
  variety: {
    /** An enemy never repeats the same peek pattern more than this many times in a row (the rule is "not three"). */
    peekPatternMaxRun: number;
    /** A re-peek delay never lands within this fraction of the previous one. */
    repeekDelayMinDifference: number;
  };
}

export const mind: MindTunables = {
  anchorSkills: [0, 35, 65, 100],
  anchors: {
    reactionMuSec: [0.43, 0.33, 0.27, 0.235],
    reactionSigmaSec: [0.06, 0.045, 0.03, 0.022],
    reactionTauSec: [0.22, 0.14, 0.085, 0.055],
    holdOffsetMeanDeg: [6, 3, 1.2, 0.4],
    holdOffsetSdDeg: [4, 2.5, 1.2, 0.6],
    wideSwingAnticipation: [0.05, 0.15, 0.35, 0.55],
    offAngleHold: [0, 0.05, 0.15, 0.3],
    flickThroughputBps: [3.5, 4.5, 5.6, 7.0],
    amplitudeBias: [-0.04, -0.05, -0.06, -0.06],
    amplitudeSd: [0.16, 0.11, 0.08, 0.06],
    correctionDelaySec: [0.2, 0.17, 0.14, 0.12],
    settleNoiseDeg: [1.6, 0.9, 0.5, 0.3],
    swipeShare: [0.05, 0.15, 0.35, 0.55],
    trackingDelaySec: [0.26, 0.22, 0.19, 0.16],
    trackingLeadGain: [0, 0.3, 0.6, 0.85],
    // #90, not in the research table. `aimDropM`: the duel aim point, metres below the head centre (§5.5:
    // "head centre at the top anchors, upper chest at m = 0"); calibrated with `settleNoiseDeg` so the
    // headshot share of hits lands on `calibrationHeadshotShare` (signature S7, the calibration report on
    // #90). `rhythmGain`: weight of the learnt-rhythm prediction over plain linear lead once a strafe
    // rhythm is regular (S4: a regular ADAD is tracked under 120 ms at m >= 65, a random one is not).
    aimDropM: [0.42, 0.26, 0.195, 0.15],
    rhythmGain: [0, 0.2, 0.85, 1],
    movingShotShare: [0.5, 0.3, 0.15, 0.06],
    shotAfterGateSec: [0.18, 0.14, 0.1, 0.07],
    sprayCompensation: [0.25, 0.45, 0.65, 0.82],
    // Burst policy. Spray (full auto) closer than `sprayBelowM`, taps (single shots) beyond `tapBeyondM`,
    // bursts of `burstMin`..`burstMax` between. m=0 sprays at every range (no taps, no bursts: NEVER_M);
    // m=35 sprays up to 20 m, bursts of 4-6 beyond (no taps); m=65 taps beyond 25 m, bursts of 2-4 at
    // 12-25 m, sprays under 12 m; m=100 taps beyond 20 m, bursts of 2-3 at 10-20 m, sprays under 10 m.
    sprayBelowM: [NEVER_M, 20, 12, 10],
    tapBeyondM: [NEVER_M, NEVER_M, 25, 20],
    burstMin: [4, 4, 2, 2],
    burstMax: [6, 6, 4, 3],
    strafeLegMedianSec: [0.9, 0.65, 0.5, 0.42],
    // The mid tier is deliberately regular (low CV): a habit a player can learn (§2.4).
    strafeLegCv: [0.25, 0.15, 0.3, 0.45],
    crouchOnFiring: [0.55, 0.45, 0.25, 0.15],
    // Only the top anchor limits it ("max twice per duel"); the others never reach 8 in one duel.
    crouchMaxPerDuel: [8, 8, 8, 2],
    peekWide: [0.6, 0.65, 0.5, 0.4],
    peekJiggle: [0.05, 0.1, 0.22, 0.3],
    peekShoulder: [0.05, 0.05, 0.12, 0.15],
    peekJump: [0, 0.02, 0.05, 0.07],
    peekCrouch: [0.05, 0.08, 0.06, 0.06],
    peekWalk: [0.25, 0.1, 0.05, 0.02],
    retreatAfterDamage: [0.15, 0.3, 0.55, 0.75],
    reloadInOpen: [0.6, 0.4, 0.15, 0.05],
    repeekSame: [0.75, 0.6, 0.35, 0.15],
    repeekDelayMedianSec: [1.4, 1.6, 2.0, 2.4],
    repeekInstantShare: [0.05, 0.08, 0.12, 0.2],
    tradeChance: [0.25, 0.45, 0.7, 0.9],
    tradeSwingDelayMedianSec: [1.6, 1.2, 0.9, 0.7],
    preFire: [0, 0.1, 0.35, 0.55],
    // Not in the research table: the §5.3 sentence gives the ends (max(1.0, 0.25 d) at the lowest anchor,
    // max(0.5, 0.10 d) at the top); the two middle columns are the straight line between them.
    hearErrorFloorM: [1.0, 0.825, 0.675, 0.5],
    hearErrorFrac: [0.25, 0.1975, 0.1525, 0.1],
    calibrationHeadshotShare: [0.09, 0.15, 0.23, 0.3],
  },

  spread: { reaction: 0.12, aimNoise: 0.2, aggression: 0.25, habit: 0.2 },
  groups: {
    reaction: ['reactionMuSec', 'reactionSigmaSec', 'reactionTauSec'],
    aimNoise: ['holdOffsetMeanDeg', 'holdOffsetSdDeg', 'amplitudeSd', 'settleNoiseDeg'],
    aggressionUp: ['wideSwingAnticipation', 'swipeShare', 'movingShotShare', 'repeekInstantShare', 'tradeChance', 'preFire'],
    aggressionDown: ['retreatAfterDamage'],
    habit: [
      'offAngleHold', 'crouchOnFiring', 'reloadInOpen', 'repeekSame',
      'peekWide', 'peekJiggle', 'peekShoulder', 'peekJump', 'peekCrouch', 'peekWalk',
    ],
    probabilities: [
      'wideSwingAnticipation', 'offAngleHold', 'swipeShare', 'movingShotShare', 'sprayCompensation', 'crouchOnFiring',
      'retreatAfterDamage', 'reloadInOpen', 'repeekSame', 'repeekInstantShare', 'tradeChance', 'preFire',
      'trackingLeadGain', 'rhythmGain', 'calibrationHeadshotShare',
    ],
    peekMix: ['peekWide', 'peekJiggle', 'peekShoulder', 'peekJump', 'peekCrouch', 'peekWalk'],
  },

  // Human limits (§5.4 "top ranks, never superhuman"; §5.5 "never zero"). HYPOTHESIS values: just under
  // the top anchor, so jitter at m = 100 may sharpen an enemy a little but never past them.
  minimums: [
    { param: 'reactionSigmaSec', value: 0.015 },
    { param: 'correctionDelaySec', value: 0.1 },
    { param: 'settleNoiseDeg', value: 0.2 },
    { param: 'amplitudeSd', value: 0.04 },
    { param: 'trackingDelaySec', value: 0.14 },
    { param: 'shotAfterGateSec', value: 0.05 },
  ],
  maximums: [
    { param: 'flickThroughputBps', value: 8 },
    { param: 'trackingLeadGain', value: 0.95 },
    { param: 'sprayCompensation', value: 0.9 },
  ],

  // HYPOTHESIS (§5.5 step 7): 1,500 deg/s as the §5.5 cap; the acceleration cap sits above the
  // minimum-jerk peak of a 90 degree flick at the top throughput (about 6,000 deg/s^2).
  caps: { angularSpeedDegPerSec: 1500, angularAccelDegPerSec2: 12000 },

  perception: {
    attentionHalfAngleDeg: 15,
    memoryHalfLifeSec: 2,
    shareDelayMedianSec: 0.8,
    shareDelayCv: 0.4,
    decisionIntervalMedianSec: 0.12,
    decisionIntervalCv: 0.3,
  },

  hearing: { radiusScale: { footstep: 1, landing: 1, reload: 1, shot: 1 } },

  aim: {
    noiseAlong: 0.06,
    noiseAcrossRatio: 0.192,
    noiseTauSec: 0.04,
    minMoveSec: 0.08,
    maxCorrections: 3,
    correctionDelayCv: 0.25,
    correctTolerance: 2,
    driftMinSec: 0.3,
    driftMaxSec: 0.8,
    pursuitTauSec: 0.06,
    catchUpZones: 4,
    catchUpMinDeg: 3,
    velocityWindowSec: 0.05,
    leadRampSec: 0.6,
    reversalSpeedMps: 0.8,
    rhythmTolerance: 0.15,
    historyTicks: 64,
  },

  shoot: {
    onTargetZones: 1.5,
    shotAfterGateCv: 0.3,
    swipeFromProgress: 0.6,
  },

  variety: { peekPatternMaxRun: 2, repeekDelayMinDifference: 0.1 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { mind };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
