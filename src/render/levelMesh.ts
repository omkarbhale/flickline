import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
} from 'three';
import type { BoxTag, LevelDef } from '../sim/types';

const TAG_COLORS: Record<BoxTag, number> = {
  floor: 0x2a2f38,
  wall: 0x6a7684,
  crate: 0xc99a5a,
  platform: 0x6e92b8,
};

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
export function buildLevelMesh(level: LevelDef): LevelMesh {
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
    inst.setColorAt(i, col.setHex(TAG_COLORS[b.tag]));
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
    },
  };
}
