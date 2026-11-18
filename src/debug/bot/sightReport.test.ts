import { describe, expect, it } from 'vitest';
import { bySector, formatSightReport, HEIGHT_DIFF_M, LONG_M, quantile, sightStats, sweepReport, type FirstSight } from './sweepReport';

const s = (sector: string, distM: number, dy = 0): FirstSight => ({ sector, distM, dy });

describe('the first-sight block of the Sweep report (#249)', () => {
  it('quantiles interpolate between ranks and are 0 for nothing', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([4], 0.9)).toBe(4);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 9);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('counts the share of sightings beyond 20 m and the share across more than 1 m of height, either way', () => {
    expect(LONG_M).toBe(20);
    expect(HEIGHT_DIFF_M).toBe(1);
    const st = sightStats([s('a', 5), s('a', 10), s('a', 20), s('a', 21, 1.2), s('a', 30, -2)]);
    expect(st.n).toBe(5);
    expect(st.p50).toBe(20);
    expect(st.beyond20).toBeCloseTo(2 / 5, 9);
    expect(st.heightDiff).toBeCloseTo(2 / 5, 9);
    expect(sightStats([])).toMatchObject({ n: 0, p50: 0, beyond20: 0, heightDiff: 0 });
  });

  it('groups by sector, in name order', () => {
    const g = bySector([s('lane/b', 9), s('elbow/a', 12), s('lane/b', 21)]);
    expect(Object.keys(g)).toEqual(['elbow/a', 'lane/b']);
    expect(g['lane/b']!.n).toBe(2);
  });

  it('prints a percentile row per skill and a row per sector', () => {
    const rows = [{ skill: 50, sight: sightStats([s('x/y', 8), s('x/y', 22, 1.5)]), sightBySector: bySector([s('x/y', 8), s('x/y', 22, 1.5)]) }];
    const out = formatSightReport(rows as never);
    expect(out[0]).toContain('Beyond 20 m');
    expect(out[0]).toContain('Height difference above 1 m');
    expect(out[2]).toBe('| 50 | 2 | 9.4 / 11.5 / 15.0 / 18.5 / 20.6 | 50 % | 50 % |');
    expect(out.some((l) => l.startsWith('| x/y | 2 |'))).toBe(true);
  });

  it('the bot at default skill meets the distance target over 100 runs: a median of 12 to 15 m and at least a fifth of fights beyond 20 m, with fights across levels', () => {
    const { rows } = sweepReport([50], 100, 1);
    const sight = rows[0]!.sight;
    expect(sight.n).toBeGreaterThan(300);
    expect(sight.p50).toBeGreaterThanOrEqual(12);
    expect(sight.p50).toBeLessThanOrEqual(15);
    expect(sight.beyond20).toBeGreaterThanOrEqual(0.2);
    // the 1 m height difference of design's "crosshair placement across heights": a share of fights, not none
    expect(sight.heightDiff).toBeGreaterThanOrEqual(0.05);
    // every sector the run plays is reached
    expect(Object.keys(rows[0]!.sightBySector).length).toBeGreaterThanOrEqual(6);
  }, 180_000);
});
