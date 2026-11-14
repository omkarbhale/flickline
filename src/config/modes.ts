/**
 * Mode framework tunables (design §4 intro, §9.3 beats, §10.2 scheduler). The fairness floors
 * (spawn distance, exposure, scale) and the beat length (`beat.drillSec`) are not duplicated
 * here: they live in `config/dial.ts`.
 */
export interface ModeTunables {
  /** `ready` phase length: crosshair and movement work, targets not live (§2 definitions). */
  readySec: number;
  /** Length of a drill's live phase, seconds (design §4: every drill is a 60-second run). */
  drillSec: number;
  /** Spawn picker: random candidates tried before the constraints are relaxed. */
  spawnMaxTries: number;
  /** Beacon-shell sampling: pitch limits in degrees from the horizon (§4.2). */
  shellPitchMinDeg: number;
  shellPitchMaxDeg: number;
  /** Beacon-shell sampling: the pitch is biased towards this value (head height, roughly level). */
  shellPitchBiasDeg: number;
  coldStart: ColdStartTunables;
  orbit: OrbitTunables;
  placement: PlacementTunables;
  strafeTrack: StrafeTrackTunables;
  stopAndPop: StopAndPopTunables;
}

/** Cold Start (design §4.1): one Post at a time, 5-25 degrees from the crosshair, the first bullet decides. */
export interface ColdStartTunables {
  /** Angular distance of a new Post from the crosshair direction, degrees. */
  minAngleDeg: number;
  maxAngleDeg: number;
  /** A Post leaves this long after the first bullet fired at it (spraying is pointless by design). */
  leaveAfterFirstBulletSec: number;
  /** Seeded gap between a Post leaving or dying and the next one appearing. */
  gapMinSec: number;
  gapMaxSec: number;
  /** Distance band around the dial's `distance` axis (multipliers): the picker widens it if nothing fits. */
  distanceLoMult: number;
  distanceHiMult: number;
}

/** Orbit (design §4.2): one Beacon at a time on the 8-25 m shell around the player. */
export interface OrbitTunables {
  /** Radius band of the shell the Beacon is placed in, metres (clipped to the map's shell anchor). */
  minDistM: number;
  maxDistM: number;
  /** Gap after a kill and after an expiry, seconds. */
  gapAfterKillSec: number;
  gapAfterExpirySec: number;
}

/**
 * The Placement run (design §9.2): a fixed hybrid of Orbit and Cold Start trials driven by the
 * staircase. Each trial keeps the pacing of its own mode (gaps in `coldStart` / `orbit`).
 */
export interface PlacementTunables {
  durationSec: number;
}

/**
 * Strafe Track (design §4.3): 1-3 Strafers alive at 10-35 m, each on a Range `strafe-lane`. The
 * dial moves their speed, leg, stand-still, time limit, lane distance and how many are alive
 * (`config/dial.ts`); what is here is what the dial does not.
 */
export interface StrafeTrackTunables {
  /** Most Strafers alive at once; the dial's density (1..6) is spread over 1..maxAlive in equal bands. */
  maxAlive: number;
  /** Lane distance band, metres from the eye (design §4.3: 10-35 m). */
  minDistM: number;
  maxDistM: number;
  /** The dial's distance axis picks a lane within these multiples of it (the picker widens the band if no lane fits). */
  distanceLoMult: number;
  distanceHiMult: number;
  /** A replacement Strafer spawns this long after a kill or a timeout (design §4.3: 0.4 s). */
  replaceDelaySec: number;
  /** The Strafers of the opening wave appear this far apart, so they do not all pop in at once. */
  openingStaggerSec: number;
  /** Tries to find a lane no other living Strafer is on before sharing one. */
  laneRetries: number;
}

/**
 * Stop & Pop (design §4.4): the Lane arms while the player strafes, then a Post appears at the far
 * end with a stance ring; the first bullet must kill it from that stance below the accuracy
 * deadzone. The exposure and distance come from the dial's axes (§9.4), the stance mix from the
 * dial value itself (below).
 */
export interface StopAndPopTunables {
  /** The lane arms while the speed along the view's right axis is at least this fraction of the equipped run speed (§4.4: 80%). */
  armedFraction: number;
  /** Seeded gap between a trial ending and the lane arming a new one (the player must also be moving sideways again). */
  gapMinSec: number;
  gapMaxSec: number;
  /** A target leaves this long after the first bullet fired at it (spraying is pointless by design). */
  leaveAfterFirstBulletSec: number;
  /** The Lane's far-end Post anchors lie 16-28.5 m from the start: the dial's distance axis is clamped to this band before use, so low dials get the near posts. */
  distanceMinM: number;
  distanceMaxM: number;
  /** Distance band around that value (multipliers); the picker widens it if nothing fits. */
  distanceLoMult: number;
  distanceHiMult: number;
  /** A target appears within this many degrees of where the player looks (the view cone is +-51.5 degrees); the picker widens it if nothing fits. */
  maxAngleDeg: number;
  /** Stance mix by dial (§4.4): below this only "stand" rings; from it, crouch rings join. */
  crouchFromDial: number;
  /** Above this dial: a chance of a double (two targets) and the stop must come from a direction reversal (a true counter-strafe tap). */
  advancedAboveDial: number;
  /** Share of crouch rings once they are in the mix. */
  crouchShare: number;
  /** Chance of a double above `advancedAboveDial` (§4.4: 20%). */
  doubleChance: number;
  /** Both targets of a double share the exposure plus this, for the swing between them. */
  doubleExtraSec: number;
  /** The two targets of a double are at least this far apart (metres). */
  doubleMinSeparationM: number;
}

export const modes: ModeTunables = {
  readySec: 0.8,
  drillSec: 60,
  spawnMaxTries: 24,
  shellPitchMinDeg: -20,
  shellPitchMaxDeg: 25,
  shellPitchBiasDeg: 2,
  coldStart: {
    minAngleDeg: 5,
    maxAngleDeg: 25,
    leaveAfterFirstBulletSec: 0.25,
    gapMinSec: 0.5,
    gapMaxSec: 0.9,
    distanceLoMult: 0.7,
    distanceHiMult: 1.4,
  },
  orbit: {
    minDistM: 8,
    maxDistM: 25,
    gapAfterKillSec: 0.1,
    gapAfterExpirySec: 0.2,
  },
  placement: {
    durationSec: 45,
  },
  strafeTrack: {
    maxAlive: 3,
    minDistM: 10,
    maxDistM: 35,
    distanceLoMult: 0.7,
    distanceHiMult: 1.4,
    replaceDelaySec: 0.4,
    openingStaggerSec: 0.25,
    laneRetries: 4,
  },
  stopAndPop: {
    armedFraction: 0.8, // design §4.4
    gapMinSec: 0.35,
    gapMaxSec: 0.7,
    leaveAfterFirstBulletSec: 0.25,
    distanceMinM: 16,
    distanceMaxM: 28,
    distanceLoMult: 0.7,
    distanceHiMult: 1.4,
    maxAngleDeg: 40,
    crouchFromDial: 30, // design §4.4: dial < 30 stand only
    advancedAboveDial: 60, // design §4.4: > 60 doubles and counter-strafe stops
    crouchShare: 0.5,
    doubleChance: 0.2, // design §4.4
    doubleExtraSec: 0.4,
    doubleMinSeparationM: 1.2,
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { modes };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
