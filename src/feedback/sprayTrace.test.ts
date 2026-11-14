import { describe, expect, it } from 'vitest';
import { collapseIndex, sprayHitRateByIndex, sprayPullErrorByIndex, type SprayBulletTrace, type SprayRecord } from './sprayTrace';

const bullet = (index: number, hit: boolean, pullY = 0, reqY = 0): SprayBulletTrace => ({
  index, tMs: index * 90, impactXDeg: 0, impactYDeg: 0, pullXDeg: 0, pullYDeg: pullY, requiredPullXDeg: 0, requiredPullYDeg: reqY,
  spreadDeg: 0.2, hit, zone: hit ? 'body' : null,
});
const spray = (hits: boolean[], burst = hits.length, pulls: [number, number][] = []): SprayRecord => ({
  index: 0, station: 's', distanceM: 12, burst, requiredFraction: 0.6, fired: hits.length, hits: hits.filter(Boolean).length,
  headHits: 0, bodyHits: 0, fraction: 0, success: true, reason: 'burst',
  trace: hits.map((h, i) => bullet(i, h, pulls[i]?.[0] ?? 0, pulls[i]?.[1] ?? 0)),
});

describe('spray trace helpers', () => {
  it('hit rate per bullet index counts bullets never fired as misses and skips indices no burst reached', () => {
    const r = sprayHitRateByIndex([spray([true, true, false]), spray([true, false, false, false], 4), spray([true], 3)]);
    expect(r).toEqual([1, 1 / 3, 0, 0]);
    expect(sprayHitRateByIndex([])).toEqual([]);
  });

  it('pull error per index is the mean absolute vertical difference between pull and required pull', () => {
    const r = sprayPullErrorByIndex([spray([true, true], 2, [[0, 0], [-0.5, -1]]), spray([true], 2, [[0, 0]])]);
    expect(r).toEqual([0, 0.5]);
  });

  it('collapse index is where the trailing run beyond the limit starts; a recovery or no data means null', () => {
    expect(collapseIndex([1, 0.9, 0.4, 0.2, 0.1], 0.5, true)).toBe(2);
    expect(collapseIndex([1, 0.2, 0.9, 0.3], 0.5, true)).toBe(3);
    expect(collapseIndex([1, 0.9, 0.8], 0.5, true)).toBeNull();
    expect(collapseIndex([0.1, 0.2, 0.9, null], 0.5, true)).toBeNull();
    expect(collapseIndex([0.1, 0.2, 0.9, 1.4], 0.5, false)).toBe(2);
    expect(collapseIndex([], 0.5, true)).toBeNull();
  });
});
