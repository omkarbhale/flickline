/**
 * The player's side of combat (docs/mechanics-spec.md §4, §7.1 global keys). Units: HP, seconds,
 * degrees (display-facing angles end in `Deg`), fractions of the player's maximum speed.
 */
export interface PlayerTunables {
  health: {
    /** `health.max` (spec §4.1): 100 HP, no armour in the first release. */
    max: number;
  };
  /** Tagging, the movement slow when hit (spec §4.3). */
  tag: {
    /** `tag.speed_scale`: the speed cap while fully tagged, as a fraction of max speed (a 72.5% slow). */
    speedScale: number;
    /** `tag.ramp_in`: seconds to go from untagged to the full slow after a hit. */
    rampInSec: number;
    /** `tag.release`: seconds from the last hit until the slow is gone; each hit refreshes it. */
    releaseSec: number;
  };
  /** Aim punch when hit (spec §4.4, PLACEHOLDER numbers). `strength` is the user's multiplier (0 disables). */
  flinch: {
    strength: number;
    pitchHeadDeg: number;
    pitchBodyDeg: number;
    pitchLegDeg: number;
    /** A head hit's kick recovers in this long; smaller kicks recover at the same rate. */
    recoverySec: number;
    /** The punch never stacks beyond this, degrees. */
    maxDeg: number;
  };
}

export const player: PlayerTunables = {
  health: { max: 100 },
  tag: { speedScale: 0.275, rampInSec: 0.1, releaseSec: 0.5 },
  flinch: { strength: 1, pitchHeadDeg: 2.0, pitchBodyDeg: 0.6, pitchLegDeg: 0.3, recoverySec: 0.25, maxDeg: 4 },
};
