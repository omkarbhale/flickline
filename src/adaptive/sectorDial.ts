import type { DialTunables } from '../config/dial';
import { tunables } from '../config/tunables';
import { clamp } from '../core/math';
import { DIAL_MAX, DIAL_MIN } from './dial';
import { Staircase } from './staircase';

/** How one Opener contact counts for the placement staircase (design §9.2). */
export type OpenerOutcome = 'win' | 'loss' | 'neutral';

/**
 * The dial of a Sweep run, sector by sector (design §9.3.2, §4.1, §9.2; #203). Pure: the caller
 * reads the skill model's target (θ_line − s·logit(0.7), `SkillState.targetDial`) at each sector
 * boundary and hands it in with the sector's depth offset; nothing here reads the last few shots.
 *
 * - **Run start**: the matched dial is the target. Sector 1 (the Opener) plays at matched + its
 *   offset (−8).
 * - **Each later sector**: the matched dial moves towards the target by at most `beat.maxStep` (3)
 *   points; the sector plays at matched + its depth offset. Nothing changes inside a sector.
 * - **A new profile's first Opener** (`startRun(..., placing = true)`): a 2-up/1-down staircase on
 *   contacts, step 16 halving at each reversal, starting at the prior's target itself: the staircase
 *   is already the gentle start, and the Opener's −8 would only cost a player above the prior a climb
 *   the few contacts cannot make (#203). Each Opener contact plays at the staircase's dial;
 *   `endOpener` makes the staircase's final dial the matched dial, which seeds sector 2 without a ±3
 *   move at that boundary.
 */
export class SectorDial {
  /** Matched dial before the depth offset (NaN before `startRun`). */
  matched = NaN;
  /** The dial in force: the current sector's (or Opener contact's). */
  dial = NaN;
  /** The Opener staircase while a new profile is being placed, else null. */
  staircase: Staircase | null = null;

  constructor(private readonly cfg: DialTunables = tunables.dial) {}

  /** True while the Opener staircase is placing a new profile. */
  get placing(): boolean {
    return this.staircase !== null;
  }

  /**
   * Sector `index` of the run plan starts: the one decision of the run's dial. `opener`: one of a
   * placing Opener's contact sectors; `target`: the skill model's matched dial now; `offset`: the
   * sector's depth offset (design §4.1); `placing`: the run places a new profile (sector 0 only).
   * Returns the sector's dial.
   */
  enterSector(index: number, opener: boolean, target: number, offset: number, placing: boolean): number {
    if (index === 0) return this.startRun(target, offset, placing);
    if (opener && this.placing) return this.nextOpenerContact();
    const seed = this.placing;
    this.endOpener();
    return this.nextSector(target, offset, seed);
  }

  /** A run starts: `target` is the skill model's matched dial now, `offset` the Opener's depth offset. Returns the first dial. */
  startRun(target: number, offset: number, placing = false): number {
    this.matched = clamp(target, DIAL_MIN, DIAL_MAX);
    this.staircase = placing ? new Staircase(this.matched, this.cfg) : null;
    this.dial = this.staircase ? this.staircase.dial : clamp(this.matched + offset, DIAL_MIN, DIAL_MAX);
    return this.dial;
  }

  /** An Opener contact ended (placing only). Returns the staircase's dial for the next one. */
  recordOpener(outcome: OpenerOutcome): number {
    const s = this.staircase;
    if (!s) return this.dial;
    if (outcome === 'neutral') s.hold();
    else s.record(outcome === 'win');
    return s.dial;
  }

  /** The next Opener contact's sector starts (placing only): its dial is the staircase's. */
  nextOpenerContact(): number {
    if (this.staircase) this.dial = this.staircase.dial;
    return this.dial;
  }

  /**
   * Whether a placing Opener that has fought `fought` contacts is done (design §9.2: four to six):
   * from `min` on once the staircase has turned at least once (it found the edge), at `max` in any case.
   */
  openerDone(fought: number, min: number, max: number): boolean {
    const s = this.staircase;
    if (!s) return true;
    return fought >= max || (fought >= min && s.reversals >= 1);
  }

  /** The placing Opener is over: the staircase's final dial becomes the matched dial (design §9.2). */
  endOpener(): void {
    const s = this.staircase;
    if (!s) return;
    this.matched = s.dial;
    this.staircase = null;
  }

  /**
   * A sector boundary. `target`: the skill model's matched dial now; `offset`: the new sector's depth
   * offset. `seed`: the boundary right after a placing Opener, where the matched dial is the
   * staircase's and does not move. Returns the sector's dial.
   */
  nextSector(target: number, offset: number, seed = false): number {
    if (!seed) {
      const max = this.cfg.beat.maxStep;
      this.matched = clamp(this.matched + clamp(target - this.matched, -max, max), DIAL_MIN, DIAL_MAX);
    }
    this.dial = clamp(this.matched + offset, DIAL_MIN, DIAL_MAX);
    return this.dial;
  }
}
