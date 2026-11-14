/**
 * Frame-rate cap for a loop driven by `requestAnimationFrame` (design §13.3 "FPS cap"). The loop
 * keeps asking for frames at the display's rate; `shouldRun(ts)` says whether this one should do
 * work. Skipped frames cost nothing, so a 60 fps cap on a 144 Hz display really runs about 60 frames
 * per second (every 2nd or 3rd display frame, never a fixed 1-in-3 that would give 48).
 *
 * The schedule is absolute: each run moves the next due time forward by exactly one interval, so
 * rounding to display frames averages out. A frame is accepted when it is within half a display
 * frame of the due time (the display's frame time is learned from the gaps it sees). A caller that
 * falls more than one interval behind resynchronises instead of bursting to catch up. Pure: no clock
 * of its own, no allocation.
 */
export class FrameLimiter {
  /** Target frames per second; 0 = uncapped. */
  private cap = 0;
  private interval = 0;
  private due = 0;
  private lastTs = 0;
  /** Smallest gap between consecutive timestamps seen (ms): the display frame time. */
  private display = 0;

  setCap(fps: number): void {
    this.cap = fps > 0 ? fps : 0;
    this.interval = this.cap > 0 ? 1000 / this.cap : 0;
    this.due = 0;
  }

  get fps(): number {
    return this.cap;
  }

  /** Whether the frame at `ts` (ms, the rAF timestamp) should run. */
  shouldRun(ts: number): boolean {
    const gap = ts - this.lastTs;
    if (this.lastTs !== 0 && gap > 0.5 && (this.display === 0 || gap < this.display)) this.display = gap;
    this.lastTs = ts;
    if (this.cap === 0) return true;
    if (this.due === 0) {
      this.due = ts + this.interval;
      return true;
    }
    const slack = this.display > 0 ? this.display * 0.5 : 0;
    if (ts + slack < this.due) return false;
    this.due += this.interval;
    if (this.due < ts) this.due = ts + this.interval; // fell behind (tab hidden, hitch): resynchronise
    return true;
  }
}
