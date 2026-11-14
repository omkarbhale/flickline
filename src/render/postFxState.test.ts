import { describe, expect, it } from 'vitest';
import { damageFx } from '../config/damageFx';
import { post } from '../config/post';
import { chromaEnvelope, damageEnvelope, PostFxState } from './postFxState';

const make = (): PostFxState => new PostFxState(post, damageFx.vignetteMs);
const run = (s: PostFxState, ms: number, step = 1000 / 144): void => {
  for (let t = 0; t < ms; t += step) s.update(step / 1000);
};

describe('damage vignette envelope', () => {
  it('rises to 1 over the attack, then fades out with an ease-out and ends at 0', () => {
    const T = damageFx.vignetteMs;
    const a = T * post.damage.attack;
    expect(damageEnvelope(0, T, post.damage.attack)).toBe(0);
    expect(damageEnvelope(a / 2, T, post.damage.attack)).toBeCloseTo(0.5, 5);
    expect(damageEnvelope(a, T, post.damage.attack)).toBeCloseTo(1, 5);
    expect(damageEnvelope(a + (T - a) / 2, T, post.damage.attack)).toBeCloseTo(0.25, 5);
    expect(damageEnvelope(T, T, post.damage.attack)).toBe(0);
  });

  it('a hit shows the vignette, which is gone after its length at any frame rate', () => {
    for (const fps of [60, 144, 360]) {
      const s = make();
      s.hurt();
      run(s, damageFx.vignetteMs * 0.3, 1000 / fps);
      expect(s.damage).toBeGreaterThan(0.5);
      run(s, damageFx.vignetteMs, 1000 / fps);
      expect(s.damage).toBe(0);
    }
  });

  it('a second hit restarts it', () => {
    const s = make();
    s.hurt();
    run(s, 250);
    const late = s.damage;
    s.hurt();
    run(s, damageFx.vignetteMs * post.damage.attack);
    expect(s.damage).toBeGreaterThan(late);
  });
});

describe('chromatic pulse', () => {
  it('is 50 ms (three frames at 60 Hz) in milliseconds, whatever the frame rate', () => {
    expect(post.chromatic.ms).toBe(50);
    expect(chromaEnvelope(0, 50)).toBe(1);
    expect(chromaEnvelope(25, 50)).toBeCloseTo(0.5, 5);
    expect(chromaEnvelope(50, 50)).toBe(0);
  });

  it('is off until the player turns it on', () => {
    const s = make();
    expect(s.kill(1)).toBe(false);
    run(s, 10);
    expect(s.chroma).toBe(0);
    s.setChromaticEnabled(true);
    expect(s.kill(2)).toBe(true);
    run(s, 5);
    expect(s.chroma).toBeGreaterThan(0);
    run(s, post.chromatic.ms + 20);
    expect(s.chroma).toBe(0);
  });

  it('is rate limited by the pulse budget (R10)', () => {
    const s = make();
    s.setChromaticEnabled(true);
    let started = 0;
    for (let i = 0; i < 10; i++) if (s.kill(5 + i * 0.05)) started++;
    expect(started).toBe(post.chromatic.maxPerSecond);
    expect(s.kill(7)).toBe(true); // the window has passed
  });
});

describe('Reduce flashing disables the pulses', () => {
  it('no damage vignette pulse and no chromatic pulse, and anything showing is dropped at once', () => {
    const s = make();
    s.setChromaticEnabled(true);
    s.hurt();
    s.kill(1);
    run(s, 10);
    expect(s.damage).toBeGreaterThan(0);
    expect(s.chroma).toBeGreaterThan(0);
    s.setReduceFlashing(true);
    expect(s.damage).toBe(0);
    expect(s.chroma).toBe(0);
    s.hurt();
    expect(s.kill(10)).toBe(false);
    run(s, 100);
    expect(s.damage).toBe(0);
    expect(s.chroma).toBe(0);
  });

  it('turning it off again lets pulses through', () => {
    const s = make();
    s.setChromaticEnabled(true);
    s.setReduceFlashing(true);
    s.setReduceFlashing(false);
    s.hurt();
    expect(s.kill(1)).toBe(true);
  });
});

describe('reset', () => {
  it('drops a showing pulse and refills the budget', () => {
    const s = make();
    s.setChromaticEnabled(true);
    s.hurt();
    for (let i = 0; i < 3; i++) s.kill(1 + i * 0.01);
    run(s, 10);
    s.reset();
    expect(s.damage).toBe(0);
    expect(s.chroma).toBe(0);
    expect(s.kill(1)).toBe(true);
  });
});
