import { describe, expect, it } from 'vitest';
import { nextSeed } from '../../feedback/results';
import { formatRepeatReport, repeatChain, repeatRow, type RepeatRunFacts } from './repeatReport';

/** A run of the given route and pairs (the rest is filler). */
function run(route: string[], pairs: string[], over: Partial<RepeatRunFacts> = {}): RepeatRunFacts {
  return {
    seed: 1, route, pairs, lean: [], endReason: 'death', liveSec: 60, sectors: 6, reached: route.length, finaleCleared: false, finaleSec: 0, finaleFights: 0, overtimeSectors: 0,
    fights: pairs.length, score: 0, ...over,
  };
}

describe('the repeat report (bot harness, #214)', () => {
  it('counts what a run repeats from the run before and from any earlier run, routes included', () => {
    const chain = [
      run(['a', 'b', 'c'], ['a x', 'b y']),
      run(['a', 'd', 'e'], ['a x', 'd z']),
      run(['a', 'b', 'c'], ['b y', 'e w'], { reached: 7, finaleCleared: true, finaleSec: 130, finaleFights: 13, liveSec: 170, overtimeSectors: 1 }),
    ];
    const r = repeatRow(50, [chain]);
    expect(r.pairsPerRun).toBe(2);
    // Run 2: 'a x' was in run 1 (1 of 2). Run 3: neither pair was in run 2; 'b y' was in run 1.
    expect(r.pairRepeatLast).toBeCloseTo((0.5 + 0) / 2);
    expect(r.pairRepeatAny).toBeCloseTo((0.5 + 0.5) / 2);
    expect(r.sectorRepeatLast).toBeCloseTo((1 / 3 + 1 / 3) / 2);
    expect(r.routeRepeat).toBeCloseTo(0.5); // run 3 replays run 1's route
    expect(r.firstThreeRepeat).toBeCloseTo(0.5);
    expect(r.distinctPairs).toBe(4);
    expect(r.distinctSectors).toBe(5);
    expect(r.finaleReached).toBeCloseTo(1 / 3);
    expect(r.finaleCleared).toBeCloseTo(1 / 3);
    expect(r.clearedLengthP50).toBe(130); // to the Finale's exit: the Overtime sector after it is not the full run (#274)
    expect(r.clearedFightsP50).toBe(13);
    expect(r.pairNewFrom20).toBe(0); // no run 20 in a chain of three
  });

  it('plays consecutive runs on the results card\'s seed chain, deterministically, and prints two tables', () => {
    const a = repeatChain(50, 3, 7);
    expect(a.map((r) => r.seed)).toEqual([7, nextSeed(7), nextSeed(nextSeed(7))]);
    for (const r of a) {
      expect(r.route.length).toBeGreaterThan(0);
      expect(r.endReason).not.toBeNull();
    }
    expect(a[0]!.lean).toEqual([]); // nothing to lean toward before the first results card
    expect(repeatChain(50, 3, 7)).toEqual(a);
    const t = formatRepeatReport([repeatRow(50, [a])]);
    expect(t).toHaveLength(7);
    expect(t[2]).toMatch(/^\| 50 \| 1 × 3 \|/);
    expect(t[4]).toContain('(target 120–240)');
  });

  it('walks at the scripted human pace when asked (the closer estimate of a person\'s run length)', () => {
    const bot = repeatChain(50, 1, 7);
    const human = repeatChain(50, 1, 7, 'facts', 'bank', true);
    expect(human[0]!.route[0]).toBe(bot[0]!.route[0]); // the same seed deals the same Opener
    expect(human[0]!.liveSec).not.toBe(bot[0]!.liveSec);
  });
});
