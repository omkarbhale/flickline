import type { BoxDef } from '../sim/types';
import type { RenderTunables } from '../config/render';

/**
 * Pure helpers (no three.js) deciding what the Lightline environment draws for a level; kept
 * separate so they are unit-testable without WebGL.
 */

/** The 12 edges of a box as pairs of corner indices; corner bit 0 = x, bit 1 = y, bit 2 = z (max side if set). */
export const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/** Whether a box is a pillar: tall and narrow in both horizontal directions. */
export function isPillar(b: BoxDef, cfg: RenderTunables['blob']): boolean {
  if (b.tag === 'floor' || b.ramp !== undefined) return false;
  const dx = b.max.x - b.min.x;
  const dz = b.max.z - b.min.z;
  const h = b.max.y - b.min.y;
  return h >= cfg.pillarMinHeight && dx <= cfg.pillarMaxFootprint && dz <= cfg.pillarMaxFootprint;
}

/**
 * Trim edges for a level, as a flat array of segment endpoints (x,y,z, x,y,z, ...). Non-floor
 * boxes get all 12 edges; floor slabs only the outline of their top face.
 */
export function trimSegments(boxes: readonly BoxDef[]): number[] {
  const out: number[] = [];
  for (const b of boxes) {
    if (b.ramp !== undefined) {
      rampTrim(b, out);
      continue;
    }
    for (let e = 0; e < BOX_EDGES.length; e++) {
      const [i0, i1] = BOX_EDGES[e]!;
      if (b.tag === 'floor' && !((i0 & 2) !== 0 && (i1 & 2) !== 0)) continue; // top face edges only
      out.push(
        i0 & 1 ? b.max.x : b.min.x, i0 & 2 ? b.max.y : b.min.y, i0 & 4 ? b.max.z : b.min.z,
        i1 & 1 ? b.max.x : b.min.x, i1 & 2 ? b.max.y : b.min.y, i1 & 4 ? b.max.z : b.min.z,
      );
    }
  }
  return out;
}

/**
 * The 8 corners of a ramp solid as (x, y, z) triples written into `out`'s caller via the helpers
 * below: `along` is the coordinate on the climbing axis (low face / high face), `side` the one
 * across it.
 */
interface RampFrame {
  alongX: boolean;
  /** Coordinate of the low and the high face on the climbing axis. */
  lo: number;
  hi: number;
  /** Cross-axis extent. */
  s0: number;
  s1: number;
}

function rampFrame(b: BoxDef): RampFrame {
  switch (b.ramp!.rise) {
    case '+x': return { alongX: true, lo: b.min.x, hi: b.max.x, s0: b.min.z, s1: b.max.z };
    case '-x': return { alongX: true, lo: b.max.x, hi: b.min.x, s0: b.min.z, s1: b.max.z };
    case '+z': return { alongX: false, lo: b.min.z, hi: b.max.z, s0: b.min.x, s1: b.max.x };
    default: return { alongX: false, lo: b.max.z, hi: b.min.z, s0: b.min.x, s1: b.max.x };
  }
}

function rampPoint(f: RampFrame, along: number, y: number, side: number, out: number[]): void {
  if (f.alongX) out.push(along, y, side);
  else out.push(side, y, along);
}

/** Trim edges of a ramp: the base outline, the sloped top's four edges and the vertical edges (the riser at the low end, the full height at the high end). */
function rampTrim(b: BoxDef, out: number[]): void {
  const f = rampFrame(b);
  const y0 = b.min.y;
  const yl = b.ramp!.lowY;
  const yh = b.max.y;
  const seg = (a0: number, ay: number, as: number, b0: number, by: number, bs: number): void => {
    rampPoint(f, a0, ay, as, out);
    rampPoint(f, b0, by, bs, out);
  };
  // base rectangle
  seg(f.lo, y0, f.s0, f.hi, y0, f.s0);
  seg(f.lo, y0, f.s1, f.hi, y0, f.s1);
  seg(f.lo, y0, f.s0, f.lo, y0, f.s1);
  seg(f.hi, y0, f.s0, f.hi, y0, f.s1);
  // sloped top: low edge, high edge and the two slope edges
  seg(f.lo, yl, f.s0, f.lo, yl, f.s1);
  seg(f.hi, yh, f.s0, f.hi, yh, f.s1);
  seg(f.lo, yl, f.s0, f.hi, yh, f.s0);
  seg(f.lo, yl, f.s1, f.hi, yh, f.s1);
  // vertical edges
  seg(f.hi, y0, f.s0, f.hi, yh, f.s0);
  seg(f.hi, y0, f.s1, f.hi, yh, f.s1);
  if (yl - y0 > 1e-4) {
    seg(f.lo, y0, f.s0, f.lo, yl, f.s0);
    seg(f.lo, y0, f.s1, f.lo, yl, f.s1);
  }
}

/**
 * How to draw a ramp from instanced primitives: the solid below `lowY` is an ordinary box (the
 * riser at the low end; absent when the ramp starts on its base) and the part above is a unit
 * wedge (a triangular prism, see `WEDGE`) placed by this transform: scale `(length along the
 * climb, height, width across it)`, then rotate about +Y by `rotY`, then translate to the centre.
 */
export interface RampParts {
  /** Riser box (same footprint, `min.y..lowY`) or null. */
  riser: { min: [number, number, number]; max: [number, number, number] } | null;
  centre: [number, number, number];
  scale: [number, number, number];
  rotY: number;
}

export function rampParts(b: BoxDef): RampParts {
  const r = b.ramp!;
  const alongX = r.rise === '+x' || r.rise === '-x';
  const length = alongX ? b.max.x - b.min.x : b.max.z - b.min.z;
  const width = alongX ? b.max.z - b.min.z : b.max.x - b.min.x;
  const rotY = r.rise === '+x' ? 0 : r.rise === '-x' ? Math.PI : r.rise === '+z' ? -Math.PI / 2 : Math.PI / 2;
  return {
    riser:
      r.lowY - b.min.y > 1e-4
        ? { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, r.lowY, b.max.z] }
        : null,
    centre: [(b.min.x + b.max.x) / 2, (r.lowY + b.max.y) / 2, (b.min.z + b.max.z) / 2],
    scale: [length, b.max.y - r.lowY, width],
    rotY,
  };
}

/**
 * The unit wedge: x, y, z in [-0.5, 0.5], the sloped face rising from (x = -0.5, y = -0.5) to
 * (x = +0.5, y = +0.5). Flat-shaded (per-face normals), counter-clockwise outward winding.
 */
export interface WedgeMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

type V3 = [number, number, number];

export function buildWedge(): WedgeMesh {
  const A: V3 = [-0.5, -0.5, -0.5], B: V3 = [0.5, -0.5, -0.5], C: V3 = [0.5, -0.5, 0.5], D: V3 = [-0.5, -0.5, 0.5];
  const E: V3 = [0.5, 0.5, -0.5], F: V3 = [0.5, 0.5, 0.5];
  const s = Math.SQRT1_2;
  const faces: { verts: V3[]; normal: V3 }[] = [
    { verts: [A, B, C, D], normal: [0, -1, 0] }, // base
    { verts: [B, E, F, C], normal: [1, 0, 0] }, // high end
    { verts: [A, D, F, E], normal: [-s, s, 0] }, // slope
    { verts: [A, E, B], normal: [0, 0, -1] }, // side z-
    { verts: [D, C, F], normal: [0, 0, 1] }, // side z+
  ];
  const out: WedgeMesh = { positions: [], normals: [], indices: [] };
  for (const f of faces) {
    const base = out.positions.length / 3;
    // Wind the face counter-clockwise as seen from outside, whatever order the corners were listed in.
    const [p0, p1, p2] = f.verts as [V3, V3, V3];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const dot = (uy * vz - uz * vy) * f.normal[0] + (uz * vx - ux * vz) * f.normal[1] + (ux * vy - uy * vx) * f.normal[2];
    const verts = dot >= 0 ? f.verts : [...f.verts].reverse();
    for (const v of verts) {
      out.positions.push(v[0], v[1], v[2]);
      out.normals.push(f.normal[0], f.normal[1], f.normal[2]);
    }
    for (let i = 1; i < verts.length - 1; i++) out.indices.push(base, base + i, base + i + 1);
  }
  return out;
}
