import { describe, expect, it } from 'vitest';
import { tier } from '../adaptive/dial';
import { dial } from '../config/dial';
import { progress } from '../config/progress';
import { stepRank, subTierInfo, subTierOf } from './ranks';
import type { RankEntry } from './save';

describe('sub-tiers', () => {
  it('number Chalk I = 0 ... Zenith = 18 and name themselves', () => {
    expect(subTierOf(0)).toBe(0);
    expect(subTierOf(13.9)).toBe(2); // Chalk III
    expect(subTierOf(14)).toBe(3); // Brass I
    expect(subTierOf(51)).toBe(subTierOf(42) + 1); // Cobalt (42-58) thirds: 42-47.3, 47.3-52.7: II
    expect(subTierOf(86)).toBe(18);
    expect(subTierOf(100)).toBe(18);
    expect(subTierInfo(0).label).toBe('Chalk I');
    expect(subTierInfo(subTierOf(51)).label).toBe('Cobalt II');
    expect(subTierInfo(18).label).toBe('Zenith');
    expect(subTierInfo(18).division).toBe(0);
    expect(dial.tiers.length).toBe(7);
  });

  it('agree with the tier table for every dial value', () => {
    for (let d = 0; d <= 100; d += 0.25) expect(subTierInfo(subTierOf(d)).label, `${d}`).toBe(tier(d).label);
  });
});

const start = (at: number): RankEntry => stepRank(null, at).entry;

describe('rank buffer (design §8.4)', () => {
  it('commits the first rating at once, with no medal for being placed', () => {
    const s = stepRank(null, 7);
    expect(s.entry).toMatchObject({ at: 7, peak: 7 });
    expect(s.moved).toBeNull();
    expect(s.ascent).toBe(false);
  });

  it('demotion needs two consecutive runs across the boundary', () => {
    let e = start(8);
    let s = stepRank(e, 7); // one run below
    expect(s.moved).toBeNull();
    expect(s.entry.at).toBe(8);
    e = s.entry;
    s = stepRank(e, 7); // the second
    expect(s.moved).toBe('down');
    expect(s.entry.at).toBe(7);
    expect(s.ascent).toBe(false);
  });

  it('one run below and then back on the rank does not demote, and the streak starts over', () => {
    let e = start(8);
    e = stepRank(e, 7).entry;
    e = stepRank(e, 8).entry; // back: streak cleared
    expect(e.down).toBe(0);
    let s = stepRank(e, 7);
    expect(s.moved).toBeNull();
    s = stepRank(s.entry, 8);
    expect(s.entry.at).toBe(8);
  });

  it('lands on the most lenient sub-tier of the streak, never overshooting', () => {
    let e = start(10);
    e = stepRank(e, 6).entry; // far below
    const s = stepRank(e, 9); // then just below: the rank drops one, not four
    expect(s.moved).toBe('down');
    expect(s.entry.at).toBe(9);
  });

  it('promotion is immediate by default, and an Ascent only for a new peak', () => {
    let s = stepRank(start(5), 6);
    expect(s).toMatchObject({ moved: 'up', ascent: true });
    expect(s.entry).toMatchObject({ at: 6, peak: 6 });
    // fall back (two runs), then climb again: promoted, but not a new peak
    let e = s.entry;
    e = stepRank(e, 5).entry;
    e = stepRank(e, 5).entry;
    expect(e.at).toBe(5);
    s = stepRank(e, 6);
    expect(s).toMatchObject({ moved: 'up', ascent: false });
    expect(s.entry.peak).toBe(6);
  });

  it('a promotion buffer is honoured when configured, and the same rating keeps the streak at zero', () => {
    const cfg = { ...progress, promoteAfterRuns: 2 };
    let s = stepRank(start(5), 6, cfg);
    expect(s.moved).toBeNull();
    s = stepRank(s.entry, 6, cfg);
    expect(s.moved).toBe('up');
    expect(stepRank(start(5), 5).entry).toMatchObject({ up: 0, down: 0 });
  });

  it('a jump of several sub-tiers promotes straight to the lowest of the streak', () => {
    const s = stepRank(start(2), 9);
    expect(s.entry.at).toBe(9);
    expect(s.ascent).toBe(true);
  });
});
