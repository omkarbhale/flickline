import { describe, expect, it } from 'vitest';
import { FrameLimiter } from './frameLimiter';

/** Frames per second actually run when a `displayHz` display drives a limiter set to `cap` for `seconds`. */
function achieved(displayHz: number, cap: number, seconds = 10, jitterMs = 0): number {
  const l = new FrameLimiter();
  l.setCap(cap);
  const dt = 1000 / displayHz;
  let ran = 0;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
  for (let i = 1; i <= displayHz * seconds; i++) {
    const ts = i * dt + (jitterMs ? rnd() * jitterMs : 0);
    if (l.shouldRun(ts)) ran++;
  }
  return ran / seconds;
}

describe('FrameLimiter', () => {
  it('runs every frame when uncapped', () => {
    expect(achieved(144, 0)).toBe(144);
    expect(achieved(240, 0)).toBe(240);
  });

  it('holds each cap option on displays that are faster than it', () => {
    for (const [hz, cap] of [[144, 60], [240, 60], [240, 144], [360, 144], [360, 240], [165, 60], [165, 144]] as const) {
      expect(achieved(hz, cap)).toBeGreaterThan(cap * 0.97);
      expect(achieved(hz, cap)).toBeLessThan(cap * 1.03);
    }
  });

  it('still holds the cap with vsync jitter on the timestamps', () => {
    for (const [hz, cap] of [[144, 60], [240, 144], [360, 240]] as const) {
      const fps = achieved(hz, cap, 10, 0.4);
      expect(fps).toBeGreaterThan(cap * 0.95);
      expect(fps).toBeLessThan(cap * 1.05);
    }
  });

  it('does not slow a display that is at or below the cap', () => {
    expect(achieved(60, 144)).toBe(60);
    expect(achieved(144, 144)).toBe(144);
    expect(achieved(60, 240)).toBe(60);
  });

  it('resynchronises after a hitch instead of bursting', () => {
    const l = new FrameLimiter();
    l.setCap(60);
    let ts = 0;
    for (let i = 0; i < 50; i++) l.shouldRun((ts += 1000 / 144));
    ts += 2000; // the tab was hidden for two seconds
    let burst = 0;
    for (let i = 0; i < 10; i++) if (l.shouldRun((ts += 1000 / 144))) burst++;
    expect(burst).toBeLessThanOrEqual(5);
  });

  it('changing the cap takes effect at once', () => {
    const l = new FrameLimiter();
    l.setCap(60);
    for (let i = 1; i < 30; i++) l.shouldRun(i * (1000 / 144));
    l.setCap(0);
    expect(l.shouldRun(1000)).toBe(true);
    expect(l.shouldRun(1000 + 1000 / 144)).toBe(true);
  });
});
