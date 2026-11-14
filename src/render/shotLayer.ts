import { BoxGeometry, Mesh, MeshLambertMaterial, type PerspectiveCamera, type Scene } from 'three';
import type { FeedbackTunables } from '../config/feedback';
import { palette } from '../config/palette';
import type { ShotCues } from '../feedback/shotCues';
import { ShotEffects } from './effects';
import type { RenderFrame, RenderLayer } from './gameRenderer';

const VIEWMODEL_BASE_Z = -0.34;

/**
 * Per-shot visuals as a render layer: the effects drawn from the shot-cue model (tracers, impacts,
 * shatter, muzzle flash) and the placeholder viewmodel with its recoil kick.
 */
export class ShotLayer implements RenderLayer {
  private readonly effects: ShotEffects;
  private readonly viewmodel: Mesh;

  constructor(scene: Scene, camera: PerspectiveCamera, private readonly cues: ShotCues, cfg: FeedbackTunables) {
    this.effects = new ShotEffects(scene, camera, cues, cfg);
    // Placeholder first-person weapon model, parented to the camera.
    this.viewmodel = new Mesh(new BoxGeometry(0.05, 0.07, 0.36), new MeshLambertMaterial({ color: palette.steel }));
    this.viewmodel.position.set(0.15, -0.14, VIEWMODEL_BASE_Z);
    camera.add(this.viewmodel);
  }

  update(frame: RenderFrame): void {
    this.effects.update(frame.dt);
    this.viewmodel.position.z = VIEWMODEL_BASE_Z + this.cues.kick * 0.04;
    this.viewmodel.rotation.x = this.cues.kick * 0.06;
  }

  afterDraw(): void {
    this.cues.markDrawn();
  }

  resize(_width: number, height: number, pixelRatio: number): void {
    this.effects.setViewportHeight(height * pixelRatio);
  }

  dispose(): void {
    this.effects.dispose();
  }
}
