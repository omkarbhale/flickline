/**
 * Sweep, the run (design §4), tunables. Starting values are HYPOTHESIS until the balance pass (#53):
 * the shape of a run (six sectors: the Opener, four drawn by role, the Finale; #201, #204), the
 * scenario-card mix of its contacts, how the run director places Echoes on a take sector's hold
 * anchors and sends them along a hold sector's approach lanes, and the run terms of design §8.1.
 * Seconds, metres; names ending `Deg` are degrees.
 */

/** The scenario cards a take sector deals (design §4.4; meet's cards arrive with #212). */
export type TakeCard = 'take-unaware' | 'take-expected' | 'clear' | 'crossfire';
export const TAKE_CARDS: readonly TakeCard[] = ['take-unaware', 'take-expected', 'clear', 'crossfire'];
/** The scenario cards a hold sector deals, and a survivor that follows the player (design §4.2, §4.4). */
export type HoldCard = 'hold' | 'trade' | 'flank';
export const HOLD_CARDS: readonly HoldCard[] = ['hold', 'trade', 'flank'];
export type SweepCard = TakeCard | HoldCard;
export const SWEEP_CARDS: readonly SweepCard[] = [...TAKE_CARDS, ...HOLD_CARDS];

/** The role a sector plays in a run (design §4.2). */
export type SweepRole = 'take' | 'hold' | 'meet';

/** The skill a contact's trials count for (design §3.1: where a run exercises each skill). */
export type SweepTrialSkill = 'precision' | 'flick' | 'angles' | 'switch';

export interface SweepTunables {
  /** HP restored by a kill (design §4.1: "a body kill restores 5 HP, a headshot kill 10"); capped at max HP. A leg kill counts as a body kill. */
  killHeal: { body: number; head: number };
  /** Sectors in a run (design §4.1: the Opener, four drawn by role, the Finale). Overtime (#206) goes beyond. */
  sectors: number;
  /**
   * Roles of sectors 2 to 5 (design §4.2): the share of each, drawn per sector. The Opener is always a
   * take and the Finale always a hold. A run has at least one take and one hold among those four and
   * never `maxRoleRun + 1` of one role in a row. Until meet sectors exist (#212) a drawn meet is played
   * as a take, and the rules count the role played.
   */
  roleWeight: Readonly<Record<SweepRole, number>>;
  maxRoleRun: number;
  /** 0-based sector indices that never deal a crossfire (design §4.1: sector 5 is a breather). */
  noCrossfireSectors: readonly number[];
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
  /** Base weight of each take card (renormalised over the cards a contact may draw). */
  cardWeight: Readonly<Record<TakeCard, number>>;
  /** First sector index (0-based) that may deal a crossfire (design: "only from sector 3"). */
  crossfireFromSector: number;
  /** The same card never this many times in a row (design §4.4: never three in a row). */
  maxCardRun: number;
  /** What each card's trials count for (design §3.1). */
  cardSkill: Readonly<Record<SweepCard, SweepTrialSkill>>;
  /** Hold sectors (design §4.2): Echoes arrive along the sector's approach lanes. */
  hold: {
    /** Contacts per sector index, an inclusive range drawn uniformly (the Finale, index 5, is the run's largest). */
    contactsMin: readonly number[];
    contactsMax: readonly number[];
    /** Base weight of each card a contact can draw (flank needs a second lane and a contact before it). */
    cardWeight: Readonly<Record<HoldCard, number>>;
    /** Seconds from the sector's start to the first arrival, and the span the arrivals are spread over: `[min, max]` drawn uniformly. */
    firstArrivalSec: readonly [number, number];
    windowSec: readonly [number, number];
    /** The Finale's own window: more contacts take longer to arrive. */
    finaleWindowSec: readonly [number, number];
    /** A Peeker only walks to a peek anchor at least this far from the sector's entry (the walk there would meet the fairness floor), metres. */
    minPeekFromEntryM: number;
    /** A Peeker's walk to its cover keeps at least this far from the sector's entry (else a Strafer comes): the fairness floors would stop it in the open, metres. */
    minRouteFromEntryM: number;
    /** Share of arrivals that are Peekers (they need a free peek anchor; else a Strafer comes). */
    peekerShare: number;
    /** Share of Strafer arrivals that run (audible) rather than walk (silent). A flank always runs: it must be audible. */
    runShare: number;
    /** Speeds, m/s. A walk stays at or under `audio.enemy.silentMps` (checked by a test). */
    runMps: number;
    walkMps: number;
    /** A Strafer stops walking and fights once it sees the player this close: `[min, max]` metres, drawn per Echo. */
    engageM: readonly [number, number];
    /** Seconds between the two Echoes of a trade, and from a won contact to a flank's arrival. */
    tradeGapSec: readonly [number, number];
    flankDelaySec: readonly [number, number];
    /** An arrival whose lane start is in the player's line of sight waits for it to clear, at most this long, seconds. */
    deferMaxSec: number;
    /** The exit opens this long after the last arrival is due even if an Echo is alive (one stuck behind a wall must not hold the run), seconds. */
    exitFallbackSec: number;
    /** Share of the lane's width an Echo may walk off the lane's centre line, each way. */
    laneSpreadShare: number;
  };
  /**
   * Survivors of a take sector left alive follow the player into the next sector (design §4.2): at
   * most `max` of them, arriving `delaySec` after it begins along its approach lanes, as a flank when
   * the player won a contact in the sector just left and as a trade otherwise.
   */
  follow: { max: number; delaySec: readonly [number, number] };
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
  sectors: 6,
  roleWeight: { take: 0.5, hold: 0.35, meet: 0.15 },
  maxRoleRun: 2,
  noCrossfireSectors: [4],
  dialOffset: [-8, -3, 0, 3, 0, 6],
  depthMultiplier: [1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
  contactsMin: [1, 1, 2, 2, 1, 1],
  contactsMax: [1, 2, 2, 3, 2, 2],
  cardWeight: { 'take-unaware': 0.3, 'take-expected': 0.35, clear: 0.2, crossfire: 0.25 },
  crossfireFromSector: 2,
  maxCardRun: 2,
  cardSkill: {
    'take-unaware': 'angles', 'take-expected': 'precision', clear: 'angles', crossfire: 'switch', hold: 'angles', trade: 'switch', flank: 'flick',
  },
  hold: {
    contactsMin: [1, 1, 1, 2, 1, 4],
    contactsMax: [1, 2, 3, 3, 2, 5],
    cardWeight: { hold: 0.6, trade: 0.25, flank: 0.15 },
    firstArrivalSec: [5, 10],
    windowSec: [25, 45],
    finaleWindowSec: [40, 60],
    minPeekFromEntryM: 6,
    minRouteFromEntryM: 5.5,
    peekerShare: 0.45,
    runShare: 0.65,
    runMps: 4.6,
    walkMps: 2.4,
    engageM: [6, 10],
    tradeGapSec: [1.2, 2.8],
    flankDelaySec: [4, 8],
    deferMaxSec: 4,
    exitFallbackSec: 120,
    laneSpreadShare: 0.3,
  },
  follow: { max: 2, delaySec: [3, 6] },
  place: {
    laneMinM: 1.2,
    laneMaxM: 3,
    holderLaneMaxM: 0.8,
    laneDropM: 0.3,
    sampleStepM: 0.25,
    clearPeekerShare: 0.6,
    unawareMoverShare: 0.7,
  },
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
