import { describe, expect, it } from 'vitest';
import { effectiveDial } from './itemDifficulty';
import { createLinearDial } from './linearDial';

const table = {
  size: { at0: 3, at100: 1 }, // decreasing, linear
  exposure: { at0: 3, at100: 0.45, geometric: true }, // decreasing, geometric
  speed: { at0: 2, at100: 5.4 }, // increasing
  fixed: { at0: 1, at100: 1 }, // does not vary with the dial
};
const src = createLinearDial(table);

describe('effectiveDial', () => {
  it('inverts each axis (linear, geometric, rising and falling) back to the dial', () => {
    for (const dial of [0, 13, 50, 77.5, 100]) {
      const v = src.axes(dial);
      for (const k of ['size', 'exposure', 'speed']) {
        expect(effectiveDial(src, v, [k], -1)).toBeCloseTo(dial, 4);
      }
    }
  });

  it('averages the used axes, so a clamped axis pulls the item difficulty', () => {
    const v = { ...src.axes(80), exposure: src.axes(40).exposure! }; // exposure held easier than the dial
    expect(effectiveDial(src, v, ['size', 'exposure'], -1)).toBeCloseTo(60, 4);
  });

  it('only counts the axes the mode uses; fixed or unknown axes are skipped; falls back to the dial', () => {
    const v = src.axes(30);
    expect(effectiveDial(src, v, ['size', 'fixed', 'nope'], -1)).toBeCloseTo(30, 4);
    expect(effectiveDial(src, v, ['fixed'], 41)).toBe(41);
    expect(effectiveDial(src, v, [], 41)).toBe(41);
  });

  it('clamps values outside the table range', () => {
    expect(effectiveDial(src, { size: 0.5 }, ['size'], -1)).toBeCloseTo(100, 4);
    expect(effectiveDial(src, { size: 9 }, ['size'], -1)).toBeCloseTo(0, 4);
  });
});
