import { describe, expect, it } from 'vitest';
import { render } from '../config/render';
import { vec3 } from '../core/vec3';
import type { BoxDef } from '../sim/types';
import { BOX_EDGES, isPillar, trimSegments } from './envLayout';

const b = (tag: BoxDef['tag'], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef => ({
  tag,
  min: vec3(x0, y0, z0),
  max: vec3(x1, y1, z1),
});

describe('trimSegments', () => {
  it('emits 12 edges per prop box and only the top outline (4 edges) per floor slab', () => {
    const seg = trimSegments([b('crate', 0, 0, 0, 1, 1, 1), b('floor', -5, -1, -5, 5, 0, 5)]);
    expect(seg.length / 6).toBe(12 + 4);
  });

  it('every segment has both endpoints on the box surface corners', () => {
    const seg = trimSegments([b('wall', 1, 2, 3, 4, 6, 9)]);
    for (let i = 0; i < seg.length; i += 3) {
      expect([1, 4]).toContain(seg[i]);
      expect([2, 6]).toContain(seg[i + 1]);
      expect([3, 9]).toContain(seg[i + 2]);
    }
  });

  it('edge table has 12 distinct edges joining corners that differ in exactly one axis', () => {
    expect(new Set(BOX_EDGES.map(([a, c]) => `${a}-${c}`)).size).toBe(12);
    for (const [a, c] of BOX_EDGES) expect([1, 2, 4]).toContain(a ^ c);
  });
});

describe('isPillar', () => {
  it('is tall and narrow in both horizontal directions', () => {
    expect(isPillar(b('wall', 0, 0, 0, 0.6, 3, 0.6), render.blob)).toBe(true);
    expect(isPillar(b('wall', 0, 0, 0, 0.4, 3, 3), render.blob)).toBe(false); // a wall, not a pillar
    expect(isPillar(b('crate', 0, 0, 0, 1, 1.2, 1), render.blob)).toBe(false); // too low
    expect(isPillar(b('floor', 0, 0, 0, 1, 3, 1), render.blob)).toBe(false);
  });
});
