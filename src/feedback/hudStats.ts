import type { Subscribable } from '../core/eventBus';
import type { SimEvents } from '../sim/types';
import type { RunStats } from './statTracker';

/**
 * What the HUD stat strip reads (design §7.2, definitions in §3). The HUD never computes a stat:
 * it asks this contract, which `TrackerHudStats` backs with the run's stat tracker. Missing data is
 * `NaN` for every figure (the HUD shows a dash, never a fake zero).
 */
export interface HudStatsSource {
  readonly shots: number;
  /** Hits ÷ shots, NaN with no shots. */
  readonly accuracy: number;
  /** Head hits ÷ all hits, NaN with no hits. */
  readonly headshotRate: number;
  /** Median time to shot (ms; design §3, `rtMs` until #137) over the targets so far, NaN with none. */
  readonly medianRtMs: number;
  /** Median time to kill (ms) over the kills so far, NaN with none. */
  readonly medianTtkMs: number;
  /** Shots fired above the accuracy deadzone or airborne. */
  readonly movingShots: number;
}

/** The part of the run controller this adapter needs: a live stats snapshot (it allocates). */
export interface LiveStatsSource {
  liveStats(): RunStats;
}

type StatEvents = Pick<SimEvents, 'shotFired' | 'targetHit' | 'targetKilled' | 'targetExpired'> & { runReady: unknown };

const NONE = (v: number | null): number => (v === null ? NaN : v);

/**
 * `HudStatsSource` over the run's stat tracker. `liveStats()` builds a full snapshot (it allocates),
 * so it is taken lazily: at most once per batch of events (shots, hits, kills, run start), never per
 * frame. Subscribe it to the bus before the HUD so its version is bumped before the HUD reads.
 */
export class TrackerHudStats implements HudStatsSource {
  private snap: RunStats | null = null;
  private version = 0;
  private snapVersion = -1;

  constructor(private readonly source: LiveStatsSource) {}

  attach(bus: Subscribable<StatEvents>): () => void {
    const bump = (): void => { this.version++; };
    const offs = [bus.on('shotFired', bump), bus.on('targetHit', bump), bus.on('targetKilled', bump), bus.on('targetExpired', bump), bus.on('runReady', bump)];
    return () => offs.forEach((f) => f());
  }

  /** Force the next read to take a fresh snapshot (after a reset). */
  invalidate(): void {
    this.version++;
  }

  private get s(): RunStats {
    if (this.snap === null || this.snapVersion !== this.version) {
      this.snap = this.source.liveStats();
      this.snapVersion = this.version;
    }
    return this.snap;
  }

  get shots(): number { return this.s.shots; }
  get movingShots(): number { return this.s.movingShots; }
  get accuracy(): number { return NONE(this.s.accuracy); }
  get headshotRate(): number { return NONE(this.s.headshotRate); }
  get medianRtMs(): number { return NONE(this.s.medianRtMs); }
  get medianTtkMs(): number { return NONE(this.s.medianTtkMs); }
}
