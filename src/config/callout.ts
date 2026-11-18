/**
 * The callout stand-in (`docs/research/engagement-information.md` §4.2, #99): a rare, coarse,
 * delayed cue that stands in for a teammate's call when a card gives the player an `area` and no
 * sound would carry it. A short chirp plus a soft glow on the side of the contact; never a marker
 * on a position, never on a minimap, and a settings switch turns it off.
 */
export interface CalloutTunables {
  /**
   * The cards whose player knowledge is an area (engagement-information §3: `playerInfo: 'area'`) and
   * whose Echoes are silent where they wait. A hold, trade or flank is carried by the running steps
   * of the arrivals instead (their honest audio), and a take-unaware's point is that the player is not told.
   */
  cards: readonly string[];
  /** The chance a qualifying sector gets one at all ("rare": most sectors get none). HYPOTHESIS 40%. */
  chance: number;
  /** Never in two sectors within this many sectors of each other (1 = not in consecutive sectors). */
  minSectorGap: number;
  /** The delay after the sector's Echoes are "seen by a teammate" (the sector is entered), seconds: uniform in [min, max]. */
  delaySec: readonly [number, number];
  /** The direction is the true bearing of the contact's Echoes off by a uniform error of up to this, degrees (either side). */
  maxErrorDeg: number;
  /** How long the glow stays, seconds (it fades out over the whole time and follows the view, so it stays on its side). */
  glowSec: number;
  /** Angular reach of the glow around its bearing, degrees (soft, so it reads as a side, not a point). */
  glowWidthDeg: number;
  /** Where the chirp is placed, metres from the head along the called bearing (it comes from that side). */
  chirpDistanceM: number;
}

export const callout: CalloutTunables = {
  cards: ['take-expected', 'clear', 'crossfire'],
  chance: 0.5,
  minSectorGap: 1,
  delaySec: [0.6, 1.2],
  maxErrorDeg: 45,
  glowSec: 1.8,
  glowWidthDeg: 90,
  chirpDistanceM: 2.5,
};

export const tunableGroups = { callout };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
