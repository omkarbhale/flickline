import type { FairnessFloors } from '../config/dial';
import type { ExpectationTunables } from '../config/expectation';
import type { Rng } from '../core/rng';

/**
 * When an enemy that has just seen the player starts its tell and becomes able to fire, with the
 * fairness floors split by expectation (#127, `docs/research/prepared-holders.md`). Pure, seeded,
 * allocation-free; the enemy aim model and FSM (#90, #91) call it once per contact.
 *
 * - **Prepared** (the enemy holds this spot and expects the player there): reaction is the
 *   profile's human draw minus the expectation bonus, floored at `preparedReactionSec`. The tell
 *   starts the moment the enemy perceives the player and runs until the shot; it never delays it.
 *   A real holder answers a wide swing in about 0.3 s, so Flickline's does too.
 * - **Attending / unaware** (the player surprised it): reaction floored at `enemyReactionSec`
 *   (unaware adds the orientation cost first), then the tell lasts `max(aim phase, tell)` with the
 *   tell floored at `tellSec` (research F5). These are the fairness floors as before.
 *
 * Peeker's advantage (`config/expectation.ts`) applies to whoever moves into view.
 * All times are seconds from the instant the player becomes visible to the enemy.
 */

/** Reaction time as an ex-Gaussian: normal(mu, sigma) + exponential(tau), seconds (research §2.5). */
export interface ReactionDist {
  muSec: number;
  sigmaSec: number;
  tauSec: number;
}

/** What the enemy expected when the player appeared (research §5.3). */
export type Expectation = 'prepared' | 'attending' | 'unaware';

/** Who moved into view: the player peeked the enemy, the enemy peeked the player, or neither. */
export type Peeker = 'player' | 'enemy' | 'none';

export interface ShotTiming {
  /** Peeker's-advantage delay before the enemy perceives the player (0 unless the player peeked). */
  perceiveSec: number;
  /** Reaction after perceiving, floors applied. */
  reactionSec: number;
  /** When the tell (flare, line, tone) starts. */
  tellStartSec: number;
  /** When the enemy may fire its first shot; the tell ends here. */
  fireReadySec: number;
}

export function createShotTiming(): ShotTiming {
  return { perceiveSec: 0, reactionSec: 0, tellStartSec: 0, fireReadySec: 0 };
}

/** Standard normal draw (Box–Muller, one output used; keeps the stream simple to reason about). */
export function normalDraw(rng: Rng): number {
  const u = 1 - rng.next(); // (0, 1]
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

/** One ex-Gaussian draw, seconds. */
export function exGaussianDraw(rng: Rng, d: ReactionDist): number {
  return d.muSec + d.sigmaSec * normalDraw(rng) - d.tauSec * Math.log(1 - rng.next());
}

/** Rejection tries before a truncated draw falls back to its bound (research §5.8). */
const TRUNCATE_TRIES = 8;

/**
 * Ex-Gaussian shifted by `shiftSec`, truncated below at `floorSec` by rejection (so the floor is a
 * cut, not a spike of identical values), falling back to the floor after a few tries.
 */
export function reactionDraw(rng: Rng, d: ReactionDist, shiftSec: number, floorSec: number): number {
  for (let i = 0; i < TRUNCATE_TRIES; i++) {
    const r = exGaussianDraw(rng, d) + shiftSec;
    if (r >= floorSec) return r;
  }
  return floorSec;
}

/**
 * Compute one contact's timing into `out`.
 * @param aimSec length of the aim phase the aim model needs to get on target (0 for an enemy already on target).
 * @param tellSec the dial's tell length for this enemy (floored here at `floors.tellSec`); unused when prepared.
 */
export function enemyShotTiming(
  rng: Rng,
  reaction: ReactionDist,
  expectation: Expectation,
  peeker: Peeker,
  aimSec: number,
  tellSec: number,
  floors: FairnessFloors,
  exp: ExpectationTunables,
  out: ShotTiming,
): ShotTiming {
  const advantage = peeker === 'none' ? 0 : rng.range(exp.peekerAdvantageMinSec, exp.peekerAdvantageMaxSec);
  const perceive = peeker === 'player' ? advantage : 0;
  const early = peeker === 'enemy' ? advantage : 0;
  out.perceiveSec = perceive;
  if (expectation === 'prepared') {
    const r = reactionDraw(rng, reaction, -exp.preparedBonusSec - early, floors.preparedReactionSec);
    out.reactionSec = r;
    out.tellStartSec = perceive;
    out.fireReadySec = perceive + r + aimSec;
  } else {
    const shift = (expectation === 'unaware' ? exp.orientationSec : 0) - early;
    const r = reactionDraw(rng, reaction, shift, floors.enemyReactionSec);
    const tell = Math.max(tellSec, floors.tellSec);
    out.reactionSec = r;
    out.tellStartSec = perceive + r;
    out.fireReadySec = out.tellStartSec + Math.max(aimSec, tell);
  }
  return out;
}
