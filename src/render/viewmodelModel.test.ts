import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { VIEWMODEL_IDS } from '../config/viewmodel';
import { buildViewmodel } from './viewmodelModel';

const colors = cloneTunables().viewmodel.colors;

describe('procedural viewmodel meshes (issue #45)', () => {
  for (const id of VIEWMODEL_IDS) {
    const m = buildViewmodel(id, colors);

    it(`${id}: at most 1,500 triangles, one merged mesh, no textures`, () => {
      expect(m.triangleCount).toBeGreaterThan(100);
      expect(m.triangleCount).toBeLessThanOrEqual(1500);
      expect(m.vertexCount).toBe(m.triangleCount * 3);
      // One mesh: every attribute is a flat per-vertex array of the same length; there is no uv.
      expect(m.position.length).toBe(m.vertexCount * 3);
      expect(m.normal.length).toBe(m.vertexCount * 3);
      expect(m.color.length).toBe(m.vertexCount * 3);
      expect(m.trim.length).toBe(m.vertexCount);
      expect(Object.keys(m).some((k) => /uv|texture|map/i.test(k))).toBe(false);
    });

    it(`${id}: finite numbers, unit normals facing away from the geometry`, () => {
      for (const arr of [m.position, m.normal, m.color, m.trim]) {
        for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i]!)).toBe(true);
      }
      for (let v = 0; v < m.vertexCount; v++) {
        const l = Math.hypot(m.normal[3 * v]!, m.normal[3 * v + 1]!, m.normal[3 * v + 2]!);
        expect(l).toBeGreaterThan(0.999);
        expect(l).toBeLessThan(1.001);
      }
    });

    it(`${id}: a single trim line, as whole triangles`, () => {
      let trimVerts = 0;
      for (let v = 0; v < m.vertexCount; v++) trimVerts += m.trim[v]!;
      // One thin box: 12 triangles.
      expect(trimVerts).toBe(36);
      for (let t = 0; t < m.triangleCount; t++) {
        expect(m.trim[3 * t]).toBe(m.trim[3 * t + 1]);
        expect(m.trim[3 * t]).toBe(m.trim[3 * t + 2]);
      }
    });

    it(`${id}: the muzzle is the foremost point of the barrel, in front of the grip`, () => {
      let minZ = Infinity;
      for (let v = 0; v < m.vertexCount; v++) minZ = Math.min(minZ, m.position[3 * v + 2]!);
      expect(m.muzzle.z).toBeLessThan(-0.1);
      // Nothing (bar float fuzz) extends past the muzzle.
      expect(minZ).toBeGreaterThan(m.muzzle.z - 0.01);
    });
  }

  it('the three weapons have distinct silhouettes (length and bulk differ)', () => {
    const z = VIEWMODEL_IDS.map((id) => buildViewmodel(id, colors).muzzle.z);
    expect(new Set(z).size).toBe(3);
  });
});
