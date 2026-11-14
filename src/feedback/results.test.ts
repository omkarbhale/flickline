import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { results as cfg } from '../config/results';
import { displayRating } from '../adaptive/dial';
import type { RunLog } from './eventLog';
import type { RunStats, TargetStat } from './statTracker';
import {
  buildCard, DASH, fill, formatDelta, formatThousands, nextSeed, pickFix, ResultsRecorder, shotSplit,
  statCells, timeToShotBaselineMs, type ResultsEvents, type ShotSplit,
} from './results';

function target(p: Partial<TargetStat> = {}): TargetStat {
  return {
    id: 1, kind: 'post', visibleTick: 0, rtMs: 500, ttkMs: 300, bullets: 1, hits: 1, misses: 0, movingShots: 0,
    killed: true, expired: false, firstBullet: true, clean: true, zone: 'head', preAimDeg: 5, flickErrorDeg: null, armoured: false, ...p,
  };
}

function stats(p: Partial<RunStats> = {}): RunStats {
  return {
    mode: 'coldStart', seed: 7, dial: 50, endReason: 'timer', liveTicks: 7680, durationSec: 60,
    shots: 50, hits: 30, misses: 20, headHits: 12, bodyHits: 16, legHits: 2, kills: 10, cleanKills: 6, movingShots: 2,
    accuracy: 0.6, headshotRate: 0.4, medianRtMs: 620, medianTtkMs: 410, timeOnTarget: 0.31,
    medianStopLatencyMs: null, stopCount: 0, preAimErrorDeg: 6.24, headHeightDisciplineDeg: null, headHeightSamples: 0,
    flickErrorBiasDeg: null, flickErrorMeanAbsDeg: null, flickCount: 0, maxChain: 3, maxCleanStreak: 4, cleanStreak: 1,
    targets: [target(), target({ id: 2, firstBullet: false }), target({ id: 3 }), target({ id: 4, bullets: 0, killed: false, rtMs: null })],
    sprayBursts: [],
    ...p,
  };
}

const emptyStats = (): RunStats =>
  stats({
    shots: 0, hits: 0, misses: 0, headHits: 0, bodyHits: 0, legHits: 0, kills: 0, cleanKills: 0, movingShots: 0,
    accuracy: null, headshotRate: null, medianRtMs: null, medianTtkMs: null, timeOnTarget: null, preAimErrorDeg: null,
    maxChain: 0, maxCleanStreak: 0, cleanStreak: 0, targets: [],
  });

describe('formatting', () => {
  it('groups thousands and signs deltas with a real minus', () => {
    expect(formatThousands(1234567)).toBe('1,234,567');
    expect(formatThousands(999)).toBe('999');
    expect(formatDelta(14)).toBe('+14');
    expect(formatDelta(-3.4)).toBe('−3');
    expect(formatDelta(0.2)).toBe('±0');
  });
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('{a} of {b} {c}', { a: 1, b: 'x' })).toBe('1 of x {c}');
  });
});

describe('nextSeed', () => {
  it('is deterministic, changes the seed and stays a uint32', () => {
    expect(nextSeed(7)).toBe(nextSeed(7));
    expect(nextSeed(7)).not.toBe(7);
    let s = 1;
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      s = nextSeed(s);
      expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
      seen.add(s);
    }
    expect(seen.size).toBe(1000);
  });
});

describe('shotSplit', () => {
  it('counts shots and hits by the moving flag set at fire time', () => {
    const fired = (shotId: number, moving: boolean) => ({ type: 'shotFired' as const, data: { shotId, moving } as never });
    const impact = (shotId: number, result: 'hit' | 'miss') => ({ type: 'shotImpact' as const, data: { shotId, result } as never });
    const log: RunLog = {
      mode: 'x', seed: 1, dial: 50, truncated: false,
      events: [fired(1, true), impact(1, 'miss'), fired(2, true), impact(2, 'hit'), fired(3, false), impact(3, 'hit'), fired(4, false)],
    };
    expect(shotSplit(log)).toEqual<ShotSplit>({ movingShots: 2, movingHits: 1, stoppedShots: 2, stoppedHits: 1 });
  });
});

describe('pickFix (the #26 stub)', () => {
  const split: ShotSplit = { movingShots: 11, movingHits: 3, stoppedShots: 39, stoppedHits: 29 };

  it('flags moving shots above 15% of shots, with the moving-vs-stopped hit rates', () => {
    const f = pickFix(stats({ movingShots: 11, shots: 50 }), split);
    expect(f.kind).toBe('movingShots');
    expect(f.evidence).toContain('22%');
    expect(f.evidence).toContain('11 of 50');
    expect(f.evidence).toContain('27%'); // 3/11 moving
    expect(f.evidence).toContain('74%'); // 29/39 stopped
    expect(f.evidence).not.toContain('{');
  });

  it('does not flag exactly 15%', () => {
    expect(pickFix(stats({ movingShots: 6, shots: 40 }), null).kind).not.toBe('movingShots');
  });

  it('falls back to a sentence without the comparison when there is nothing to compare', () => {
    const f = pickFix(stats({ movingShots: 40, shots: 50 }), { movingShots: 40, movingHits: 5, stoppedShots: 0, stoppedHits: 0 });
    expect(f.kind).toBe('movingShots');
    expect(f.evidence).not.toContain('{');
    expect(f.evidence).toContain('80%');
  });

  it('flags a slow median time to shot against the dial baseline', () => {
    const base = timeToShotBaselineMs(50);
    expect(base).toBeCloseTo(700, 5);
    const f = pickFix(stats({ medianRtMs: base * 1.5, movingShots: 0 }), null);
    expect(f.kind).toBe('slowTimeToShot');
    expect(f.evidence).toContain(`${Math.round(base * 1.5)} ms`);
    expect(f.evidence).not.toContain('{');
    expect(pickFix(stats({ medianRtMs: base * 1.1, movingShots: 0 }), null).kind).toBe('placeholder');
  });

  it('needs enough timed targets before calling the time to shot slow', () => {
    const one = [target()];
    expect(pickFix(stats({ medianRtMs: 2000, movingShots: 0, targets: one }), null).kind).toBe('placeholder');
  });

  it('picks the clearer weakness when both apply, and Play again otherwise', () => {
    const both = pickFix(stats({ medianRtMs: 710 * 1.3, movingShots: 40 }), null); // rt just over, moving far over
    expect(both.kind).toBe('movingShots');
    const slowWins = pickFix(stats({ medianRtMs: 3000, movingShots: 8 }), null);
    expect(slowWins.kind).toBe('slowTimeToShot');
    const ok = pickFix(stats(), null);
    expect(ok.kind).toBe('placeholder');
    expect(ok.title).toBe('Play again');
  });

  it('says so on an empty run and stays quiet on a tiny one', () => {
    expect(pickFix(emptyStats(), null).evidence).toBe(cfg.copy.empty.evidence);
    expect(pickFix(stats({ shots: 3, hits: 1, movingShots: 3 }), null).kind).toBe('placeholder');
  });
});

describe('statCells', () => {
  it('lists the headline stats then the mode key metrics, with a dash for undefined values', () => {
    const cells = statCells(emptyStats());
    expect(cells.map((c) => c.id)).toEqual(['accuracy', 'headshotRate', 'timeToShot', 'ttk', 'movingShots', 'kills', 'firstShotRate', 'preAimError']);
    const byId = Object.fromEntries(cells.map((c) => [c.id, c.value]));
    for (const id of ['accuracy', 'headshotRate', 'timeToShot', 'ttk', 'movingShots', 'firstShotRate', 'preAimError']) expect(byId[id]).toBe(DASH);
    expect(byId.kills).toBe('0');
  });

  it('formats a real run', () => {
    const byId = Object.fromEntries(statCells(stats()).map((c) => [c.id, c]));
    expect(byId.accuracy!.value).toBe('60%');
    expect(byId.accuracy!.hint).toBe('30 of 50 shots');
    expect(byId.headshotRate!.value).toBe('40%');
    expect(byId.timeToShot!.value).toBe('620 ms');
    expect(byId.ttk!.value).toBe('410 ms');
    expect(byId.movingShots!.value).toBe('2');
    expect(byId.movingShots!.hint).toBe('4% of shots');
    expect(byId.firstShotRate!.value).toBe('67%'); // 2 of 3 engaged targets
    expect(byId.firstShotRate!.hint).toBe('of 3 targets');
    expect(byId.preAimError!.value).toBe('6.2°');
  });

  it('shows the mode specific pair and signs the flick bias', () => {
    const o = statCells(stats({ mode: 'orbit', flickErrorBiasDeg: 2.34, flickErrorMeanAbsDeg: 3.1, flickCount: 9 }));
    expect(o.slice(6).map((c) => c.id)).toEqual(['flickBias', 'flickError']);
    expect(o[6]!.value).toBe('+2.3°');
    expect(o[6]!.hint).toBe('you overshoot');
    expect(statCells(stats({ mode: 'orbit', flickErrorBiasDeg: -1.2 }))[6]!.hint).toBe('you undershoot');
  });
});

describe('buildCard', () => {
  const input = (p: Partial<Parameters<typeof buildCard>[0]> = {}) => ({
    stats: stats(), split: null, score: 12345, rating: null, pb: null, medals: [] as string[], ...p,
  });

  it('shows a dash for the PB delta without a PB, and tones the delta with one', () => {
    expect(buildCard(input()).pbText).toBe(DASH);
    expect(buildCard(input()).pbTone).toBe('none');
    expect(buildCard(input({ pb: 12000 }))).toMatchObject({ pbText: '+345', pbTone: 'good' });
    expect(buildCard(input({ pb: 13000 }))).toMatchObject({ pbText: '−655', pbTone: 'bad' });
    expect(buildCard(input({ pb: 12345 }))).toMatchObject({ pbText: '±0', pbTone: 'even' });
    expect(buildCard(input({ score: null, pb: 5 })).pbText).toBe(DASH);
  });

  it('formats the score and shows a dash for a run that does not score', () => {
    expect(buildCard(input()).score).toBe('12,345');
    expect(buildCard(input({ score: null })).score).toBe(DASH);
  });

  it('builds the rating row in display points with tier and progress', () => {
    const c = buildCard(input({ rating: { skill: 'precision', before: 40, after: 43.5 } }));
    const r = c.rating!;
    expect(r.before).toBe(displayRating(40));
    expect(r.after).toBe(displayRating(43.5));
    expect(r.delta).toBe(r.after - r.before);
    expect(r.deltaText).toBe('+105');
    expect(r.tone).toBe('good');
    expect(r.beforeTier).toBe('Steel III');
    expect(r.afterTier).toBe('Cobalt I');
    expect(r.tierShift).toBe('up');
    expect(r.progress).toBeGreaterThanOrEqual(0);
    expect(r.progress).toBeLessThanOrEqual(1);
    expect(r.skill).toBe('Precision');
    expect(buildCard(input({ rating: { skill: 'line', before: 50, after: 49 } })).rating).toMatchObject({ skill: 'Line rating', tone: 'bad', tierShift: 'same' });
    expect(buildCard(input()).rating).toBeNull();
  });

  it('knows the top tier has no next division', () => {
    const r = buildCard(input({ rating: { skill: 'flick', before: 95, after: 96 } })).rating!;
    expect(r.afterTier).toBe('Zenith');
    expect(r.progressText).toBe('Top tier');
  });

  it('lists medals with counts and labels', () => {
    const c = buildCard(input({ medals: ['needle', 'needle', 'someNewMedal'] }));
    expect(c.medals).toEqual([
      { id: 'needle', label: 'Needle', count: 2 },
      { id: 'someNewMedal', label: 'Some New Medal', count: 1 },
    ]);
    expect(buildCard(input()).medals).toEqual([]);
  });

  it('marks an empty run and labels the mode and ending', () => {
    const c = buildCard(input({ stats: emptyStats(), score: 0 }));
    expect(c.empty).toBe(true);
    expect(c.modeLabel).toBe('Cold Start');
    expect(c.endLabel).toBe("Time's up");
    expect(c.fix.evidence).toBe(cfg.copy.empty.evidence);
    expect(buildCard(input({ stats: stats({ mode: 'my-new_mode' }) })).modeLabel).toBe('My New Mode');
  });
});

describe('ResultsRecorder', () => {
  function setup(skill: 'precision' | 'line' | null) {
    const bus = new EventBus<ResultsEvents>();
    let rating = 40;
    const cards: unknown[] = [];
    let newRuns = 0;
    const s = stats();
    const rec = new ResultsRecorder({
      bus,
      run: { log: { mode: 'coldStart', seed: 7, dial: 50, events: [], truncated: false }, liveStats: () => s },
      ratings: { rating: () => rating },
      skillOf: () => skill,
      pb: { best: () => 10000 },
      onCard: (c) => cards.push(c),
      onNewRun: () => newRuns++,
    });
    return { bus, rec, cards, setRating: (r: number) => (rating = r), newRuns: () => newRuns };
  }

  it('builds one card at runEnded from the score, medals and the rating before and after', () => {
    const { bus, rec, cards, setRating, newRuns } = setup('precision');
    bus.emit('runReady', { tick: 0, mode: 'coldStart', seed: 7, dial: 50 });
    expect(newRuns()).toBe(1);
    bus.emit('scoreAwarded', { total: 100 });
    bus.emit('scoreAwarded', { total: 250 });
    bus.emit('medalAwarded', { tick: 5, id: 'needle' });
    setRating(41);
    expect(cards).toHaveLength(0);
    bus.emit('runEnded', { tick: 9, t: 60, reason: 'timer' });
    expect(cards).toHaveLength(1);
    const c = rec.last!;
    expect(c.scoreValue).toBe(250);
    expect(c.pbText).toBe('−9,750');
    expect(c.medals.map((m) => m.id)).toEqual(['needle']);
    expect(c.rating).toMatchObject({ before: displayRating(40), after: displayRating(41), skill: 'Precision' });
  });

  it('resets between runs and reports no score or rating for a plain run', () => {
    const { bus, rec } = setup(null);
    bus.emit('runReady', { tick: 0, mode: 'freeplay', seed: 1, dial: 50 });
    bus.emit('scoreAwarded', { total: 999 });
    bus.emit('runEnded', { tick: 9, t: 5, reason: 'quit' });
    expect(rec.last!.rating).toBeNull();
    bus.emit('runReady', { tick: 0, mode: 'freeplay', seed: 2, dial: 50 });
    expect(rec.last).toBeNull();
    bus.emit('runEnded', { tick: 9, t: 5, reason: 'quit' });
    expect(rec.last!.scoreValue).toBeNull();
    expect(rec.last!.score).toBe(DASH);
  });
});
