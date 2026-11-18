import type { Anchored } from './mind';

/**
 * The enemy mind's decision layer (issue #91; `docs/research/player-like-enemies.md` §5.2 states,
 * §2.2-2.4 holding, stop-shoot and strafing, §2.7 disengage / reposition / re-peek, §2.10 tier
 * mistakes, §5.7 not robotic). The profile (`config/mind.ts`, #88) holds the numbers the research
 * table gives per anchor; this file holds what the decision FSM needs on top: the rows the table
 * leaves to the implementation (anchored the same way, at `mind.anchorSkills`) and the scalars of
 * the hold, the duel rhythm, cover, nav steering and the stuck watchdog. Pure data; every number
 * is a calibration hypothesis for the balance pass (#53, #95) unless its comment cites a source.
 *
 * Units: seconds, metres, degrees only in names ending `Deg`, probabilities 0..1.
 */
export interface MindDecisionTunables {
  /** Rows interpolated by mind skill exactly like the profile's anchor table (§5.4 columns m = 0, 35, 65, 100). */
  anchors: {
    /**
     * Disengage: share that backs out of the angle still aiming at it (§5.2 "top"); the rest turn
     * away and run (§5.2 "low"). HYPOTHESIS 35% (coaching: "keep watching the angle while backing out", §2.7).
     */
    backOutAiming: Anchored;
    /** After reaching cover: share that re-contests (re-peek); the rest reposition to another hold (§2.7 "After one contact, reposition"). HYPOTHESIS 30%. */
    repeekChance: Anchored;
    /** A strafe leg reverses the previous one (ADAD); the rest are double-taps the same way. The mid tier is regular (§2.4). HYPOTHESIS 35%. */
    strafeReverse: Anchored;
    /** Median seconds between glances to a second angle while holding (attention switching, §2.2). HYPOTHESIS 30%. */
    glanceIntervalMedianSec: Anchored;
    /** Repositions walked (silent) rather than run; information denial grows with skill (§2.9). HYPOTHESIS 30%. */
    repositionWalk: Anchored;
  };

  hold: {
    /** Half width of the sector a holder attends, degrees (it is `prepared` for a player appearing inside it, #127). */
    sectorHalfWidthDeg: number;
    /** Where a wide swing ends: metres past the corner edge, square to the line of sight (§2.2 nAts: aim further from the corner). */
    wideSwingOffsetM: number;
    /** An off-angle hold stands this far to the side of the common spot, metres (uniform between the two). */
    offAngleMinM: number;
    offAngleMaxM: number;
    /** View drift while holding (Booth's "view drift"): SD as a multiple of the profile's settle noise, and its knot period range. */
    driftScale: number;
    driftPeriodMinSec: number;
    driftPeriodMaxSec: number;
    /** A glance: how long it looks away (lognormal median, CV) and how far, degrees (uniform). */
    glanceMedianSec: number;
    glanceCv: number;
    glanceMinDeg: number;
    glanceMaxDeg: number;
    /** Lognormal CV of the glance interval. */
    glanceIntervalCv: number;
  };

  duel: {
    /** Strafe legs are drawn from the profile's lognormal and truncated here, seconds. */
    legMinSec: number;
    legMaxSec: number;
    /** A leg never starts towards a wall closer than this, metres (it turns round instead). */
    legRoomM: number;
    /** CV of the shot-after-gate delay (the profile gives the median, §2.3). */
    shotAfterGateCv: number;
    /** Most shots in one spray (a full spray is the magazine, but no human holds it through 30 at range). */
    sprayMaxShots: number;
    /** On target: the aim is within the target's angular radius plus this, degrees. */
    onTargetToleranceDeg: number;
    /** It has lost the player when it has not seen him for this long, seconds (a peek that ducked back). */
    lostSightSec: number;
    /** A moving-shot burst waits at most this long for its speed to rise above the gate before firing anyway, seconds. */
    movingShotWaitSec: number;
    /** A stop that has not produced a shot this long after its shot-after-gate delay moves on to the next leg, seconds. */
    stopWaitMaxSec: number;
  };

  /** A teammate's death keeps it alert this long with no memory of the player, seconds. */
  alarmHoldSec: number;

  /** Ammunition: it reloads under this fraction of the magazine (§5.4 "reload in the open (when the magazine is under 30%)"). */
  reloadBelowFrac: number;

  cover: {
    /** Directions sampled around the enemy for a cover point (evenly spaced). */
    directions: number;
    /** Distances sampled along each direction, metres. */
    distancesM: readonly number[];
    /** Score penalty per metre a cover point lies towards the threat (it prefers backing away). */
    towardsPenalty: number;
    /** A cover point must also hide it this far short of the point (it may stop early), metres. */
    marginM: number;
    /** With no cover in a straight walk, the nearest nav node out of sight within this, metres. */
    navRadiusM: number;
    /** It found no cover: it does not try to retreat again for this long, seconds. */
    noCoverRetrySec: number;
  };

  repeek: {
    /** An "instant" re-peek lands uniformly in [instantMinSec, instantMaxSec] (§2.7: < 0.6 s). */
    instantMinSec: number;
    instantMaxSec: number;
    /** The non-instant delay: lognormal with the profile's median and this CV, truncated. */
    delayCv: number;
    delayMinSec: number;
    delayMaxSec: number;
    /** Among re-peeks that are not the same way: share that takes the same angle another way (the rest go elsewhere). */
    otherWayShare: number;
    /** "Another way" as a wider swing: this much further out past the last peek spot, metres. */
    widerM: number;
    /** A crouched re-peek crouches only within this of its spot, metres. */
    crouchWithinM: number;
  };

  nav: {
    /** Look-ahead steering: the carrot runs this far ahead along the path, metres (Left 4 Dead: never exact path following). */
    lookAheadM: number;
    /** A waypoint is reached within this, metres; the goal within `arriveM`. */
    waypointM: number;
    arriveM: number;
    /** Every this many ticks it tests whether it can walk straight to the next waypoint and skips the current one. */
    shortcutEveryTicks: number;
  };

  /** Anti-stuck watchdog (UT^2: being stuck is the most bot-like tell). AC: never > 0.5 s stationary against a wall while trying to move. */
  watchdog: {
    /** Under this horizontal speed while holding a movement key counts as stuck, m/s. */
    stuckSpeedMps: number;
    /** Stuck this long, seconds: it sidesteps. */
    stuckAfterSec: number;
    /** The sidestep lasts this long, seconds, then it plans again from where it stands. */
    sidestepSec: number;
    /** After this many sidesteps on one move it gives the move up (the FSM chooses something else). */
    maxAttempts: number;
    /** How far it probes each side for room to sidestep, metres. */
    probeM: number;
  };

  look: {
    /** Time constant of the stand-in look controller, seconds (the human aim model of #90 replaces it). */
    tauSec: number;
    /** Tracking: the target's own rate is fed forward up to this, deg/s (it turns with a point it tracks while strafing). */
    feedForwardMaxDegPerSec: number;
    /** A target that moves more than this in one tick is a new one (a glance, a contact), not tracked, degrees. */
    newTargetDeg: number;
    /** The aim phase it predicts for the tell (F5): the angle at this fraction of the speed cap, plus a base, seconds. */
    aimSpeedFraction: number;
    aimBaseSec: number;
  };
}

export const mindDecision: MindDecisionTunables = {
  anchors: {
    backOutAiming: [0.1, 0.35, 0.7, 0.9],
    repeekChance: [0.85, 0.75, 0.6, 0.5],
    // m = 35 always reverses (regular ADAD the player can time); the top mixes in double-taps.
    strafeReverse: [0.7, 0.95, 0.8, 0.7],
    glanceIntervalMedianSec: [2.0, 2.4, 3.0, 3.6],
    repositionWalk: [0.05, 0.15, 0.35, 0.55],
  },
  hold: {
    sectorHalfWidthDeg: 12,
    wideSwingOffsetM: 1.6,
    offAngleMinM: 1.2,
    offAngleMaxM: 3.0,
    driftScale: 1.5,
    driftPeriodMinSec: 0.6,
    driftPeriodMaxSec: 1.6,
    glanceMedianSec: 0.45,
    glanceCv: 0.3,
    glanceMinDeg: 25,
    glanceMaxDeg: 60,
    glanceIntervalCv: 0.4,
  },
  duel: {
    legMinSec: 0.12,
    legMaxSec: 2.5,
    legRoomM: 0.6,
    shotAfterGateCv: 0.35,
    sprayMaxShots: 12,
    onTargetToleranceDeg: 1.0,
    lostSightSec: 0.35,
    movingShotWaitSec: 0.4,
    stopWaitMaxSec: 1.0,
  },
  alarmHoldSec: 3,
  reloadBelowFrac: 0.3,
  cover: {
    directions: 16,
    distancesM: [1, 2, 3, 4.5, 6],
    towardsPenalty: 2,
    marginM: 0.5,
    navRadiusM: 15,
    noCoverRetrySec: 2,
  },
  repeek: {
    instantMinSec: 0.15,
    instantMaxSec: 0.6,
    delayCv: 0.4,
    delayMinSec: 0.6,
    delayMaxSec: 6,
    otherWayShare: 0.5,
    widerM: 1.0,
    crouchWithinM: 1.0,
  },
  nav: {
    lookAheadM: 1.2,
    waypointM: 0.6,
    arriveM: 0.3,
    shortcutEveryTicks: 8,
  },
  watchdog: {
    stuckSpeedMps: 0.15,
    stuckAfterSec: 0.2,
    sidestepSec: 0.25,
    maxAttempts: 3,
    probeM: 1.5,
  },
  look: {
    tauSec: 0.06,
    feedForwardMaxDegPerSec: 170,
    newTargetDeg: 3,
    aimSpeedFraction: 0.5,
    aimBaseSec: 0.05,
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { mindDecision };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
