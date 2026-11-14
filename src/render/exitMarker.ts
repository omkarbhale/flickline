import {
  AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, type Scene,
} from 'three';
import { palette } from '../config/palette';
import type { RenderFrame, RenderLayer } from './gameRenderer';

/**
 * Where a Sweep sector's exit is (#201): a soft column of light over a ring on the floor, in the
 * trim colour of the interface, so the way on reads at a glance and never as an enemy (Echoes are
 * ember). Gates and doors replace it (#205). Two meshes, built once; `update` only moves a uniform
 * value (the pulse), so it allocates nothing per frame.
 */
export class ExitMarker implements RenderLayer {
  private readonly root = new Group();
  private readonly column: MeshBasicMaterial;
  private readonly ring: MeshBasicMaterial;
  private time = 0;

  constructor(private readonly scene: Scene, radiusM: number, heightM = 3) {
    this.column = new MeshBasicMaterial({
      color: palette.trim, transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
    });
    this.ring = new MeshBasicMaterial({
      color: palette.trim, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
    });
    const col = new Mesh(new CylinderGeometry(radiusM, radiusM, heightM, 32, 1, true), this.column);
    col.position.y = heightM / 2;
    const ring = new Mesh(new RingGeometry(radiusM - 0.08, radiusM, 48), this.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.root.add(col, ring);
    this.root.visible = false;
    this.root.renderOrder = 5;
    scene.add(this.root);
  }

  /** Stand the marker on a sector's exit (feet position), or hide it with null. */
  place(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  update(frame: RenderFrame): void {
    if (!this.root.visible) return;
    this.time += frame.dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.4);
    this.column.opacity = 0.1 + 0.08 * pulse;
    this.ring.opacity = 0.5 + 0.35 * pulse;
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const m of this.root.children) (m as Mesh).geometry.dispose();
    this.column.dispose();
    this.ring.dispose();
  }
}
