/**
 * Tunables of the fight ledger (`feedback/fightLedger.ts`, #120): the unit boundaries of
 * `docs/research/fight-attribution.md` §3.1 and the thresholds of the facts F1–F12 (§3.2). They are
 * data so each HYPOTHESIS the research names is a data change once a playtest settles it.
 */
export interface FightLedgerTunables {
  /**
   * §3.1: a contact ends when nobody has seen the other for this long (HYPOTHESIS 50%: long enough for a
   * re-peek to count as the same contact, short enough that the next contact is separate), seconds.
   */
  contactGapSec: number;
  /** §3.1: a duel ends when the line of sight is broken for longer than this, seconds. */
  duelBreakSec: number;
  /**
   * An enemy's own shot, tell or hit on the player proves it sees him; the line of sight itself is not logged, so after each one
   * it is assumed to hold for this long (longer than an enemy's fire interval) before a gap can break the duel, seconds.
   */
  enemyFireHoldSec: number;
  /** F12 same peek: the player re-exposes to the same enemy within this long of breaking the line of sight, seconds … */
  samePeekWindowSec: number;
  /** … from within this far of the previous spot, metres. */
  samePeekRadiusM: number;
  /** F12 stayed after the kill: hit within this long of a kill (the trade window), seconds … */
  tradeWindowSec: number;
  /** … while still within this far of where the kill was made, metres. */
  tradeRadiusM: number;
  /** F11: the running footsteps counted are those of this long before the enemy first perceived the player, seconds. */
  footstepWindowSec: number;
  /** F5: damage is off-target when the player's aim ray was on another enemy, within this angle of it, degrees … */
  offTargetDeg: number;
  /** … as of the latest shot or aim-on edge no older than this, seconds. */
  aimMemorySec: number;
  /**
   * F8: a shot counts as "at" an enemy (aim miss, spread miss or hit) when its view ray was within this angle of the
   * enemy's head centre, degrees. Wider than the stat tracker's 1° (which asks what a bullet could kill): the ledger
   * asks where the player's attempts went, and a flick that fires 5° early is the aim miss worth naming.
   */
  shotAtDeg: number;
  /**
   * F8: a shot whose aim ray (before the spread draw) passed within this angle of the enemy's head centre is
   * "on target": a stray bullet from it is a spread miss, not an aim miss. Degrees. The log carries no body extent
   * at the enemy's distance, so this is one angle: a head-to-chest half height at about 10 m.
   */
  onTargetDeg: number;
  /** F7: a first shot is out of role when a perfectly aimed, stationary one would hit the head with less than this probability. */
  outOfRoleHeadProb: number;
  /** A `contactSettled` attaches its scenario card to a contact that ended at most this long before it, seconds. */
  cardLagSec: number;
}

export const fightLedger: FightLedgerTunables = {
  contactGapSec: 2,
  duelBreakSec: 1,
  enemyFireHoldSec: 2,
  samePeekWindowSec: 4,
  samePeekRadiusM: 1,
  tradeWindowSec: 3,
  tradeRadiusM: 1,
  footstepWindowSec: 3,
  offTargetDeg: 5,
  aimMemorySec: 0.5,
  shotAtDeg: 8,
  onTargetDeg: 3,
  outOfRoleHeadProb: 0.5,
  cardLagSec: 10,
};

/** Fixed capacities of the ledger's preallocated records; a run that exceeds one sets `FightLedger.overflow` instead of allocating. */
export const fightLedgerCapacity = {
  contacts: 128,
  duels: 512,
  damages: 1024,
  /** Distinct enemy ids tracked (a power of two: the id table is open-addressed). */
  enemies: 2048,
};

export const tunableGroups = { fightLedger };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
