import { describe, expect, it } from 'vitest';
import { scoring } from '../config/scoring';
import {
  createScoreBreakdown, difficultyMultiplier, precisionMultiplier, scoreKill, speedMultiplier, streakMultiplier,
  type KillScoreInput,
} from './scoring';

const cfg = scoring;
const base: KillScoreInput = {
  kind: 'post', headshot: false, firstBullet: false, ttkMs: 5000, parSec: 1, cleanStreak: 0, dial: 50, surge: false,
};

describe('scoring table (design §8.1)', () => {
  it('base points per enemy kind', () => {
    const want = { post: 100, beacon: 100, strafer: 150, peeker: 200, rusher: 150, bulwark: 250, gnat: 120 };
    for (const [kind, pts] of Object.entries(want)) {
      expect(scoreKill(createScoreBreakdown(), { ...base, kind: kind as KillScoreInput['kind'] }, cfg).total).toBe(pts);
    }
  });

  it('precision: ×1.5 head, ×1.25 first bullet, stacking to ×1.875', () => {
    expect(precisionMultiplier(false, false, cfg)).toBe(1);
    expect(precisionMultiplier(true, false, cfg)).toBe(1.5);
    expect(precisionMultiplier(false, true, cfg)).toBe(1.25);
    expect(precisionMultiplier(true, true, cfg)).toBeCloseTo(1.875, 12);
  });

  it('speed: 1 + 0.5 × clamp((par − TTK)/par, 0, 1)', () => {
    expect(speedMultiplier(0, 1, cfg)).toBeCloseTo(1.5, 12); // instant
    expect(speedMultiplier(500, 1, cfg)).toBeCloseTo(1.25, 12); // half of par
    expect(speedMultiplier(1000, 1, cfg)).toBe(1); // exactly par
    expect(speedMultiplier(9000, 1, cfg)).toBe(1); // slower than par never goes below 1
    expect(speedMultiplier(100, 0, cfg)).toBe(1); // no par, no term
    expect(speedMultiplier(-50, 1, cfg)).toBeCloseTo(1.5, 12); // clamped
  });

  it('streak: 1 + 0.1 × min(cleanStreak, 20), ×1.0 to ×3.0', () => {
    expect(streakMultiplier(0, cfg)).toBe(1);
    expect(streakMultiplier(5, cfg)).toBeCloseTo(1.5, 12);
    expect(streakMultiplier(20, cfg)).toBeCloseTo(3, 12);
    expect(streakMultiplier(500, cfg)).toBeCloseTo(3, 12); // capped
    expect(streakMultiplier(-3, cfg)).toBe(1);
  });

  it('difficulty: 2^((dial − 50)/25)', () => {
    expect(difficultyMultiplier(50, cfg)).toBe(1);
    expect(difficultyMultiplier(75, cfg)).toBe(2);
    expect(difficultyMultiplier(25, cfg)).toBe(0.5);
    expect(difficultyMultiplier(100, cfg)).toBe(4);
    expect(difficultyMultiplier(0, cfg)).toBe(0.25);
    expect(difficultyMultiplier(62.5, cfg)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('multiplies every term and rounds the total', () => {
    const out = scoreKill(createScoreBreakdown(), {
      kind: 'strafer', headshot: true, firstBullet: true, ttkMs: 500, parSec: 1, cleanStreak: 10, dial: 75, surge: false,
    }, cfg);
    // 150 × 1.875 × 1.25 × 2.0 × 2
    expect(out.raw).toBeCloseTo(150 * 1.875 * 1.25 * 2 * 2, 9);
    expect(out.total).toBe(Math.round(out.raw));
    expect([out.base, out.precision, out.speed, out.streak, out.difficulty, out.surge]).toEqual([150, 1.875, 1.25, 2, 2, 1]);
  });

  it('Surge doubles the total; the hook is the only difference', () => {
    const a = scoreKill(createScoreBreakdown(), { ...base, headshot: true }, cfg).raw;
    const b = scoreKill(createScoreBreakdown(), { ...base, headshot: true, surge: true }, cfg).raw;
    expect(b).toBeCloseTo(a * 2, 9);
  });

  it('never negative, whatever the inputs', () => {
    for (const dial of [-10, 0, 50, 100, 140]) {
      for (const ttkMs of [-5, 0, 1e6]) {
        expect(scoreKill(createScoreBreakdown(), { ...base, dial, ttkMs, cleanStreak: -2 }, cfg).total).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('is driven by the tunables, not by constants in code', () => {
    const t = JSON.parse(JSON.stringify(cfg)) as typeof cfg;
    t.base.post = 7;
    t.headshotMult = 3;
    expect(scoreKill(createScoreBreakdown(), { ...base, headshot: true }, t).total).toBe(21);
  });
});
