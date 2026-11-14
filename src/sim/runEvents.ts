import type { Vec3 } from '../core/vec3';

/**
 * The run-level event vocabulary (design §14.3), typed. Naming follows the architecture issue
 * (camelCase past-tense facts). Every payload carries `tick` (the sim tick it happened on); seconds
 * since the run went live are `t` where a payload has it, else `(tick - runStartedTick) * TICK_DT`.
 * Angles are radians (events), distances metres, durations in ms only where the design says `*Ms`.
 * Payloads are plain data, read-only, and valid only during the callback.
 *
 * Producers: the run lifecycle (`run*`: the run controller, or the mode runner, one at a time with
 * identical payloads; `modes/contracts.ts` `ModeEvents` declares the same three) and later systems
 * (enemies, player damage, surge, medals) for the rest, typed here so consumers can code against
 * them now. The sim's target and shot events live in `SimEvents`; chain/streak/skillTrial/score
 * events belong to the mode framework (`ModeEvents`, `feedback/streaks.ts`).
 */

export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit';

export interface RunEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; t: number; reason: RunEndReason };

  /** A shot absorbed by a Bulwark plate. */
  targetShielded: { tick: number; targetId: number };

  enemyTell: { tick: number; id: number; durationMs: number };
  enemyFired: { tick: number; id: number; hit: boolean; dir: Vec3 };
  // `playerDamaged`, `playerSlowed`, `playerDied` and `playerHealed` live in `SimEvents` (sim/types.ts).

  surgeStarted: { tick: number };
  surgeEnded: { tick: number };
  medalAwarded: { tick: number; id: string };
}
