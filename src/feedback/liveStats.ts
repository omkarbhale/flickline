import type { Subscribable } from '../core/eventBus';
import { SortedSamples } from '../core/sortedSamples';
import type { HudTunables } from '../config/hud';
import type { ModeEvents } from '../modes/contracts';
import type { SimEvents } from '../sim/types';

/**
 * What the HUD stat strip reads (design §7.2, definitions in §3). The HUD never computes a stat;
 * it asks this contract. The run stat tracker of #13 implements it (or replaces `LiveStats`
 * below) without the HUD changing. Missing data is `NaN` for medians and 0 for rates.
 */
export interface HudStatsSource {
  readonly shots: number;
  readonly hits: number;
  readonly headHits: number;
  readonly movingShots: number;
  /** Hits ÷ shots, 0 with no shots. */
  readonly accuracy: number;
  /** Head hits ÷ all hits, 0 with no hits. */
  readonly headshotRate: number;
  /** Median reaction time (ms) over the kills so far, NaN with none. */
  readonly medianRtMs: number;
  /** Median time to kill (ms) over the kills so far, NaN with none. */
  readonly medianTtkMs: number;
}

type LiveStatsEvents = Pick<SimEvents, 'shotFired' | 'targetHit' | 'targetKilled'> & Pick<ModeEvents, 'runReady'>;

/**
 * Event-fed implementation of `HudStatsSource`: counters and per-run medians from the same facts
 * the rest of the game sees (`shotFired.moving`, `targetHit.zone`, `targetKilled.rtMs/ttkMs`).
 * Resets when a run is readied. Allocation-free after construction.
 */
export class LiveStats implements HudStatsSource {
  shots = 0;
  hits = 0;
  headHits = 0;
  movingShots = 0;
  private readonly rt: SortedSamples;
  private readonly ttk: SortedSamples;

  constructor(cfg: Pick<HudTunables, 'medianCapacity'>) {
    this.rt = new SortedSamples(cfg.medianCapacity);
    this.ttk = new SortedSamples(cfg.medianCapacity);
  }

  get accuracy(): number {
    return this.shots === 0 ? 0 : this.hits / this.shots;
  }
  get headshotRate(): number {
    return this.hits === 0 ? 0 : this.headHits / this.hits;
  }
  get medianRtMs(): number {
    return this.rt.median();
  }
  get medianTtkMs(): number {
    return this.ttk.median();
  }

  attach(bus: Subscribable<LiveStatsEvents>): () => void {
    const offs = [
      bus.on('shotFired', (e) => {
        this.shots++;
        if (e.moving) this.movingShots++;
      }),
      bus.on('targetHit', (e) => {
        this.hits++;
        if (e.zone === 'head') this.headHits++;
      }),
      bus.on('targetKilled', (e) => {
        // A negative RT means "never seen / not measured": not a sample.
        if (e.rtMs >= 0) this.rt.add(e.rtMs);
        if (e.ttkMs >= 0) this.ttk.add(e.ttkMs);
      }),
      bus.on('runReady', () => this.reset()),
    ];
    return () => offs.forEach((f) => f());
  }

  reset(): void {
    this.shots = this.hits = this.headHits = this.movingShots = 0;
    this.rt.clear();
    this.ttk.clear();
  }
}
