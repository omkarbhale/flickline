import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { results as cfg } from '../config/results';
import { cloneTunables } from '../config/tunables';
import { leanView } from '../modes/lean';
import { displayRating } from '../adaptive/dial';
import type { RunLog } from './eventLog';
import type { RunStory } from './runStory';
import type { RunStats, TargetStat } from './statTracker';
import {
  buildCard, DASH, depthLabel, fill, formatDelta, formatThousands, nextSeed, pickFix, ResultsRecorder, shotSplit,
  statCells, timeToShotBaselineMs, type ResultsEvents, type ShotSplit,
} from './results';

const tunables = cloneTunables();

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
    leadErrorBiasDeg: null, leadErrorMeanAbsDeg: null, leadSamples: 0,
    flickErrorBiasDeg: null, flickErrorMeanAbsDeg: null, flickCount: 0, maxChain: 3, maxCleanStreak: 4, cleanStreak: 1,
    targets: [target(), target({ id: 2, firstBullet: false }), target({ id: 3 }), target({ id: 4, bullets: 0, killed: false, rtMs: null })],
    sprayBursts: [], sprays: [], sprayHitRateByIndex: [], sprayPullErrorByIndex: [], sprayCollapseIndex: null, sprayPullFallsApartIndex: null,
    sectorsReached: 0, sectorsTotal: 0, sectorsCleared: 0, contactsWon: 0, contactsLost: 0,
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
    expect(cells.map((c) => c.id)).toEqual(['accuracy', 'headshotRate', 'timeToShot', 'cleanStreak', 'movingShots', 'kills', 'firstShotRate', 'preAimError']);
    const byId = Object.fromEntries(cells.map((c) => [c.id, c.value]));
    for (const id of ['accuracy', 'headshotRate', 'timeToShot', 'cleanStreak', 'movingShots', 'firstShotRate', 'preAimError']) expect(byId[id]).toBe(DASH);
    expect(byId.kills).toBe('0');
  });

  it('formats a real run', () => {
    const byId = Object.fromEntries(statCells(stats()).map((c) => [c.id, c]));
    expect(byId.accuracy!.value).toBe('60%');
    expect(byId.accuracy!.hint).toBe('30 of 50 shots');
    expect(byId.headshotRate!.value).toBe('40%');
    expect(byId.timeToShot!.value).toBe('620 ms');
    expect(byId.ttk).toBeUndefined(); // Cold Start's kills are one bullet: the tile is the clean streak instead
    expect(byId.cleanStreak!.value).toBe('4');
    expect(Object.fromEntries(statCells(stats({ mode: 'strafeTrack' })).map((c) => [c.id, c])).ttk!.value).toBe('410 ms');
    expect(byId.movingShots!.value).toBe('2');
    expect(byId.movingShots!.hint).toBe('4% of shots');
    expect(byId.firstShotRate!.value).toBe('67%'); // 2 of 3 engaged targets
    expect(byId.firstShotRate!.hint).toBe('of 3 targets');
    expect(byId.preAimError!.value).toBe('6.2°');
  });

  it('swaps the meaningless time to kill for the clean streak in one-bullet modes (#175)', () => {
    for (const mode of ['coldStart', 'orbit', 'placement']) {
      const ids = statCells(stats({ mode, maxCleanStreak: 7 })).map((c) => c.id);
      expect(ids).not.toContain('ttk');
      expect(ids.slice(0, 6)).toEqual(['accuracy', 'headshotRate', 'timeToShot', 'cleanStreak', 'movingShots', 'kills']);
    }
    const streak = statCells(stats({ mode: 'coldStart', maxCleanStreak: 7, kills: 12 })).find((c) => c.id === 'cleanStreak')!;
    expect(streak.value).toBe('7');
    expect(statCells(stats({ mode: 'coldStart', kills: 0 })).find((c) => c.id === 'cleanStreak')!.value).toBe(DASH);
    expect(statCells(stats({ mode: 'strafeTrack' })).map((c) => c.id)).toContain('ttk');
  });

  it('shows the mode specific pair and signs the flick bias', () => {
    const o = statCells(stats({ mode: 'orbit', flickErrorBiasDeg: 2.34, flickErrorMeanAbsDeg: 3.1, flickCount: 9 }));
    expect(o.slice(6).map((c) => c.id)).toEqual(['flickBias', 'flickError']);
    expect(o[6]!.value).toBe('+2.3°');
    expect(o[6]!.hint).toBe('you overshoot');
    expect(statCells(stats({ mode: 'orbit', flickErrorBiasDeg: -1.2 }))[6]!.hint).toBe('you undershoot');
  });

  it('Strafe Track shows time on target and the signed lead error (+ ahead of the target, - behind it)', () => {
    const s = statCells(stats({ mode: 'strafeTrack', timeOnTarget: 0.42, leadErrorBiasDeg: 0.84, leadErrorMeanAbsDeg: 1.1, leadSamples: 120 }));
    expect(s.slice(6).map((c) => c.id)).toEqual(['timeOnTarget', 'leadError']);
    expect(s[6]!.value).toBe('42%');
    expect(s[7]!.value).toBe('+0.8°');
    expect(s[7]!.hint).toBe('you lead the target');
    const lag = statCells(stats({ mode: 'strafeTrack', leadErrorBiasDeg: -1.46, leadSamples: 50 }))[7]!;
    expect(lag.value).toBe('−1.5°');
    expect(lag.hint).toBe('you lag behind');
    expect(statCells(stats({ mode: 'strafeTrack', leadErrorBiasDeg: 0.2, leadSamples: 50 }))[7]!.hint).toBe('on the line');
    const none = statCells(stats({ mode: 'strafeTrack' }))[7]!;
    expect(none.value).toBe('—');
    expect(none.hint).toBe('');
  });
});

describe('buildCard', () => {
  const input = (p: Partial<Parameters<typeof buildCard>[0]> = {}) => ({
    stats: stats(), split: null, score: 12345, rating: null, pb: null, medals: [] as string[], ...p,
  });

  it('marks a clean run so the card can say the cues were off (design §7.4)', () => {
    expect(buildCard(input()).clean).toBe(false);
    expect(buildCard(input({ clean: true })).clean).toBe(true);
  });

  it('says "New personal best" on the run that sets the first one, and never on one that cannot (#175)', () => {
    expect(buildCard(input({ pb: null }))).toMatchObject({ pbKind: 'first', pbLabel: 'New personal best', pbTone: 'good' });
    expect(buildCard(input({ pb: null, stats: stats({ endReason: 'quit' }) })).pbLabel).toBe('');
    expect(buildCard(input({ pb: null, score: 0 })).pbLabel).toBe('');
    expect(buildCard(input({ pb: null, score: null })).pbLabel).toBe('');
    expect(buildCard(input({ pb: null, keepsBest: false })).pbLabel).toBe('');
  });

  it('labels a beaten best with the margin, and a missed one with the gap', () => {
    expect(buildCard(input({ pb: 12000 }))).toMatchObject({ pbKind: 'beat', pbLabel: 'New personal best +345' });
    expect(buildCard(input({ pb: 13000 }))).toMatchObject({ pbKind: 'none', pbLabel: '−655 vs personal best' });
    expect(buildCard(input({ pb: 12345 })).pbLabel).toBe('±0 vs personal best');
    expect(buildCard(input({ pb: 12000, stats: stats({ endReason: 'quit' }) })).pbKind).toBe('none');
  });

  it('the Daily Route compares with the day best instead of the run best, and the header names its day (#208)', () => {
    const day = (p: Partial<Parameters<typeof buildCard>[0]> = {}) => input({ stats: stats({ mode: 'sweep' }), daily: '2026-11-15', ...p });
    expect(buildCard(day({ pb: null }))).toMatchObject({ pbKind: 'first', pbLabel: 'New day best', daily: '2026-11-15', modeLabel: 'Daily Route · Sun 15 Nov' });
    expect(buildCard(day({ pb: 12000 }))).toMatchObject({ pbKind: 'beat', pbLabel: 'New day best +345' });
    expect(buildCard(day({ pb: 13000 }))).toMatchObject({ pbKind: 'none', pbLabel: '−655 vs day best' });
    // An ordinary Sweep run keeps the run best and no date; a drill never claims a daily.
    expect(buildCard(input({ stats: stats({ mode: 'sweep' }), pb: 13000 }))).toMatchObject({ pbLabel: '−655 vs best run', daily: null });
    expect(buildCard(input({ pb: 13000, daily: '2026-11-15' })).daily).toBeNull();
  });

  it('shows a dash for the PB delta without a PB, and tones the delta with one', () => {
    expect(buildCard(input()).pbText).toBe(DASH);
    expect(buildCard(input({ score: null })).pbTone).toBe('none');
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
  function setup(skill: 'precision' | 'line' | null, isClean?: () => boolean, firstRating?: (mode: string) => boolean) {
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
      isClean,
      firstRating,
    });
    return { bus, rec, cards, setRating: (r: number) => (rating = r), newRuns: () => newRuns };
  }

  it('marks the rating of a first-rating mode as first, and only that mode', () => {
    const { bus, rec } = setup('line', undefined, (m) => m === 'placement');
    bus.emit('runReady', { tick: 0, mode: 'placement', seed: 1, dial: 30 });
    bus.emit('runEnded', { tick: 9, t: 45, reason: 'timer' });
    expect(rec.last!.rating!.first).toBe(true);
    bus.emit('runReady', { tick: 0, mode: 'coldStart', seed: 1, dial: 30 });
    bus.emit('runEnded', { tick: 9, t: 60, reason: 'timer' });
    expect(rec.last!.rating!.first).toBe(false);
  });

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

  it('flags the card as a clean run when the cue planner says the run was clean', () => {
    let clean = true;
    const { bus, rec } = setup('precision', () => clean);
    bus.emit('runReady', { tick: 0, mode: 'coldStart', seed: 7, dial: 50 });
    bus.emit('runEnded', { tick: 9, t: 60, reason: 'timer' });
    expect(rec.last!.clean).toBe(true);
    clean = false;
    bus.emit('runReady', { tick: 0, mode: 'coldStart', seed: 8, dial: 50 });
    bus.emit('runEnded', { tick: 9, t: 60, reason: 'timer' });
    expect(rec.last!.clean).toBe(false);
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

describe('the run results card (design §8.2, #213)', () => {
  const sweep = (p: Partial<RunStats> = {}) => stats({ mode: 'sweep', endReason: 'death', medianTtkMs: 410, stopCount: 3, medianStopLatencyMs: 96, ...p });
  const tile = (n: number, p: Partial<RunStory['sectors'][number]> = {}): RunStory['sectors'][number] => ({
    number: n, sectorId: `s${n}`, role: 'take', condition: 'full', stake: 'plain', cleared: true, ended: true, fell: false,
    won: 1, lost: 0, avoided: 0, kills: 2, hpIn: 100, hpOut: 80, flawless: false, overtime: n > 6, points: 100, ...p,
  });
  const story = (n: number, p: Partial<RunStory> = {}): RunStory => ({
    sectors: Array.from({ length: n }, (_, i) => tile(i + 1)), situations: [], overtimeSectors: Math.max(0, n - 6), banked: null, total: null, won: n, lost: 0, ...p,
  });
  const make = (st: RunStats, rs: RunStory | undefined, extra: object = {}) =>
    buildCard({ stats: st, split: null, score: 9000, rating: null, pb: null, medals: [], story: rs, ...extra });

  it('shows the six headline stats of §8.2 for a sector run, and no route for a drill', () => {
    const c = make(sweep(), story(2));
    expect(c.stats.map((x) => x.id)).toEqual(['accuracy', 'headshotRate', 'timeToShot', 'ttk', 'movingShots', 'stopLatency']);
    expect(c.stats.find((x) => x.id === 'stopLatency')!.value).toBe('96 ms');
    expect(c.route).toHaveLength(2);
    const drill = make(stats(), undefined);
    expect(drill.route).toEqual([]);
    expect(drill.situations).toEqual([]);
    expect(drill.depth).toBe('');
    expect(drill.stats).toHaveLength(8);
  });

  it('carries the armour and eco notes of the run (#207), and none by default', () => {
    expect(make(sweep(), story(2)).notes).toEqual([]);
    const notes = ['Your Pace needed two headshots on an armoured target (one kills an unarmoured one).'];
    expect(make(sweep(), story(2), { notes }).notes).toEqual(notes);
  });

  it('shows a score of 0, not a dash, for a sector run that earned nothing', () => {
    expect(make(sweep(), story(1), { score: null }).score).toBe('0');
    expect(buildCard({ stats: stats(), split: null, score: null, rating: null, pb: null, medals: [] }).score).toBe(DASH);
  });

  it('never shows a meaningless 0 ms time to kill (#175)', () => {
    const c = make(sweep({ medianTtkMs: 0.2 }), story(1));
    const ids = c.stats.map((x) => x.id);
    expect(ids).not.toContain('ttk');
    expect(ids).toContain('cleanStreak');
    expect(c.stats.every((x) => x.value !== '0 ms')).toBe(true);
    expect(make(sweep({ medianTtkMs: 410 }), story(1)).stats.map((x) => x.id)).toContain('ttk');
  });

  it('celebrates the first best run, and measures later ones against it (#175)', () => {
    expect(make(sweep(), story(1), { pb: null })).toMatchObject({ pbKind: 'first', pbLabel: 'New best run', pbTone: 'good' });
    expect(make(sweep(), story(1), { pb: 8000 })).toMatchObject({ pbKind: 'beat', pbLabel: 'New best run +1,000' });
    expect(make(sweep(), story(1), { pb: 9500 })).toMatchObject({ pbKind: 'none', pbLabel: '−500 vs best run', pbTone: 'bad' });
  });

  it('words the depth: sector n of 6, the Finale, Overtime', () => {
    expect(depthLabel(story(0), 'death')).toBe('');
    expect(depthLabel(story(5), 'death')).toBe('Sector 5 of 6');
    expect(depthLabel(story(6, { sectors: Array.from({ length: 6 }, (_, i) => tile(i + 1, { cleared: i < 5 })) }), 'death')).toBe('Fell in the Finale');
    expect(depthLabel(story(6), 'left')).toBe('Finale cleared');
    expect(depthLabel(story(9), 'death')).toBe('Overtime 3');
    expect(depthLabel(story(4), 'quit')).toBe('Sector 4 of 6');
    // A shorter route (the run director's v0 reports four sectors): n of total, and leaving at its end clears it.
    expect(depthLabel(story(4, { total: 4 }), 'left')).toBe('Route cleared, 4 sectors');
    // "Cleared" means every Echo dead: walking out without a fight is not clearing the route (#252).
    const walked = (n: number, total: number, clearedUpTo: number): RunStory =>
      story(n, { total, sectors: Array.from({ length: n }, (_, i) => tile(i + 1, { cleared: i < clearedUpTo, won: 0, kills: 0 })) });
    expect(depthLabel(walked(4, 4, 0), 'left')).toBe('0 of 4 sectors cleared');
    expect(depthLabel(walked(4, 4, 3), 'left')).toBe('3 of 4 sectors cleared');
    expect(depthLabel(walked(4, 4, 4), 'left')).toBe('Route cleared, 4 sectors');
    expect(depthLabel(walked(6, 6, 0), 'left')).toBe('0 of 6 sectors cleared');
    expect(depthLabel(walked(6, 6, 5), 'left')).toBe('5 of 6 sectors cleared');
    expect(depthLabel(walked(6, 6, 6), 'left')).toBe('Finale cleared');
    expect(depthLabel(story(3, { total: 4 }), 'death')).toBe('Sector 3 of 4');
    expect(depthLabel(story(2, { total: 4 }), 'quit')).toBe('Sector 2 of 4');
  });

  it('puts the end label, death cause and Overtime banked or lost in the header', () => {
    const dead = make(sweep(), story(8), { deathCause: 'Lost to a flank you could not see.' });
    expect(dead).toMatchObject({ endLabel: 'Eliminated', depth: 'Overtime 2', deathLine: 'Lost to a flank you could not see.' });
    expect(dead.overtime).toEqual({ points: '200', state: 'lost' });
    const left = make(sweep({ endReason: 'left' }), story(8), { deathCause: 'ignored' });
    expect(left.endLabel).toBe('Made it out');
    expect(left.deathLine).toBeNull();
    expect(left.overtime).toEqual({ points: '200', state: 'banked' });
    expect(make(sweep(), story(3)).overtime).toBeNull();
    expect(make(sweep(), story(3)).deathLine).toBeNull();
  });

  it('formats tiles: role, stake and condition words, fights, HP in to out, the gold mark', () => {
    const c = make(sweep(), story(2, { sectors: [tile(1, { stake: 'hot', condition: 'eco', won: 2, lost: 1, hpIn: 100, hpOut: 54.4, flawless: true }), tile(2, { role: 'hold', won: 0, hpIn: 54, hpOut: 54, kills: 0 })] }));
    expect(c.route[0]).toMatchObject({ role: 'Take', stake: 'Hot', condition: 'Eco', fights: '2 won · 1 lost', hp: '100 → 54', hpTone: 'bad', flawless: true });
    expect(c.route[1]).toMatchObject({ role: 'Hold', stake: '', condition: '', fights: 'no fights', hp: '54 → 54', hpTone: 'even', flawless: false });
    expect(c.route[0]!.label).toContain('Flawless');
    expect(c.route.map((x) => x.outcome)).toEqual(['cleared', 'cleared']);
    expect(make(sweep(), story(1, { sectors: [tile(1, { cleared: false })] })).route[0]!.outcome).toBe('left');
    expect(make(sweep(), story(1, { sectors: [tile(1, { cleared: false, fell: true })] })).route[0]!.outcome).toBe('fell');
  });

  it('formats fights by situation with the win share and the running record when it is known', () => {
    const st = story(1, {
      situations: [
        { card: 'take-expected', played: 3, won: 2, lost: 1, avoided: 0 },
        { card: 'crossfire', played: 1, won: 0, lost: 0, avoided: 1 },
        { card: 'brand-new', played: 2, won: 0, lost: 2, avoided: 0 },
      ],
    });
    const c = make(sweep(), st, { situationHistory: (card: string) => (card === 'take-expected' ? { won: 12, played: 18 } : null) });
    expect(c.situations[0]).toMatchObject({ label: 'Take, expected', summary: '2 of 3 won', tone: 'good', recent: '67% over 18' });
    expect(c.situations[0]!.rate).toBeCloseTo(2 / 3, 9);
    expect(c.situations[1]).toMatchObject({ label: 'Crossfire', summary: 'avoided', rate: null, recent: '' });
    expect(c.situations[2]).toMatchObject({ label: 'Brand New', tone: 'bad' });
  });
  describe('the lean line (#210)', () => {
    const leanFor = (kind: string) => leanView(kind, tunables.lean, tunables.sweep);
    const moving = () => sweep({ movingShots: 20, shots: 50 });

    it('names what the next run leans toward under the one thing to fix, from cards the run can deal', () => {
      const c = make(moving(), story(2), { leanFor });
      expect(c.fix.kind).toBe('movingShots');
      expect(c.fix.lean?.cards).toEqual(['meet', 'take-expected']);
      expect(c.fix.lean?.line).toBe('Next run leans: meets in a corridor and takes against enemies who expect you, where the stop decides the fight.');
    });

    it('says nothing when nothing stood out, when there are no shots, or when no lean is offered', () => {
      expect(make(sweep(), story(2), { leanFor }).fix.lean).toBeNull(); // placeholder: nothing stood out
      expect(make(sweep({ shots: 0, hits: 0, movingShots: 0 }), story(2), { leanFor }).fix.lean).toBeNull();
      expect(make(moving(), story(2)).fix.lean).toBeNull();
    });

    it('says nothing on the Daily Route (everyone plays the same route that day) or for a drill', () => {
      expect(make(moving(), story(2), { leanFor, daily: '2026-11-15' }).fix.lean).toBeNull();
      expect(make(stats({ movingShots: 20, shots: 50 }), undefined, { leanFor }).fix.lean).toBeNull();
    });
  });
});
