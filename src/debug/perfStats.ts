/**
 * Rolling performance counters. Fixed-size ring buffers, no allocation after construction.
 * Frame time is measured between consecutive rAF timestamps (what the player experiences, includes
 * vsync/throttling); work time is the CPU time spent inside our frame callback.
 */
const N = 240;

export class PerfStats {
  readonly frameMs = new Float32Array(N);
  private i = 0;
  private filled = 0;
  private lastTs = 0;
  private workStart = 0;
  private tickAccumMs = 0;
  private tickCount = 0;
  /** CPU ms spent in our frame callback (sim + render submit) for the last frame. */
  workMs = 0;
  /** Average per-tick sim cost over the last second-ish window, in ms. */
  tickMs = 0;
  ticksLastFrame = 0;
  private windowStart = 0;
  private windowFrames = 0;
  fps = 0;
  avgMs = 0;
  maxMs = 0;
  p99Ms = 0;
  private readonly sorted = new Float32Array(N);

  beginFrame(ts: number): void {
    if (this.lastTs !== 0) {
      const d = ts - this.lastTs;
      this.frameMs[this.i] = d;
      this.i = (this.i + 1) % N;
      if (this.filled < N) this.filled++;
      this.windowFrames++;
    }
    this.lastTs = ts;
    if (this.windowStart === 0) this.windowStart = ts;
    this.workStart = performance.now();
    if (ts - this.windowStart >= 500) {
      this.fps = (this.windowFrames * 1000) / (ts - this.windowStart);
      this.windowStart = ts;
      this.windowFrames = 0;
      this.recompute();
      if (this.tickCount > 0) {
        this.tickMs = this.tickAccumMs / this.tickCount;
        this.tickAccumMs = 0;
        this.tickCount = 0;
      }
    }
  }

  endFrame(): void {
    this.workMs = performance.now() - this.workStart;
  }

  recordTick(ms: number): void {
    this.tickAccumMs += ms;
    this.tickCount++;
  }

  private recompute(): void {
    const n = this.filled;
    if (n === 0) return;
    let sum = 0;
    let max = 0;
    for (let k = 0; k < n; k++) {
      const v = this.frameMs[k]!;
      sum += v;
      if (v > max) max = v;
      this.sorted[k] = v;
    }
    this.avgMs = sum / n;
    this.maxMs = max;
    // p99 via partial selection on a scratch copy (sort of <=240 floats, twice a second).
    this.sorted.subarray(0, n).sort();
    this.p99Ms = this.sorted[Math.min(n - 1, Math.floor(n * 0.99))]!;
  }

  get count(): number {
    return this.filled;
  }

  /** Most recent frame times, oldest first, via callback (no allocation). */
  forEachRecent(count: number, fn: (ms: number, index: number) => void): void {
    const n = Math.min(count, this.filled);
    for (let k = 0; k < n; k++) {
      const idx = (this.i - n + k + N * 2) % N;
      fn(this.frameMs[idx]!, k);
    }
  }
}
