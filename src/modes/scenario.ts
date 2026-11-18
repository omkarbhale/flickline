import { Rng } from '../core/rng';
import type { LeanTunables } from '../config/lean';
import { SCENARIO_CARDS_DATA, SCENARIO_CARD_IDS, type PoolRole, type ScenarioCard, type ScenarioCardId, type ScenarioTunables } from '../config/scenario';

export type { ScenarioCard, ScenarioCardId };

/**
 * # Scenario cards and the seeded scenario sampler (design §4.4; research `engagement-information.md` §4.1, §4.5; #97)
 *
 * Every contact is described by a card; the sampler draws the next card from the Sweep target mix with the rules of
 * research §4.5, all seeded and deterministic:
 *
 *  1. **Coverage**: a run presents at least `coverage.minCards` distinct cards. The sampler cannot see the run's length, so
 *     the caller says how many contacts it still has to deal (`contactsLeft`, this one included); once every remaining
 *     contact has to be a new card to reach the minimum, the draw is restricted to cards not yet seen.
 *  2. **No streaks**: the same card never `maxRun + 1` times in a row; a card in `neverRepeat` (the flank) never follows itself.
 *  3. **Caps**: a card with a cap (the known duel, the flank) never exceeds its share of the run's contacts so far (rounded up to
 *     a whole contact), and a card with `afterWin` (the flank) is only dealt right after a contact the player won.
 *  4. **Tempo overrides** (#100) choose the card before the mix is sampled: `commit` registers a card the caller chose, so the
 *     streak, cap and coverage rules and the weakness weighting see it like any other.
 *  5. **Weakness weighting**: the cards the player loses most (the lean's rule: the `lean.weakest.count` lowest win rates over each
 *     card's last `lean.weakest.window` contacts, at least `minContacts` fought and under `belowRate`) gain `lean.boost` (+50%)
 *     in weight, and no such card's share passes `lean.maxShareFactor` (2x) its base share (the closed form of `boostShares`).
 *     `lean(...)` adds the cards the results card named for the next run (#210) to the same set.
 *  6. **Drift correction**: independent draws would leave a 1,000-contact mix a point or two off its target by luck alone (the
 *     standard deviation of a 22% share over 1,000 draws is 1.3 points). So the sampler keeps, per card, how many contacts it
 *     is *owed* (the share it should have had over the draws it was allowed, minus the ones dealt) and tilts the weights by
 *     it (`catchUp`, bounded): a card dealt too often waits, one dealt too rarely comes sooner. The target it tracks is the
 *     mix after the weakness weighting, so a boosted card keeps its boost; a tempo override (`commit`) is paid for the same
 *     way ("the mix rebalances over the rest of the run", rule 4). Draws stay random; only the clumping is damped.
 *  7. **The dial is never an input**: it sets enemy profiles and counts, never the mix, so difficulty and situation stay separate
 *     variables in the skill model. The sampler reads `scenario` and the lean numbers and nothing else.
 *
 * Cards are indices into `SCENARIO_CARD_IDS` and sets of cards are bit masks, so a draw allocates nothing: every buffer is
 * made once in the constructor. One `rng.next()` is consumed per draw however it was decided, so a seed's sequence is stable.
 */

export const CARD_COUNT = SCENARIO_CARD_IDS.length;
/** Returned by `draw` when the rules leave the caller no card (every allowed card is barred): it decides what to do. */
export const NO_CARD = -1;

/** The index of a card id, or -1. */
export function cardIndex(id: string): number {
  return (SCENARIO_CARD_IDS as readonly string[]).indexOf(id);
}

/** The card's data (its recipe: what each side knows, timing, role, count, arrangement). */
export function cardData(index: number): ScenarioCard {
  return SCENARIO_CARDS_DATA[index]!;
}

/** The bit mask of some cards (setup time: it allocates nothing the sampler reads per draw). */
export function cardMask(ids: readonly ScenarioCardId[]): number {
  let m = 0;
  for (const id of ids) m |= 1 << cardIndex(id);
  return m;
}

/** Every card. */
export const ALL_CARDS = (1 << CARD_COUNT) - 1;

/** The mask of the cards a sector of `role` can hold (`scenario.pools`). */
export function poolMask(cfg: ScenarioTunables, role: PoolRole): number {
  return cardMask(cfg.pools[role]);
}

const WON = 2;
const LOST = 1;

export class ScenarioSampler {
  private readonly rng = new Rng();
  private readonly base = new Float64Array(CARD_COUNT);
  private readonly w = new Float64Array(CARD_COUNT);
  private readonly neverRepeatMask: number;
  private readonly capShare = new Float64Array(CARD_COUNT);
  private readonly capAfterWin = new Uint8Array(CARD_COUNT);
  private readonly capped = new Uint8Array(CARD_COUNT);
  /** Per card, a ring of its last `window` outcomes (0 = empty, 1 = lost, 2 = won), with its head, fill and win count. */
  private readonly ring: Uint8Array;
  private readonly head = new Uint8Array(CARD_COUNT);
  private readonly fill = new Uint8Array(CARD_COUNT);
  private readonly wins = new Uint8Array(CARD_COUNT);
  private readonly window: number;
  private readonly count = new Int32Array(CARD_COUNT);
  /** Contacts each card is owed: the share it should have had over the draws it was allowed, minus the times it was dealt. */
  private readonly owed = new Float64Array(CARD_COUNT);
  private leaned = 0;
  private lastCard = NO_CARD;
  private runLen = 0;
  private total = 0;
  private distinctCount = 0;

  constructor(
    private readonly cfg: ScenarioTunables,
    private readonly leanCfg: Pick<LeanTunables, 'boost' | 'maxShareFactor' | 'weakest'>,
    seed = 1,
  ) {
    this.window = Math.min(255, Math.max(1, Math.floor(leanCfg.weakest.window)));
    this.ring = new Uint8Array(CARD_COUNT * this.window);
    let nr = 0;
    for (const id of cfg.neverRepeat) nr |= 1 << cardIndex(id);
    this.neverRepeatMask = nr;
    for (let i = 0; i < CARD_COUNT; i++) {
      const id = SCENARIO_CARD_IDS[i]!;
      this.base[i] = Math.max(0, cfg.mix[id]);
      const cap = cfg.caps[id];
      if (cap) {
        this.capped[i] = 1;
        this.capShare[i] = cap.maxShare;
        this.capAfterWin[i] = cap.afterWin ? 1 : 0;
      }
    }
    this.reset(seed);
  }

  /** A new run: the seed, no contacts dealt, no lean. The outcome windows are kept (they are the player's history, `preload`ed once). */
  reset(seed: number): void {
    this.rng.setState(seed);
    this.count.fill(0);
    this.owed.fill(0);
    this.leaned = 0;
    this.lastCard = NO_CARD;
    this.runLen = 0;
    this.total = 0;
    this.distinctCount = 0;
  }

  /** The contacts dealt so far this run, and the distinct cards among them. */
  get dealt(): number {
    return this.total;
  }
  get distinct(): number {
    return this.distinctCount;
  }
  /** How many times a card was dealt this run. */
  dealtOf(card: number): number {
    return this.count[card]!;
  }
  /** The card dealt last, or `NO_CARD`. */
  get last(): number {
    return this.lastCard;
  }

  /**
   * The next card, drawn from `allowed` (a mask of the cards this contact can hold: its sector's pool, the anchors left; see
   * `poolMask`) by the mix and the rules. `wonLast`: the player won the previous contact (the flank's condition).
   * `contactsLeft`: contacts this run still deals, this one included (default: unknown, so no coverage forcing). Returns the
   * card index, or `NO_CARD` when the rules bar every allowed card (a streak, a cap): the caller then widens `allowed` or plays
   * a card of its own through `commit`. The drawn card counts as dealt.
   */
  draw(allowed: number, wonLast: boolean, contactsLeft = Infinity): number {
    let ok = allowed & ALL_CARDS;
    // Rules 2 and 3: bar what the rules bar.
    if (this.lastCard >= 0) {
      if (this.runLen >= this.cfg.maxRun) ok &= ~(1 << this.lastCard);
      ok &= ~(this.neverRepeatMask & (1 << this.lastCard));
    }
    const nextTotal = this.total + 1;
    for (let i = 0; i < CARD_COUNT; i++) {
      if (this.capped[i] === 0 || (ok & (1 << i)) === 0) continue;
      if (this.capAfterWin[i] === 1 && !wonLast) ok &= ~(1 << i);
      else if (this.count[i]! + 1 > Math.ceil(this.capShare[i]! * nextTotal - 1e-9)) ok &= ~(1 << i);
    }
    if (ok === 0) return NO_CARD;
    // Rule 1: when every contact left has to be a new card to reach the minimum, only new cards.
    if (this.distinctCount < this.cfg.coverage.minCards && this.cfg.coverage.minCards - this.distinctCount >= contactsLeft) {
      let unseen = 0;
      for (let i = 0; i < CARD_COUNT; i++) if ((ok & (1 << i)) !== 0 && this.count[i] === 0) unseen |= 1 << i;
      if (unseen !== 0) ok = unseen;
    }
    const card = this.pick(ok);
    this.commit(card);
    return card;
  }

  /** A card the caller chose itself (a tempo override, a hold's survivor following the player): it counts as dealt, and no draw is consumed. */
  commit(card: number): void {
    if (card < 0 || card >= CARD_COUNT) return;
    this.owed[card]!--;
    if (this.count[card] === 0) this.distinctCount++;
    this.count[card]!++;
    this.total++;
    if (card === this.lastCard) this.runLen++;
    else {
      this.lastCard = card;
      this.runLen = 1;
    }
  }

  /** The outcome of a settled contact of `card` (won: the player won it), for the weakness weighting. */
  record(card: number, won: boolean): void {
    if (card < 0 || card >= CARD_COUNT) return;
    const win = this.window;
    const slot = card * win + this.head[card]!;
    if (this.fill[card]! === win) {
      if (this.ring[slot] === WON) this.wins[card]!--;
    } else this.fill[card]!++;
    this.ring[slot] = won ? WON : LOST;
    if (won) this.wins[card]!++;
    this.head[card] = (this.head[card]! + 1) % win;
  }

  /**
   * The player's history, oldest first, so the weakness weighting works from the first contact of a run
   * (the progress store keeps the last `window` settled contacts per card). Call once per card, before the run.
   */
  preload(card: number, won: boolean): void {
    this.record(card, won);
  }

  /** The cards the results card named for this run (design §8.3, #210): they gain the same weight as the weakest. A mask; 0 clears it. */
  lean(mask: number): void {
    this.leaned = mask & ALL_CARDS;
  }

  /** The cards that gain weight now: the leaned ones and the weakest (a mask; for the debug hook and tests). */
  boosted(): number {
    return this.leaned | this.weakMask();
  }

  /** Fights of a card in its window, and the win rate over them (0 with none). */
  fights(card: number): number {
    return this.fill[card]!;
  }
  winRate(card: number): number {
    const f = this.fill[card]!;
    return f === 0 ? 0 : this.wins[card]! / f;
  }

  /**
   * The weakest cards as a mask: of the cards with at least `minContacts` fights in their window and a win rate under
   * `belowRate`, the `count` lowest (ties go to the earlier card, so the result is stable).
   */
  private weakMask(): number {
    const wk = this.leanCfg.weakest;
    let mask = 0;
    for (let n = 0; n < wk.count; n++) {
      let best = -1;
      let bestRate = 2;
      for (let i = 0; i < CARD_COUNT; i++) {
        const f = this.fill[i]!;
        if ((mask & (1 << i)) !== 0 || f < wk.minContacts || f === 0) continue;
        const rate = this.wins[i]! / f;
        if (rate < wk.belowRate && rate < bestRate) {
          best = i;
          bestRate = rate;
        }
      }
      if (best < 0) break;
      mask |= 1 << best;
    }
    return mask;
  }

  /** One weighted draw over `ok`, the boosted cards raised by the lean's boost within its share cap. */
  private pick(ok: number): number {
    const w = this.w;
    let total = 0;
    for (let i = 0; i < CARD_COUNT; i++) {
      w[i] = (ok & (1 << i)) !== 0 ? this.base[i]! : 0;
      total += w[i]!;
    }
    // A card the mix gives no share (or a mask of only such cards) still has to be drawable: fall back to equal weights.
    if (total <= 0) {
      for (let i = 0; i < CARD_COUNT; i++) {
        w[i] = (ok & (1 << i)) !== 0 ? 1 : 0;
        total += w[i]!;
      }
    }
    const boosted = this.boosted() & ok;
    if (boosted !== 0 && this.leanCfg.boost > 0) {
      let lw = 0;
      for (let i = 0; i < CARD_COUNT; i++) if ((boosted & (1 << i)) !== 0) lw += w[i]!;
      if (lw > 0) {
        let m = 1 + this.leanCfg.boost;
        const k = this.leanCfg.maxShareFactor;
        if (total > k * lw) m = Math.min(m, (k * (total - lw)) / (total - k * lw));
        if (m > 1) {
          for (let i = 0; i < CARD_COUNT; i++) if ((boosted & (1 << i)) !== 0) w[i]! *= m;
          total += (m - 1) * lw;
        }
      }
    }
    // Drift correction: the owed contacts accrue at the target shares of this draw, then tilt the weights.
    const owed = this.owed;
    const cu = this.cfg.catchUp;
    let tilted = 0;
    for (let i = 0; i < CARD_COUNT; i++) {
      const wi = w[i]!;
      if (wi <= 0) continue;
      owed[i]! += wi / total;
      const f = 1 + cu.gain * owed[i]!;
      const wt = wi * (f < cu.min ? cu.min : f > cu.max ? cu.max : f);
      w[i] = wt;
      tilted += wt;
    }
    total = tilted;
    let u = this.rng.next() * total;
    let last = 0;
    for (let i = 0; i < CARD_COUNT; i++) {
      const wi = w[i]!;
      if (wi <= 0) continue;
      last = i;
      u -= wi;
      if (u < 0) return i;
    }
    return last; // rounding: the last card with weight
  }
}
