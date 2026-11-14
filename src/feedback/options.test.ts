import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { applySettingsToOptions, createFeedbackOptions, setReferenceLike } from './options';

describe('feedback options', () => {
  const on = { ...DEFAULT_SETTINGS, coachingCues: true, missGhost: true, damageNumbers: true };

  it('follow the settings outside a reference-like run', () => {
    const o = createFeedbackOptions(on);
    expect(o).toMatchObject({ coachingCues: true, missGhost: true, damageNumbers: true, referenceLike: false });
    applySettingsToOptions(o, { ...on, missGhost: false });
    expect(o.missGhost).toBe(false);
  });

  it('a reference-like run forces the cues off whatever the settings say, and a settings change cannot bring them back', () => {
    const o = createFeedbackOptions(on);
    setReferenceLike(o, on, true);
    expect(o).toMatchObject({ coachingCues: false, missGhost: false, damageNumbers: false, referenceLike: true });
    applySettingsToOptions(o, { ...on, damageNumbers: true, coachingCues: true });
    expect(o).toMatchObject({ coachingCues: false, missGhost: false, damageNumbers: false });
    setReferenceLike(o, { ...on, missGhost: false }, false);
    expect(o).toMatchObject({ coachingCues: true, missGhost: false, damageNumbers: true, referenceLike: false });
  });

  it('keeps reduce-flashing as set (it is an accessibility setting, not a cue)', () => {
    const o = createFeedbackOptions({ ...on, reduceFlashing: true });
    setReferenceLike(o, { ...on, reduceFlashing: true }, true);
    expect(o.reduceFlashing).toBe(true);
  });
});
