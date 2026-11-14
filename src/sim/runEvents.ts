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

/** `left`: the player walked out of a run's last exit alive (a Leave gate, design §4.9). */
export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit' | 'left';

/**
 * Spray Wall's facts (design §4.5): one spray = one trial. They are logged (`feedback/eventLog.ts`)
 * so the spray trace is, like every stat, a pure function of the event log: the stat tracker cuts
 * the run's shots into sprays between `sprayStarted` and `sprayEnded`.
 */
export interface SprayEvents {
  /** The player stands at an alcove with a Post up: bullets from now on belong to this spray. */
  sprayStarted: {
    tick: number;
    t: number;
    /** 0-based spray number in the run. */
    index: number;
    /** The alcove's anchor id (`spray-12`), its distance in metres and the id of its wall panel box. */
    station: string;
    distanceM: number;
    panel: string;
    /** Bullets the spray asks for (3, 7 or the full magazine) and the share of them that must hit head or body. */
    burst: number;
    requiredFraction: number;
    postId: number;
  };
  /** The spray is over (the burst was fired, or the player reloaded early) and was judged. */
  sprayEnded: {
    tick: number;
    t: number;
    index: number;
    burst: number;
    /** Bullets fired in the spray, and how many of them hit the Post's head or body. */
    bullets: number;
    hits: number;
    headHits: number;
    bodyHits: number;
    requiredFraction: number;
    /** `hits / burst`: bullets never fired count as misses. */
    fraction: number;
    success: boolean;
    reason: 'burst' | 'reload';
  };
}

export interface RunEvents extends SprayEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; t: number; reason: RunEndReason };

  /** A shot absorbed by a Bulwark plate. */
  targetShielded: { tick: number; targetId: number };

  enemyTell: { tick: number; id: number; durationMs: number };
  /** An enemy fired. `audibleToPlayer`: the shot is within `attribution.soundRadiusM.shot` of the player (fight-attribution F1). */
  enemyFired: { tick: number; id: number; hit: boolean; dir: Vec3; audibleToPlayer: boolean };
  // `playerDamaged`, `playerSlowed`, `playerDied` and `playerHealed` live in `SimEvents` (sim/types.ts).

  surgeStarted: { tick: number };
  surgeEnded: { tick: number };
  medalAwarded: { tick: number; id: string };

  /**
   * One Sweep contact or Corner Clear angle ended (design §3 "Contact", §8.1, §14.3). `enemies` is how many
   * enemies the contact sent (the Untouched medal needs 3 or more); `kept` is the health kept, 1 = no damage.
   * Emitted by the mode that owns contacts (Corner Clear #50, Sweep #51); the medals engine reads it.
   */
  contactSettled: {
    tick: number;
    t: number;
    contactId: number;
    outcome: 'cleared' | 'disengaged' | 'avoided' | 'died';
    kept: number;
    enemies: number;
    points: number;
  };
}

declare module '../core/gameEvents' {
  interface GameEvents extends RunEvents {}
}
