import type { EventSink } from '../core/eventBus';
import type { ScoringTunables } from '../config/scoring';
import { streakMultiplier } from './scoring';

/** Events of the two counters (design §14.3). `t` is seconds since the run went live. */
export interface StreakEvents {
  chainUpdated: { tick: number; t: number; count: number };
  streakUpdated: { tick: number; t: number; streak: number; mult: number };
}

/**
 * The two counters of design §3, both fed by facts, both shown to the player:
 *  - **Chain**: isolated kills each within `chainWindowSec` (1.5 s) of the previous one. A lone kill
 *    is a chain of 1; the HUD shows it from 2 (Pair). It decays to 0 when the window lapses.
 *  - **Clean streak**: consecutive clean kills (no missed shot at the target, no moving shot).
 *    Any unclean kill, miss or failed trial resets it. It drives the score multiplier.
 * Emits `chainUpdated` / `streakUpdated` only when the value changes. Payload objects are reused
 * (valid only during the callback), so nothing here allocates after construction.
 */
export class StreakTracker {
  chain = 0;
  streak = 0;
  bestChain = 0;
  bestStreak = 0;
  private lastKillT = -Infinity;
  private readonly chainEv = { tick: 0, t: 0, count: 0 };
  private readonly streakEv = { tick: 0, t: 0, streak: 0, mult: 1 };

  constructor(
    private readonly cfg: ScoringTunables,
    private readonly events: EventSink<StreakEvents>,
  ) {}

  reset(): void {
    this.chain = this.streak = this.bestChain = this.bestStreak = 0;
    this.lastKillT = -Infinity;
  }

  /** The multiplier a kill made right now would get from the streak term. */
  get mult(): number {
    return streakMultiplier(this.streak, this.cfg);
  }

  /**
   * A kill at run time `t` (seconds). `clean` per design §3: no miss at it, no moving shot.
   * `isolated` (#132): false when another live enemy had the player in sight from a second angle
   * (see `scoring.isolationAngleDeg`); such a kill gets no chain credit, so swinging into a
   * crossfire never builds a chain. It still counts for the clean streak, which is about aim.
   */
  onKill(tick: number, t: number, clean: boolean, isolated = true): void {
    this.step(tick, t);
    if (isolated) {
      this.chain = this.chain > 0 && t - this.lastKillT <= this.cfg.chainWindowSec ? this.chain + 1 : 1;
      this.lastKillT = t;
      if (this.chain > this.bestChain) this.bestChain = this.chain;
      this.emitChain(tick, t);
    }
    if (clean) {
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;
      this.emitStreak(tick, t);
    } else {
      this.onBreak(tick, t);
    }
  }

  /** A miss or a failed trial: the clean streak (not the chain) resets. */
  onBreak(tick: number, t: number): void {
    if (this.streak === 0) return;
    this.streak = 0;
    this.emitStreak(tick, t);
  }

  /** Advance time so a lapsed chain decays to 0 (emits once). Call every tick; it is O(1). */
  step(tick: number, t: number): void {
    if (this.chain > 0 && t - this.lastKillT > this.cfg.chainWindowSec) {
      this.chain = 0;
      this.emitChain(tick, t);
    }
  }

  private emitChain(tick: number, t: number): void {
    const e = this.chainEv;
    e.tick = tick;
    e.t = t;
    e.count = this.chain;
    this.events.emit('chainUpdated', e);
  }

  private emitStreak(tick: number, t: number): void {
    const e = this.streakEv;
    e.tick = tick;
    e.t = t;
    e.streak = this.streak;
    e.mult = streakMultiplier(this.streak, this.cfg);
    this.events.emit('streakUpdated', e);
  }
}
