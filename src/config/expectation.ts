/**
 * How what an enemy expects changes when it can shoot (issue #127, `docs/research/prepared-holders.md`).
 * Pure data read by `sim/enemyTiming.ts`. The floors themselves stay with the other fairness floors
 * in `config/dial.ts`, split by expectation there. Units: seconds.
 */
export interface ExpectationTunables {
  /**
   * Reaction saved by an enemy that expects the player at this spot and roughly now (research
   * `player-like-enemies.md` §5.3: midpoint of the 27 ms foreperiod and 47 ms valid-cue effects).
   */
  preparedBonusSec: number;
  /** Added when the player appears outside the enemy's attention cone (§5.3, ~100 ms peripheral capture). */
  orientationSec: number;
  /**
   * Peeker's advantage, drawn uniformly per contact. The reference game's netcode shows a peeker to
   * the holder 40–70 ms late (Riot, *Peeking into VALORANT's netcode*). Flickline has no network, so
   * the gap is modelled where it lands: an enemy that the player peeks perceives the player this much
   * late; an enemy that peeks the player reacts this much early (still floored).
   * **Off (0) by default**: on its own it turns a wide swing into a prepared holder into a coin flip
   * (#127 experiment), while the holder-side effects that offset it in the reference game are not
   * modelled yet. Revisit with real Echoes (#93 re-runs the experiment as signature S12).
   */
  peekerAdvantageMinSec: number;
  peekerAdvantageMaxSec: number;
}

export const expectation: ExpectationTunables = {
  preparedBonusSec: 0.035,
  orientationSec: 0.1,
  peekerAdvantageMinSec: 0,
  peekerAdvantageMaxSec: 0,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { expectation };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
