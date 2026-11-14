import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from 'three';
import type { FloorMark } from '../sim/mapTypes';
import type { BoxTag, LevelDef } from '../sim/types';

type Palette = Record<BoxTag, number>;

const PALETTES: Record<string, Palette> = {
  default: {
    floor: 0x2a2f38,
    wall: 0x6a7684,
    crate: 0xc99a5a,
    platform: 0x6e92b8,
    cover: 0x8a7a64,
    pillar: 0x7d8ca0,
    panel: 0xb4bfcd,
    ceiling: 0x2a303a,
  },
  /** Indoor hall (Range): ceiling albedo is high because it is only lit from below by the hemisphere light. */
  hall: {
    floor: 0x2a2f38,
    wall: 0x566277,
    crate: 0xc99a5a,
    platform: 0x6e92b8,
    cover: 0x8a7a64,
    pillar: 0x8798b2,
    panel: 0x9aa8bc,
    ceiling: 0x8a97ad,
  },
};

const MARK_COLORS: Record<FloorMark['kind'], number> = {
  tick: 0x4a6a82,
  major: 0x74c8e6,
  line: 0x38e8ff,
};
/** Marks float this far above the floor to avoid z-fighting (invisible at eye height). */
const MARK_LIFT = 0.012;

export interface LevelMeshOptions {
  /** Box colour palette name (unknown names fall back to `default`). */
  palette?: string;
  /** Flat floor markings (distance ticks, start lines). Visual only. */
  marks?: readonly FloorMark[];
}

function makeGridTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = '#38404c';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#414a58';
  g.fillRect(0, 0, size / 2, size / 2);
  g.fillRect(size / 2, size / 2, size / 2, size / 2);
  g.strokeStyle = '#5c6677';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, size - 3, size - 3);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface LevelMesh {
  root: Object3D;
  setAnisotropy(n: number): void;
  dispose(): void;
}

/**
 * Static level visuals. All non-floor boxes share ONE InstancedMesh (one draw call, per-instance
 * colour by tag); each floor slab is a single mesh with a grid texture.
 */
export function buildLevelMesh(level: LevelDef, options: LevelMeshOptions = {}): LevelMesh {
  const colors = PALETTES[options.palette ?? 'default'] ?? PALETTES['default']!;
  const root = new Group();
  const geo = new BoxGeometry(1, 1, 1);
  const mat = new MeshLambertMaterial({ color: 0xffffff });
  const gridTex = makeGridTexture();
  const floorMat = new MeshLambertMaterial({ map: gridTex });
  const extraGeos: BoxGeometry[] = [];

  const props = level.boxes.filter((b) => b.tag !== 'floor');
  const inst = new InstancedMesh(geo, mat, Math.max(1, props.length));
  const m = new Matrix4();
  const col = new Color();
  props.forEach((b, i) => {
    const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
    m.makeScale(sx, sy, sz).setPosition((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.setHex(colors[b.tag]));
  });
  inst.count = props.length;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.matrixAutoUpdate = false;
  root.add(inst);

  for (const b of level.boxes) {
    if (b.tag !== 'floor') continue;
    const w = b.max.x - b.min.x, h = b.max.y - b.min.y, d = b.max.z - b.min.z;
    const g = new BoxGeometry(w, h, d);
    extraGeos.push(g);
    const mesh = new Mesh(g, floorMat);
    mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    root.add(mesh);
    gridTex.repeat.set(w / 2, d / 2); // 2 m per texture tile; assumes a single floor slab
  }

  const marks = options.marks ?? [];
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
      markMesh!.setColorAt(i, col.setHex(MARK_COLORS[mk.kind]));
    });
    markMesh.instanceMatrix.needsUpdate = true;
    if (markMesh.instanceColor) markMesh.instanceColor.needsUpdate = true;
    markMesh.matrixAutoUpdate = false;
    root.add(markMesh);
  }

  return {
    root,
    setAnisotropy(n: number) {
      if (gridTex.anisotropy !== n) {
        gridTex.anisotropy = n;
        gridTex.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      floorMat.dispose();
      gridTex.dispose();
      extraGeos.forEach((g) => g.dispose());
      inst.dispose();
      markGeo?.dispose();
      markMat?.dispose();
      markMesh?.dispose();
    },
  };
}
