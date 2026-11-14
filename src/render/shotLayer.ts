import { BoxGeometry, Mesh, MeshLambertMaterial, type PerspectiveCamera, type Scene } from 'three';
import type { Subscribable } from '../core/eventBus';
import { palette } from '../config/palette';
import type { SimEvents } from '../sim/types';
import { ShotEffects } from './effects';
import type { RenderFrame, RenderLayer } from './gameRenderer';

const VIEWMODEL_BASE_Z = -0.34;

/** Shot visuals as a render layer: pooled tracers/impacts and the placeholder viewmodel's kick. */
export class ShotLayer implements RenderLayer {
  private readonly effects: ShotEffects;
  private readonly viewmodel: Mesh;

  constructor(scene: Scene, camera: PerspectiveCamera, bus: Subscribable<SimEvents>) {
    this.effects = new ShotEffects(scene, bus);
    // Placeholder first-person weapon model, parented to the camera.
    this.viewmodel = new Mesh(new BoxGeometry(0.05, 0.07, 0.36), new MeshLambertMaterial({ color: palette.steel }));
    this.viewmodel.position.set(0.15, -0.14, VIEWMODEL_BASE_Z);
    camera.add(this.viewmodel);
  }

  update(frame: RenderFrame): void {
    this.effects.update(frame.dt);
    this.viewmodel.position.z = VIEWMODEL_BASE_Z + this.effects.kick * 0.04;
    this.viewmodel.rotation.x = this.effects.kick * 0.06;
  }

  dispose(): void {
    this.effects.dispose();
  }
}
