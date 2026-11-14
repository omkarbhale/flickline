import { describe, expect, it } from 'vitest';
import { dial } from '../config/dial';
import { progress } from '../config/progress';
import { computeStats } from '../feedback/statTracker';
import type { RunLog } from '../feedback/eventLog';
import { bandOf, beatsBest, GhostPace, scoreOnCurve, ScoreCurve, summariseRun } from './bests';
import type { BestRecord } from './save';

describe('dial bands (design §8.4)', () => {
  it('are Chalk/Brass, Steel/Cobalt, Neon and Prism/Zenith', () => {
    const at = (name: string): number => dial.tiers.find((t) => t.name === name)!.from;
    expect(progress.bands.map((b) => b.id)).toEqual(['chalkBrass', 'steelCobalt', 'neon', 'prismZenith']);
    expect(progress.bands.map((b) => b.from)).toEqual([at('Chalk'), at('Steel'), at('Neon'), at('Prism')]);
  });

  it('put every dial value in exactly one band, boundaries going up', () => {
    expect(bandOf(0)).toBe('chalkBrass');
    expect(bandOf(27.99)).toBe('chalkBrass');
    expect(bandOf(28)).toBe('steelCobalt');
    expect(bandOf(57.9)).toBe('steelCobalt');
    expect(bandOf(58)).toBe('neon');
    expect(bandOf(71.9)).toBe('neon');
    expect(bandOf(72)).toBe('prismZenith');
    expect(bandOf(100)).toBe('prismZenith');
    expect(bandOf(-5)).toBe('chalkBrass');
    expect(bandOf(140)).toBe('prismZenith');
  });
});

describe('personal best rule', () => {
  const best = { score: 1000 } as BestRecord;
  it('beats only a higher score; a zero score never counts', () => {
    expect(beatsBest(1001, best)).toBe(true);
    expect(beatsBest(1000, best)).toBe(false);
    expect(beatsBest(999, best)).toBe(false);
    expect(beatsBest(1, null)).toBe(true);
    expect(beatsBest(0, null)).toBe(false);
    expect(beatsBest(1000.4, best)).toBe(false); // rounds to the stored integer
  });
});

describe('score curve', () => {
  it('samples the cumulative score once per second, flat between awards', () => {
    const c = new ScoreCurve(1, 100);
    c.record(0.5, 100);
    c.record(2.2, 250);
    c.record(2.9, 400);
    // t=0:0  t=1: 100  t=2: 100  t=3: 400 ... held to the end
    expect(c.finish(5)).toEqual([0, 100, 100, 400, 400, 400]);
  });

  it('starts at zero, handles an award at t=0 and a run that scored nothing, and resets', () => {
    const c = new ScoreCurve(1, 100);
    c.record(0, 50);
    expect(c.finish(2)).toEqual([0, 50, 50]);
    c.reset();
    expect(c.finish(2)).toEqual([0, 0, 0]);
  });

  it('never goes backwards and does not overflow its capacity', () => {
    const c = new ScoreCurve(1, 4);
    c.record(1, 300);
    c.record(2, 100); // a lower total (cannot happen, but must not lower the curve)
    c.record(9, 500);
    expect(c.finish(60)).toEqual([0, 300, 300, 300]); // an award at exactly t=1 is in sample 1
  });

  it('is read by linear interpolation, flat past the end', () => {
    const curve = [0, 100, 300];
    expect(scoreOnCurve(curve, 0)).toBe(0);
    expect(scoreOnCurve(curve, 0.5)).toBe(50);
    expect(scoreOnCurve(curve, 1)).toBe(100);
    expect(scoreOnCurve(curve, 1.25)).toBe(150);
    expect(scoreOnCurve(curve, 2)).toBe(300);
    expect(scoreOnCurve(curve, 99)).toBe(300);
    expect(scoreOnCurve(curve, -1)).toBe(0);
    expect(scoreOnCurve([], 3)).toBe(0);
  });
});

describe('ghost pace provider (the HUD bar)', () => {
  const best: BestRecord = {
    score: 600, seed: 1, date: 'd', dial: 50, curve: [0, 200, 400, 600],
    stats: { shots: 0, hits: 0, headHits: 0, kills: 0, movingShots: 0, accuracy: null, headshotRate: null, medianRtMs: null, medianTtkMs: null, maxChain: 0, cleanKills: 0 },
  };

  it('returns the best run\'s cumulative score at time t, and nothing without a best', () => {
    const g = new GhostPace(1);
    expect(g.scoreAt('orbit', 1)).toBeNull();
    g.arm('orbit', best);
    expect(g.scoreAt('orbit', 0)).toBe(0);
    expect(g.scoreAt('orbit', 1.5)).toBe(300);
    expect(g.scoreAt('orbit', 3)).toBe(600);
    expect(g.scoreAt('orbit', 60)).toBe(600);
  });

  it('only answers for the mode it was armed for, and clears', () => {
    const g = new GhostPace(1);
    g.arm('orbit', best);
    expect(g.scoreAt('coldStart', 1)).toBeNull();
    g.arm('orbit', null);
    expect(g.scoreAt('orbit', 1)).toBeNull();
    g.arm('orbit', best);
    g.clear();
    expect(g.scoreAt('orbit', 1)).toBeNull();
  });
});

describe('run summary', () => {
  it('keeps the numbers of a finished run and no duration, XP or time played', () => {
    const log: RunLog = { mode: 'orbit', seed: 9, dial: 61.5, events: [], truncated: false };
    const stats = computeStats(log);
    const s = summariseRun({ ...stats, endReason: 'timer' }, 1234.6, '2026-01-01T00:00:00.000Z', ['needle', 'needle', 'flawless']);
    expect(s).toMatchObject({ mode: 'orbit', seed: 9, dial: 61.5, reason: 'timer', score: 1235, medals: ['needle', 'flawless'], date: '2026-01-01T00:00:00.000Z' });
    expect(Object.keys(s).join(' ')).not.toMatch(/xp|time|duration|minutes|seconds/i);
  });
});
