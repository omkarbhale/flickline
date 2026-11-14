/**
 * Strafer, Peeker and the shared way enemies shoot back (design §5.2, §5.3, §9.4; spec §2.3, §2.4,
 * §5.3). Pure data read by `sim/strafer.ts`, `sim/peeker.ts` and `sim/enemyFire.ts`. The dial
 * decides the speed, leg, stand-still, tell, reaction and hit chance of one enemy
 * (`config/dial.ts` axes, passed in at spawn); what is here is everything the dial does not move.
 * Units: metres, seconds, m/s, m/s^2.
 */

/** Strafer motion (design §5.2, spec §2.3 braking, spec §5.3 leg and stand-still ranges). */
export interface StraferTunables {
  /**
   * Shortest strafe leg (design §5.2, #130: 0.35-1.0 s; spec §5.3 had 0.3). A leg is drawn from
   * `legMinSec` up to the dial's leg value (1.0 s at dial 0, 0.35 s at dial 100).
   */
  legMinSec: number;
  /** Shortest stand-still window; the dial's value (0.4 s at dial 0, 0.25 s at dial 100) is the longest. */
  standMinSec: number;
  /** Seconds from rest to the cruise speed (spec §9 Q3 default: 0.20 s). */
  accelSec: number;
  /**
   * Braking (spec §2.3): constant deceleration in two bands, 39 m/s^2 down to the accuracy
   * deadzone and 24 m/s^2 below it, for a runner at `brakeRefSpeed`; both scale with the speed the
   * leg ran at so the stop takes about 0.16 s at every strafe speed (the same stop time at any speed).
   */
  brakeHigh: number;
  brakeLow: number;
  brakeRefSpeed: number;
  /** Where the bands meet, as a fraction of the cruise speed (spec §2.4 deadzone, 0.275). */
  brakeBandFraction: number;
  /** Chance a stand-still ends with the opposite direction (the seeded coin). */
  reverseChance: number;
  /** A strafer never starts a leg with less than this much lane ahead of it: it turns round instead. */
  minLegRoomM: number;
  /** Half length of the strafe line when the spawn gives no lane (centred on the spawn point). */
  freeHalfRangeM: number;
  /** What a Strafer spawned without dial numbers does: the dial-50 values of the axes. */
  defaultSpeed: number;
  defaultLegSec: number;
  defaultStandStillSec: number;
}

/** One peek pattern's exposure plan (design §5.2). */
export interface PeekPatternTunables {
  /** Fraction of the body (0..1) exposed at the step's peak. */
  exposure: number;
  /** Seconds held at that exposure. */
  holdSec: number;
}

export interface PeekTunables {
  /** Shoulder: exposes 40% of the body for 0.3 s. */
  shoulder: PeekPatternTunables;
  /** Jiggle: shoulder out, in, out (the in leg is a full retreat behind cover). */
  jiggle: { exposure: number; outSec: number; inSec: number };
  /** Hop: rises above low cover for 0.35 s, head and upper body only. */
  hop: { holdSec: number };
  /** Wide: full body for `defaultSec` (0.8-1.2 s with the jitter) unless the dial gives `wideSec`. */
  wide: { exposure: number; defaultSec: number; jitter: number };
  /** Seconds an Echo waits hidden between peeks (seeded uniform). */
  hiddenMinSec: number;
  hiddenMaxSec: number;
  /** Speed of the step out and back, m/s. */
  speedMps: number;
  /** Resolution of the exposure raycast the peek position is solved with (columns across, rows up). */
  solveColumns: number;
  solveRows: number;
  /** Bisection steps for the peek position. */
  solveSteps: number;
}

/** The shared shooting model (design §5.3). */
export interface EnemyFireTunables {
  /** What an enemy spawned with `fire: true` and no dial numbers does: the dial-50 values of the axes. */
  defaultTellSec: number;
  defaultReactionSec: number;
  defaultHitChance: number;
  /** An enemy only acquires a player closer than this (and in line of sight), metres. */
  acquireRangeM: number;
  /** Muzzle height above the feet, standing and crouched. */
  muzzleHeightStand: number;
  muzzleHeightCrouch: number;
  /** Rolled reaction (first sight to tell) spread, as a fraction of the dial's reaction. */
  reactionSpread: number;
  /** Burst length, inclusive range (design §5.3: 1-3 shots). */
  burstMin: number;
  burstMax: number;
  /** Rest between one burst and the next tell, seconds (seeded uniform). */
  gapMinSec: number;
  gapMaxSec: number;
  /** Gap between two bursts of one wide peek (no second tell), seconds. */
  burstGapMinSec: number;
  burstGapMaxSec: number;
  /** Bursts per wide peek, inclusive (design §5.2: one or two). */
  peekBurstsMax: number;
  /**
   * Hit probability falloff with distance: full up to `falloffNearM`, falling in a line to
   * `falloffFarMult` of it at `falloffFarM`, flat beyond (design §5.3 "by distance falloff").
   */
  falloffNearM: number;
  falloffFarM: number;
  falloffFarMult: number;
  /** Multiplier when the player's speed is above the accuracy deadzone (design §5.3: 0.5). */
  movingMult: number;
  /** Multiplier when the player is crouched at `crouchRangeM` or further (design §5.3: 0.7). */
  crouchMult: number;
  crouchRangeM: number;
  /** Speed margin over the weapon deadzone, m/s: a tagged player sits exactly at it and counts as accurate. */
  movingEpsilon: number;
  /** Where a landed bullet strikes, as weights (head, body, leg); normalised when used. */
  zoneHead: number;
  zoneBody: number;
  zoneLeg: number;
  /** A near miss passes this far from the player's aim point (seeded uniform), metres. */
  missMinM: number;
  missMaxM: number;
  /** Aim point heights on the player as fractions of the hull height: body and legs (the head is the eye). */
  bodyAimFraction: number;
  legAimFraction: number;
}

/** What the tell and an enemy's bullets look like (`render/enemyFx.ts`, design §5.3 "tell", §7 "damage"). */
export interface EnemyFxTunables {
  /** The line from the muzzle to the player while a tell runs: width (m), peak alpha, flicker rate (Hz) and depth (0..1). */
  tellLineWidthM: number;
  tellLineAlpha: number;
  tellFlickerHz: number;
  tellFlickerDepth: number;
  /** How far along the way to the player the line reaches (0..1): it fades out before the head so it never blocks the view. */
  tellLineReach: number;
  /** The head-node flare: world size at the start and at the end of the tell (m), and peak alpha. */
  flareStartM: number;
  flareEndM: number;
  flareAlpha: number;
  /** Enemy bullets (hit or miss): how long the streak shows (s), its width (m), alpha, and how far it runs past the player (m). */
  tracerLifeSec: number;
  tracerWidthM: number;
  tracerAlpha: number;
  tracerOvershootM: number;
  /** Fixed pool sizes (lines = tells + tracers; flares). Extra effects are skipped, never allocated. */
  tellCapacity: number;
  tracerCapacity: number;
}

export interface EnemiesTunables {
  strafer: StraferTunables;
  peek: PeekTunables;
  fire: EnemyFireTunables;
  fx: EnemyFxTunables;
}

export const enemies: EnemiesTunables = {
  strafer: {
    legMinSec: 0.35,
    standMinSec: 0.25,
    accelSec: 0.2,
    brakeHigh: 39,
    brakeLow: 24,
    brakeRefSpeed: 5.4,
    brakeBandFraction: 0.275,
    reverseChance: 0.5,
    minLegRoomM: 0.6,
    freeHalfRangeM: 4,
    defaultSpeed: 3.7,
    defaultLegSec: 0.65,
    defaultStandStillSec: 0.3,
  },
  peek: {
    shoulder: { exposure: 0.4, holdSec: 0.3 },
    jiggle: { exposure: 0.4, outSec: 0.15, inSec: 0.12 },
    hop: { holdSec: 0.35 },
    wide: { exposure: 1, defaultSec: 1, jitter: 0.2 },
    hiddenMinSec: 0.8,
    hiddenMaxSec: 2,
    speedMps: 5.4,
    solveColumns: 21,
    solveRows: 3,
    solveSteps: 7,
  },
  fire: {
    defaultTellSec: 0.34,
    defaultReactionSec: 0.75,
    defaultHitChance: 0.375,
    acquireRangeM: 80,
    muzzleHeightStand: 1.4,
    muzzleHeightCrouch: 1,
    reactionSpread: 0.1,
    burstMin: 1,
    burstMax: 3,
    gapMinSec: 0.7,
    gapMaxSec: 1.4,
    burstGapMinSec: 0.2,
    burstGapMaxSec: 0.35,
    peekBurstsMax: 2,
    falloffNearM: 10,
    falloffFarM: 50,
    falloffFarMult: 0.5,
    movingMult: 0.5,
    crouchMult: 0.7,
    crouchRangeM: 15,
    movingEpsilon: 0.001,
    zoneHead: 0.12,
    zoneBody: 0.78,
    zoneLeg: 0.1,
    missMinM: 0.25,
    missMaxM: 0.9,
    bodyAimFraction: 0.55,
    legAimFraction: 0.25,
  },
  fx: {
    tellLineWidthM: 0.02,
    tellLineAlpha: 0.95,
    tellFlickerHz: 28,
    tellFlickerDepth: 0.45,
    tellLineReach: 0.9,
    flareStartM: 0.5,
    flareEndM: 1.3,
    flareAlpha: 1,
    tracerLifeSec: 0.1,
    tracerWidthM: 0.02,
    tracerAlpha: 0.9,
    tracerOvershootM: 8,
    tellCapacity: 8,
    tracerCapacity: 12,
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { enemies };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
