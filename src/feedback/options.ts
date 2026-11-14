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
