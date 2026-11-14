/**
 * Enemy perception (issue #89, `docs/research/player-like-enemies.md` §5.3 and rules F1–F3,
 * `docs/research/engagement-information.md` §4.2): what an enemy may know about the player, and how
 * fast it forgets. Pure data read by `sim/perception.ts`. Units: metres, seconds, radians in code
 * (degrees only in names ending `Deg`).
 *
 * Every number marked HYPOTHESIS is a calibration starting value from the research document; #53
 * tunes them against the signatures. The field of view is not here: it is the player's own
 * (`view.hfovDeg`), so both sides share one rule. The sound radii are not here either: they are
 * `attribution.soundRadiusM`, the table the player's hearing of enemies reads, so the two sides cannot
 * drift apart (the symmetric channels of engagement-information §4.2).
 */

export interface PerceptionTunables {
  /**
   * Decision points: how often an enemy looks (sight) and refreshes what it expects. The interval is a
   * lognormal draw (median and CV), clamped, so a group does not decide on the same tick (§5.2:
   * 100–125 ms command granularity). Each enemy's first decision is drawn within one median.
   */
  decisionMedianSec: number;
  decisionCv: number;
  decisionMinSec: number;
  decisionMaxSec: number;
  /** Raycasts one decision point may spend (the sample points below, in order, up to this many). */
  maxRaysPerDecision: number;
  /** Beyond this horizontal distance nothing is seen, whatever the light. */
  sightRangeM: number;
  /**
   * The attention cone: half angle around the view direction inside which reaction uses the
   * profile's base draw; outside it (but in the field of view) the orientation cost applies
   * (§5.3, HYPOTHESIS 40%).
   */
  attentionHalfDeg: number;
  /**
   * Where an enemy samples the player to see him: the eye, the chest, and both shoulders, as
   * fractions of the player's current hull height above the feet (so a crouch lowers them) plus the
   * shoulder half width. Sight needs one of them with a clear ray; the head and the upper body are
   * what a human sees first, and a shoulder peeking round a corner is what gives a peek away.
   */
  samples: {
    chestFrac: number;
    shoulderFrac: number;
    shoulderHalfWidthM: number;
  };
  /**
   * Hearing: a heard sound gives a position estimate with an error radius `max(floor, frac * d)`
   * (§5.3). The two ends are for mind skill 0 and 100; skill in between interpolates linearly
   * (HYPOTHESIS 30%). The estimate is uniform in a disc of that radius around the true feet position.
   */
  hearing: {
    errFloorM: [number, number];
    errFrac: [number, number];
    /** A sound heard again within this many seconds, estimated within the combined error of the last one, is a repeat ... */
    repeatWindowSec: number;
    /** ... and each repeat multiplies the next error by this (so a steady stream of steps narrows the guess) ... */
    repeatShrink: number;
    /** ... down to this fraction of the base error (§2.9: error shrinks with repetition). */
    repeatMinScale: number;
  };
  /** How sure the enemy is of a position at the moment it learns it (1 = looking at the player). */
  confidence: {
    sight: number;
    shot: number;
    landing: number;
    footstep: number;
    reload: number;
    /** A teammate's callout: confidence of the callout itself, before the age since the sighting takes its share. */
    shared: number;
    /** A position the director or a card put in the enemy's head at spawn (engagement-information §4.1). */
    prior: number;
  };
  /**
   * Memory: confidence halves every `halfLifeSec` (§5.3, HYPOTHESIS), is never refreshed without new
   * perception, and the entry is dropped below `forgetBelow` (back to a hold).
   */
  memory: {
    halfLifeSec: number;
    forgetBelow: number;
  };
  /**
   * Shared sightings: a teammate's sighting reaches this enemy after a lognormal delay standing in
   * for a human callout (§5.3: median 0.8 s, HYPOTHESIS 30%). One sighter calls again after
   * `intervalSec` while it keeps seeing the player.
   */
  share: {
    delayMedianSec: number;
    delayCv: number;
    delayMinSec: number;
    delayMaxSec: number;
    intervalSec: number;
  };
  /**
   * What the enemy expects (the aim model's input, #90): the attended sector is where memory (or the
   * sector the mind set for a hold) points, wide by how uncertain it is; the window is when it
   * predicts the player there, `windowSec` wide (§5.3: 1.5 s).
   */
  expectation: {
    windowSec: number;
    /** The speed the enemy assumes the player closes the distance at (a run, spec §2.1), for the predicted arrival time. */
    assumedSpeedMps: number;
    /** Uncertainty of a sighting's position at the instant of the sighting, metres. */
    sightErrM: number;
    /** Extra uncertainty per second since the information, metres (the player has moved on). */
    driftMps: number;
    minHalfWidthDeg: number;
    maxHalfWidthDeg: number;
  };
  /** Capacity of the fixed pools (enemies with a perceiver at once, callouts in flight). */
  maxPerceivers: number;
  maxShares: number;
}

export const perception: PerceptionTunables = {
  decisionMedianSec: 0.12,
  decisionCv: 0.25,
  decisionMinSec: 0.06,
  decisionMaxSec: 0.3,
  maxRaysPerDecision: 4,
  sightRangeM: 150,
  attentionHalfDeg: 15,
  samples: { chestFrac: 0.62, shoulderFrac: 0.78, shoulderHalfWidthM: 0.2 },
  hearing: {
    errFloorM: [1.0, 0.5],
    errFrac: [0.25, 0.1],
    repeatWindowSec: 3,
    repeatShrink: 0.75,
    repeatMinScale: 0.5,
  },
  confidence: { sight: 1, shot: 0.8, landing: 0.6, footstep: 0.55, reload: 0.5, shared: 0.8, prior: 0.9 },
  memory: { halfLifeSec: 2, forgetBelow: 0.1 },
  share: { delayMedianSec: 0.8, delayCv: 0.4, delayMinSec: 0.3, delayMaxSec: 2.5, intervalSec: 0.6 },
  expectation: {
    windowSec: 1.5,
    assumedSpeedMps: 5.4,
    sightErrM: 0.3,
    driftMps: 1,
    minHalfWidthDeg: 5,
    maxHalfWidthDeg: 45,
  },
  maxPerceivers: 16,
  maxShares: 64,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { perception };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
