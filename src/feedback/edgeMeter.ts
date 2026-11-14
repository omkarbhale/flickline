import type { Subscribable } from '../core/eventBus';
import type { HudTunables } from '../config/hud';
import type { ModeEvents } from '../modes/contracts';

/**
 * The rolling success rate of design §9.5: the last N `skillTrial` outcomes in a ring buffer.
 * Purely informational; the target zone (60-80%) is drawn by the HUD from the tunables.
 */
export class EdgeMeter {
  private readonly ring: Uint8Array;
  private head = 0;
  private n = 0;
  private wins = 0;

  constructor(cfg: Pick<HudTunables, 'edgeWindow'>) {
    this.ring = new Uint8Array(Math.max(1, Math.floor(cfg.edgeWindow)));
  }

  /** Trials in the window (at most the window size). */
  get count(): number {
    return this.n;
  }

  /** Success rate over the window, NaN before the first trial. */
  get rate(): number {
    return this.n === 0 ? NaN : this.wins / this.n;
  }

  record(success: boolean): void {
    const v = success ? 1 : 0;
    if (this.n === this.ring.length) this.wins -= this.ring[this.head]!;
    else this.n++;
    this.ring[this.head] = v;
    this.wins += v;
    this.head = (this.head + 1) % this.ring.length;
  }

  reset(): void {
    this.head = this.n = this.wins = 0;
  }

  attach(bus: Subscribable<Pick<ModeEvents, 'skillTrial' | 'runReady'>>): () => void {
    const offs = [bus.on('skillTrial', (e) => this.record(e.success)), bus.on('runReady', () => this.reset())];
    return () => offs.forEach((f) => f());
  }
}
