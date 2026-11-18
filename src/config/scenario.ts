/**
 * Scenario cards and the sampler's numbers (design §4.4; `docs/research/engagement-information.md` §3, §4.1, §4.5; #97).
 * Every fight is described by a card: what the player knows, what the enemy knows, how predictable the timing is, who
 * must move, how many enemies and in what arrangement. This file is the data (the ten cards, the target mix and the
 * rule numbers); the logic is `modes/scenario.ts`. The mix is HYPOTHESIS 40% until the balance pass (#53) and the
 * playtest (#105). Turning a card into placements and beliefs is #98, not here.
 */

/** The ten cards of research §3. Index order is the order of this list and is part of the sampler's seeded draws: never reorder. */
export const SCENARIO_CARD_IDS = [
  'take-expected', 'take-unaware', 'hold', 'clear', 'trade', 'meet', 'breach', 'crossfire', 'flank', 'known-duel',
] as const;
export type ScenarioCardId = (typeof SCENARIO_CARD_IDS)[number];

/** What the player knows of the enemy before the fight, delivered only through honest channels (research §4.2). */
export type PlayerInfo = 'none' | 'area' | 'spot';
/** What the enemy knows of the player: the initial belief written into its memory (mind §5.3). */
export type EnemyInfo = 'unaware' | 'area' | 'spot';
/** How predictable the fight's start is: the spawn or approach delay distribution. */
export type Timing = 'window' | 'rough' | 'unknown';
/** The player's role; enemies get the complement. `none`: nobody must move (the known duel). */
export type PlayerRole = 'take' | 'hold' | 'both' | 'breach' | 'none';
export type Arrangement = 'single' | 'sequential' | 'crossfire';

export interface ScenarioCard {
  id: ScenarioCardId;
  playerInfo: PlayerInfo;
  enemyInfo: EnemyInfo;
  timing: Timing;
  role: PlayerRole;
  count: 1 | 2 | 3 | 4;
  arrangement: Arrangement;
}

/** The ten cards as data, in `SCENARIO_CARD_IDS` order (research §3's table; where it gives a range, the more typical value). */
export const SCENARIO_CARDS_DATA: readonly ScenarioCard[] = [
  // 1. The most common attacker fight: the holder has the designed advantage, so peek technique decides it.
  { id: 'take-expected', playerInfo: 'area', enemyInfo: 'spot', timing: 'rough', role: 'take', count: 1, arrangement: 'single' },
  // 5. Someone looking away or reloading: punish the timing.
  { id: 'take-unaware', playerInfo: 'spot', enemyInfo: 'unaware', timing: 'window', role: 'take', count: 1, arrangement: 'single' },
  // 2. The defender's core fight: the enemy takes, at a time the player cannot know.
  { id: 'hold', playerInfo: 'area', enemyInfo: 'area', timing: 'unknown', role: 'hold', count: 1, arrangement: 'single' },
  // 3. Several possible spots, one real one: one enemy, the player checks angles one at a time.
  { id: 'clear', playerInfo: 'area', enemyInfo: 'area', timing: 'rough', role: 'take', count: 1, arrangement: 'single' },
  // 4. A second enemy hears the first fight: real fights are sequences.
  { id: 'trade', playerInfo: 'area', enemyInfo: 'area', timing: 'rough', role: 'both', count: 2, arrangement: 'sequential' },
  // 6. Rotations and mid-map contacts: who stops first wins.
  { id: 'meet', playerInfo: 'none', enemyInfo: 'unaware', timing: 'unknown', role: 'both', count: 1, arrangement: 'single' },
  // 7. Forced entry into held space: the order of angles, accepting a trade, not giving up.
  { id: 'breach', playerInfo: 'area', enemyInfo: 'area', timing: 'window', role: 'breach', count: 2, arrangement: 'sequential' },
  // 8. Two enemies at once: isolate one angle, do not swing into both.
  { id: 'crossfire', playerInfo: 'area', enemyInfo: 'area', timing: 'rough', role: 'take', count: 2, arrangement: 'crossfire' },
  // 9. From behind or the side, audible before it fires: the player holds and must turn to a sound.
  { id: 'flank', playerInfo: 'none', enemyInfo: 'spot', timing: 'unknown', role: 'hold', count: 1, arrangement: 'single' },
  // 10. Pure aim and reaction: a small control and a breather.
  { id: 'known-duel', playerInfo: 'spot', enemyInfo: 'spot', timing: 'window', role: 'none', count: 1, arrangement: 'single' },
];

/** The sector roles of a Sweep run (design §4.2), which the sampler's caller maps to the cards a sector can deal. */
export type PoolRole = 'take' | 'hold' | 'meet';

export interface ScenarioTunables {
  /**
   * The Sweep target mix, a share of contacts per card (research §4.5; sums to 1). Shares, not counts: a run draws
   * them over the cards its sector roles let it deal, renormalised.
   */
  mix: Readonly<Record<ScenarioCardId, number>>;
  /**
   * The cards a sector of each role can hold (design §4.2, §4.4; research §5 Q5: taker cards are take, clear, breach and
   * crossfire, holder cards hold, flank and trade, neutral cards meet and the known duel). The caller's `allowed` mask
   * for a contact starts from its role's pool.
   */
  pools: Readonly<Record<PoolRole, readonly ScenarioCardId[]>>;
  /** Research §4.5 rule 1: a run presents at least `minCards` distinct cards, when the caller says how many contacts it still has to deal and its sectors can deal them. */
  coverage: { minCards: number };
  /** Rule 2: the same card never this many times in a row. */
  maxRun: number;
  /** Rule 2: these never follow themselves ("a flank never follows a flank"). */
  neverRepeat: readonly ScenarioCardId[];
  /**
   * Rule 3: a ceiling on a card's share of the run's contacts so far, rounded up to a whole contact (one contact is 100% of a
   * one-contact run, so a short run may hold one). `afterWin`: the card may only be dealt after a contact the player won
   * (the flank is never a punishment).
   */
  caps: Readonly<Partial<Record<ScenarioCardId, { maxShare: number; afterWin: boolean }>>>;
  /**
   * Drift correction (`modes/scenario.ts`): a card's weight is multiplied by `1 + gain * owed` (owed = contacts it should have
   * had by the mix, minus the ones dealt), bounded to `[min, max]`. Damps the clumping of independent draws so a
   * 1,000-contact mix stays near its target whatever the seed; it never decides a card on its own.
   */
  catchUp: { gain: number; min: number; max: number };
}

export const scenario: ScenarioTunables = {
  mix: {
    hold: 0.22,
    'take-expected': 0.16,
    clear: 0.13,
    trade: 0.12,
    'take-unaware': 0.08,
    meet: 0.08,
    breach: 0.06,
    crossfire: 0.06,
    flank: 0.04,
    'known-duel': 0.05,
  },
  pools: {
    take: ['take-expected', 'take-unaware', 'clear', 'breach', 'crossfire'],
    hold: ['hold', 'trade', 'flank'],
    meet: ['meet', 'known-duel'],
  },
  coverage: { minCards: 6 },
  maxRun: 2,
  neverRepeat: ['flank'],
  caps: {
    'known-duel': { maxShare: 0.05, afterWin: false },
    flank: { maxShare: 0.05, afterWin: true },
  },
  catchUp: { gain: 0.15, min: 0.2, max: 3 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { scenario };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
