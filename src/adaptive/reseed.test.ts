import { describe, expect, it } from 'vitest';
import { SkillState } from './skillModel';

describe('SkillState.reseed', () => {
  it('starts every skill over from the new prior and forgets trials and beats', () => {
    const s = new SkillState('skip');
    for (let i = 0; i < 20; i++) s.observe('flick', { itemDifficulty: 80, success: true });
    s.dialFor('test', 0);
    expect(s.trialCount('flick')).toBe(20);

    s.reseed({ mean: 15, sd: 25 });
    expect(s.trialCount('flick')).toBe(0);
    expect(Number.isNaN(s.matchedDial('test'))).toBe(true);
    for (const id of ['flick', 'precision'] as const) {
      expect(s.rating(id)).toBeCloseTo(15, 1);
      expect(s.confidence(id)).toBeGreaterThan(12);
    }
    expect(s.rating('line')).toBeCloseTo(15, 1);
  });

  it('matches a fresh model built with that prior', () => {
    const a = new SkillState({ mean: 75, sd: 25 });
    const b = new SkillState('skip');
    b.observe('flick', { itemDifficulty: 30, success: false });
    b.reseed('competitive');
    expect(b.rating('precision')).toBeCloseTo(a.rating('precision'), 6);
    expect(b.confidence('flick')).toBeCloseTo(a.confidence('flick'), 6);
    expect(b.dialFor('test', 0, [0])).toBeCloseTo(a.dialFor('test', 0, [0]), 6);
  });

  it('lets later trials move the reseeded model, unplayed skills following', () => {
    const s = new SkillState('skip');
    s.reseed('new');
    const before = s.rating('precision');
    for (let i = 0; i < 12; i++) s.observe('flick', { itemDifficulty: 60, success: true });
    expect(s.rating('flick')).toBeGreaterThan(before + 10);
    expect(s.rating('precision')).toBeGreaterThan(before); // the correlation prior
  });
});
