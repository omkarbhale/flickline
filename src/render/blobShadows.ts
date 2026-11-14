import { Color, InstancedMesh, Matrix4, PlaneGeometry } from 'three';
import type { RenderTunables } from '../config/render';
import type { BoxDef, TargetState } from '../sim/types';
import { createBlobMaterial } from './envShaders';
import { isPillar } from './envLayout';

const LIFT = 0.012; // metres above the floor (floor top is y = 0)
const FADE_HEIGHT = 5; // a target this far off the floor casts only a faint blob
const MIN_ALPHA = 0.25;

/**
 * Soft blob-shadow decals: one InstancedMesh of fixed capacity (no real-time shadows). The first
 * `staticCount` slots are pillars (set when a level loads); the rest follow the targets every
 * frame. When capacity runs out further blobs are skipped, never allocated.
 */
export class BlobShadows {
  readonly mesh: InstancedMesh;
  private staticCount = 0;
  private readonly m = new Matrix4();
  private readonly c = new Color();

  constructor(private readonly cfg: RenderTunables['blob']) {
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(geo, createBlobMaterial(cfg.opacity), cfg.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    for (let i = 0; i < cfg.capacity; i++) this.mesh.setColorAt(i, this.c.setRGB(1, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** (Re)build the static decals for a level: one under every pillar. */
  setLevel(boxes: readonly BoxDef[]): void {
    let n = 0;
    for (const b of boxes) {
      if (n >= this.cfg.capacity) break;
      if (!isPillar(b, this.cfg)) continue;
      const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      const s = w * 2.4 + 0.3;
      this.place(n, (b.min.x + b.max.x) / 2, b.min.y + LIFT, (b.min.z + b.max.z) / 2, s, 1);
      n++;
    }
    this.staticCount = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Per-frame: one blob under each living target. No allocation. */
  update(targets: readonly TargetState[]): void {
    const cap = this.cfg.capacity;
    let n = this.staticCount;
    for (let i = 0; i < targets.length && n < cap; i++) {
      const t = targets[i]!;
      if (!t.alive) continue;
      const clearance = Math.max(0, t.pos.y - t.radius);
      const a = Math.max(MIN_ALPHA, 1 - clearance / FADE_HEIGHT);
      this.place(n, t.pos.x, LIFT, t.pos.z, t.radius * 2 * this.cfg.echoScale, a);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private place(i: number, x: number, y: number, z: number, size: number, alpha: number): void {
    this.m.makeScale(size, 1, size).setPosition(x, y, z);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.c.setRGB(alpha, 0, 0));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
    this.mesh.dispose();
  }
}
