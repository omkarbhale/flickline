import type { Rng } from './rng';

/**
 * Distributions for human-like timing and noise (player-like enemies research §5.8, §2.5). Pure
 * functions of an `Rng`, so a seed fixes every draw. Nothing here allocates: no arrays, objects or
 * closures per draw. Times are in whatever unit the caller passes (the enemy code uses seconds).
 */

/** Rejection tries before a truncated draw falls back to its bound (research §5.8). */
export const TRUNCATE_TRIES = 8;

/** Normal(mean, sd): Box–Muller on the stream, both outputs consumed (`Rng.normal`). */
export function normal(rng: Rng, mean = 0, sd = 1): number {
  return mean + sd * rng.normal();
}

/** Exponential with mean `tau` (rate 1/tau); the slow tail of a reaction time. */
export function exponential(rng: Rng, tau: number): number {
  return -tau * Math.log(1 - rng.next()); // 1 - u in (0, 1]
}

/**
 * Ex-Gaussian: normal(mu, sigma) + exponential(tau). The standard model of human reaction time
 * (§2.5): mean `mu + tau`, variance `sigma^2 + tau^2`, right-skewed. Two uniforms per draw, or
 * one in two when the normal half is cached.
 */
export function exGaussian(rng: Rng, mu: number, sigma: number, tau: number): number {
  return mu + sigma * rng.normal() - tau * Math.log(1 - rng.next());
}

/** Log-space SD of a lognormal with this coefficient of variation: `sqrt(ln(1 + cv^2))`. */
export function lognormalSigma(cv: number): number {
  return Math.sqrt(Math.log(1 + cv * cv));
}

/**
 * Lognormal given by its median and coefficient of variation (SD / mean). The median is
 * `exp(mu)`, the mean is `median * sqrt(1 + cv^2)`. Always positive, right-skewed: the shape of
 * strafe-leg lengths and hold durations (§2.4).
 */
export function lognormal(rng: Rng, median: number, cv: number): number {
  return median * Math.exp(lognormalSigma(cv) * rng.normal());
}

/**
 * Deterministic truncation: the value a draw is clamped to when every try fell outside [`lo`, `hi`].
 * Rejection keeps the shape of the distribution inside the bounds (no spike at the bound), the
 * fallback keeps the cost bounded.
 */
function bound(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normal(mean, sd) truncated to [`lo`, `hi`] by rejection (≤ 8 tries, then the nearest bound). */
export function normalTruncated(rng: Rng, mean: number, sd: number, lo: number, hi: number): number {
  let v = 0;
  for (let i = 0; i < TRUNCATE_TRIES; i++) {
    v = mean + sd * rng.normal();
    if (v >= lo && v <= hi) return v;
  }
  return bound(v, lo, hi);
}

/**
 * Ex-Gaussian shifted by `shift` and truncated to [`lo`, `hi`] by rejection (≤ 8 tries, then the
 * bound). The enemy reaction draw: `lo` is the fairness floor (design §9.3), `shift` the
 * expectation bonus. Use `Infinity` for no upper bound.
 */
export function exGaussianTruncated(
  rng: Rng, mu: number, sigma: number, tau: number, shift: number, lo: number, hi: number,
): number {
  let v = 0;
  for (let i = 0; i < TRUNCATE_TRIES; i++) {
    v = exGaussian(rng, mu, sigma, tau) + shift;
    if (v >= lo && v <= hi) return v;
  }
  return bound(v, lo, hi);
}

/** Lognormal (median, CV) truncated to [`lo`, `hi`] by rejection (≤ 8 tries, then the bound). */
export function lognormalTruncated(rng: Rng, median: number, cv: number, lo: number, hi: number): number {
  let v = 0;
  for (let i = 0; i < TRUNCATE_TRIES; i++) {
    v = lognormal(rng, median, cv);
    if (v >= lo && v <= hi) return v;
  }
  return bound(v, lo, hi);
}

/** What `weightedChoice` remembers to forbid a third identical pick in a row. One per chooser. */
export interface RepeatGuard {
  /** Last choice, or -1 before the first. */
  last: number;
  /** How many times in a row `last` was chosen. */
  run: number;
}

export function createRepeatGuard(): RepeatGuard {
  return { last: -1, run: 0 };
}

export function resetRepeatGuard(g: RepeatGuard): void {
  g.last = -1;
  g.run = 0;
}

/**
 * Pick an index in `[0, n)` with probability proportional to `weights[i]` (negative weights count
 * as 0), never the same index three times in a row: once `guard` has seen an index twice running
 * it is excluded from the next pick and the others share its weight. If it is the only index with
 * weight, it is picked anyway (the rule never leaves a chooser without an answer). Exactly one
 * uniform per call, so the stream advances the same whether or not the rule bites. Returns -1 when
 * `n` is 0 or no weight is positive (the guard is left untouched).
 */
export function weightedChoice(rng: Rng, weights: ArrayLike<number>, n: number, guard: RepeatGuard): number {
  const banned = guard.run >= 2 ? guard.last : -1;
  let total = 0;
  let bannedWeight = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i]!;
    if (w <= 0) continue;
    total += w;
    if (i === banned) bannedWeight = w;
  }
  const u = rng.next();
  if (total <= 0) return -1;
  // Exclude the banned index unless it is the only one with weight.
  const skip = bannedWeight < total ? banned : -1;
  let target = u * (skip >= 0 ? total - bannedWeight : total);
  let pick = -1;
  for (let i = 0; i < n; i++) {
    const w = weights[i]!;
    if (w <= 0 || i === skip) continue;
    pick = i; // the last eligible index absorbs rounding at the top end
    if (target < w) break;
    target -= w;
  }
  if (pick === guard.last) guard.run++;
  else {
    guard.last = pick;
    guard.run = 1;
  }
  return pick;
}
