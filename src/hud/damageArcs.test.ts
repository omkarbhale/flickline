import { describe, expect, it } from 'vitest';
import { angleDiff, arcAlpha, arcScreenAngle, DamageArcPool } from './damageArcs';

const deg = (r: number): number => (r * 180) / Math.PI;

describe('arcScreenAngle', () => {
  it('points up for a shooter ahead, right for one on the right, down for one behind', () => {
    expect(deg(arcScreenAngle(0, -1, 0, 0))).toBeCloseTo(0, 9);
    expect(deg(arcScreenAngle(1, 0, 0, 0))).toBeCloseTo(90, 9);
    expect(Math.abs(deg(arcScreenAngle(0, 1, 0, 0)))).toBeCloseTo(180, 9);
    expect(deg(arcScreenAngle(-1, 0, 0, 0))).toBeCloseTo(-90, 9);
  });

  it('stays on the shooter while the view turns (turning left moves it clockwise)', () => {
    // Shooter on the right at the hit; the player then turns 90 deg left (yaw +): it is now behind.
    expect(Math.abs(deg(arcScreenAngle(1, 0, 0, Math.PI / 2)))).toBeCloseTo(180, 9);
    // Turning 90 deg right (yaw -) instead puts it dead ahead.
    expect(deg(arcScreenAngle(1, 0, 0, -Math.PI / 2))).toBeCloseTo(0, 9);
  });
});

describe('arcAlpha', () => {
  it('attacks fast, eases out, is gone at the end', () => {
    expect(arcAlpha(0, 700)).toBe(0);
    expect(arcAlpha(25, 700)).toBeCloseTo(0.5, 9);
    expect(arcAlpha(50, 700)).toBeCloseTo(1, 9);
    expect(arcAlpha(375, 700)).toBeCloseTo(0.25, 9);
    expect(arcAlpha(700, 700)).toBe(0);
    expect(arcAlpha(-5, 700)).toBe(0);
    let prev = 1;
    for (let a = 50; a < 700; a += 25) {
      const v = arcAlpha(a, 700);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('angleDiff', () => {
  it('wraps around', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(0.2, 12);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    expect(angleDiff(7 * Math.PI, Math.PI)).toBeCloseTo(0, 9);
  });
});

describe('DamageArcPool', () => {
  const merge = (10 * Math.PI) / 180;

  it('adds an arc per direction and prunes faded ones', () => {
    const p = new DamageArcPool(4);
    p.add(0, -1, 0, 0, 0, merge); // ahead
    p.add(1, 0, 0, 0, 100, merge); // right
    expect(p.active).toBe(2);
    expect(p.prune(650, 700)).toBe(2);
    expect(p.prune(750, 700)).toBe(1); // the first (t=0) has faded, the second (t=100) has not
    expect(p.prune(900, 700)).toBe(0);
  });

  it('a burst from one shooter refreshes one arc instead of stacking', () => {
    const p = new DamageArcPool(4);
    const a = p.add(0, -1, 0, 0, 0, merge);
    const b = p.add(Math.sin(0.05), -Math.cos(0.05), 0, 0, 90, merge);
    expect(b).toBe(a);
    expect(p.active).toBe(1);
    expect(p.startMs[a]).toBe(90);
  });

  it('merges on the live direction, not the original one, after the view turned', () => {
    const p = new DamageArcPool(4);
    p.add(1, 0, 0, 0, 0, merge); // shooter on the right at yaw 0
    // The player turned left 90 deg; the same shooter hits again, now directly behind (dir z = +1).
    const slot = p.add(0, 1, Math.PI / 2, Math.PI / 2, 50, merge);
    expect(p.active).toBe(1);
    expect(deg(p.screenAngle(slot, Math.PI / 2))).toBeCloseTo(180, 6);
  });

  it('recycles the oldest slot when full and never allocates beyond its capacity', () => {
    const p = new DamageArcPool(2);
    p.add(0, -1, 0, 0, 0, merge);
    p.add(1, 0, 0, 0, 10, merge);
    p.add(0, 1, 0, 0, 20, merge); // full: recycles slot 0
    expect(p.active).toBe(2);
    expect(p.startMs[0]).toBe(20);
  });

  it('clear empties it', () => {
    const p = new DamageArcPool(3);
    p.add(0, -1, 0, 0, 0, merge);
    p.clear();
    expect(p.active).toBe(0);
    expect(p.prune(1, 700)).toBe(0);
  });
});
