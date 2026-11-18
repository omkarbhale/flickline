import { DIAGNOSTIC_IDS, SCENARIO_CARDS, type DiagnosticId, type LeanTunables, type ScenarioCardId } from '../config/lean';
import type { SweepTunables } from '../config/sweep';

/**
 * # The lean (design §4.4, §8.3; #210)
 *
 * The one thing to fix is practised by playing: the cards that exercise the finding get more weight in the next
 * run's sampler, and the results card says so in plain words. Pure data and arithmetic, no clock, no randomness: the
 * plan stays a function of the seed and the lean it was dealt with.
 *
 *  - `boostShares` is the sampler's rule: a leaned card's weight rises by `boost`, and its share never goes above
 *    `maxShareFactor` times its base share (closed form, so the cap is exact, not approximate).
 *  - `leanView` turns a diagnostic into what the card says and what the sampler is told, using only cards the run can
 *    deal today (`dealableCards`): the line never promises a situation that will not come.
 *  - `weakestCards` is the other half of the lean (design §4.4): the cards the player loses most.
 *  - `LeanKeeper` holds the lean between the results card and the next run: it applies to one run and is then spent.
 */

/** The cards a run leans toward (empty: no lean). Card ids, as `contactSettled.card` carries them. */
export type Lean = readonly string[];
export const NO_LEAN: Lean = Object.freeze([]) as Lean;

/** What the sampler needs: the cards and the two numbers. */
export interface LeanSpec {
  cards: Lean;
  boost: number;
  maxShareFactor: number;
}

/**
 * `weights` with every leaned card's weight raised by `boost`, so that no leaned card's share of the total passes
 * `maxShareFactor` times its share before. Cards that are not leaned, or have no weight to begin with, keep their weight
 * (their share falls a little, as the leaned ones rise). With nothing to lean it returns `weights` itself.
 *
 * With total weight T, leaned weight L and multiplier m = 1 + boost, a leaned card's share goes from w/T to
 * m·w/(T + (m−1)·L); holding that at or under k·w/T gives m ≤ k·(T−L)/(T−k·L) when T > k·L, and no limit otherwise.
 */
export function boostShares<K extends string>(
  weights: Readonly<Record<K, number>>,
  leaned: Lean,
  boost: number,
  maxShareFactor: number,
): Readonly<Record<K, number>> {
  let total = 0;
  let leanedTotal = 0;
  for (const k of Object.keys(weights) as K[]) {
    const w = weights[k];
    if (w <= 0) continue;
    total += w;
    if (leaned.includes(k)) leanedTotal += w;
  }
  if (leanedTotal <= 0 || boost <= 0) return weights;
  let m = 1 + boost;
  const k = maxShareFactor;
  if (total > k * leanedTotal) m = Math.min(m, (k * (total - leanedTotal)) / (total - k * leanedTotal));
  const out = { ...weights } as Record<K, number>;
  for (const key of Object.keys(out) as K[]) if (out[key] > 0 && leaned.includes(key)) out[key] = out[key] * m;
  return out;
}

/** The sweep tunables with the lean applied: the card weights, and the role mix for a card that is a sector role. */
export function leanedSweep(cfg: SweepTunables, spec: LeanSpec | null, playable: readonly string[] = cfg.playableRoles): SweepTunables {
  if (spec === null || spec.cards.length === 0) return cfg;
  const cardWeight = boostShares(cfg.cardWeight, spec.cards, spec.boost, spec.maxShareFactor);
  // A role leans only when the run plays it (`meet` today; a drawn hold plays as a take until #204).
  const roleCards = spec.cards.filter((c) => playable.includes(c));
  const roleMix = boostShares(cfg.roleMix, roleCards, spec.boost, spec.maxShareFactor);
  return cardWeight === cfg.cardWeight && roleMix === cfg.roleMix ? cfg : { ...cfg, cardWeight, roleMix };
}

/** The cards a Sweep run can deal today: a take card with weight, and the role cards (`meet`) of the roles it plays. */
export function dealableCards(cfg: SweepTunables): ScenarioCardId[] {
  return SCENARIO_CARDS.filter((c) => {
    if (cfg.cardWeight[c as keyof SweepTunables['cardWeight']] > 0) return true;
    const role = c as keyof SweepTunables['roleMix'];
    return (cfg.playableRoles as readonly string[]).includes(c) && cfg.roleMix[role] > 0;
  });
}

/** What the results card says, and what the next run is told. */
export interface LeanView {
  diagnostic: DiagnosticId;
  /** The cards the next run leans toward: the diagnostic's cards that the run can deal. Never empty. */
  cards: ScenarioCardId[];
  /** "Next run leans: meets in a corridor and takes against enemies who expect you, where the stop decides the fight." */
  line: string;
}

/** Phrases in plain words: "a", "a and b", "a, b and c". */
export function joinWords(parts: readonly string[], join: LeanTunables['listJoin']): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.slice(0, -1).join(join.comma) + join.and + parts[parts.length - 1]!;
}

/** The lean of one finding, or null when no card the run can deal exercises it (then the card says nothing). */
export function leanView(id: string, lean: LeanTunables, sweep: SweepTunables): LeanView | null {
  if (!(DIAGNOSTIC_IDS as readonly string[]).includes(id)) return null;
  const entry = lean.table[id as DiagnosticId];
  const dealable = dealableCards(sweep);
  const cards = entry.cards.filter((c) => dealable.includes(c));
  if (cards.length === 0) return null;
  const words = joinWords(cards.map((c) => lean.phrases[c]), lean.listJoin);
  return { diagnostic: id as DiagnosticId, cards, line: lean.line.replace('{cards}', words).replace('{why}', entry.why) };
}

/** One card's recent record, as the progress store gives it. */
export interface CardRecord {
  won: number;
  played: number;
}

/**
 * The weakest cards (design §4.4): of the cards the run can deal, those with at least `minContacts` fights over their
 * last `window` and a win rate under `belowRate`, lowest first (ties by card order), at most `count`. `record(card,
 * window)` is the player's record: null when the card was never fought.
 */
export function weakestCards(record: (card: string, window: number) => CardRecord | null, lean: LeanTunables, sweep: SweepTunables): ScenarioCardId[] {
  const w = lean.weakest;
  const rows: { card: ScenarioCardId; rate: number; order: number }[] = [];
  const dealable = dealableCards(sweep);
  SCENARIO_CARDS.forEach((card, order) => {
    if (!dealable.includes(card)) return;
    const r = record(card, w.window);
    if (r === null || r.played < w.minContacts) return;
    const rate = r.won / r.played;
    if (rate < w.belowRate) rows.push({ card, rate, order });
  });
  rows.sort((a, b) => a.rate - b.rate || a.order - b.order);
  return rows.slice(0, w.count).map((r) => r.card);
}

/** Cards of `a` then those of `b` not already in it. */
export function mergeLean(a: Lean, b: Lean): Lean {
  if (b.length === 0) return a;
  const out = a.slice();
  for (const c of b) if (!out.includes(c)) out.push(c);
  return out;
}

/**
 * Holds the lean between the results card and the next run (design §8.3: "the next run leans toward"). The results card
 * sets what the run it shows leans the next toward; the next fresh run takes it, together with the weakest cards, and it
 * is spent: the lean decays after one run. A replay of a seed keeps the lean the run had (the same seed is the same
 * route); the Daily Route never leans (everyone plays the same route that day).
 */
export class LeanKeeper {
  private pending: Lean = NO_LEAN;
  private current: Lean = NO_LEAN;

  /** The results card says the next run leans toward `cards` (empty: nothing). */
  setNext(cards: Lean): void {
    this.pending = cards;
  }

  /** What the next fresh run would lean toward now (for the debug hook). */
  get next(): Lean {
    return this.pending;
  }

  /** The lean of the run now playing. */
  get now(): Lean {
    return this.current;
  }

  /** A fresh run starts: it takes the pending lean (spent now) and the weakest cards. */
  fresh(weakest: Lean): Lean {
    this.current = mergeLean(this.pending, weakest);
    this.pending = NO_LEAN;
    return this.current;
  }

  /** The same seed again: the lean it was dealt with. The pending lean is left for the next fresh run. */
  replay(): Lean {
    return this.current;
  }

  /** A run that never leans (the Daily Route, a mode that is not a Sweep run). */
  none(): Lean {
    this.current = NO_LEAN;
    return this.current;
  }
}
