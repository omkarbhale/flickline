import { clamp } from '../core/math';
import type { EnemyKind, ScoringTunables } from '../config/scoring';

/**
 * The scoring table of design §8.1, as pure functions of the tunables in `config/scoring.ts`.
 *
 *   score = base(enemy) × precision × speed × streak × difficulty        (× surgeMult in Surge)
 *
 * `streak` is the multiplier the player has *earned going into the kill* (the clean streak before
 * this kill), which is what the HUD ring shows, so 20 clean kills in a row make the 21st ×3.0.
 */

export interface KillScoreInput {
  kind: EnemyKind;
  /** The killing bullet hit the head. */
  headshot: boolean;
  /** The killing bullet was the first bullet fired at that target. */
  firstBullet: boolean;
  /** Time from the first shot at the target to its death, milliseconds. */
  ttkMs: number;
  /** The mode's par time for this enemy, seconds (<= 0 disables the speed term). */
  parSec: number;
  /** Clean streak before this kill. */
  cleanStreak: number;
  /** Difficulty dial (0-100) in force for this target. */
  dial: number;
  /** Surge is active (the Surge meter lives elsewhere; this is the hook). */
  surge: boolean;
}

/** Every term of one kill's score, for the floating `+score` and the results card. */
export interface ScoreBreakdown {
  base: number;
  precision: number;
  speed: number;
  streak: number;
  difficulty: number;
  surge: number;
  /** Unrounded product of all terms. */
  raw: number;
  /** Points awarded (rounded to a whole number so the floating numbers sum to the run score). */
  total: number;
}

export function createScoreBreakdown(): ScoreBreakdown {
  return { base: 0, precision: 1, speed: 1, streak: 1, difficulty: 1, surge: 1, raw: 0, total: 0 };
}

/** ×1.5 for a head kill, ×1.25 for a first-bullet kill, stacking to ×1.875. */
export function precisionMultiplier(headshot: boolean, firstBullet: boolean, cfg: ScoringTunables): number {
  return (headshot ? cfg.headshotMult : 1) * (firstBullet ? cfg.firstBulletMult : 1);
}

/** `1 + speedBonusMax × clamp((par − TTK)/par, 0, 1)`. */
export function speedMultiplier(ttkMs: number, parSec: number, cfg: ScoringTunables): number {
  if (!(parSec > 0)) return 1;
  return 1 + cfg.speedBonusMax * clamp((parSec - ttkMs / 1000) / parSec, 0, 1);
}

/** `1 + streakStep × min(cleanStreak, streakCap)` (×1.0 → ×3.0 at 20). */
export function streakMultiplier(cleanStreak: number, cfg: ScoringTunables): number {
  return 1 + cfg.streakStep * Math.min(Math.max(cleanStreak, 0), cfg.streakCap);
}

/** `2^((dial − 50)/25)`: dial 75 = ×2, dial 25 = ×0.5, so adapting the dial gives no free points. */
export function difficultyMultiplier(dial: number, cfg: ScoringTunables): number {
  return Math.pow(2, (dial - cfg.difficultyPivot) / cfg.difficultySpan);
}

/** Score one kill; writes every term into `out` (no allocation) and returns it. */
export function scoreKill(out: ScoreBreakdown, k: KillScoreInput, cfg: ScoringTunables): ScoreBreakdown {
  out.base = cfg.base[k.kind];
  out.precision = precisionMultiplier(k.headshot, k.firstBullet, cfg);
  out.speed = speedMultiplier(k.ttkMs, k.parSec, cfg);
  out.streak = streakMultiplier(k.cleanStreak, cfg);
  out.difficulty = difficultyMultiplier(k.dial, cfg);
  out.surge = k.surge ? cfg.surgeMult : 1;
  out.raw = out.base * out.precision * out.speed * out.streak * out.difficulty * out.surge;
  out.total = Math.round(out.raw);
  return out;
}
