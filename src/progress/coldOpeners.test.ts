import { describe, expect, it } from 'vitest';
import { coldOpener } from '../config/coldOpener';
import {
  buildColdRecord, coldTrend, nextColdLevel, readColdLevel, readColdRecord, readColdRecords, replayColdLevel, stepColdLevel, validMask,
  type ColdOpenerRecord,
} from './coldOpeners';

function rec(date: string, dial: number, over: Partial<ColdOpenerRecord> = {}): ColdOpenerRecord {
  return {
    v: coldOpener.version, date, at: `${date}T08:00:00.000Z`, gapH: 12, seed: 1, level: 45, legs: 6, of: 6, score: Math.round(dial * 30), dial,
    skills: { angles: [dial, 9, 4] }, trials: 6, contacts: 6, won: 4, headRate: 0.5, ttsMs: 600, movingShare: 0.1, kept: 0.8, warm: false, sens: 0.4,
    end: 'exit', ...over,
  };
}

describe('records', () => {
  it('reads back what it stores, and skips what is not a record', () => {
    const r = rec('2026-03-01', 50);
    expect(readColdRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(readColdRecord({ v: 2 })).toBeNull();
    expect(readColdRecord('x')).toBeNull();
    expect(readColdRecords([r, null, { date: 'no' }])).toHaveLength(1);
  });

  it('builds a record with its raw facts (design 8.5)', () => {
    const out = buildColdRecord(
      {
        version: 2, seed: 9, level: 30, legs: 5, of: 6, trials: [{ skill: 'angles', itemDifficulty: 30, success: true }], contacts: 5, won: 3,
        firstBulletHeads: 1, engaged: 4, ttsMs: [700, 300, 500], shots: 10, movingShots: 2, kept: 0.6543, end: 'death',
      },
      { skills: { angles: { mean: 41.234, sd: 12.5, n: 1 } }, dial: 41.234, score: 1237, trials: 1 },
      { date: '2026-03-02', at: '2026-03-02T07:00:00.000Z', gapH: 13.333, sens: 0.35 },
    );
    expect(out).toMatchObject({ level: 30, legs: 5, of: 6, won: 3, contacts: 5, headRate: 0.25, ttsMs: 500, movingShare: 0.2, kept: 0.654, end: 'death', gapH: 13.33, warm: false });
    expect(out.skills.angles).toEqual([41.23, 12.5, 1]);
  });

  it('counts for the trend only when current, not warm, with trials, and the first of its date', () => {
    const rs = [
      rec('2026-03-01', 50),
      rec('2026-03-01', 60), // second of the day
      rec('2026-03-02', 50, { warm: true }),
      rec('2026-03-03', 50, { v: 1 }),
      rec('2026-03-04', 50, { trials: 0 }),
      rec('2026-03-05', 50),
    ];
    expect(validMask(rs)).toEqual([true, false, false, false, false, true]);
  });
});

describe('levels (3 of the last 5 above 85% or below 35% contacts won)', () => {
  const won = (w: number, c = 6) => ({ won: w, contacts: c });
  it('moves up after 3 of 5 above 85%, down after 3 of 5 below 35%, else stays', () => {
    expect(nextColdLevel(45, [won(6), won(6), won(3), won(6)])).toBe(60);
    expect(nextColdLevel(45, [won(6), won(6), won(5)])).toBe(45); // 5/6 = 83% is not above 85%
    expect(nextColdLevel(45, [won(1), won(2), won(4), won(0)])).toBe(30);
    expect(nextColdLevel(90, [won(6), won(6), won(6)])).toBe(90);
    expect(nextColdLevel(15, [won(0), won(0), won(0)])).toBe(15);
  });

  it('only valid records at the level since its last move count, and each move is kept', () => {
    let s = { v: coldOpener.version, level: 45, moves: [] as { date: string; from: number; to: number }[] };
    const rs: ColdOpenerRecord[] = [];
    for (let d = 1; d <= 3; d++) {
      rs.push(rec(`2026-04-0${d}`, 55, { won: 6 }));
      s = stepColdLevel(s, rs);
    }
    expect(s.level).toBe(60);
    expect(s.moves).toEqual([{ date: '2026-04-03', from: 45, to: 60 }]);
    // The next ones are at 60: the 45 records no longer count.
    rs.push(rec('2026-04-04', 60, { level: 60, won: 6 }));
    s = stepColdLevel(s, rs);
    expect(s.level).toBe(60);
    // A warm record never moves the level.
    rs.push(rec('2026-04-05', 60, { level: 60, won: 6, warm: true }));
    expect(stepColdLevel(s, rs)).toBe(s);
  });

  it('replays the level from the series after an answer changed', () => {
    const rs = [1, 2, 3].map((d) => rec(`2026-05-0${d}`, 55, { won: 6 }));
    const moved = { v: coldOpener.version, level: 60, moves: [{ date: '2026-05-03', from: 45, to: 60 }] };
    rs[2]!.warm = true;
    expect(replayColdLevel(moved, rs).level).toBe(45);
  });

  it('a stored level of another version is not read', () => {
    expect(readColdLevel({ v: 1, level: 30, moves: [] }, 2)).toBeNull();
    expect(readColdLevel({ v: 2, level: 30, moves: [{ date: 'd', from: 15, to: 30 }] }, 2)?.moves).toHaveLength(1);
  });
});

describe('trend (design 8.5)', () => {
  const steady = [50, 52, 48, 51, 49, 50, 52, 48, 51, 49, 50, 50];
  it('says nothing before the minimum of valid cold openers', () => {
    expect(coldTrend(steady.slice(0, coldOpener.trend.minValid - 1)).verdict).toBe('none');
  });
  it('steady scores are Steady; a rise beyond the band is Improved, a fall Lower', () => {
    expect(coldTrend(steady).verdict).toBe('Steady');
    const rise = steady.map((x, i) => x + i * 2);
    expect(coldTrend(rise).verdict).toBe('Improved');
    expect(coldTrend(steady.map((x, i) => x - i * 2)).verdict).toBe('Lower');
  });
  it('the band is z·σ·√(2/k) with σ from successive differences', () => {
    const t = coldTrend(steady, { ...coldOpener, trend: { ...coldOpener.trend, confirm: false } });
    expect(t.k).toBe(Math.min(coldOpener.trend.kMax, Math.floor(steady.length / 2)));
    let ss = 0;
    for (let i = 1; i < steady.length; i++) ss += (steady[i]! - steady[i - 1]!) ** 2;
    const sigma = Math.sqrt(ss / (steady.length - 1) / 2);
    expect(t.sigma).toBeCloseTo(sigma, 9);
    expect(t.band).toBeCloseTo(coldOpener.trend.z * sigma * Math.sqrt(2 / t.k), 9);
  });
  it('with confirmation, the newest day alone cannot flip the verdict: the day before must agree', () => {
    const noConfirm = { ...coldOpener, trend: { ...coldOpener.trend, confirm: false } };
    const xs = steady.map((x, i) => x + 0.4 * i);
    expect(coldTrend(xs.slice(0, -1), noConfirm).verdict).toBe('Steady');
    expect(coldTrend(xs, noConfirm).verdict).toBe('Improved');
    expect(coldTrend(xs).verdict).toBe('Steady');
  });
});
