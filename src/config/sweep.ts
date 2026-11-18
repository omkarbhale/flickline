/**
 * Sweep, the run (design §4), tunables. Starting values are HYPOTHESIS until the balance pass (#53):
 * the shape of a v0 run (four take sectors, #201), the scenario-card mix of its contacts, how the
 * run director places Echoes on a sector's hold anchors, and the run terms of design §8.1.
 * Seconds, metres; names ending `Deg` are degrees.
 */

import type { WeaponId } from './weapon';

/**
 * The scenario cards a sector can deal (design §4.4; the rest arrive with #97, #204). A take sector
 * deals the first four, a meet sector (#212) always deals `meet`.
 */
export type SweepCard = 'take-unaware' | 'take-expected' | 'clear' | 'crossfire' | 'meet';
export const SWEEP_CARDS: readonly SweepCard[] = ['take-unaware', 'take-expected', 'clear', 'crossfire', 'meet'];

/** Who has to move in a sector (design §4.2). */
export type SectorRole = 'take' | 'hold' | 'meet';

/** What a door's stake does (design §4.5): `shield` refills the shield, `arms` swaps the primary, `hot` adds a contact and pays more, `plain` nothing. */
export type GateStake = 'shield' | 'arms' | 'hot' | 'plain';
export const GATE_STAKES: readonly GateStake[] = ['shield', 'arms', 'hot', 'plain'];

/** How many Echoes a door says it hears: nothing, one or two, three or more (design §4.5). */
export type HeardBucket = 'quiet' | 'few' | 'several';

/** The gate between two sectors (design §4.5, #205): one authored room, two doors, three facts and a stake on each. */
export interface GateTunables {
  /** The map the gate room lives in (`sim/levels/gate.json`); loaded between sectors like any sector's map. */
  mapId: string;
  /** Where the player is put on entering (feet) and the way they face (radians), in the gate room. */
  entry: { x: number; y: number; z: number; yaw: number };
  /** The two doors, left then right as the player faces them: where each doorway's plane stands (feet, y 0) and its half width. */
  doors: readonly [{ x: number; z: number }, { x: number; z: number }];
  doorHalfWidthM: number;
  /** Past the door plane by this much (towards the far wall) the player has walked through: the choice is made. */
  commitDepthM: number;
  /** After the choice: how long the other door takes to close and the screen to cut, before the sector loads, seconds. */
  commitSec: number;
  /** Door draw weights per stake (renormalised over the stakes a door may carry); the two doors always differ in stake. */
  stakeWeight: Readonly<Record<GateStake, number>>;
  /** Shield stake: the shield is refilled to this (the heavy tier, spec 4.1) and not offered again until this many sectors later. */
  shieldRefillTo: number;
  shieldEverySectors: number;
  /** Hot stake: contacts added to the sector (as many as its hidden anchors can hold) and the multiplier on its points. */
  hotExtraContacts: number;
  hotMultiplier: number;
  /** Arms stake: the primaries a door can name (never the one the player carries). */
  armsPool: readonly string[];
  /** The "heard" bucket of a count: up to `quietMax` Echoes = quiet, up to `fewMax` = one or two, more = several. */
  heard: { quietMax: number; fewMax: number };
  /** A sector's longest sightline on the walk from its entry to its exit, at or above this many metres, is `long`; below, `close` (design §10: close 5-8 m, mid 12-16, long 22-26). */
  longSightlineM: number;
}

export interface SweepTunables {
  /** HP restored by a kill (design §4.1: "a body kill restores 5 HP, a headshot kill 10"); capped at max HP. A leg kill counts as a body kill. */
  killHeal: { body: number; head: number };
  /** The sector that is the Finale (design §4.1); sectors past it are Overtime. The Closer medal and the run records read it. */
  finaleSector: number;
  /** Sectors in a run (v0: four take sectors; the six-sector shape with holds and the Finale is #204). */
  sectors: number;
  /**
   * Per sector, by index: dial offset from the matched dial (design §4.1 and §9.3) and the depth
   * multiplier applied to every point earned in it (design §8.1). A run longer than these lists
   * repeats their last entry.
   */
  dialOffset: readonly number[];
  depthMultiplier: readonly number[];
  /** Contacts per sector, by index: an inclusive range drawn uniformly, then capped by the sector's hold anchors. */
  contactsMin: readonly number[];
  contactsMax: readonly number[];
  /** Base weight of each card (renormalised over the cards a contact may draw). */
  cardWeight: Readonly<Record<SweepCard, number>>;
  /** First sector index (0-based) that may deal a crossfire (design: "only from sector 3"). */
  crossfireFromSector: number;
  /** The same card never this many times in a row (design §4.4: never three in a row). */
  maxCardRun: number;
  /**
   * The mix of sector roles for sectors 2 and later (design §4.2: takes 50%, holds 35%, meets 15%; HYPOTHESIS), drawn
   * per sector; the Opener is always a take. The same role is never drawn three times in a row. A role the run cannot
   * play yet plays as a take: holds until #204.
   */
  roleMix: Readonly<Record<SectorRole, number>>;
  /** The roles a run plays today. A drawn role not listed plays as a take (holds arrive with #204); the lean skips it too (#210). */
  playableRoles: readonly SectorRole[];
  /**
   * Meet sectors (design §4.2, #212): an Echo group crosses the player's corridor on a route from the sector's exit
   * to its entry. Walks and runs are the Echo's gait; a walk is silent, a run is heard (`audio.enemy.silentBelowMps`).
   */
  meet: {
    /** Chance the group has two Echoes rather than one, by sector index (the last entry repeats). */
    groupTwoShare: readonly number[];
    /** Share of groups that run (else they walk). */
    runShare: number;
    /** Gait speeds, m/s: a rifle run (spec §7.2) and the walk (`movement.walkFraction` of it, spec §2.2). */
    runSpeedMps: number;
    walkSpeedMps: number;
    /** The lead Echo starts this far behind the sector's exit (seeded uniform, shortened to what is walkable), metres. */
    startBackMinM: number;
    startBackMaxM: number;
    /** The second Echo starts this far behind the first, along the route (seeded uniform), metres. */
    gapMinM: number;
    gapMaxM: number;
    /** The second Echo walks this far to one side of the first (the side is seeded; dropped where it would clip a wall), metres. */
    lateralM: number;
    /** A route ends this far before the sector's entry: an Echo that never sees the player stops there, metres. */
    endShortM: number;
    /**
     * Horizontal speed at or below which a side counts as stopped when the report asks who stopped first, m/s: the
     * accuracy deadzone of a rifle (spec §2.4: 27.5% of its run speed), the speed a counter-strafed shot is accurate at.
     */
    stopSpeedMps: number;
  };
  /** Echo placement on hold anchors. */
  place: {
    /** A Strafer's lane is drawn in this length range, then shortened until all of it is hidden from the entry. */
    laneMinM: number;
    laneMaxM: number;
    /** A holder on its angle (`take-expected`, `crossfire`) only shuffles: its lane is at most this long. */
    holderLaneMaxM: number;
    /** Lanes shorter than this are dropped: the Echo stands still on its anchor. */
    laneDropM: number;
    /** Spacing of the sight samples along a lane or a peek path, metres. */
    sampleStepM: number;
    /** Share of `clear` occupants that are Peekers when the anchor's peek path is hidden from the entry (else a Strafer holds it). */
    clearPeekerShare: number;
    /** Share of `take-unaware` Echoes that walk a lane rather than stand (`unaware` and moving: it is busy elsewhere). */
    unawareMoverShare: number;
    /**
     * Where an Echo stands is drawn by distance (design §9.4, #249): each free hold anchor of a sector is weighted by how near
     * its **first-sight distance** (how far the player is from it when the walk from entry to exit first shows it,
     * `sim/mapSight.ts`) is to `targetM`, on a log scale with a spread of `distanceSigma` (a natural-log width: 0.5 puts an
     * anchor a factor of 1.65 off the target at 60% of the peak weight). The card still decides what kind of Echo stands there.
     * The run overlays both per plan from the dial that plan is played at; the values here are the dial-50 ones.
     */
    /** The distance the dial asks for, metres (design §9.4: 5 at dial 0, 35 at dial 100, geometric). */
    targetM: number;
    /** The spread of the draw at dial 50, and at the ends of the dial (linear between): a beginner's fights are all near, an expert's range wide. */
    distanceSigma: number;
    distanceSigmaAt0: number;
    distanceSigmaAt100: number;
    /** Weight (of a peak 1) of an anchor the walk never shows: a fight the player only has by leaving the route. */
    offRouteWeight: number;
    /** Floor of every weight, so no anchor is ever impossible. */
    weightFloor: number;
    /**
     * Bands of a first sight (design §10, #249): below `closeToM` is **close**, from `longFromM` **long**, in between **mid**.
     * The map lint wants every take sector to offer all three.
     */
    closeToM: number;
    longFromM: number;
    /** An anchor at least this far above (or below) the player's feet at its first sight is **off the floor plane** (#249; the report's "height difference above 1 m"). */
    levelM: number;
    /** An Echo whose body the player sees less than this share of at its first sight holds **from cover** (over a wall, past a frame). */
    coverExposureMax: number;
    /** Spacing of the walk's sample points for the first-sight search, metres. */
    walkStepM: number;
  };
  /**
   * A new profile's first Opener (design §9.2): instead of one or two contacts it is a chain of short
   * take sectors with one single-Echo contact each, dealt from the gentlest cards, on a placement
   * staircase (`adaptive/sectorDial.ts`). It ends once `contactsMin` contacts were fought if the
   * staircase has turned by then, else at `contactsMax`, or after `maxSectors` sectors. A contact
   * counts as won for the staircase when it was cleared with at most `winMaxShieldLoss` of the full
   * shield lost.
   */
  opener: {
    contactsMin: number;
    contactsMax: number;
    maxSectors: number;
    cards: readonly SweepCard[];
    winMaxShieldLoss: number;
  };
  /**
   * Sector conditions (design §4.6, #207): which sectors of a run are light or eco. Rare: at most one
   * of each per run, never the Opener and never the Finale (a run shorter than the Finale simply has none there).
   */
  conditions: {
    /** Chance that a run deals an eco sector, and a light one (drawn independently; HYPOTHESIS until the balance pass #53). */
    ecoChance: number;
    lightChance: number;
    /** First sector index (0-based) that may carry one: 1 = never the Opener. */
    firstSector: number;
  };
  /**
   * The primary pick on the run's `ready` screen (design §4.1): `1`..`3` choose these in order, the
   * sidearm is always Pace. Choosing starts the run at once; otherwise the screen times out on the
   * last pick after `readySec`.
   */
  pick: {
    primaries: readonly WeaponId[];
    /** The pick of a player who has not chosen yet. */
    defaultPrimary: WeaponId;
    readySec: number;
  };
  /** What a sector's condition says when the player enters it (and what its door shows, #205): a title and one plain line. `full` says nothing. */
  conditionCopy: Readonly<Record<'full' | 'light' | 'eco', { title: string; line: string }>>;
  /** Seconds the entry announcement of a light or eco sector stays up. */
  conditionBannerSec: number;
  /** A sector's exit: the player's feet within this horizontal radius of the exit point, and this height of it, leave the sector. */
  exitRadiusM: number;
  exitHeightM: number;
  /** Sector clear: `clearKills × kill × kept_sector` (design §8.1). */
  clearKills: number;
  /** Presentation: the dip to black that hides the move between sectors, seconds. */
  fadeSec: number;
  gate: GateTunables;
}

export const sweep: SweepTunables = {
  killHeal: { body: 5, head: 10 },
  finaleSector: 6,
  sectors: 4,
  dialOffset: [-8, -3, 0, 3],
  depthMultiplier: [1.0, 1.2, 1.4, 1.6],
  contactsMin: [1, 1, 2, 2],
  contactsMax: [1, 2, 2, 3],
  cardWeight: { 'take-unaware': 0.3, 'take-expected': 0.35, clear: 0.2, crossfire: 0.25, meet: 0 },
  crossfireFromSector: 2,
  maxCardRun: 2,
  roleMix: { take: 0.5, hold: 0.35, meet: 0.15 },
  playableRoles: ['take', 'meet'],
  meet: {
    groupTwoShare: [0, 0.4, 0.5, 0.6],
    runShare: 0.6,
    runSpeedMps: 5.4,
    walkSpeedMps: 2.7,
    startBackMinM: 0,
    startBackMaxM: 4,
    gapMinM: 2.5,
    gapMaxM: 4.5,
    lateralM: 0.55,
    endShortM: 3,
    stopSpeedMps: 1.5,
  },
  place: {
    laneMinM: 1.2,
    laneMaxM: 3,
    holderLaneMaxM: 0.8,
    laneDropM: 0.3,
    sampleStepM: 0.25,
    clearPeekerShare: 0.6,
    unawareMoverShare: 0.7,
    targetM: 13.2,
    distanceSigma: 0.78,
    distanceSigmaAt0: 0.4,
    distanceSigmaAt100: 1.15,
    offRouteWeight: 0.05,
    weightFloor: 0.02,
    closeToM: 10,
    longFromM: 20,
    levelM: 1,
    coverExposureMax: 0.75,
    walkStepM: 0.5,
  },
  // `hold` is gentle too, and joins the list with hold sectors (#204).
  opener: { contactsMin: 4, contactsMax: 6, maxSectors: 9, cards: ['take-unaware', 'clear'], winMaxShieldLoss: 0.5 },
  conditions: { ecoChance: 0.4, lightChance: 0.4, firstSector: 1 },
  pick: { primaries: ['kestrel', 'vane', 'rill'], defaultPrimary: 'kestrel', readySec: 3 },
  conditionCopy: {
    full: { title: '', line: '' },
    light: { title: 'Light buy', line: 'Light shields (25) for you and the Echoes' },
    eco: { title: 'Eco round', line: 'No shields, sidearms only: your primary is holstered' },
  },
  conditionBannerSec: 4,
  exitRadiusM: 1.2,
  exitHeightM: 1.5,
  clearKills: 3,
  fadeSec: 0.3,
  gate: {
    mapId: 'gate',
    entry: { x: 0, y: 0, z: 1.6, yaw: 0 },
    doors: [{ x: -2.6, z: -4 }, { x: 2.6, z: -4 }],
    doorHalfWidthM: 1,
    commitDepthM: 0.8,
    commitSec: 0.45,
    stakeWeight: { shield: 0.3, arms: 0.25, hot: 0.3, plain: 0.15 },
    shieldRefillTo: 50,
    shieldEverySectors: 2,
    hotExtraContacts: 1,
    hotMultiplier: 1.5,
    armsPool: ['kestrel', 'vane', 'rill'],
    heard: { quietMax: 0, fewMax: 2 },
    longSightlineM: 20,
  },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { sweep };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
