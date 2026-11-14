import { clamp } from '../core/math';
import type { EnemyKind, ScoringTunables } from '../config/scoring';
import { difficultyMultiplier } from './scoring';

/**
 * The contact settle (design §8.1, #132): the part of the score that pays for surviving.
 *
 * Kill points are paid the instant each enemy dies, as everywhere else. In modes where enemies fire
 * back (Sweep, Corner Clear), each contact also *settles* once when it ends, by outcome and by the
 * health the player kept through it. Without it the table pays only for kills and the only cost of a
 * bad fight is health, which kill-heal refunds: the loop would train "take every fight, fast", the
 * over-aggression the reference game punishes. Pure functions of `config/scoring.ts`; the mode that
 * owns contacts (Sweep #51, Corner Clear #50) tracks the facts and calls `settleContact` once.
 */

/** How a contact ended. `avoided`: the player left it unhurt (no fight, nothing to pay). */
export type ContactOutcome = 'cleared' | 'disengaged' | 'avoided' | 'died';

/** Facts about one finished contact, gathered by the mode that owns it. */
export interface ContactFacts {
  /** Every enemy the contact sent, killed or not. */
  kinds: readonly EnemyKind[];
  /** Dial in force for the contact (its value is in the same currency as kills). */
  dial: number;
  /** Health + shield the player had when the contact started. */
  startEhp: number;
  /** Health + shield the player lost during it (kill-heal does not reduce it). */
  damageTaken: number;
  /** Every enemy of the contact is dead. */
  allDead: boolean;
  /** The player died in it. */
  died: boolean;
}

export interface ContactSettle {
  outcome: ContactOutcome;
  /** Share of the starting health+shield the player still had, 0–1. */
  kept: number;
  /** One kill's worth: the mean `base` of the contact's enemies × difficulty. */
  value: number;
  /** Kills' worth for the outcome before `kept` (0 for died and avoided). */
  rate: number;
  /** Points paid, rounded like kill points; never negative. */
  total: number;
}

export function createContactSettle(): ContactSettle {
  return { outcome: 'avoided', kept: 1, value: 0, rate: 0, total: 0 };
}

/** Share of the starting health+shield kept through a contact (1 = untouched). */
export function healthKept(startEhp: number, damageTaken: number): number {
  return startEhp > 0 ? clamp(1 - damageTaken / startEhp, 0, 1) : 0;
}

/**
 * Classify a finished contact. A contact the player left alive with enemies still up is
 * `disengaged` only if it cost at least `disengageMinLost` of the starting health+shield (the
 * player was losing it); leaving unhurt is `avoided` and pays nothing, so peeking and leaving
 * cannot be farmed. The caller decides the contact is over (all dead, player dead, or no live enemy
 * of it in sight for `disengageSec`).
 */
export function contactOutcome(f: ContactFacts, cfg: ScoringTunables): ContactOutcome {
  if (f.died) return 'died';
  if (f.allDead) return 'cleared';
  const lost = f.startEhp > 0 ? f.damageTaken / f.startEhp : 1;
  return lost >= cfg.contact.disengageMinLost ? 'disengaged' : 'avoided';
}

/** Settle one contact; writes into `out` (no allocation) and returns it. */
export function settleContact(out: ContactSettle, f: ContactFacts, cfg: ScoringTunables): ContactSettle {
  const c = cfg.contact;
  out.outcome = contactOutcome(f, cfg);
  out.kept = f.died ? 0 : healthKept(f.startEhp, f.damageTaken);
  let base = 0;
  for (let i = 0; i < f.kinds.length; i++) base += cfg.base[f.kinds[i]!];
  out.value = f.kinds.length > 0 ? (base / f.kinds.length) * difficultyMultiplier(f.dial, cfg) : 0;
  out.rate = out.outcome === 'cleared' ? c.clear : out.outcome === 'disengaged' ? c.disengage : 0;
  out.total = Math.round(out.value * out.rate * out.kept);
  return out;
}
