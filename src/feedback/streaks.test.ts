import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { TICK_RATE } from '../core/time';
import { scoring } from '../config/scoring';
import { StreakTracker, type StreakEvents } from './streaks';

function setup() {
  const bus = new EventBus<StreakEvents>();
  const chain: number[] = [];
  const streak: [number, number][] = [];
  bus.on('chainUpdated', (e) => chain.push(e.count));
  bus.on('streakUpdated', (e) => streak.push([e.streak, e.mult]));
  const tr = new StreakTracker(scoring, bus);
  const T = (s: number): number => Math.round(s * TICK_RATE);
  return { tr, chain, streak, T };
}

describe('chain (kills within 1.5 s)', () => {
  it('a crossfire kill (not isolated, #132) neither extends nor starts a chain, but keeps the clean streak', () => {
    const { tr, chain, streak, T } = setup();
    tr.onKill(T(1), 1, true);
    tr.onKill(T(1.5), 1.5, true, false); // swung into a second angle: no chain credit
    expect(chain).toEqual([1]);
    expect(tr.chain).toBe(1);
    expect(streak.map((s) => s[0])).toEqual([1, 2]);
    tr.onKill(T(2.4), 2.4, true); // 1.4 s after the last isolated kill: the chain goes on
    expect(chain).toEqual([1, 2]);
    tr.onKill(T(5), 5, true, false); // after a lapse: does not start a new chain either
    expect(tr.chain).toBe(0);
  });

  it('extends while each kill is within 1.5 s of the previous one', () => {
    const { tr, chain, T } = setup();
    tr.onKill(T(1), 1, true);
    tr.onKill(T(2.4), 2.4, true);
    tr.onKill(T(3.9), 3.9, true); // exactly 1.5 s after the previous: still in the chain
    expect(chain).toEqual([1, 2, 3]);
    expect(tr.bestChain).toBe(3);
  });

  it('restarts at 1 when the gap exceeds 1.5 s', () => {
    const { tr, chain, T } = setup();
    tr.onKill(T(1), 1, true);
    tr.onKill(T(2.6), 2.6, true); // 1.6 s gap
    expect(chain).toEqual([1, 0, 1]); // the lapse is announced (0) before the new chain starts
  });

  it('decays to 0 with one event when the window lapses', () => {
    const { tr, chain, T } = setup();
    tr.onKill(T(1), 1, true);
    tr.step(T(2), 2); // still inside
    expect(chain).toEqual([1]);
    tr.step(T(2.6), 2.6);
    tr.step(T(3), 3);
    expect(chain).toEqual([1, 0]);
    expect(tr.chain).toBe(0);
  });

  it('a break does not end the chain (they are different counters)', () => {
    const { tr, T } = setup();
    tr.onKill(T(1), 1, true);
    tr.onBreak(T(1.2), 1.2);
    expect(tr.chain).toBe(1);
  });
});

describe('clean streak', () => {
  it('counts consecutive clean kills and reports the multiplier', () => {
    const { tr, streak } = setup();
    for (let i = 0; i < 3; i++) tr.onKill(i, i * 5, true);
    expect(streak.map((s) => s[0])).toEqual([1, 2, 3]);
    expect(streak[2]![1]).toBeCloseTo(1.3, 12);
    expect(tr.mult).toBeCloseTo(1.3, 12);
  });

  it('an unclean kill resets it (and still counts for the chain)', () => {
    const { tr, streak, chain } = setup();
    tr.onKill(1, 1, true);
    tr.onKill(2, 2, true);
    tr.onKill(3, 2.5, false);
    expect(streak.map((s) => s[0])).toEqual([1, 2, 0]);
    expect(chain).toEqual([1, 2, 3]);
    expect(tr.bestStreak).toBe(2);
  });

  it('a miss resets it, but an already-empty streak emits nothing', () => {
    const { tr, streak } = setup();
    tr.onBreak(1, 0.1);
    expect(streak).toEqual([]);
    tr.onKill(2, 1, true);
    tr.onBreak(3, 1.1);
    tr.onBreak(4, 1.2);
    expect(streak.map((s) => s[0])).toEqual([1, 0]);
  });

  it('caps the multiplier at ×3.0 but keeps counting', () => {
    const { tr, streak } = setup();
    for (let i = 0; i < 25; i++) tr.onKill(i, i * 10, true);
    expect(streak[19]![1]).toBeCloseTo(3, 12);
    expect(streak[24]![0]).toBe(25);
    expect(streak[24]![1]).toBeCloseTo(3, 12);
  });

  it('reset clears everything silently', () => {
    const { tr, chain } = setup();
    tr.onKill(1, 1, true);
    tr.reset();
    expect([tr.chain, tr.streak, tr.bestChain, tr.bestStreak]).toEqual([0, 0, 0, 0]);
    expect(chain).toEqual([1]);
  });
});
