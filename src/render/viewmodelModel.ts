import { srgbToLinear } from '../core/color';
import type { ViewmodelId, ViewmodelTunables } from '../config/viewmodel';

/**
 * Procedural low-poly first-person weapons (design section 11), as plain typed arrays: no three.js
 * here, so the budgets (triangles, one mesh, no textures) and the on-screen footprint can be
 * unit-tested.
 *
 * Each weapon is ONE merged, non-indexed mesh: convex prisms and cylinders with flat faces, a
 * per-vertex linear colour (matte dark body, darker details, glove) and a per-vertex `trim` flag
 * (the single line of light, drawn unlit). One mesh means one draw call.
 *
 * Model space: metres, +X right, +Y up, the barrel along -Z, the origin at the grip. The viewmodel
 * layer places this at the weapon's rest pose; the muzzle point is where the flash and the
 * tracers start.
 */

export interface ViewmodelMeshData {
  id: ViewmodelId;
  triangleCount: number;
  vertexCount: number;
  /** xyz per vertex. */
  position: Float32Array;
  /** Flat face normal per vertex. */
  normal: Float32Array;
  /** Linear-light rgb per vertex. */
  color: Float32Array;
  /** 1 on the trim line (drawn unlit in the trim colour), else 0. */
  trim: Float32Array;
  /** Where the flash and the tracers start, model space. */
  muzzle: { x: number; y: number; z: number };
}

type P3 = readonly [number, number, number];

interface Builder {
  pos: number[];
  nrm: number[];
  col: number[];
  trim: number[];
}

function hexToLinear(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

/** One triangle, wound so its normal points away from `centre` (the solids here are convex). */
function tri(b: Builder, a: P3, c: P3, d: P3, centre: P3, rgb: readonly number[], trim: number): void {
  const e1x = c[0] - a[0], e1y = c[1] - a[1], e1z = c[2] - a[2];
  const e2x = d[0] - a[0], e2y = d[1] - a[1], e2z = d[2] - a[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const mx = (a[0] + c[0] + d[0]) / 3 - centre[0];
  const my = (a[1] + c[1] + d[1]) / 3 - centre[1];
  const mz = (a[2] + c[2] + d[2]) / 3 - centre[2];
  let v1 = c, v2 = d;
  if (nx * mx + ny * my + nz * mz < 0) {
    v1 = d;
    v2 = c;
    nx = -nx; ny = -ny; nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  for (const v of [a, v1, v2]) {
    b.pos.push(v[0], v[1], v[2]);
    b.nrm.push(nx, ny, nz);
    b.col.push(rgb[0]!, rgb[1]!, rgb[2]!);
    b.trim.push(trim);
  }
}

function centroid(points: readonly P3[]): P3 {
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    x += p[0]; y += p[1]; z += p[2];
  }
  const n = points.length;
  return [x / n, y / n, z / n];
}

/** A convex prism between two quads (each given in a consistent corner order): 12 triangles. */
function prism(b: Builder, a: readonly [P3, P3, P3, P3], c: readonly [P3, P3, P3, P3], color: number, trim = 0): void {
  const rgb = hexToLinear(color);
  const centre = centroid([...a, ...c]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(b, a[i]!, a[j]!, c[j]!, centre, rgb, trim);
    tri(b, a[i]!, c[j]!, c[i]!, centre, rgb, trim);
  }
  tri(b, a[0], a[1], a[2], centre, rgb, trim);
  tri(b, a[0], a[2], a[3], centre, rgb, trim);
  tri(b, c[0], c[1], c[2], centre, rgb, trim);
  tri(b, c[0], c[2], c[3], centre, rgb, trim);
}

/** Axis-aligned rectangle in the XY plane at depth z. */
function rectXY(cx: number, cy: number, z: number, w: number, h: number): [P3, P3, P3, P3] {
  return [
    [cx - w / 2, cy - h / 2, z], [cx + w / 2, cy - h / 2, z],
    [cx + w / 2, cy + h / 2, z], [cx - w / 2, cy + h / 2, z],
  ];
}

/** Axis-aligned rectangle in the XZ plane at height y. */
function rectXZ(cx: number, y: number, cz: number, w: number, d: number): [P3, P3, P3, P3] {
  return [
    [cx - w / 2, y, cz - d / 2], [cx + w / 2, y, cz - d / 2],
    [cx + w / 2, y, cz + d / 2], [cx - w / 2, y, cz + d / 2],
  ];
}

/** Axis-aligned box. */
function box(b: Builder, cx: number, cy: number, cz: number, w: number, h: number, d: number, color: number, trim = 0): void {
  prism(b, rectXY(cx, cy, cz - d / 2, w, h), rectXY(cx, cy, cz + d / 2, w, h), color, trim);
}

/** A rectangular beam along Z whose cross-section changes from (w0, h0) at z0 to (w1, h1) at z1. */
function beamZ(
  b: Builder, cx: number, cy: number, z0: number, z1: number,
  w0: number, h0: number, w1: number, h1: number, color: number, trim = 0,
): void {
  prism(b, rectXY(cx, cy, z0, w0, h0), rectXY(cx, cy, z1, w1, h1), color, trim);
}

/** A beam running down (or up) in Y between two XZ rectangles, for magazines and grips. */
function beamY(
  b: Builder, y0: number, cx0: number, cz0: number, w0: number, d0: number,
  y1: number, cx1: number, cz1: number, w1: number, d1: number, color: number,
): void {
  prism(b, rectXZ(cx0, y0, cz0, w0, d0), rectXZ(cx1, y1, cz1, w1, d1), color);
}

/** An n-gon cylinder (or cone frustum) along Z, from radius r0 at z0 to r1 at z1: 4n triangles. */
function cylZ(b: Builder, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, n: number, color: number): void {
  const rgb = hexToLinear(color);
  const centre: P3 = [cx, cy, (z0 + z1) / 2];
  const ring = (z: number, r: number, i: number): P3 => {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  };
  const c0: P3 = [cx, cy, z0];
  const c1: P3 = [cx, cy, z1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(b, ring(z0, r0, i), ring(z0, r0, j), ring(z1, r1, j), centre, rgb, 0);
    tri(b, ring(z0, r0, i), ring(z1, r1, j), ring(z1, r1, i), centre, rgb, 0);
    tri(b, c0, ring(z0, r0, i), ring(z0, r0, j), centre, rgb, 0);
    tri(b, c1, ring(z1, r1, i), ring(z1, r1, j), centre, rgb, 0);
  }
}

/** A gloved hand around a grip at (x, y, z): palm, three finger blocks, a thumb and a forearm that runs off screen. */
function hand(b: Builder, x: number, y: number, z: number, glove: number, side: 1 | -1, thumbUp: boolean): void {
  box(b, x, y - 0.012, z + 0.004, 0.056, 0.07, 0.05, glove); // palm
  for (let i = 0; i < 3; i++) box(b, x, y + 0.016 - i * 0.022, z - 0.036, 0.05, 0.02, 0.026, glove); // fingers
  box(b, x - side * 0.03, y + (thumbUp ? 0.012 : -0.006), z - 0.008, 0.016, 0.026, 0.05, glove); // thumb
  beamZ(b, x + side * 0.012, y - 0.05, z + 0.03, z + 0.26, 0.058, 0.062, 0.08, 0.09, glove); // forearm
}

/** A hand cupped under a handguard at (x, y, z). */
function supportHand(b: Builder, x: number, y: number, z: number, glove: number): void {
  box(b, x, y, z, 0.07, 0.034, 0.07, glove); // palm and fingers under the rail
  box(b, x - 0.034, y + 0.022, z, 0.016, 0.03, 0.06, glove); // thumb along the left side
  beamZ(b, x - 0.01, y - 0.028, z + 0.04, z + 0.3, 0.06, 0.05, 0.085, 0.07, glove); // forearm
}

function pace(b: Builder, c: ViewmodelTunables['colors']): P3 {
  const { body, dark, glove, trim } = c;
  // Slide and frame.
  beamZ(b, 0, 0.034, -0.13, 0.05, 0.028, 0.034, 0.034, 0.036, body);
  box(b, 0, 0.004, -0.04, 0.032, 0.026, 0.17, dark);
  // Trim line along the top of the slide.
  box(b, 0, 0.0525, -0.045, 0.0045, 0.0014, 0.16, trim, 1);
  // Barrel tip and sights.
  cylZ(b, 0, 0.034, -0.15, -0.126, 0.0085, 0.0085, 8, dark);
  box(b, 0, 0.056, -0.12, 0.006, 0.008, 0.01, dark);
  box(b, 0, 0.056, 0.04, 0.014, 0.008, 0.012, dark);
  // Grip, trigger guard, trigger.
  beamY(b, -0.01, 0, 0.032, 0.03, 0.05, -0.11, 0, 0.056, 0.03, 0.05, dark);
  box(b, 0, -0.027, -0.012, 0.01, 0.004, 0.05, dark);
  box(b, 0, -0.02, -0.036, 0.01, 0.018, 0.005, dark);
  box(b, 0, -0.014, -0.003, 0.006, 0.014, 0.006, body);
  // Hands: the firing hand and the support hand wrapped over its front.
  hand(b, 0.001, -0.06, 0.048, glove, 1, true);
  box(b, -0.03, -0.062, 0.018, 0.034, 0.07, 0.05, glove);
  return [0, 0.034, -0.15];
}

function kestrel(b: Builder, c: ViewmodelTunables['colors']): P3 {
  const { body, dark, glove, trim } = c;
  // Receiver, top cover, handguard.
  box(b, 0, 0, -0.02, 0.044, 0.056, 0.26, body);
  box(b, 0, 0.034, -0.03, 0.03, 0.012, 0.22, dark);
  beamZ(b, 0, -0.004, -0.15, -0.37, 0.05, 0.052, 0.042, 0.044, body);
  // Trim line along the left side of the receiver and handguard.
  box(b, -0.0225, 0.012, -0.12, 0.0015, 0.005, 0.4, trim, 1);
  // Barrel, muzzle brake, sights.
  cylZ(b, 0, 0.004, -0.37, -0.5, 0.0095, 0.0095, 8, dark);
  cylZ(b, 0, 0.004, -0.5, -0.56, 0.014, 0.014, 8, body);
  box(b, 0, 0.032, -0.44, 0.006, 0.026, 0.008, dark);
  box(b, 0, 0.044, 0.07, 0.016, 0.014, 0.012, dark);
  // Magazine (leans forward), grip, stock, trigger guard.
  beamY(b, -0.028, 0, -0.02, 0.03, 0.052, -0.17, 0, -0.055, 0.03, 0.056, dark);
  beamY(b, -0.028, 0, 0.075, 0.034, 0.042, -0.125, 0, 0.1, 0.034, 0.042, dark);
  box(b, 0, -0.03, 0.03, 0.01, 0.004, 0.06, dark);
  beamZ(b, 0, -0.012, 0.11, 0.28, 0.036, 0.062, 0.036, 0.09, dark);
  // Hands: firing hand on the grip, support hand under the handguard.
  hand(b, 0, -0.085, 0.082, glove, 1, true);
  supportHand(b, -0.004, -0.048, -0.24, glove);
  return [0, 0.004, -0.56];
}

function rill(b: Builder, c: ViewmodelTunables['colors']): P3 {
  const { body, dark, glove, trim } = c;
  // Receiver and top cover.
  box(b, 0, 0, 0, 0.05, 0.07, 0.22, body);
  box(b, 0, 0.042, -0.02, 0.036, 0.014, 0.2, dark);
  // Trim line along the top of the cover.
  box(b, 0, 0.0505, -0.02, 0.0045, 0.0014, 0.19, trim, 1);
  // Shroud and muzzle.
  cylZ(b, 0, 0.004, -0.11, -0.27, 0.026, 0.024, 8, body);
  cylZ(b, 0, 0.004, -0.27, -0.31, 0.012, 0.012, 8, dark);
  box(b, 0, 0.034, -0.24, 0.006, 0.022, 0.008, dark);
  box(b, 0, 0.056, 0.07, 0.016, 0.014, 0.012, dark);
  // Straight magazine, pistol grip, foregrip, wire stock, trigger guard.
  beamY(b, -0.034, 0, -0.01, 0.028, 0.046, -0.215, 0, -0.016, 0.028, 0.046, dark);
  beamY(b, -0.034, 0, 0.07, 0.034, 0.04, -0.13, 0, 0.092, 0.034, 0.04, dark);
  beamY(b, -0.028, 0, -0.15, 0.03, 0.036, -0.1, 0, -0.152, 0.03, 0.036, dark);
  box(b, 0, -0.034, 0.03, 0.01, 0.004, 0.06, dark);
  box(b, -0.014, 0.002, 0.18, 0.006, 0.006, 0.14, dark);
  box(b, 0.014, 0.002, 0.18, 0.006, 0.006, 0.14, dark);
  box(b, 0, 0.002, 0.255, 0.04, 0.05, 0.012, dark);
  // Hands.
  hand(b, 0, -0.088, 0.082, glove, 1, true);
  supportHand(b, -0.003, -0.108, -0.15, glove);
  return [0, 0.004, -0.31];
}

const BUILDERS: Record<ViewmodelId, (b: Builder, c: ViewmodelTunables['colors']) => P3> = { pace, kestrel, rill };

/** Build the mesh data for weapon `id`. Called once per weapon at startup (allocation is fine here). */
export function buildViewmodel(id: ViewmodelId, colors: ViewmodelTunables['colors']): ViewmodelMeshData {
  const b: Builder = { pos: [], nrm: [], col: [], trim: [] };
  const m = BUILDERS[id](b, colors);
  const vertexCount = b.pos.length / 3;
  return {
    id,
    triangleCount: vertexCount / 3,
    vertexCount,
    position: new Float32Array(b.pos),
    normal: new Float32Array(b.nrm),
    color: new Float32Array(b.col),
    trim: new Float32Array(b.trim),
    muzzle: { x: m[0], y: m[1], z: m[2] },
  };
}
