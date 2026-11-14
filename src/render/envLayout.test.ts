import { describe, expect, it } from 'vitest';
import { render } from '../config/render';
import { vec3 } from '../core/vec3';
import type { BoxDef } from '../sim/types';
import { BOX_EDGES, buildWedge, isPillar, rampParts, trimSegments } from './envLayout';

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

const ramp = (rise: '+x' | '-x' | '+z' | '-z', lowY: number): BoxDef => ({
  tag: 'ramp',
  min: vec3(0, 0, 0),
  max: vec3(4, 2, 2),
  ramp: { rise, lowY },
});

describe('ramps', () => {
  it('the unit wedge is closed, flat-shaded and wound counter-clockwise from outside', () => {
    const w = buildWedge();
    expect(w.indices.length / 3).toBe(2 + 2 + 2 + 1 + 1);
    for (let t = 0; t < w.indices.length; t += 3) {
      const [i0, i1, i2] = [w.indices[t]!, w.indices[t + 1]!, w.indices[t + 2]!];
      const p = (i: number) => [w.positions[i * 3]!, w.positions[i * 3 + 1]!, w.positions[i * 3 + 2]!];
      const [a, b, c] = [p(i0), p(i1), p(i2)] as [number[], number[], number[]];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const n = [w.normals[i0 * 3]!, w.normals[i0 * 3 + 1]!, w.normals[i0 * 3 + 2]!];
      expect(cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!).toBeGreaterThan(0);
      // the face is on the outside: its centroid is not on the inner side of the origin (the slope passes through it)
      const cen = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3];
      expect(cen[0]! * n[0]! + cen[1]! * n[1]! + cen[2]! * n[2]!).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('a ramp is trimmed with its own edges (10 on its base, 12 with a riser), not the box ones', () => {
    expect(trimSegments([ramp('+x', 0)]).length / 6).toBe(10);
    expect(trimSegments([ramp('+x', 0.5)]).length / 6).toBe(12);
    // every trim endpoint lies on the solid: at or below the sloped surface
    const seg = trimSegments([ramp('+x', 0)]);
    for (let i = 0; i < seg.length; i += 3) expect(seg[i + 1]!).toBeLessThanOrEqual(seg[i]! * 0.5 + 1e-9);
  });

  it('derives the riser and the wedge transform for each direction', () => {
    const p = rampParts(ramp('+x', 0.5));
    expect(p.riser).toEqual({ min: [0, 0, 0], max: [4, 0.5, 2] });
    expect(p.centre).toEqual([2, 1.25, 1]);
    expect(p.scale).toEqual([4, 1.5, 2]);
    expect(rampParts(ramp('+x', 0)).riser).toBeNull();
    expect(rampParts(ramp('-x', 0)).rotY).toBeCloseTo(Math.PI, 9);
    // rotating the wedge's +x edge onto the world: '+z' maps +x to +z (rotation of -90 deg about Y)
    const rz = rampParts(ramp('+z', 0));
    expect([rz.scale[0], rz.scale[2]]).toEqual([2, 4]); // length is the z extent, width the x extent
    expect(Math.cos(rz.rotY) * 1).toBeCloseTo(0, 9);
    expect(-Math.sin(rz.rotY)).toBeCloseTo(1, 9); // +x -> +z
  });

  it('a ramp is never a pillar', () => {
    expect(isPillar({ ...ramp('+x', 0), max: vec3(0.6, 3, 0.6) }, render.blob)).toBe(false);
  });
});
