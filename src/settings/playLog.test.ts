import { describe, expect, it } from 'vitest';
import { sanitizePlayLog } from './playLog';

describe('version 1 play log reader', () => {
  it('sanitises anything it reads', () => {
    const clean = sanitizePlayLog({ bests: { a: 5, b: -1, c: 'x', d: NaN }, plays: { a: 2.5, b: 3 }, flaggedSkill: 'nope' });
    expect(clean).toEqual({ bests: { a: 5 }, plays: { b: 3 }, flaggedSkill: null });
    expect(sanitizePlayLog(null)).toEqual({ bests: {}, plays: {}, flaggedSkill: null });
    expect(sanitizePlayLog({ flaggedSkill: 'flick' }).flaggedSkill).toBe('flick');
  });
});
