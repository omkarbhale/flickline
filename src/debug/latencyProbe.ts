/**
 * Input-to-frame latency probe (debug only; nothing is recorded unless a playtest starts it).
 *
 * For each input event it records the event's own timestamp and then the moments the game
 * pipeline reached with it:
 *  - `consumedAt`: the sim tick that acted on it (fire: the tick that emitted `shotFired`; a key:
 *    the first tick after it) or, for mouse look, the frame that sampled the new view angles;
 *  - `drawnAt`: the end of the frame that drew the result (WebGL calls issued);
 *  - `vsyncAt`: the next animation-frame timestamp after that, the earliest the browser can put
 *    the drawn frame on screen. The compositor and the display add more after it (a frame or so in
 *    a browser): this probe cannot see past the page, so real input-to-photon is longer.
 * All times are `performance.now()` milliseconds, the timebase of `Event.timeStamp` in browsers.
 *
 * Pure bookkeeping, no DOM: the `latencyProbe` feature feeds it from listeners and frame hooks.
 */

export type ProbeKind = 'fire' | 'look' | 'key';

export interface ProbeSample {
  kind: ProbeKind;
  eventAt: number;
  consumedAt: number;
  drawnAt: number;
  vsyncAt: number;
  /** Sim ticks the consuming frame ran (fire / key), or -1 for look. */
  ticksInFrame: number;
}

export interface Percentiles {
  n: number;
  min: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
  mean: number;
}

export interface ProbeSummary {
  kind: ProbeKind;
  /** Event to consuming tick / frame. */
  toConsumed: Percentiles;
  /** Event to the end of the drawing frame. */
  toDrawn: Percentiles;
  /** Event to the next vsync after drawing (lower bound of event-to-photon). */
  toVsync: Percentiles;
}

/** Percentiles of a list of numbers (nearest-rank). Empty input gives NaNs and n = 0. */
export function percentiles(values: readonly number[]): Percentiles {
  const n = values.length;
  if (n === 0) return { n, min: NaN, p50: NaN, p90: NaN, p99: NaN, max: NaN, mean: NaN };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]!;
  let sum = 0;
  for (const v of s) sum += v;
  return { n, min: s[0]!, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: s[n - 1]!, mean: sum / n };
}

interface Pending {
  kind: ProbeKind;
  eventAt: number;
  consumedAt: number;
  drawnAt: number;
  ticksInFrame: number;
}

export class LatencyProbe {
  readonly samples: ProbeSample[] = [];
  private readonly pending: Pending[] = [];
  /** At most this many samples are kept (the oldest are dropped). */
  constructor(readonly capacity = 4000) {}

  /** An input event arrived (`at` = its `timeStamp`). Look events coalesce until a frame samples them. */
  event(kind: ProbeKind, at: number): void {
    if (kind === 'look') {
      for (const p of this.pending) if (p.kind === 'look' && p.consumedAt < 0) return; // the oldest unsampled move counts
    }
    this.pending.push({ kind, eventAt: at, consumedAt: -1, drawnAt: -1, ticksInFrame: -1 });
  }

  /** A shot left the gun in a tick running at wall time `now`: consumes the oldest pending fire event. */
  shot(now: number): void {
    for (const p of this.pending) {
      if (p.kind === 'fire' && p.consumedAt < 0 && p.eventAt <= now) {
        p.consumedAt = now;
        return;
      }
    }
  }

  /** A sim tick ran at wall time `now`: consumes every pending key event that arrived before it. */
  tick(now: number): void {
    for (const p of this.pending) if (p.kind === 'key' && p.consumedAt < 0 && p.eventAt <= now) p.consumedAt = now;
  }

  /**
   * The frame sampled input (its view angles) at wall time `now`, and ran `ticks` sim ticks. A click
   * still unconsumed after a frame that ran ticks was ignored by the gun (it was cycling, reloading
   * or equipping: the game does not buffer a click), so it is counted in `dropped`, not paired with
   * a later shot.
   */
  frameSampled(now: number, ticks: number): void {
    let w = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i]!;
      if (p.kind === 'look' && p.consumedAt < 0 && p.eventAt <= now) p.consumedAt = now;
      if (p.kind !== 'look' && p.consumedAt >= 0 && p.ticksInFrame < 0) p.ticksInFrame = ticks;
      if (p.kind === 'fire' && p.consumedAt < 0 && ticks > 0 && p.eventAt <= now) {
        this.dropped++;
        continue;
      }
      this.pending[w++] = p;
    }
    this.pending.length = w;
  }

  /** Clicks the gun ignored (see `frameSampled`). */
  dropped = 0;

  /** The frame finished drawing at wall time `now`. */
  frameDrawn(now: number): void {
    for (const p of this.pending) if (p.consumedAt >= 0 && p.drawnAt < 0) p.drawnAt = now;
  }

  /** The next animation frame began (`ts`): every drawn event is complete. */
  vsync(ts: number): void {
    let w = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i]!;
      if (p.drawnAt >= 0 && ts >= p.drawnAt) {
        this.samples.push({ kind: p.kind, eventAt: p.eventAt, consumedAt: p.consumedAt, drawnAt: p.drawnAt, vsyncAt: ts, ticksInFrame: p.ticksInFrame });
      } else {
        this.pending[w++] = p;
      }
    }
    this.pending.length = w;
    if (this.samples.length > this.capacity) this.samples.splice(0, this.samples.length - this.capacity);
  }

  clear(): void {
    this.dropped = 0;
    this.samples.length = 0;
    this.pending.length = 0;
  }

  summary(): ProbeSummary[] {
    const out: ProbeSummary[] = [];
    for (const kind of ['look', 'fire', 'key'] as const) {
      const s = this.samples.filter((x) => x.kind === kind);
      if (s.length === 0) continue;
      out.push({
        kind,
        toConsumed: percentiles(s.map((x) => x.consumedAt - x.eventAt)),
        toDrawn: percentiles(s.map((x) => x.drawnAt - x.eventAt)),
        toVsync: percentiles(s.map((x) => x.vsyncAt - x.eventAt)),
      });
    }
    return out;
  }
}
