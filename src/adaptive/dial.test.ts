import { describe, expect, it } from 'vitest';
import { cloneTunables, tunables } from '../config/tunables';
import { axes, axisValue, displayRating, isFairSpawn, tier } from './dial';

const cfg = tunables.dial;

describe('axes (design §9.4)', () => {
  it('hits the table end points at dial 0 and 100', () => {
    const a0 = axes(0);
    const a100 = axes(100);
    for (const key of Object.keys(cfg.axes) as (keyof typeof cfg.axes)[]) {
      expect(a0[key], `${key} @0`).toBeCloseTo(cfg.axes[key].at0, 9);
      expect(a100[key], `${key} @100`).toBeCloseTo(cfg.axes[key].at100, 9);
    }
    // The research values adopted in #130 (#12 P5/P6, #52 R8).
    expect(a0.beaconScale).toBe(3);
    expect(a100.distance).toBe(35);
    expect(a0.exposureSec).toBe(3);
    expect(a100.exposureSec).toBeCloseTo(0.45, 9);
    expect(a100.flickMinDeg).toBe(60);
    expect(a100.flickMaxDeg).toBe(120);
    expect(a100.orbitExposureSec).toBeCloseTo(1.6, 9);
    expect(a100.coldStartExposureSec).toBeCloseTo(1.35, 9);
    expect(a100.stopAndPopExposureSec).toBeCloseTo(0.7, 9);
    expect(a100.peekWideSec).toBeCloseTo(0.45, 9);
    expect(a100.strafeLegSec).toBeCloseTo(0.35, 9);
    expect(a100.standStillSec).toBeCloseTo(0.25, 9);
    expect(a0.strafeLimitSec).toBeCloseTo(8, 9);
    expect(a100.strafeLimitSec).toBeCloseTo(3, 9);
    expect(a0.tellSec).toBeCloseTo(0.7, 9);
    expect(a100.tellSec).toBeCloseTo(0.3, 9);
  });

  it('interpolates linear, geometric and step axes', () => {
    expect(axes(50).strafeSpeed).toBeCloseTo(3.7, 9);
    // geometric: the midpoint is the geometric mean
    expect(axes(50).distance).toBeCloseTo(Math.sqrt(5 * 35), 9);
    expect(axes(50).exposureSec).toBeCloseTo(Math.sqrt(3 * 0.45), 9);
    // density 1..6 in six equal bands
    expect([0, 16, 17, 34, 50, 67, 84, 99.9, 100].map((d) => axes(d).density)).toEqual([1, 1, 2, 3, 4, 5, 6, 6, 6]);
  });

  it('clamps the dial and writes into a reused object', () => {
    const out = axes(50);
    expect(axes(-20, out)).toBe(out);
    expect(out.distance).toBe(5);
    expect(axes(250, out).distance).toBe(35);
    expect(axisValue({ at0: 2, at100: 4, curve: 'linear' }, Number.NaN)).toBeNaN();
  });
});

describe('fairness floors (design §9.3.5)', () => {
  it('hold at every dial with the shipped numbers', () => {
    for (let d = 0; d <= 100; d += 0.5) {
      const a = axes(d);
      expect(a.tellSec).toBeGreaterThanOrEqual(0.25);
      expect(a.exposureSec).toBeGreaterThanOrEqual(0.45);
      expect(a.peekWideSec).toBeGreaterThanOrEqual(0.45);
      expect(a.orbitExposureSec).toBeGreaterThanOrEqual(1.25);
      expect(a.coldStartExposureSec).toBeGreaterThanOrEqual(0.8);
      expect(a.stopAndPopExposureSec).toBeGreaterThanOrEqual(0.55);
      expect(a.enemyReactionSec).toBeGreaterThanOrEqual(0.25);
      expect(a.beaconScale).toBeGreaterThanOrEqual(1);
    }
  });

  it('hold even when the end points are tuned past them', () => {
    const c = cloneTunables().dial;
    c.axes.tellSec.at100 = 0.05;
    c.axes.exposureSec.at100 = 0.1;
    c.axes.peekWideSec.at100 = 0.1;
    c.axes.orbitExposureSec.at100 = 0.1;
    c.axes.coldStartExposureSec.at100 = 0.1;
    c.axes.stopAndPopExposureSec.at100 = 0.1;
    c.axes.enemyReactionSec.at100 = 0.1;
    c.axes.beaconScale.at100 = 0.5;
    const a = axes(100, undefined, c);
    expect(a.tellSec).toBe(0.25);
    expect(a.exposureSec).toBe(0.45);
    expect(a.peekWideSec).toBe(0.45);
    expect(a.orbitExposureSec).toBe(1.25);
    expect(a.coldStartExposureSec).toBe(0.8);
    expect(a.stopAndPopExposureSec).toBe(0.55);
    expect(a.enemyReactionSec).toBe(0.25);
    expect(a.beaconScale).toBe(1);
    // above the floor the mapping is untouched
    expect(axes(0, undefined, c).tellSec).toBe(0.7);
  });

  it('forbids spawns closer than 4 m anywhere and closer than 5 m inside the view cone (#12 P6)', () => {
    expect(isFairSpawn(120, 3.9)).toBe(false); // behind the player is no safer at point-blank range
    expect(isFairSpawn(120, 4)).toBe(true);
    expect(isFairSpawn(10, 4.5)).toBe(false);
    expect(isFairSpawn(-51, 4.9)).toBe(false);
    expect(isFairSpawn(-52, 4.9)).toBe(true); // just outside the ±51.5° cone (half the 103° FOV)
    expect(isFairSpawn(10, 5)).toBe(true);
  });
});

describe('tiers (design §8.4)', () => {
  it('maps dial bands to tiers and ascending divisions', () => {
    expect(tier(0).label).toBe('Chalk I');
    expect(tier(13.9).label).toBe('Chalk III');
    expect(tier(14).label).toBe('Brass I');
    expect(tier(51).label).toBe('Cobalt II');
    expect(tier(57.9).label).toBe('Cobalt III');
    expect(tier(58).label).toBe('Neon I');
    expect(tier(85.9).label).toBe('Prism III');
    expect(tier(86).label).toBe('Zenith');
    expect(tier(86).division).toBe(0);
    expect(tier(100).progress).toBe(1);
  });

  it('reports progress through the sub-tier', () => {
    expect(tier(42).progress).toBeCloseTo(0, 9);
    expect(tier(42 + 16 / 6).progress).toBeCloseTo(0.5, 9);
    expect(tier(93).progress).toBeCloseTo(0.5, 9);
  });

  it('shows ratings on the 0–3000 scale', () => {
    expect(displayRating(51)).toBe(1530);
    expect(displayRating(120)).toBe(3000);
  });
});
