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
  type Object3D,
  type ShaderMaterial,
} from 'three';
import { env } from '../config/palette';
import type { RenderTunables } from '../config/render';
import type { BoxTag, LevelDef } from '../sim/types';
import { trimSegments } from './envLayout';
import { createBoxMaterial, createFloorMaterial, type EnvUniforms } from './envShaders';

/** Rendered (brightest) colour per box tag; the shader only ever darkens these. */
const TAG_COLORS: Record<BoxTag, number> = {
  floor: env.floor,
  wall: env.wall,
  crate: env.cover,
  platform: env.platform,
};

export interface LevelMesh {
  root: Object3D;
  dispose(): void;
}

/**
 * Static level visuals in the Lightline style, no textures. Draw calls: one InstancedMesh for all
 * non-floor boxes, one merged grid-floor mesh, one LineSegments for every trim edge.
 */
export function buildLevelMesh(level: LevelDef, uniforms: EnvUniforms, r: RenderTunables): LevelMesh {
  const root = new Group();
  const disposables: { dispose(): void }[] = [];

  // Props: flat-shaded boxes, per-instance colour by tag.
  const boxGeo = new BoxGeometry(1, 1, 1);
  const boxMat: ShaderMaterial = createBoxMaterial(uniforms);
  disposables.push(boxGeo, boxMat);
  const props = level.boxes.filter((b) => b.tag !== 'floor');
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

  return {
    root,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
