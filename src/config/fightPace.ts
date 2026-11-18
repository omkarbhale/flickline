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
  /**
   * Target: live seconds from `live` to the Finale's exit for a run that clears it, as [low, high] (design §4.1, #274). A full
   * run is its contacts at the fight pace above: the Opener, four drawn sectors and the Finale's five hold about 13 fights,
   * which at 4–7 a live minute, with gates and the walk between fights, is two to four minutes. HYPOTHESIS until testers'
   * journals measure it (`npm run journal`); the bot's time (`npm run bot -- --repeat-report`) is a floor for a person's.
   * Fewer fights a minute is never how a run gets longer (`targetFightsPerMin`).
   */
  finaleClearSec: readonly [number, number];
  /** How often the measurement looks for an Echo in sight or a running Echo within earshot, seconds. */
  sampleSec: number;
}

export const fightPace: FightPaceTunables = {
  targetFightsPerMin: 4,
  maxDeadAirSec: 15,
  maxGateSec: 5,
  finaleClearSec: [120, 240],
  sampleSec: 0.125,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { fightPace };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
