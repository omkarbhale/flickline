/**
 * Fixed-timestep accumulator. Pure: feed it real frame deltas, it tells you how many sim ticks
 * to run and the interpolation alpha for rendering between the last two ticks.
 */
export class FixedStepper {
  private acc = 0;
  /** Interpolation factor in [0, 1) between previous and current sim state. */
  alpha = 0;
  /** Ticks dropped because a frame took too long (spiral-of-death guard). */
  droppedTicks = 0;

  constructor(
    readonly dt: number,
    /** Most ticks run in one frame; any excess time is discarded. */
    readonly maxTicksPerFrame = 8,
  ) {}

  /** Add `frameSeconds` of real time; returns how many ticks to run now. */
  advance(frameSeconds: number): number {
    this.acc += frameSeconds < 0 ? 0 : frameSeconds;
    let ticks = Math.floor(this.acc / this.dt);
    if (ticks > this.maxTicksPerFrame) {
      this.droppedTicks += ticks - this.maxTicksPerFrame;
      ticks = this.maxTicksPerFrame;
      this.acc = ticks * this.dt;
    }
    this.acc -= ticks * this.dt;
    this.alpha = this.acc / this.dt;
    return ticks;
  }

  /** Forget accumulated time (e.g. after the game was paused). */
  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
