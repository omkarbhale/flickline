import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { applySettingsToOptions, createFeedbackOptions } from './options';

describe('feedback options', () => {
  it('start outside a reference-like run, and a settings change never switches it', () => {
    const o = createFeedbackOptions(DEFAULT_SETTINGS);
    expect(o.referenceLike).toBe(false);
    o.referenceLike = true;
    applySettingsToOptions(o, { ...DEFAULT_SETTINGS, missGhost: false });
    expect(o.referenceLike).toBe(true);
    expect(o.missGhost).toBe(false);
  });
});
