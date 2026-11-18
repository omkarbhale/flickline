/**
 * Fight pace (#248, design §2.2): how many fights a minute of Sweep gives and how long the player
 * goes without one. These are the product targets the bot report and the fun criteria check, and
 * the sampling the measurement uses. They are not gameplay numbers: nothing in the run reads them.
 */
export interface FightPaceTunables {
  /**
   * Target: fights (contacts fought: cleared, died or disengaged) per live minute at the median run.
   * HYPOTHESIS until the repeat-enjoyment playtest (#214): the reference game's deathmatch gives
   * about 4 a minute to a player who goes even (first to 40 in 9 minutes; #248).
   */
  targetFightsPerMin: number;
  /** Target: the longest stretch inside a sector with no Echo seen, heard or shooting, seconds (HYPOTHESIS). */
  maxDeadAirSec: number;
  /** Target: the longest gate, from entering it to entering the sector behind the chosen door, seconds (HYPOTHESIS). */
  maxGateSec: number;
  /** How often the measurement looks for an Echo in sight or a running Echo within earshot, seconds. */
  sampleSec: number;
}

export const fightPace: FightPaceTunables = {
  targetFightsPerMin: 4,
  maxDeadAirSec: 15,
  maxGateSec: 5,
  sampleSec: 0.125,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { fightPace };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
