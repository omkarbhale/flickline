import { describe, expect, it } from 'vitest';
import { axisValue } from '../adaptive/dial';
import { BASELINE_SKILLS } from '../config/baseline';
import { BASELINE_ITEMS } from '../config/baselineItems';
import { tunables } from '../config/tunables';
import { DEG2RAD } from '../core/math';
import { baselineLevelFor, buildBaselineSequence, isBaselineDue, type BaselineLevels } from './baseline';
import { generateBaselineItems } from './baselineGen';

const LEVELS: BaselineLevels = { flick: 45, precision: 45 };
const HOUR = 3_600_000;

const stat = (xs: number[]): [number, number] => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return [m, xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length];
};

describe('isBaselineDue', () => {
  const now = 1_800_000_000_000;
  it('is due with no earlier run, or after 8 hours away, and not before', () => {
    expect(isBaselineDue(null, now)).toBe(true);
    expect(isBaselineDue(Number.NaN, now)).toBe(true);
    expect(isBaselineDue(now - 8 * HOUR + 1, now)).toBe(false);
    expect(isBaselineDue(now - 8 * HOUR, now)).toBe(true);
    expect(isBaselineDue(now - 30 * 60_000, now)).toBe(false);
  });
  it('takes the gap from the config, or an override', () => {
    expect(tunables.baseline.gapHours).toBe(8);
    expect(isBaselineDue(now - 5 * HOUR, now, 4)).toBe(true);
    expect(isBaselineDue(now - 5 * HOUR, now, 6)).toBe(false);
  });
  it('a last run in the future (the clock moved back) is not a gap', () => {
    expect(isBaselineDue(now + HOUR, now)).toBe(false);
  });
  it('is pure: the same inputs give the same answer', () => {
    expect(isBaselineDue(now - 9 * HOUR, now)).toBe(isBaselineDue(now - 9 * HOUR, now));
  });
});

describe('baseline levels', () => {
  it('picks the highest level at or below the matched dial, the lowest for anything under it', () => {
    expect(baselineLevelFor(-5)).toBe(15);
    expect(baselineLevelFor(14.9)).toBe(15);
    expect(baselineLevelFor(15)).toBe(15);
    expect(baselineLevelFor(29.99)).toBe(15);
    expect(baselineLevelFor(30)).toBe(30);
    expect(baselineLevelFor(52)).toBe(45);
    expect(baselineLevelFor(89.9)).toBe(75);
    expect(baselineLevelFor(100)).toBe(90);
  });
  it('the matched success rate is the 70% every matched run aims for', () => {
    expect(tunables.baseline.matchedTargetSuccess.flick).toBe(tunables.dial.modes.sweep!.targetSuccess);
    expect(tunables.baseline.matchedTargetSuccess.precision).toBe(tunables.dial.modes.sweep!.targetSuccess);
  });
});

describe('stored item lists', () => {
  it('are what the generator writes from the fixed seed (npm run baseline:items)', () => {
    expect(JSON.parse(JSON.stringify(generateBaselineItems(tunables)))).toEqual(JSON.parse(JSON.stringify(BASELINE_ITEMS)));
  });

  it('there are 20 items for each of the six levels of each skill, at the level\'s own axis values', () => {
    expect(tunables.baseline.levels).toEqual([15, 30, 45, 60, 75, 90]);
    for (const skill of BASELINE_SKILLS) {
      for (const level of tunables.baseline.levels) {
        const list = BASELINE_ITEMS[skill][level]!;
        expect(list).toHaveLength(20);
        const rc = tunables.baseline.recipe;
        const angleMin = axisValue(rc.flick.angleMinDeg, level);
        const angleMax = axisValue(rc.flick.angleMaxDeg, level);
        for (const [angle, pitch, distance, scale, exposure] of list) {
          expect(Number.isFinite(angle + pitch + distance + scale + exposure)).toBe(true);
          if (skill === 'flick') {
            expect(angle).toBeGreaterThanOrEqual(angleMin - 0.01);
            expect(angle).toBeLessThanOrEqual(angleMax + 0.01);
            expect(scale).toBeCloseTo(Math.max(rc.floors.minBeaconScale, axisValue(rc.flick.beaconScale, level)), 3);
            expect(exposure).toBeCloseTo(Math.max(rc.floors.flickExposureSec, axisValue(rc.flick.exposureSec, level)), 3);
            expect(distance).toBeGreaterThanOrEqual(rc.flick.minDistM);
            expect(distance).toBeLessThanOrEqual(rc.flick.maxDistM);
            // never under the floor
            expect(tunables.movement.standEyeHeight + distance * Math.sin(pitch * DEG2RAD)).toBeGreaterThanOrEqual(tunables.baseline.minBeaconHeightM - 0.01);
          } else {
            expect(angle).toBeGreaterThanOrEqual(rc.precision.angleMinDeg - 0.01);
            expect(angle).toBeLessThanOrEqual(rc.precision.angleMaxDeg + 0.01);
            expect(scale).toBe(1);
            expect(exposure).toBeCloseTo(Math.max(rc.floors.precisionExposureSec, axisValue(rc.precision.exposureSec, level)), 3);
            expect(distance).toBeGreaterThanOrEqual(tunables.baseline.minPostDistanceM - 0.01);
            expect(distance).toBeLessThanOrEqual(tunables.baseline.maxDistanceM + 0.01);
          }
        }
      }
    }
  });

  it('are stratified: one flick angle in each twentieth of the level\'s angle range', () => {
    for (const level of tunables.baseline.levels) {
      const lo = axisValue(tunables.baseline.recipe.flick.angleMinDeg, level);
      const slice = (axisValue(tunables.baseline.recipe.flick.angleMaxDeg, level) - lo) / 20;
      const sorted = BASELINE_ITEMS.flick[level]!.map(([a]) => a).sort((x, y) => x - y);
      sorted.forEach((a, k) => {
        expect(a).toBeGreaterThanOrEqual(lo + k * slice - 0.01);
        expect(a).toBeLessThanOrEqual(lo + (k + 1) * slice + 0.01);
      });
    }
  });

  it('get harder with the level: smaller Beacons, shorter exposure, wider flicks, farther Posts', () => {
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const col = (skill: 'flick' | 'precision', level: number, i: number): number => mean(BASELINE_ITEMS[skill][level]!.map((t) => t[i]!));
    const lv = tunables.baseline.levels;
    for (let k = 1; k < lv.length; k++) {
      const a = lv[k - 1]!;
      const b = lv[k]!;
      expect(col('flick', b, 3)).toBeLessThan(col('flick', a, 3));
      expect(col('flick', b, 4)).toBeLessThan(col('flick', a, 4));
      expect(col('flick', b, 0)).toBeGreaterThan(col('flick', a, 0));
      expect(col('precision', b, 4)).toBeLessThan(col('precision', a, 4));
      expect(col('precision', b, 2)).toBeGreaterThanOrEqual(col('precision', a, 2));
    }
  });
});

describe('the daily shuffle', () => {
  it('is 40 trials alternating flick and precision, 20 each', () => {
    const plan = buildBaselineSequence(1, LEVELS);
    expect(plan).toHaveLength(40);
    expect(plan.map((p) => p.skill)).toEqual(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'flick' : 'precision')));
  });

  it('two different seeds give different sequences with identical item statistics', () => {
    const a = buildBaselineSequence(11, LEVELS);
    const b = buildBaselineSequence(12, LEVELS);
    const key = (p: (typeof a)[number]): string => `${p.skill}:${p.item.index}:${p.item.side}`;
    expect(a.map(key)).not.toEqual(b.map(key));
    for (const skill of BASELINE_SKILLS) {
      const of = (plan: typeof a) => plan.filter((p) => p.skill === skill);
      const sa = of(a);
      const sb = of(b);
      // The same items (the stored list, each exactly once), in a different order.
      expect(sa.map((p) => p.item.index).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(sb.map((p) => p.item.index).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(sa.map((p) => p.item.index)).not.toEqual(sb.map((p) => p.item.index));
      // Identical statistics of every column, and half the items on each side.
      for (const f of ['angleDeg', 'pitchDeg', 'distance', 'scale', 'exposureSec'] as const) {
        const [ma, va] = stat(sa.map((p) => p.item[f]));
        const [mb, vb] = stat(sb.map((p) => p.item[f]));
        expect(ma).toBeCloseTo(mb, 9);
        expect(va).toBeCloseTo(vb, 9);
      }
      expect(sa.filter((p) => p.item.side === 1)).toHaveLength(10);
      expect(sb.filter((p) => p.item.side === 1)).toHaveLength(10);
      // Each item is a stored one.
      for (const p of sa) expect([p.item.angleDeg, p.item.pitchDeg, p.item.distance, p.item.scale, p.item.exposureSec]).toEqual([...BASELINE_ITEMS[skill][45]![p.item.index]!]);
    }
  });

  it('the same seed gives the same sequence, and mirroring differs between seeds', () => {
    expect(buildBaselineSequence(5, LEVELS)).toEqual(buildBaselineSequence(5, LEVELS));
    const sides = (seed: number): number[] => buildBaselineSequence(seed, LEVELS).map((p) => p.item.side);
    expect(sides(5)).not.toEqual(sides(6));
  });

  it('each skill runs at its own level', () => {
    const plan = buildBaselineSequence(3, { flick: 15, precision: 90 });
    const flick = plan.filter((p) => p.skill === 'flick');
    const post = plan.filter((p) => p.skill === 'precision');
    const rc = tunables.baseline.recipe;
    expect(flick[0]!.item.scale).toBeCloseTo(axisValue(rc.flick.beaconScale, 15), 3);
    expect(post[0]!.item.exposureSec).toBeCloseTo(axisValue(rc.precision.exposureSec, 90), 3);
  });
});
