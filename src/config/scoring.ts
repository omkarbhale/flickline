/**
 * Scoring table of design §8.1. Every number is tunable here; nothing is inline in code.
 *
 *   score = base(enemy) × precision × speed × streak × difficulty   (× surge while Surge is on)
 *
 * plus, in modes where enemies fire back, one **contact settle** per contact (design §8.1, #132):
 * a payout for how the contact ended and how much health the player kept.
 *
 * No term is ever negative: missing costs the clean streak, the first-shot bonus and time, never
 * points directly; dying in a contact costs its settle, never points already scored.
 */

/** Enemy roster of design §5.2 (lower-case ids). Shared by scoring, modes and (later) the enemy sim. */
export const ENEMY_KINDS = ['post', 'beacon', 'strafer', 'peeker', 'rusher', 'bulwark', 'gnat'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

/**
 * The contact settle (design §8.1, #132). A contact is one Sweep contact.
 * When it ends it pays `kill × rate × kept`, where `kill` is one kill's worth (the mean `base` of the
 * contact's enemies × difficulty) and `kept = 1 − damage taken / health+shield at the start`:
 *
 *   cleared (every enemy dead, player alive)                rate = clear
 *   disengaged alive (lost at least `disengageMinLost`, left) rate = disengage
 *   avoided (left unhurt), died                             rate = 0
 *
 * Constraints the experiment in `feedback/contactExperiment.test.ts` checks, so a retune cannot
 * quietly break them: a clear pays more than a disengage at the same health (winning the fight stays
 * the best outcome, so the loop never trains passivity), and the table ranks "isolate and disengage"
 * above "always swing" at every dial, and "back off at the first hit" below both.
 */
export interface ContactSettleTunables {
  /** Kills' worth paid for clearing a contact untouched (scaled by `kept`). */
  clear: number;
  /** Kills' worth paid for leaving a contact you were losing, alive (scaled by `kept`). */
  disengage: number;
  /** A contact the player leaves counts as over after this long with no live enemy of it in sight. */
  disengageSec: number;
  /**
   * Leaving counts as a disengage only if the player lost at least this share of the contact's
   * starting health+shield (it was a fight the player was losing). Leaving unhurt pays nothing, so
   * peeking and leaving cannot be farmed. 0.3 is more than one body hit through a heavy shield.
   */
  disengageMinLost: number;
}

export interface ScoringTunables {
  /** Base points per kill by enemy kind. */
  base: Record<EnemyKind, number>;
  /** precision: ×this if the killing bullet hit the head. */
  headshotMult: number;
  /** precision: ×this if the killing bullet was the first bullet at that target (stacks with the head term). */
  firstBulletMult: number;
  /**
   * speed: `1 + speedBonusMax × clamp((par − TTK)/par, 0, 1)`. TTK runs from the first shot at the
   * target, so this pays for killing efficiently once committed, never for rushing into a fight;
   * #132 therefore keeps it on every card, holding cards included.
   */
  speedBonusMax: number;
  /** Par time (s) used when a mode does not give one for the enemy. */
  defaultParSec: number;
  /** streak: `1 + streakStep × min(cleanStreak, streakCap)`. */
  streakStep: number;
  streakCap: number;
  /** difficulty: `2^((dial − difficultyPivot)/difficultySpan)`; dial 75 = ×2, dial 25 = ×0.5. */
  difficultyPivot: number;
  difficultySpan: number;
  /** Surge multiplier hook (the meter itself belongs to the Sweep work). */
  surgeMult: number;
  /** Chain: a kill within this many seconds of the previous kill extends the chain. */
  chainWindowSec: number;
  /**
   * Chain credit only for isolated kills (#132): a kill made while another live enemy had line of
   * sight to the player from a bearing more than this many degrees away from the victim's (a second
   * angle, a crossfire) neither extends nor starts a chain. A run with no return fire has no
   * crossfire, so every kill there is isolated.
   */
  isolationAngleDeg: number;
  contact: ContactSettleTunables;
  /** A shot that misses breaks the clean streak ("missing costs you the clean streak", §8.1). */
  missBreaksStreak: boolean;
}

export const scoring: ScoringTunables = {
  base: { post: 100, beacon: 100, strafer: 150, peeker: 200, rusher: 150, bulwark: 250, gnat: 120 },
  headshotMult: 1.5,
  firstBulletMult: 1.25,
  speedBonusMax: 0.5,
  defaultParSec: 1.0,
  streakStep: 0.1,
  streakCap: 20,
  difficultyPivot: 50,
  difficultySpan: 25,
  surgeMult: 2,
  chainWindowSec: 1.5,
  // About the width of the area the crosshair can cover without a flick; two holders further apart
  // than this cannot both be fought from one crosshair placement (the crossfire card, #97).
  isolationAngleDeg: 30,
  contact: {
    // Chosen with the settling experiment (docs/research/survival-rewards.md). At 1 kill's worth
    // (the reference game's price of a life: one player of man advantage) the table only *ties*
    // the two policies; 2 is the smallest round value that ranks isolating higher at every dial.
    clear: 2,
    disengage: 1.5,
    disengageSec: 2,
    disengageMinLost: 0.3,
  },
  missBreaksStreak: true,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { scoring };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
