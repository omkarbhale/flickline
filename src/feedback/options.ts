import type { CuePhase } from '../config/cues';
import type { Settings } from '../settings/settings';

/**
 * The slice of the settings that per-shot feedback reads. One mutable object is shared by the cue
 * model and the HUD so a settings change applies live without re-subscribing anything.
 */
export interface FeedbackOptions {
  coachingCues: boolean;
  missGhost: boolean;
  damageNumbers: boolean;
  reduceFlashing: boolean;
  /**
   * Fade the coaching cues as the player improves (design §7.4). Off pins every cue at full.
   * Optional so a plain options literal keeps working; a missing value reads as on.
   */
  cueFading?: boolean;
  /**
   * Per-run state set by the cue planner at each run start, never by settings (`applySettingsToOptions`
   * leaves it alone). Missing values read as `every`, not clean, no Surge.
   */
  cuePhase?: CuePhase;
  /** A clean run: no coaching cues, no added tells, reference-like HUD. */
  clean?: boolean;
  /** Surge is active: the tells come back (first release). */
  surge?: boolean;
  /**
   * A reference-like run is on (design §8.5: the Daily Baseline), set per run by `features/baseline.ts`
   * and never by settings. It is a clean run (`clean`: no coaching cues, no stat strip, ghost pace or
   * edge meter, whatever the settings say) that also drops the rewards the reference game does not
   * have: the HUD's clock, score and streak counters, the floating points and time-to-shot readout,
   * the screen pulse, and the kill ladder, sparkle, chain and streak-break sounds. The shot, the
   * target's reaction and the hit and kill sounds are unchanged.
   */
  referenceLike?: boolean;
}

export function createFeedbackOptions(s: Readonly<Settings>): FeedbackOptions {
  return {
    coachingCues: s.coachingCues,
    missGhost: s.missGhost,
    damageNumbers: s.damageNumbers,
    reduceFlashing: s.reduceFlashing,
    cueFading: s.cueFading,
    cuePhase: 'every',
    clean: false,
    surge: false,
    referenceLike: false,
  };
}

/** Copy the relevant settings into `out` (no allocation). */
export function applySettingsToOptions(out: FeedbackOptions, s: Readonly<Settings>): void {
  out.coachingCues = s.coachingCues;
  out.missGhost = s.missGhost;
  out.damageNumbers = s.damageNumbers;
  out.reduceFlashing = s.reduceFlashing;
  out.cueFading = s.cueFading;
}
