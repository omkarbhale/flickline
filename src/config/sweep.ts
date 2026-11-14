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

/** The skill a contact's trials count for (design §3.1: where a run exercises each skill). */
export type SweepTrialSkill = 'precision' | 'flick' | 'angles' | 'switch' | 'track';

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
  /** What each card's trials count for (design §3.1). */
  cardSkill: Readonly<Record<SweepCard, SweepTrialSkill>>;
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
  cardSkill: { 'take-unaware': 'angles', 'take-expected': 'precision', clear: 'angles', crossfire: 'switch', meet: 'track' },
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
  },
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
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { sweep };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
