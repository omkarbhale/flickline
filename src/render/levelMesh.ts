import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { scaleLinear } from '../core/color';
import { vec3, type Vec3 } from '../core/vec3';
import { env, palette } from '../config/palette';
import type { RenderTunables } from '../config/render';
import type { FloorMark } from '../sim/mapTypes';
import type { BoxTag, LevelDef } from '../sim/types';
import { buildWedge, rampParts, trimSegments, type RampParts } from './envLayout';
import { createBoxMaterial, createFloorMaterial, type EnvUniforms } from './envShaders';

/** Rendered (brightest) colour per box tag; the shader only ever darkens these. */
const TAG_COLORS: Record<BoxTag, number> = {
  floor: env.floor,
  wall: env.wall,
  crate: env.cover,
  platform: env.platform,
  cover: env.cover,
  pillar: env.platform,
  panel: env.cover,
  ceiling: env.wall,
  ramp: env.platform,
};

/** Floor markings are thin lines of light: trim colour at a weight, never brighter than an Echo. */
const MARK_LIFT = 0.012; // marks float this far above the floor to avoid z-fighting

export interface LevelMeshOptions {
  /** Flat floor markings (distance ticks, start lines). Visual only. */
  marks?: readonly FloorMark[];
}

export interface LevelMesh {
  root: Object3D;
  /** Light (or dim) the map's `armed` floor marks (the Lane's armed stripe). No allocation; a no-op on maps without any. */
  setMarksArmed(armed: boolean): void;
  dispose(): void;
}

/**
 * Static level visuals in the Lightline style, no textures. Draw calls: one InstancedMesh for all
 * non-floor boxes, one merged grid-floor mesh, one LineSegments for every trim edge.
 */
export function buildLevelMesh(
  level: LevelDef,
  uniforms: EnvUniforms,
  r: RenderTunables,
  options: LevelMeshOptions = {},
): LevelMesh {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];

  // Props: flat-shaded boxes, per-instance colour by tag.
  const boxGeo = new BoxGeometry(1, 1, 1);
  const boxMat: ShaderMaterial = createBoxMaterial(uniforms);
  disposables.push(boxGeo, boxMat);
  const solids = level.boxes.filter((b) => b.tag !== 'floor');
  // A ramp is drawn as its riser (an ordinary box) plus a wedge instance; everything else is a box.
  const props: { min: Vec3; max: Vec3; tag: BoxTag }[] = [];
  const wedges: RampParts[] = [];
  for (const b of solids) {
    if (b.ramp === undefined) {
      props.push(b);
      continue;
    }
    const parts = rampParts(b);
    if (parts.riser) {
      props.push({ min: vec3(...parts.riser.min), max: vec3(...parts.riser.max), tag: b.tag });
    }
    wedges.push(parts);
  }
  const inst = new InstancedMesh(boxGeo, boxMat, Math.max(1, props.length));
  const m = new Matrix4();
  const col = new Color();
  props.forEach((b, i) => {
    m.makeScale(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z).setPosition(
      (b.min.x + b.max.x) / 2,
      (b.min.y + b.max.y) / 2,
      (b.min.z + b.max.z) / 2,
    );
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.setHex(TAG_COLORS[b.tag]));
  });
  inst.count = props.length;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.matrixAutoUpdate = false;
  inst.frustumCulled = false;
  disposables.push(inst);
  root.add(inst);

  if (wedges.length > 0) {
    const w = buildWedge();
    const wedgeGeo = new BufferGeometry();
    wedgeGeo.setAttribute('position', new BufferAttribute(new Float32Array(w.positions), 3));
    wedgeGeo.setAttribute('normal', new BufferAttribute(new Float32Array(w.normals), 3));
    wedgeGeo.setIndex(w.indices);
    const wedgeMesh = new InstancedMesh(wedgeGeo, boxMat, wedges.length);
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const wc = new Vector3();
    const ws = new Vector3();
    wedges.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rotY);
      wedgeMesh.setMatrixAt(i, m.compose(wc.set(...p.centre), q, ws.set(...p.scale)));
      wedgeMesh.setColorAt(i, col.setHex(TAG_COLORS.ramp));
    });
    wedgeMesh.instanceMatrix.needsUpdate = true;
    if (wedgeMesh.instanceColor) wedgeMesh.instanceColor.needsUpdate = true;
    wedgeMesh.matrixAutoUpdate = false;
    wedgeMesh.frustumCulled = false;
    disposables.push(wedgeGeo, wedgeMesh);
    root.add(wedgeMesh);
  }

  // Floor: the top face of every floor slab merged into one grid-shaded mesh.
  const floors = level.boxes.filter((b) => b.tag === 'floor');
  if (floors.length > 0) {
    const pos = new Float32Array(floors.length * 12);
    const idx = new Uint32Array(floors.length * 6);
    floors.forEach((b, i) => {
      const o = i * 12;
      const y = b.max.y;
      pos.set([b.min.x, y, b.min.z, b.max.x, y, b.min.z, b.max.x, y, b.max.z, b.min.x, y, b.max.z], o);
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
    });
    const floorGeo = new BufferGeometry();
    floorGeo.setAttribute('position', new BufferAttribute(pos, 3));
    floorGeo.setIndex(new BufferAttribute(idx, 1));
    const floorMat = createFloorMaterial(uniforms);
    const floorMesh = new Mesh(floorGeo, floorMat);
    floorMesh.frustumCulled = false;
    disposables.push(floorGeo, floorMat);
    root.add(floorMesh);
  }

  // Trim lines: one LineSegments; thin bright edges, dimmer toward the base (same gradient idea as the boxes).
  const seg = trimSegments(level.boxes);
  if (seg.length > 0) {
    const positions = new Float32Array(seg);
    const colors = new Float32Array(seg.length);
    const { baseIntensity, baseHeight, intensity } = r.trim;
    const baseK = baseIntensity / intensity;
    for (let i = 0; i < seg.length; i += 3) {
      const t = Math.min(1, Math.max(0, seg[i + 1]! / baseHeight));
      const k = baseK + (1 - baseK) * t;
      colors[i] = colors[i + 1] = colors[i + 2] = k;
    }
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new BufferAttribute(positions, 3));
    lineGeo.setAttribute('color', new BufferAttribute(colors, 3));
    const lineMat = new LineBasicMaterial({ vertexColors: true, fog: true });
    lineMat.color.copy(uniforms.uTrim.value).multiplyScalar(intensity);
    const lines = new LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    disposables.push(lineGeo, lineMat);
    root.add(lines);
  }

  const marks = options.marks ?? [];
  const markColors = {
    tick: scaleLinear(palette.trim, r.trim.marks.tick),
    major: scaleLinear(palette.trim, r.trim.marks.major),
    line: scaleLinear(palette.trim, r.trim.marks.line),
    armed: scaleLinear(palette.trim, r.trim.marks.armedOff),
  };
  const armedOn = scaleLinear(palette.trim, r.trim.marks.armedOn);
  const armedIndices: number[] = [];
  let markGeo: PlaneGeometry | null = null;
  let markMat: MeshBasicMaterial | null = null;
  let markMesh: InstancedMesh | null = null;
  if (marks.length > 0) {
    markGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2); // lies in XZ, local X = stripe length
    markMat = new MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    markMesh = new InstancedMesh(markGeo, markMat, marks.length);
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    marks.forEach((mk, i) => {
      const dx = mk.b.x - mk.a.x, dz = mk.b.z - mk.a.z;
      pos.set((mk.a.x + mk.b.x) / 2, (mk.a.y + mk.b.y) / 2 + MARK_LIFT, (mk.a.z + mk.b.z) / 2);
      quat.setFromAxisAngle(up, -Math.atan2(dz, dx));
      scale.set(Math.hypot(dx, dz), 1, mk.width);
      markMesh!.setMatrixAt(i, m.compose(pos, quat, scale));
      markMesh!.setColorAt(i, col.setHex(markColors[mk.kind]));
      if (mk.kind === 'armed') armedIndices.push(i);
    });
    markMesh.instanceMatrix.needsUpdate = true;
    if (markMesh.instanceColor) markMesh.instanceColor.needsUpdate = true;
    markMesh.matrixAutoUpdate = false;
    root.add(markMesh);
  }

  return {
    root,
    setMarksArmed(armed) {
      if (markMesh === null || armedIndices.length === 0) return;
      const hex = armed ? armedOn : markColors.armed;
      for (let i = 0; i < armedIndices.length; i++) markMesh.setColorAt(armedIndices[i]!, col.setHex(hex));
      if (markMesh.instanceColor) markMesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      markGeo?.dispose();
      markMat?.dispose();
      markMesh?.dispose();
    },
  };
}
