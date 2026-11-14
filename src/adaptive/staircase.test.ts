import { describe, expect, it } from 'vitest';
import { Staircase, STAIRCASE_TARGET } from './staircase';

describe('placement staircase (design §9.2)', () => {
  it('steps up after two successes and down after one failure', () => {
    const s = new Staircase(40);
    s.record(true);
    expect(s.dial).toBe(40);
    s.record(true);
    expect(s.dial).toBe(56);
    s.record(false); // reversal: step 16 -> 8
    expect(s.reversals).toBe(1);
    expect(s.dial).toBe(48);
    s.record(true);
    s.record(false); // a failure resets the success streak, no reversal (still going down)
    expect(s.dial).toBe(40);
    expect(s.reversals).toBe(1);
  });

  it('halves the step at each reversal down to 2', () => {
    const s = new Staircase(50);
    const steps: number[] = [];
    for (let i = 0; i < 6; i++) {
      s.record(true);
      s.record(true);
      s.record(false);
      steps.push(s.step);
    }
    // each round: up then down is a reversal; from round 2 the up move is a reversal too
    expect(steps.slice(0, 4)).toEqual([8, 2, 2, 2]);
    const t = new Staircase(50);
    const seen = [t.step];
    for (let i = 0; i < 5; i++) {
      t.record(false);
      t.record(true);
      t.record(true);
      seen.push(t.step);
    }
    expect(seen).toEqual([16, 8, 2, 2, 2, 2]);
  });

  it('stays inside the dial range', () => {
    const s = new Staircase(5);
    s.record(false);
    expect(s.dial).toBe(0);
    const u = new Staircase(95);
    u.record(true);
    u.record(true);
    expect(u.dial).toBe(100);
  });

  it('estimates ability from the last reversals once there are enough', () => {
    const s = new Staircase(50);
    expect(s.abilityEstimate()).toBeNaN();
    // alternate up/down around 50 to collect reversals
    for (let i = 0; i < 6; i++) {
      s.record(true);
      s.record(true);
      s.record(false);
    }
    expect(s.reversals).toBeGreaterThanOrEqual(4);
    const offset = 9 * Math.log(STAIRCASE_TARGET / (1 - STAIRCASE_TARGET));
    expect(s.abilityEstimate()).toBeCloseTo(s.reversalMean(4) + offset, 9);
  });
});
