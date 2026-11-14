/**
 * Sweep, the run (design §4), tunables. Starting values are HYPOTHESIS until the balance pass (#53):
 * the shape of a v0 run (four take sectors, #201), the scenario-card mix of its contacts, how the
 * run director places Echoes on a sector's hold anchors, and the run terms of design §8.1.
 * Seconds, metres; names ending `Deg` are degrees.
 */

/** The scenario cards a v0 take sector can deal (design §4.4; the rest arrive with #97, #204, #212). */
export type SweepCard = 'take-unaware' | 'take-expected' | 'clear' | 'crossfire';
export const SWEEP_CARDS: readonly SweepCard[] = ['take-unaware', 'take-expected', 'clear', 'crossfire'];

export interface SweepTunables {
  /** HP restored by a kill (design §4.1: "a body kill restores 5 HP, a headshot kill 10"); capped at max HP. A leg kill counts as a body kill. */
  killHeal: { body: number; head: number };
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
  sectors: 4,
  dialOffset: [-8, -3, 0, 3],
  depthMultiplier: [1.0, 1.2, 1.4, 1.6],
  contactsMin: [1, 1, 2, 2],
  contactsMax: [1, 2, 2, 3],
  cardWeight: { 'take-unaware': 0.3, 'take-expected': 0.35, clear: 0.2, crossfire: 0.25 },
  crossfireFromSector: 2,
  maxCardRun: 2,
  place: {
    laneMinM: 1.2,
    laneMaxM: 3,
    holderLaneMaxM: 0.8,
    laneDropM: 0.3,
    sampleStepM: 0.25,
    clearPeekerShare: 0.6,
    unawareMoverShare: 0.7,
  },
  // `hold` is gentle too, and joins the list with hold sectors (#204).
  opener: { contactsMin: 4, contactsMax: 6, maxSectors: 9, cards: ['take-unaware', 'clear'], winMaxShieldLoss: 0.5 },
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
