import type { Subscribable } from '../core/eventBus';
import type { HudTunables } from '../config/hud';
import type { ModeEvents } from '../modes/contracts';

/** Fixed-size ring of outcomes (1 = won) with a running count of wins. */
class OutcomeRing {
  private readonly ring: Uint8Array;
  private head = 0;
  n = 0;
  wins = 0;

  constructor(size: number) {
    this.ring = new Uint8Array(Math.max(1, Math.floor(size)));
  }

  record(won: boolean): void {
    const v = won ? 1 : 0;
    if (this.n === this.ring.length) this.wins -= this.ring[this.head]!;
    else this.n++;
    this.ring[this.head] = v;
    this.wins += v;
    this.head = (this.head + 1) % this.ring.length;
  }

  clear(): void {
    this.head = this.n = this.wins = 0;
  }
}

/**
 * The edge meter of design §9.5: the rolling **contact win rate**, over the last N fights (a contact
 * cleared is won; died or left hurt is lost; one avoided is no fight). The window rolls across runs,
 * so it reads "how the last twenty fights went", not "this run so far". In a mode without contacts
 * (`hud.edgeContactModes` lists the modes with them) it shows the run's rolling trial success rate,
 * as before. Purely informational; the target zone (60-80%) is drawn by the HUD from the tunables.
 */
export class EdgeMeter {
  private readonly contacts: OutcomeRing;
  private readonly trials: OutcomeRing;
  private contactRun = false;

  constructor(private readonly cfg: Pick<HudTunables, 'edgeWindow' | 'edgeContactModes'>) {
    this.contacts = new OutcomeRing(cfg.edgeWindow);
    this.trials = new OutcomeRing(cfg.edgeWindow);
  }

  /** What the meter shows now: fights (a contact mode) or trials. */
  get source(): 'contacts' | 'trials' {
    return this.contactRun ? 'contacts' : 'trials';
  }

  /** Outcomes in the window (at most the window size). */
  get count(): number {
    return this.contactRun ? this.contacts.n : this.trials.n;
  }

  /** Win (or success) rate over the window, NaN before the first outcome. */
  get rate(): number {
    const r = this.contactRun ? this.contacts : this.trials;
    return r.n === 0 ? NaN : r.wins / r.n;
  }

  /** A trial resolved (counts outside contact modes). */
  record(success: boolean): void {
    this.trials.record(success);
  }

  /** A contact settled (design §2.3): cleared = won, died or disengaged = lost, avoided = not a fight. */
  recordContact(outcome: 'cleared' | 'disengaged' | 'avoided' | 'died'): void {
    if (outcome === 'avoided') return;
    this.contacts.record(outcome === 'cleared');
  }

  /** A new run: the trial window starts over; the fights window rolls on. */
  reset(): void {
    this.trials.clear();
  }

  /** Forget the fights too (a new profile, a test). */
  clear(): void {
    this.trials.clear();
    this.contacts.clear();
  }

  attach(bus: Subscribable<Pick<ModeEvents, 'skillTrial' | 'runReady' | 'contactSettled'>>): () => void {
    const offs = [
      bus.on('skillTrial', (e) => this.record(e.success)),
      bus.on('contactSettled', (e) => this.recordContact(e.outcome)),
      bus.on('runReady', (e) => {
        this.contactRun = this.cfg.edgeContactModes.includes(e.mode);
        this.reset();
      }),
    ];
    return () => offs.forEach((f) => f());
  }
}
