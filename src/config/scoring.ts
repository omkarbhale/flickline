/**
 * Scoring table of design §8.1. Every number is tunable here; nothing is inline in code.
 *
 *   score = base(enemy) × precision × speed × streak × difficulty   (× surge while Surge is on)
 *
 * No term is ever negative: missing costs the clean streak, the first-shot bonus and time, never
 * points directly.
 */

/** Enemy roster of design §5.2 (lower-case ids). Shared by scoring, modes and (later) the enemy sim. */
export const ENEMY_KINDS = ['post', 'beacon', 'strafer', 'peeker', 'rusher', 'bulwark', 'gnat'] as const;
export type EnemyKind = (typeof ENEMY_KINDS)[number];

export interface ScoringTunables {
  /** Base points per kill by enemy kind. */
  base: Record<EnemyKind, number>;
  /** precision: ×this if the killing bullet hit the head. */
  headshotMult: number;
  /** precision: ×this if the killing bullet was the first bullet at that target (stacks with the head term). */
  firstBulletMult: number;
  /** speed: `1 + speedBonusMax × clamp((par − TTK)/par, 0, 1)`. */
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
  missBreaksStreak: true,
};
