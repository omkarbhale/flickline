/**
 * Rate limit for full-width screen pulses (research R10: at most N in any 1000 ms window, one
 * shared budget for every full-width effect). Time comes from the caller (sim time), so this is
 * deterministic and allocation-free. A skipped pulse loses nothing: the marker and the sound
 * for the same event still play.
 */
export class PulseBudget {
  private readonly stamps: Float64Array;
  private head = 0;
  private count = 0;

  constructor(
    maxPerWindow: number,
    private readonly windowSec = 1,
  ) {
    this.stamps = new Float64Array(Math.max(1, maxPerWindow));
  }

  /** True (and the pulse is recorded) when a pulse starting at `nowSec` is allowed. */
  tryAcquire(nowSec: number): boolean {
    const n = this.stamps.length;
    if (this.count > 0) {
      const newest = this.stamps[(this.head + this.count - 1) % n]!;
      if (nowSec < newest) this.reset(); // the clock went backwards (run restart)
    }
    while (this.count > 0 && nowSec - this.stamps[this.head]! >= this.windowSec) {
      this.head = (this.head + 1) % n;
      this.count--;
    }
    if (this.count >= n) return false;
    this.stamps[(this.head + this.count) % n] = nowSec;
    this.count++;
    return true;
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
  }
}
