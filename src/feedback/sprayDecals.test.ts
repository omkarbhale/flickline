import { describe, expect, it } from 'vitest';
import { DECAL_BODY, DECAL_HEAD, DECAL_MISS, SprayDecals } from './sprayDecals';

describe('SprayDecals', () => {
  it('stores marks in order and bumps the version on every change', () => {
    const d = new SprayDecals(4);
    const v0 = d.version;
    expect(d.add(1, 2, 3, 0, 0, 1, DECAL_MISS)).toBe(true);
    expect(d.add(4, 5, 6, 0, 0, 1, DECAL_BODY)).toBe(true);
    expect(d.count).toBe(2);
    expect([d.x[1], d.y[1], d.z[1], d.kind[1]]).toEqual([4, 5, 6, DECAL_BODY]);
    expect(d.version).toBeGreaterThan(v0);
    d.setLastKind(DECAL_HEAD);
    expect(d.kind[1]).toBe(DECAL_HEAD);
    expect(d.kind[0]).toBe(DECAL_MISS);
  });

  it('drops marks past its capacity instead of growing, and a clear wipes it for the next spray', () => {
    const d = new SprayDecals(2);
    d.add(0, 0, 0, 0, 0, 1, DECAL_MISS);
    d.add(0, 0, 0, 0, 0, 1, DECAL_MISS);
    expect(d.add(9, 9, 9, 0, 0, 1, DECAL_MISS)).toBe(false);
    expect(d.count).toBe(2);
    expect(d.x.length).toBe(2);
    d.clear(0.2);
    expect(d.count).toBe(0);
    expect(d.radius).toBe(0.2);
    expect(d.add(1, 1, 1, 0, 0, 1, DECAL_HEAD)).toBe(true);
    expect(d.count).toBe(1);
  });

  it('setLastKind on an empty buffer is a no-op', () => {
    const d = new SprayDecals(2);
    const v = d.version;
    d.setLastKind(DECAL_HEAD);
    expect(d.version).toBe(v);
  });
});
