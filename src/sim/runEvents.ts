import type { Vec3 } from '../core/vec3';

/**
 * The run-level event vocabulary (design §14.3), typed. Naming follows the architecture issue
 * (camelCase past-tense facts). Every payload carries `tick` (the sim tick it happened on); seconds
 * since the run started are `(tick - runStartedTick) * TICK_DT`, so `t` is derived, not duplicated.
 * Angles are radians (events), distances metres, durations in ms only where the design says `*Ms`.
 * Payloads are plain data, read-only, and valid only during the callback.
 *
 * Producers: the sim (aim/stop/head-height facts; the target and shot events live in `SimEvents`),
 * the run controller (run*), the stat tracker (`chainUpdated`, and `streakUpdated` from `feedback/events.ts`) and later systems
 * (enemies, player damage, surge, medals, the skill model) for the rest; those are typed here so
 * consumers can code against them now.
 */

export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit';
export type SkillId = 'precision' | 'flick' | 'track' | 'footwork' | 'spray' | 'switch' | 'angles';

export interface RunEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; reason: RunEndReason };

  /** A shot absorbed by a Bulwark plate. */
  targetShielded: { tick: number; targetId: number };

  enemyTell: { tick: number; id: number; durationMs: number };
  enemyFired: { tick: number; id: number; hit: boolean; dir: Vec3 };
  playerDamaged: { tick: number; amount: number; hp: number; dir: Vec3; sourceId: number };
  playerSlowed: { tick: number; factor: number; durationMs: number };
  playerDied: { tick: number };

  chainUpdated: { tick: number; count: number };
  surgeStarted: { tick: number };
  surgeEnded: { tick: number };
  medalAwarded: { tick: number; id: string };
  /** `rtMs` is -1 when not applicable; `extra` is a mode-specific scalar (e.g. flick error). */
  skillTrial: { tick: number; skill: SkillId; itemDifficulty: number; success: boolean; rtMs: number; extra: number };
}
