import { describe, expect, it } from 'vitest';
import { render } from '../config/render';
import { applyOverride, effectivePixelRatio, resolveQuality } from './graphics';

describe('graphics overrides', () => {
  it('auto follows the preset, on and off force', () => {
    expect(applyOverride(true, 'auto')).toBe(true);
    expect(applyOverride(false, 'auto')).toBe(false);
    expect(applyOverride(false, 'on')).toBe(true);
    expect(applyOverride(true, 'off')).toBe(false);
  });

  it('lays post and outline over each preset and leaves the rest alone', () => {
    for (const level of ['low', 'medium', 'high'] as const) {
      const base = render.quality[level];
      const auto = resolveQuality(base, { postEffects: 'auto', enemyOutline: 'auto' });
      expect(auto).toEqual(base);
      const forced = resolveQuality(base, { postEffects: 'on', enemyOutline: 'on' });
      // On keeps a preset's own stack, and gives one to a preset that has none (Low: bloom and the vignette).
      expect(forced.post).toEqual(level === 'low' ? { bloom: true, blur: false, vignette: true, chromatic: false } : base.post);
      expect(forced.echoOutline).toBe(true);
      expect(forced.pixelRatioCap).toBe(base.pixelRatioCap);
      expect(forced.gridDetail).toBe(base.gridDetail);
      const off = resolveQuality(base, { postEffects: 'off', enemyOutline: 'off' });
      expect(off.post).toEqual({ bloom: false, blur: false, vignette: false, chromatic: false });
      expect(off.echoOutline).toBe(false);
    }
  });

  it('does not change the preset it was given', () => {
    const base = render.quality.high;
    resolveQuality(base, { postEffects: 'off', enemyOutline: 'off' });
    expect(base.post.bloom).toBe(true);
  });
});

describe('effective pixel ratio', () => {
  it('is the device ratio capped by the preset, times the scale', () => {
    expect(effectivePixelRatio(2, render.quality.medium, 1)).toBe(1.5);
    expect(effectivePixelRatio(1, render.quality.high, 0.5)).toBe(0.5);
    expect(effectivePixelRatio(3, render.quality.high, 0.75)).toBe(1.5);
  });
  it('survives a bad device ratio and a tiny scale', () => {
    expect(effectivePixelRatio(0, render.quality.low, 1)).toBe(1);
    expect(effectivePixelRatio(1, render.quality.low, 0.01)).toBe(0.25);
  });
});
