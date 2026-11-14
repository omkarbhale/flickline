import { describe, expect, it } from 'vitest';
import { cmPer360, degreesPerCount, DEGREES_PER_COUNT, sensitivityFromCmPer360 } from './sensitivity';

/**
 * Sample values documented in docs/mechanics-spec.md section 1.2:
 *   yaw_deg_per_count = 0.07 * sens, cm_per_360 = 914.4 / (DPI * sens * 0.07)
 */
describe('sensitivity in the reference scale (spec 1.2)', () => {
  it('uses 0.07 degrees per count at sensitivity 1.0, same on every sensitivity linearly', () => {
    expect(DEGREES_PER_COUNT).toBe(0.07);
    expect(degreesPerCount(1)).toBeCloseTo(0.07, 12);
    expect(degreesPerCount(0.4)).toBeCloseTo(0.028, 12);
  });

  // [DPI, sens, expected cm/360]: the spec's documented checks plus its closed forms.
  const samples: [number, number, number][] = [
    [800, 0.5, 32.66], // spec: 914.4 / 28 = 32.66 (worked example from the converter sites)
    [800, 0.4, 40.82], // spec: "800 DPI at 0.4 gives 40.82"
    [1600, 0.2, 40.82], // spec: "1600 DPI at 0.2 gives the same"
    [400, 1.0, 32.66], // eDPI 400 = eDPI 400 (800 x 0.5)
    [800, 1.0, 16.33], // 13062.86 / 800, the spec's second closed form
  ];
  for (const [dpi, sens, cm] of samples) {
    it(`${dpi} DPI at sens ${sens} gives ${cm} cm/360`, () => {
      expect(cmPer360(sens, dpi)).toBeCloseTo(cm, 2);
      // The spec's two closed forms agree with each other.
      expect(cmPer360(sens, dpi)).toBeCloseTo(13062.86 / (dpi * sens), 2);
    });
  }

  it('matches a hand-calculated example', () => {
    // 800 DPI, sens 0.35: 0.07 * 0.35 = 0.0245 deg/count; 800 counts/inch -> 19.6 deg/inch;
    // 360 / 19.6 = 18.367 inches; x 2.54 = 46.653 cm for a full turn.
    expect(degreesPerCount(0.35) * 800).toBeCloseTo(19.6, 10);
    expect(cmPer360(0.35, 800)).toBeCloseTo(46.653, 3);
  });

  it('inverts exactly (entering cm/360 gives back the sensitivity)', () => {
    expect(sensitivityFromCmPer360(40.8171, 800)).toBeCloseTo(0.4, 4);
    for (const [dpi, sens] of [[400, 1.1], [1600, 0.23], [3200, 0.05]] as const) {
      expect(sensitivityFromCmPer360(cmPer360(sens, dpi), dpi)).toBeCloseTo(sens, 10);
    }
  });
});
