import { describe, expect, it } from 'vitest';
import { measureAlignment, measureMovement, measureReset, measureSpray, measureTagging } from './measure';

// Smoke tests: the measurement tool runs and reads the sim the way the review describes. The numbers
// themselves are reported by `npm run human-check`, not asserted here (the review judges them).
describe('human-check measurements', () => {
  it('records a seeded Kestrel spray bullet by bullet at the fire rate', () => {
    const r = measureSpray('kestrel', 3);
    expect(r.bullets).toBe(30);
    expect(r.rows[0]!.pitch).toBe(0);
    expect(r.intervalMs).toBeCloseTo(1000 / 11, 0);
    expect(r.firstSidewaysBullet).toBeGreaterThan(1);
  });

  it('fires the shot after a pause, so the reset table has real rows', () => {
    const rows = measureReset('kestrel', [10], [100, 1500]);
    expect(rows.every((r) => Number.isFinite(r.pitchOffsetDeg))).toBe(true);
    expect(rows[1]!.pitchOffsetDeg).toBe(0);
  });

  it('measures movement and tagging on the real world', () => {
    const m = measureMovement('kestrel');
    expect(m.runSpeed).toBeGreaterThan(5);
    expect(m.releaseToStopMs).toBeGreaterThan(0);
    const t = measureTagging('body');
    expect(t.minSpeedFraction).toBeLessThan(0.5);
    expect(t.flinchPeakDeg).toBeGreaterThan(0);
  });

  it('models the loop: a click never waits more than a frame plus a tick', () => {
    const a = measureAlignment(144, 2000);
    expect(a.clickToFiringFrame.max).toBeLessThanOrEqual(1000 / 144 + 7.8125 + 1e-9);
    expect(a.zeroTickFrames).toBeGreaterThan(0.05);
  });
});
