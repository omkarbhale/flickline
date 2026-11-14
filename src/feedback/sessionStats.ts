import type { Subscribable } from '../core/eventBus';
import type { SimEvents } from '../sim/types';

/**
 * Pure session counters built from sim events. The seed of the feedback/scoring area: later
 * work (streaks, rewards, per-kill breakdowns) grows here, reading events only.
 */
export class SessionStats {
  shots = 0;
  hits = 0;
  kills = 0;

  get accuracy(): number {
    return this.shots === 0 ? 0 : this.hits / this.shots;
  }

  attach(bus: Subscribable<SimEvents>): () => void {
    const offs = [
      bus.on('shotFired', () => { this.shots++; }),
      bus.on('targetHit', () => { this.hits++; }),
      bus.on('targetKilled', () => { this.kills++; }),
    ];
    return () => offs.forEach((f) => f());
  }

  reset(): void {
    this.shots = this.hits = this.kills = 0;
  }
}
