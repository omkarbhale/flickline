import { describe, expect, it } from 'vitest';
import { coldOpener } from '../config/coldOpener';
import { coldScore, flatPriorEstimate } from './coldScore';

const tr = (skill: string, d: number, success: boolean) => ({ skill, itemDifficulty: d, success });

describe('flat-prior estimate (design 8.5)', () => {
  it('with no trial is the flat prior itself: mean 50, s.d. of a uniform over 0..100', () => {
    const e = flatPriorEstimate([], null);
    expect(e.mean).toBeCloseTo(50, 5);
    expect(e.sd).toBeCloseTo(100 / Math.sqrt(12), 0);
    expect(e.n).toBe(0);
  });

  it('is symmetric: as many wins as losses at d puts the mean at d', () => {
    const e = flatPriorEstimate([tr('angles', 45, true), tr('angles', 45, false), tr('angles', 45, true), tr('angles', 45, false)], null);
    expect(e.mean).toBeCloseTo(45, 0);
  });

  it('moves up with wins and down with losses, and narrows with trials', () => {
    const win = flatPriorEstimate([tr('a', 50, true), tr('a', 50, true), tr('a', 50, false)], null);
    const lose = flatPriorEstimate([tr('a', 50, false), tr('a', 50, false), tr('a', 50, true)], null);
    expect(win.mean).toBeGreaterThan(50);
    expect(lose.mean).toBeLessThan(50);
    const many = flatPriorEstimate(Array.from({ length: 40 }, (_, i) => tr('a', 50, i % 2 === 0)), null);
    expect(many.sd).toBeLessThan(win.sd);
  });

  it('reads only the named skill when one is given', () => {
    const ts = [tr('angles', 30, true), tr('precision', 30, false)];
    expect(flatPriorEstimate(ts, 'angles').n).toBe(1);
    expect(flatPriorEstimate(ts, 'angles').mean).toBeGreaterThan(flatPriorEstimate(ts, 'precision').mean);
  });
});

describe('cold score', () => {
  it('is the mean of the per-skill estimates on the rating scale (x30), with each skill recorded', () => {
    const ts = [tr('angles', 45, true), tr('angles', 45, false), tr('precision', 45, true), tr('precision', 45, false)];
    const s = coldScore(ts, coldOpener);
    expect(Object.keys(s.skills)).toEqual(['angles', 'precision']);
    expect(s.dial).toBeCloseTo((s.skills.angles!.mean + s.skills.precision!.mean) / 2, 6);
    expect(s.score).toBe(Math.round(s.dial * 30));
    expect(s.trials).toBe(4);
  });

  it('pooled: one estimate over every trial', () => {
    const ts = [tr('angles', 45, true), tr('precision', 45, true), tr('precision', 45, false)];
    const s = coldScore(ts, { ...coldOpener, aggregate: 'pooled' });
    expect(s.dial).toBeCloseTo(flatPriorEstimate(ts, null).mean, 6);
  });

  it('without trials there is no score', () => {
    expect(Number.isNaN(coldScore([]).dial)).toBe(true);
  });
});
