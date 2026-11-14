import type { Settings } from '../settings/settings';

/**
 * The slice of the settings that per-shot feedback reads. One mutable object is shared by the cue
 * model and the HUD so a settings change applies live without re-subscribing anything.
 */
export interface FeedbackOptions {
  /** Effective values: the settings' choice, forced off while `referenceLike`. */
  coachingCues: boolean;
  missGhost: boolean;
  damageNumbers: boolean;
  reduceFlashing: boolean;
  /**
   * A reference-like run is on (design §8.5: the Daily Baseline), whatever the settings say: the
   * three options above read false, and the HUD and the sound map also drop the rewards and
   * readouts (floating points, time-to-shot, the screen pulse, streak and chain sounds). The shot,
   * the target's reaction and the hit and kill sounds are unchanged.
   */
  referenceLike: boolean;
}

export function createFeedbackOptions(s: Readonly<Settings>): FeedbackOptions {
  return {
    coachingCues: s.coachingCues,
    missGhost: s.missGhost,
    damageNumbers: s.damageNumbers,
    reduceFlashing: s.reduceFlashing,
    referenceLike: false,
  };
}

/** Copy the relevant settings into `out` (no allocation); a reference-like run keeps its cues off. */
export function applySettingsToOptions(out: FeedbackOptions, s: Readonly<Settings>): void {
  const on = !out.referenceLike;
  out.coachingCues = on && s.coachingCues;
  out.missGhost = on && s.missGhost;
  out.damageNumbers = on && s.damageNumbers;
  out.reduceFlashing = s.reduceFlashing;
}

/** Enter or leave the reference-like presentation (no allocation): the options are re-derived from the settings. */
export function setReferenceLike(out: FeedbackOptions, s: Readonly<Settings>, on: boolean): void {
  out.referenceLike = on;
  applySettingsToOptions(out, s);
}
