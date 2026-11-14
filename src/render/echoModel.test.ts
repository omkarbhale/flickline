import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { ZONE_HEAD, ZONE_LEG, ZONE_TORSO, buildEchoMesh, buildGnatMesh, buildOrbMesh, measureZone, poseDims } from './echoModel';

const t = cloneTunables();
const hit = t.targets.hit;
const mesh = buildEchoMesh(hit, t.echo.shape);

/** Relative error of a measured dimension against the spec value (absolute floor for ~0). */
function within2pct(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.max(0.02 * Math.abs(expected), 1e-4));
}

describe('Echo mesh', () => {
  it('stays within the 400 triangle budget (design 14.1 / issue #18)', () => {
    expect(mesh.triangleCount).toBeLessThanOrEqual(400);
    expect(mesh.vertexCount).toBe(mesh.triangleCount * 3);
  });

  it('has the same topology standing and crouched (the shader morphs between them)', () => {
    expect(mesh.positionC.length).toBe(mesh.position.length);
    expect(mesh.centroidC.length).toBe(mesh.centroid.length);
  });

  for (const crouched of [false, true]) {
    const pose = crouched ? 'crouched' : 'standing';
    const d = poseDims(hit, crouched);

    it(`head matches the hit sphere (${pose}): radius and centre within 2%`, () => {
      const b = measureZone(mesh, ZONE_HEAD, crouched);
      within2pct((b.maxX - b.minX) / 2, hit.headRadius);
      within2pct((b.maxZ - b.minZ) / 2, hit.headRadius);
      within2pct((b.maxY - b.minY) / 2, hit.headRadius);
      within2pct((b.maxY + b.minY) / 2, d.headCentre);
      expect((b.maxX + b.minX) / 2).toBeCloseTo(0, 6);
    });

    it(`torso and arms match the body zone (${pose}): height range and width within 2%`, () => {
      const b = measureZone(mesh, ZONE_TORSO, crouched);
      within2pct(b.minY, d.torsoBottom);
      within2pct(b.maxY, d.torsoTop);
      within2pct(b.maxX - b.minX, hit.torsoWidth);
    });

    it(`legs match the leg zone (${pose}): floor to leg top and width within 2%`, () => {
      const b = measureZone(mesh, ZONE_LEG, crouched);
      expect(b.minY).toBeCloseTo(0, 6);
      within2pct(b.maxY, d.legTop);
      within2pct(b.maxX - b.minX, hit.legWidth);
    });

    it(`the zones stack without gaps or overlaps (${pose}): legs top = torso bottom, torso top = head bottom`, () => {
      const legs = measureZone(mesh, ZONE_LEG, crouched);
      const torso = measureZone(mesh, ZONE_TORSO, crouched);
      const head = measureZone(mesh, ZONE_HEAD, crouched);
      expect(legs.maxY).toBeCloseTo(torso.minY, 6);
      expect(torso.maxY).toBeCloseTo(head.minY, 6);
    });
  }

  it('the crouched head is lower by exactly the hit-zone difference', () => {
    const s = measureZone(mesh, ZONE_HEAD, false);
    const c = measureZone(mesh, ZONE_HEAD, true);
    expect(s.maxY - c.maxY).toBeCloseTo(hit.headCentreStand - hit.headCentreCrouch, 5);
  });

  it('has outward-facing, non-degenerate triangles (head fully; whole mesh by signed volume)', () => {
    const n = mesh.triangleCount;
    let volume = 0;
    const hc = hit.headCentreStand;
    for (let tri = 0; tri < n; tri++) {
      const o = tri * 9;
      const p = mesh.position;
      const ax = p[o]!, ay = p[o + 1]!, az = p[o + 2]!;
      const bx = p[o + 3]!, by = p[o + 4]!, bz = p[o + 5]!;
      const cx = p[o + 6]!, cy = p[o + 7]!, cz = p[o + 8]!;
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const area = Math.hypot(nx, ny, nz) / 2;
      expect(area, `triangle ${tri}`).toBeGreaterThan(1e-7);
      // Signed volume of the tetrahedron (origin, a, b, c); positive in total for outward windings.
      volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      if (mesh.meta[tri * 6] === ZONE_HEAD) {
        const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3 - hc, mz = (az + bz + cz) / 3;
        expect(nx * mx + ny * my + nz * mz, `head triangle ${tri} faces outwards`).toBeGreaterThan(0);
      }
    }
    expect(volume).toBeGreaterThan(0);
  });

  it('smooth and flat normals are unit length', () => {
    for (let v = 0; v < mesh.vertexCount; v++) {
      expect(Math.hypot(mesh.normal[v * 3]!, mesh.normal[v * 3 + 1]!, mesh.normal[v * 3 + 2]!)).toBeCloseTo(1, 4);
      expect(Math.hypot(mesh.smooth[v * 3]!, mesh.smooth[v * 3 + 1]!, mesh.smooth[v * 3 + 2]!)).toBeCloseTo(1, 4);
    }
  });
});

describe('Beacon and Gnat meshes', () => {
  it('the Beacon orb is exactly the hit sphere (head radius) and centred', () => {
    const orb = buildOrbMesh(t.targets.kinds.beacon.orbRadius, t.echo.beacon.segments, t.echo.beacon.rings);
    const b = measureZone(orb, ZONE_HEAD, false);
    within2pct((b.maxX - b.minX) / 2, t.targets.kinds.beacon.orbRadius);
    within2pct((b.maxY - b.minY) / 2, t.targets.kinds.beacon.orbRadius);
    expect((b.maxY + b.minY) / 2).toBeCloseTo(0, 6);
    expect(orb.triangleCount).toBeLessThanOrEqual(400);
  });

  it('the Gnat is an octahedron (8 faces), hand-sized', () => {
    const g = buildGnatMesh(t.echo.gnat.radius, t.echo.gnat.stretch);
    expect(g.triangleCount).toBe(8);
    const b = measureZone(g, ZONE_HEAD, false);
    expect(b.maxX - b.minX).toBeLessThan(0.3);
    expect(b.maxY - b.minY).toBeGreaterThan(b.maxX - b.minX); // stretched: reads differently from the round Beacon
  });
});
