import type { DialTunables } from '../config/dial';
import { tunables } from '../config/tunables';
import { clamp } from '../core/math';
import { DIAL_MAX, DIAL_MIN, successOffset } from './dial';

/** Success rate a 2-up/1-down staircase converges on: p² = 0.5 -> p = 0.7071. */
export const STAIRCASE_TARGET = Math.SQRT1_2;

/**
 * Placement-run staircase on the dial (design §9.2): harder after `upAfter` (2) consecutive
 * successes, easier after 1 failure; the step starts at 16 and halves at every reversal down to 2.
 * It only chooses the dial of the next item; the rating itself comes from the grid posterior, with
 * the staircase as a sanity bound (`abilityEstimate`).
 */
export class Staircase {
  /** Dial for the next item. */
  dial: number;
  step: number;
  /** Direction of the last move: +1 harder, −1 easier, 0 none yet. */
  private lastDir = 0;
  private streak = 0;
  /** Dial values at each reversal (bounded: the run has about 30 trials). */
  private readonly reversalDials: number[] = [];
  trials = 0;

  constructor(
    startDial: number,
    private readonly cfg: DialTunables = tunables.dial,
  ) {
    this.dial = clamp(startDial, DIAL_MIN, DIAL_MAX);
    this.step = cfg.staircase.startStep;
  }

  get reversals(): number {
    return this.reversalDials.length;
  }

  /** Record the outcome of the item played at `this.dial`; moves `dial` for the next one. */
  record(success: boolean): void {
    this.trials++;
    let dir = 0;
    if (success) {
      this.streak++;
      if (this.streak >= this.cfg.staircase.upAfter) {
        dir = 1;
        this.streak = 0;
      }
    } else {
      this.streak = 0;
      dir = -1;
    }
    if (dir === 0) return;
    if (this.lastDir !== 0 && dir !== this.lastDir) {
      this.reversalDials.push(this.dial);
      this.step = Math.max(this.cfg.staircase.minStep, this.step / 2);
    }
    this.lastDir = dir;
    this.dial = clamp(this.dial + dir * this.step, DIAL_MIN, DIAL_MAX);
  }

  /** Mean dial of the last `n` reversals, or NaN before the first reversal. */
  reversalMean(n: number = this.cfg.staircase.reversalsForBound): number {
    const r = this.reversalDials;
    const k = Math.min(n, r.length);
    if (k === 0) return NaN;
    let sum = 0;
    for (let i = r.length - k; i < r.length; i++) sum += r[i];
    return sum / k;
  }

  /**
   * Ability implied by the staircase: the reversal mean is the 70.7 %-success dial, so ability is
   * that plus s·logit(0.707). NaN until `reversalsForBound` reversals have happened.
   */
  abilityEstimate(): number {
    if (this.reversals < this.cfg.staircase.reversalsForBound) return NaN;
    return this.reversalMean() + successOffset(STAIRCASE_TARGET, this.cfg.scale);
  }
}
