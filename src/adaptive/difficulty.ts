import type { DialTunables } from '../config/dial';
import { tunables } from '../config/tunables';
import { axes, createAxes, type DialAxes } from './dial';
import type { SkillState, SkillTrial } from './skillModel';

/**
 * Adaptive difficulty seam. Systems that spawn targets ask a DifficultyModel for a level in 0..1
 * and report outcomes. `ConstantDifficulty` is the fixed stand-in; `MatchedDifficulty` is the
 * skill-matched implementation backed by the grid-posterior model (`skillModel.ts`).
 */
export interface DifficultyModel {
  /** 0 = easiest, 1 = hardest. */
  readonly level: number;
  /** Feed an outcome (e.g. from targetHit / targetKilled / missed shot events). */
  recordOutcome(hit: boolean, distance: number): void;
}

export class ConstantDifficulty implements DifficultyModel {
  constructor(readonly level = 0.5) {}
  recordOutcome(): void {
    /* constant model ignores outcomes */
  }
}

/**
 * One run of one mode on the shared SkillState. Call `beat(i)` at every beat boundary (0 at the
 * start of the run); `dial`, `level` and `axes` then hold that beat's difficulty. `recordOutcome`
 * reports a trial on the mode's skill at the current dial; a mode whose items can outlive a beat,
 * or that trains several skills (Sweep, `skill: 'line'`, where `recordOutcome` is ignored), calls
 * `SkillState.observe` with the item's own skill and spawn dial instead.
 */
export class MatchedDifficulty implements DifficultyModel {
  /** Current dial (0–100), including the wave offset. */
  dial = 0;
  /** Axis values for `dial` (fairness floors applied). Reused object: copy what you keep. */
  readonly axes: DialAxes = createAxes();
  private readonly trial: SkillTrial = { itemDifficulty: 0, success: false };

  constructor(
    readonly skills: SkillState,
    readonly mode: string,
    readonly wave: readonly number[] = tunables.dial.waves.drill,
    private readonly cfg: DialTunables = tunables.dial,
  ) {
    if (!cfg.modes[mode]) throw new Error(`skill model: unknown mode "${mode}"`);
  }

  get level(): number {
    return this.dial / 100;
  }

  /** Enter beat `index` of the run; returns the new dial. */
  beat(index: number): number {
    this.dial = this.skills.dialFor(this.mode, index, this.wave);
    axes(this.dial, this.axes, this.cfg);
    return this.dial;
  }

  recordOutcome(hit: boolean): void {
    const skill = this.cfg.modes[this.mode].skill;
    if (skill === 'line') return;
    this.trial.itemDifficulty = this.dial;
    this.trial.success = hit;
    this.skills.observe(skill, this.trial);
  }
}
