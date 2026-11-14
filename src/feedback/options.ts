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
}

export function createFeedbackOptions(s: Readonly<Settings>): FeedbackOptions {
  return {
    coachingCues: s.coachingCues,
    missGhost: s.missGhost,
    damageNumbers: s.damageNumbers,
    reduceFlashing: s.reduceFlashing,
  };
}

/** Copy the relevant settings into `out` (no allocation). */
export function applySettingsToOptions(out: FeedbackOptions, s: Readonly<Settings>): void {
  out.coachingCues = s.coachingCues;
  out.missGhost = s.missGhost;
  out.damageNumbers = s.damageNumbers;
  out.reduceFlashing = s.reduceFlashing;
}
