import type { Vec3 } from '../core/vec3';

/**
 * The run-level event vocabulary (design §14.3), typed. Naming follows the architecture issue
 * (camelCase past-tense facts). Every payload carries `tick` (the sim tick it happened on); seconds
 * since the run started are `(tick - runStartedTick) * TICK_DT`, so `t` is derived, not duplicated.
 * Angles are radians (events), distances metres, durations in ms only where the design says `*Ms`.
 * Payloads are plain data, read-only, and valid only during the callback.
 *
 * Producers: the sim (spawn/visible/aim/stop/head-height facts), the run controller (run*),
 * the stat tracker (`chainUpdated`, `streakUpdated`, `killSummarised`) and later systems
 * (enemies, player damage, surge, medals, the skill model) for the rest; those are typed here so
 * consumers can code against them now.
 */

export type HitZone = 'head' | 'body' | 'leg';
export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit';
export type SkillId = 'precision' | 'flick' | 'track' | 'footwork' | 'spray' | 'switch' | 'angles';
/** Enemy/target kind id ('post', 'beacon', 'strafer', ...). Owned by the enemy framework. */
export type TargetKind = string;

export interface RunEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; reason: RunEndReason };

  targetSpawned: { tick: number; id: number; kind: TargetKind; pos: Vec3; tags: readonly string[] };
  /**
   * First tick the target is in the view frustum and unoccluded from the eye. `preAim` = angle
   * between the aim ray and the target's aim point (head centre) at that tick; `dYaw`/`dPitch` =
   * the target's aim-point angles minus the view angles (the flick vector, radians).
   */
  targetVisible: { tick: number; id: number; preAim: number; dYaw: number; dPitch: number };
  targetExpired: { tick: number; id: number };
  /** A shot absorbed by a Bulwark plate. */
  targetShielded: { tick: number; id: number };

  enemyTell: { tick: number; id: number; durationMs: number };
  enemyFired: { tick: number; id: number; hit: boolean; dir: Vec3 };
  playerDamaged: { tick: number; amount: number; hp: number; dir: Vec3; sourceId: number };
  playerSlowed: { tick: number; factor: number; durationMs: number };
  playerDied: { tick: number };

  chainUpdated: { tick: number; count: number };
  streakUpdated: { tick: number; streak: number; mult: number };
  surgeStarted: { tick: number };
  surgeEnded: { tick: number };
  medalAwarded: { tick: number; id: string };
  /** `rtMs` is -1 when not applicable; `extra` is a mode-specific scalar (e.g. flick error). */
  skillTrial: { tick: number; skill: SkillId; itemDifficulty: number; success: boolean; rtMs: number; extra: number };

  /**
   * The per-kill summary of design §14.3's `targetKilled` (ttk, rt, firstBullet, bullets, clean).
   * Emitted by the stat tracker right after the sim's `targetKilled` fact; see the PR for why the
   * derived fields are not on `targetKilled` itself.
   */
  killSummarised: {
    tick: number; id: number; kind: TargetKind; zone: HitZone;
    ttkMs: number; rtMs: number; firstBullet: boolean; bullets: number; clean: boolean;
  };

  /** Aim ray entered (`on`) or left the padded hit volume of a visible target (edge events). */
  aimOnTarget: { tick: number; on: boolean; id: number };
  /** Vertical angle (radians) between the aim ray and head-centre height, sampled while moving with no enemy visible. */
  headHeightSampled: { tick: number; err: number };
  /** Horizontal speed first fell to the accuracy threshold after a stop or counter-strafe input. */
  playerStopped: { tick: number; latencyMs: number };
}
