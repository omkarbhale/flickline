/**
 * The lean (design §4.4, §8.3; #210): the one thing to fix is practised by playing. The fix engine's finding raises
 * the weight of the scenario cards that exercise it in the next run's sampler; the results card says what the next
 * run leans toward. This file is the data: which cards exercise which diagnostic, the plain words for each, and the
 * numbers (boost, cap, weakest-card rule). The logic is `modes/lean.ts`. Starting values are HYPOTHESIS until the
 * balance pass (#53) and the lean's A/B (`npm run bot -- --lean-report`, `docs/research/replay-not-drills.md` R4).
 */

/** The ten scenario cards of design §4.4 (a run deals only the ones `config/sweep.ts` and the sector roles let it deal today). */
export type ScenarioCard =
  | 'take-expected' | 'take-unaware' | 'hold' | 'clear' | 'trade' | 'meet' | 'breach' | 'crossfire' | 'flank' | 'known-duel';
export const SCENARIO_CARDS: readonly ScenarioCard[] = [
  'take-expected', 'take-unaware', 'hold', 'clear', 'trade', 'meet', 'breach', 'crossfire', 'flank', 'known-duel',
];

/**
 * The twelve candidate diagnostics of the fix engine (design §8.3). `movingShots` and `slowTimeToShot` (the "late shot"
 * of the design) are the two the #26 stub finds today; the ranked engine (#39) finds all twelve.
 */
export type DiagnosticId =
  | 'movingShots' | 'slowTimeToShot' | 'flickBias' | 'headHeight' | 'preAim' | 'sprayCollapse'
  | 'trackingLag' | 'switchHesitation' | 'overPeek' | 'overkill' | 'reloadInOpen' | 'tilt';
export const DIAGNOSTIC_IDS: readonly DiagnosticId[] = [
  'movingShots', 'slowTimeToShot', 'flickBias', 'headHeight', 'preAim', 'sprayCollapse',
  'trackingLag', 'switchHesitation', 'overPeek', 'overkill', 'reloadInOpen', 'tilt',
];

/** What a diagnostic leans the next run toward. */
export interface LeanEntry {
  /**
   * The cards whose fights exercise the weakness, most telling first. A card the run cannot deal yet (`hold`, `trade`,
   * `breach`, `flank`, `known-duel`: #97, #204) is kept here and skipped by the sampler until it can. Empty: no situation
   * practises it (the tilt is about the fight after a loss, not about a kind of fight).
   */
  cards: readonly ScenarioCard[];
  /** Why those fights, ending the results line: "Next run leans: {cards}, {why}." Empty when `cards` is. */
  why: string;
}

export interface LeanTunables {
  /** Weight added to a leaned card: +50% (design §4.4). */
  boost: number;
  /** A leaned card's share never exceeds this many times its base share (design §4.4: twice). */
  maxShareFactor: number;
  /**
   * The weakest cards (design §4.4): after the first run, the `count` cards with the lowest win rate over their last
   * `window` contacts lean too, when at least `minContacts` of them were fought (one lost fight is not a weakness) and
   * the win rate is under `belowRate` (a card the player wins at the ~70% skill-matching target, design §9, needs no
   * extra practice).
   */
  weakest: { count: number; window: number; minContacts: number; belowRate: number };
  /** Diagnostic -> cards that exercise it (design §8.3; "a data table", #210). */
  table: Readonly<Record<DiagnosticId, LeanEntry>>;
  /** Each card as the results line says it ("meets in a corridor"). */
  phrases: Readonly<Record<ScenarioCard, string>>;
  /** The results line; `{cards}` is the phrases joined in plain words, `{why}` the diagnostic's clause. */
  line: string;
  /** Joins the phrases: "a, b and c". */
  listJoin: { comma: string; and: string };
}

export const lean: LeanTunables = {
  boost: 0.5,
  maxShareFactor: 2,
  weakest: { count: 2, window: 20, minContacts: 4, belowRate: 0.7 },
  table: {
    movingShots: { cards: ['meet', 'take-expected'], why: 'where the stop decides the fight' },
    slowTimeToShot: { cards: ['take-unaware', 'hold', 'breach'], why: 'where the first shot decides the fight' },
    flickBias: { cards: ['crossfire', 'flank'], why: 'where one flick has to cross a wide gap' },
    headHeight: { cards: ['clear', 'take-unaware'], why: 'where head height decides the first shot' },
    preAim: { cards: ['take-expected', 'clear', 'breach'], why: 'where a crosshair already on the angle wins' },
    sprayCollapse: { cards: ['breach', 'crossfire'], why: 'where the burst has to hold up' },
    trackingLag: { cards: ['meet', 'take-unaware'], why: 'where the enemy keeps moving and you keep up' },
    switchHesitation: { cards: ['trade', 'crossfire'], why: 'where the next enemy is already shooting' },
    overPeek: { cards: ['take-expected', 'breach', 'hold'], why: 'where how far you peek decides the damage' },
    overkill: { cards: ['crossfire', 'trade'], why: 'where every extra bullet is one the next enemy gets' },
    reloadInOpen: { cards: ['crossfire', 'flank'], why: 'where the magazine has to last the fight' },
    tilt: { cards: [], why: '' },
  },
  phrases: {
    'take-expected': 'takes against enemies who expect you',
    'take-unaware': 'takes against enemies who have not seen you',
    hold: 'holds',
    clear: 'clears of angles that may hold nobody',
    trade: 'trades',
    meet: 'meets in a corridor',
    breach: 'breaches into set-up enemies',
    crossfire: 'crossfires',
    flank: 'flanks',
    'known-duel': 'even duels',
  },
  line: 'Next run leans: {cards}, {why}.',
  listJoin: { comma: ', ', and: ' and ' },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { lean };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
