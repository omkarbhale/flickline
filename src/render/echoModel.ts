import type { EchoRing, EchoShape } from '../config/echo';
import type { HitTunables } from '../config/targets';

/**
 * Procedural low-poly meshes for the roster (design sections 5.1, 5.2 and 11), as plain typed
 * arrays: no three.js here, so the dimensions can be unit-tested against the hit zones.
 *
 * The Echo is built from the `hit.*` tunables (never from literals), once for the standing pose
 * and once for the crouched pose with IDENTICAL topology; the shader morphs between the two with
 * one per-instance number, so a crouched Echo costs nothing extra. Meshes are non-indexed (flat
 * facets); `normal` is the flat face normal, `smooth` the averaged one (rim light, outline).
 */

/** Zone ids written into `meta[2*v]`. */
export const ZONE_LEG = 0;
export const ZONE_TORSO = 1;
export const ZONE_HEAD = 2;

export interface EchoMeshData {
  vertexCount: number;
  triangleCount: number;
  /** Standing pose positions, xyz per vertex. */
  position: Float32Array;
  /** Crouched pose positions (same as `position` for rigid meshes). */
  positionC: Float32Array;
  /** Flat face normal per vertex (standing). */
  normal: Float32Array;
  /** Smoothed normal per vertex (standing). */
  smooth: Float32Array;
  /** Centroid of the owning face, standing / crouched (the dissolve shrinks faces towards it). */
  centroid: Float32Array;
  centroidC: Float32Array;
  /** Per vertex: zone id, and a stable 0..1 random per face (staggers the dissolve). */
  meta: Float32Array;
}

/** Heights (metres above the feet) that define one pose of the humanoid. */
export interface PoseDims {
  headCentre: number;
  headRadius: number;
  torsoBottom: number;
  torsoTop: number;
  legTop: number;
}

export function poseDims(h: HitTunables, crouched: boolean): PoseDims {
  return crouched
    ? { headCentre: h.headCentreCrouch, headRadius: h.headRadius, torsoBottom: h.torsoBottomCrouch, torsoTop: h.torsoTopCrouch, legTop: h.legTopCrouch }
    : { headCentre: h.headCentreStand, headRadius: h.headRadius, torsoBottom: h.torsoBottomStand, torsoTop: h.torsoTopStand, legTop: h.legTopStand };
}

// ---------------------------------------------------------------------------------------------
// Triangle soup generation
// ---------------------------------------------------------------------------------------------

interface Soup {
  /** 9 numbers per triangle. */
  pos: number[];
  /** One zone id per triangle. */
  zone: number[];
}

function pushTri(s: Soup, a: readonly number[], b: readonly number[], c: readonly number[], zone: number): void {
  s.pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!);
  s.zone.push(zone);
}

/** Push a triangle wound so its normal points away from `centre` (for convex solids). */
function pushOut(s: Soup, a: number[], b: number[], c: number[], centre: readonly number[], zone: number): void {
  const e1x = b[0]! - a[0]!, e1y = b[1]! - a[1]!, e1z = b[2]! - a[2]!;
  const e2x = c[0]! - a[0]!, e2y = c[1]! - a[1]!, e2z = c[2]! - a[2]!;
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const mx = (a[0]! + b[0]! + c[0]!) / 3 - centre[0]!;
  const my = (a[1]! + b[1]! + c[1]!) / 3 - centre[1]!;
  const mz = (a[2]! + b[2]! + c[2]!) / 3 - centre[2]!;
  if (nx * mx + ny * my + nz * mz >= 0) pushTri(s, a, b, c, zone);
  else pushTri(s, a, c, b, zone);
}

interface Ring3 {
  y: number;
  cx: number;
  hw: number;
  hd: number;
}

function corners(r: Ring3): number[][] {
  return [
    [r.cx - r.hw, r.y, -r.hd],
    [r.cx + r.hw, r.y, -r.hd],
    [r.cx + r.hw, r.y, r.hd],
    [r.cx - r.hw, r.y, r.hd],
  ];
}

/** A box-section solid through rings (bottom to top). Winding is explicit: outward, CCW. */
function loft(s: Soup, rings: readonly Ring3[], zone: number, capBottom: boolean, capTop: boolean): void {
  for (let i = 0; i + 1 < rings.length; i++) {
    const A = corners(rings[i]!);
    const B = corners(rings[i + 1]!);
    for (let k = 0; k < 4; k++) {
      const a = A[k]!, b = A[(k + 1) % 4]!, c = B[(k + 1) % 4]!, d = B[k]!;
      pushTri(s, a, c, b, zone);
      pushTri(s, a, d, c, zone);
    }
  }
  if (capBottom) {
    const c = corners(rings[0]!);
    pushTri(s, c[0]!, c[1]!, c[2]!, zone);
    pushTri(s, c[0]!, c[2]!, c[3]!, zone);
  }
  if (capTop) {
    const c = corners(rings[rings.length - 1]!);
    pushTri(s, c[0]!, c[2]!, c[1]!, zone);
    pushTri(s, c[0]!, c[3]!, c[2]!, zone);
  }
}

/** UV sphere with poles on +/-Y and a vertex on +/-X at the equator (so its bounds are exact). */
function sphere(s: Soup, cx: number, cy: number, cz: number, r: number, segs: number, rings: number, zone: number): void {
  const centre = [cx, cy, cz];
  const P = (i: number, j: number): number[] => {
    const th = (i * Math.PI) / rings;
    const ph = (j * 2 * Math.PI) / segs;
    return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.cos(th), cz + r * Math.sin(th) * Math.sin(ph)];
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const p00 = P(i, j), p01 = P(i, j + 1), p10 = P(i + 1, j), p11 = P(i + 1, j + 1);
      if (i > 0) pushOut(s, p00, p10, p01, centre, zone); // not the north cap (degenerate there)
      if (i < rings - 1) pushOut(s, p01, p10, p11, centre, zone);
    }
  }
}

function ring3(rings: readonly EchoRing[], y: (f: number) => number, cx: number): Ring3[] {
  return rings.map((r) => ({ y: y(r.f), cx, hw: r.hw, hd: r.hd }));
}

function generateHumanoid(s: Soup, d: PoseDims, shape: EchoShape): void {
  sphere(s, 0, d.headCentre, 0, d.headRadius, shape.headSegments, shape.headRings, ZONE_HEAD);
  const torsoY = (f: number): number => d.torsoBottom + f * (d.torsoTop - d.torsoBottom);
  loft(s, ring3(shape.torso, torsoY, 0), ZONE_TORSO, true, true);
  for (const side of [-1, 1]) {
    loft(s, ring3(shape.arm, torsoY, side * shape.armX), ZONE_TORSO, true, true);
  }
  const legY = (f: number): number => f * d.legTop;
  for (const side of [-1, 1]) {
    // Rings run floor -> hip: the top cap is hidden inside the torso, the sole is closed.
    loft(s, ring3(shape.leg, legY, side * shape.legX), ZONE_LEG, true, false);
  }
}

// ---------------------------------------------------------------------------------------------
// Soup -> attribute arrays
// ---------------------------------------------------------------------------------------------

function faceHash(i: number): number {
  let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function faceCentroids(pos: readonly number[], out: Float32Array): void {
  const tris = pos.length / 9;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const cx = (pos[o]! + pos[o + 3]! + pos[o + 6]!) / 3;
    const cy = (pos[o + 1]! + pos[o + 4]! + pos[o + 7]!) / 3;
    const cz = (pos[o + 2]! + pos[o + 5]! + pos[o + 8]!) / 3;
    for (let v = 0; v < 3; v++) {
      out[o + v * 3] = cx;
      out[o + v * 3 + 1] = cy;
      out[o + v * 3 + 2] = cz;
    }
  }
}

function finish(stand: Soup, crouch: Soup): EchoMeshData {
  if (stand.pos.length !== crouch.pos.length) throw new Error('echoModel: stand and crouch topology differ');
  const tris = stand.pos.length / 9;
  const n = tris * 3;
  const position = Float32Array.from(stand.pos);
  const positionC = Float32Array.from(crouch.pos);
  const normal = new Float32Array(n * 3);
  const smooth = new Float32Array(n * 3);
  const centroid = new Float32Array(n * 3);
  const centroidC = new Float32Array(n * 3);
  const meta = new Float32Array(n * 2);
  faceCentroids(stand.pos, centroid);
  faceCentroids(crouch.pos, centroidC);

  const sums = new Map<string, number[]>();
  const key = (x: number, y: number, z: number): string => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  for (let t = 0; t < tris; t++) {
    const o = t * 9;
    const e1x = position[o + 3]! - position[o]!, e1y = position[o + 4]! - position[o + 1]!, e1z = position[o + 5]! - position[o + 2]!;
    const e2x = position[o + 6]! - position[o]!, e2y = position[o + 7]! - position[o + 1]!, e2z = position[o + 8]! - position[o + 2]!;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    // Area-weighted accumulation for the smooth normal, unit vector for the flat one.
    for (let v = 0; v < 3; v++) {
      const k = key(position[o + v * 3]!, position[o + v * 3 + 1]!, position[o + v * 3 + 2]!);
      const acc = sums.get(k) ?? [0, 0, 0];
      acc[0]! += nx; acc[1]! += ny; acc[2]! += nz;
      sums.set(k, acc);
    }
    nx /= len; ny /= len; nz /= len;
    const r = faceHash(t);
    for (let v = 0; v < 3; v++) {
      normal[o + v * 3] = nx; normal[o + v * 3 + 1] = ny; normal[o + v * 3 + 2] = nz;
      meta[(t * 3 + v) * 2] = stand.zone[t]!;
      meta[(t * 3 + v) * 2 + 1] = r;
    }
  }
  for (let i = 0; i < n; i++) {
    const acc = sums.get(key(position[i * 3]!, position[i * 3 + 1]!, position[i * 3 + 2]!))!;
    const len = Math.hypot(acc[0]!, acc[1]!, acc[2]!) || 1;
    smooth[i * 3] = acc[0]! / len; smooth[i * 3 + 1] = acc[1]! / len; smooth[i * 3 + 2] = acc[2]! / len;
  }
  return { vertexCount: n, triangleCount: tris, position, positionC, normal, smooth, centroid, centroidC, meta };
}

/** The humanoid Echo, standing and crouched, from the zone dimensions. Allocates (build time only). */
export function buildEchoMesh(hit: HitTunables, shape: EchoShape): EchoMeshData {
  const stand: Soup = { pos: [], zone: [] };
  const crouch: Soup = { pos: [], zone: [] };
  generateHumanoid(stand, poseDims(hit, false), shape);
  generateHumanoid(crouch, poseDims(hit, true), shape);
  return finish(stand, crouch);
}

/** The Beacon: a head-sized orb centred on the origin (its `pos` is the centre). */
export function buildOrbMesh(radius: number, segments: number, rings: number): EchoMeshData {
  const s: Soup = { pos: [], zone: [] };
  sphere(s, 0, 0, 0, radius, segments, rings, ZONE_HEAD);
  return finish(s, s);
}

/** The Gnat: a vertically stretched octahedron centred on the origin. */
export function buildGnatMesh(radius: number, stretch: number): EchoMeshData {
  const s: Soup = { pos: [], zone: [] };
  const px = [radius, 0, 0], nx = [-radius, 0, 0];
  const py = [0, radius * stretch, 0], ny = [0, -radius * stretch, 0];
  const pz = [0, 0, radius], nz = [0, 0, -radius];
  const o = [0, 0, 0];
  for (const x of [px, nx]) for (const y of [py, ny]) for (const z of [pz, nz]) pushOut(s, x, y, z, o, ZONE_HEAD);
  return finish(s, s);
}

// ---------------------------------------------------------------------------------------------
// Measurement (tests, documentation)
// ---------------------------------------------------------------------------------------------

export interface ZoneBounds {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}

/** Bounding box of every vertex in a zone, in the standing or crouched pose. */
export function measureZone(mesh: EchoMeshData, zone: number, crouched: boolean): ZoneBounds {
  const p = crouched ? mesh.positionC : mesh.position;
  const b: ZoneBounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let v = 0; v < mesh.vertexCount; v++) {
    if (mesh.meta[v * 2] !== zone) continue;
    const x = p[v * 3]!, y = p[v * 3 + 1]!, z = p[v * 3 + 2]!;
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
  }
  return b;
}
