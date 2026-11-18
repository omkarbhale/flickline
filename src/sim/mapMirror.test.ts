import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { sectorSources } from '../modes/sweepCatalog';
import { entryEye, hiddenSpots } from '../modes/sweepDirector';
import { elbowMap, findMap, MAPS } from './mapLoader';
import { isMirrorId, mirroredMap, mirrorId, mirrorMap, mirrorPoint, mirrorYaw } from './mapMirror';

describe('mirrored maps', () => {
  it('names a mirror <id>~m, and a mirror of a mirror is the map', () => {
    expect(mirrorId('elbow')).toBe('elbow~m');
    expect(mirrorId('elbow~m')).toBe('elbow');
    expect(isMirrorId('elbow~m')).toBe(true);
    expect(isMirrorId('elbow')).toBe(false);
  });

  it('reflects positions in x = 0 and turns yaw to -yaw (forward (-sin yaw, -cos yaw) mirrors in x)', () => {
    expect(mirrorPoint({ x: 3, y: 1, z: -2 })).toEqual({ x: -3, y: 1, z: -2 });
    const yaw = 0.7;
    const f = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const m = mirrorYaw(yaw);
    expect(-Math.sin(m)).toBeCloseTo(-f.x);
    expect(-Math.cos(m)).toBeCloseTo(f.z);
  });

  it('every box keeps its size and swaps its x bounds; an x ramp rises the other way', () => {
    const m = mirrorMap(elbowMap);
    expect(m.id).toBe('elbow~m');
    expect(m.boxes).toHaveLength(elbowMap.boxes.length);
    elbowMap.boxes.forEach((b, i) => {
      const c = m.boxes[i]!;
      expect(c.min.x).toBe(-b.max.x);
      expect(c.max.x).toBe(-b.min.x);
      expect(c.max.x - c.min.x).toBeCloseTo(b.max.x - b.min.x);
      expect(c.id).toBe(b.id);
      if (b.ramp?.rise === '+x') expect(c.ramp?.rise).toBe('-x');
      if (b.ramp?.rise === '+z') expect(c.ramp?.rise).toBe('+z');
    });
    expect(m.bounds.min.x).toBe(-elbowMap.bounds.max.x);
    expect(m.sectors.map((s) => s.id)).toEqual(elbowMap.sectors.map((s) => s.id));
  });

  it('keeps every sight line: the hidden anchors of each sector stay hidden in the mirror', () => {
    const t = cloneTunables();
    const a = sectorSources(elbowMap, t);
    const b = sectorSources(mirroredMap(elbowMap), t);
    a.forEach((s, i) => {
      const r = b[i]!;
      expect(r.entry).toEqual(mirrorPoint(s.entry));
      expect(r.entryYaw).toBeCloseTo(mirrorYaw(s.entryYaw));
      expect(hiddenSpots(r, t.movement).map((p) => p.id)).toEqual(hiddenSpots(s, t.movement).map((p) => p.id));
      const eye = entryEye(r, t.movement);
      for (const p of s.spots) expect(r.visible(eye, mirrorPoint(p.feet), p.crouched)).toBe(s.visible(entryEye(s, t.movement), p.feet, p.crouched));
    });
  });

  it('finds shipped maps and their mirrors by id, one mirror object per map', () => {
    expect(findMap('elbow')).toBe(MAPS.elbow);
    expect(findMap('elbow~m')).toBe(findMap('elbow~m'));
    expect(findMap('elbow~m')?.id).toBe('elbow~m');
    expect(findMap('nowhere')).toBeNull();
    expect(findMap('nowhere~m')).toBeNull();
  });
});
