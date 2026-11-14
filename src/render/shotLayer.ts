import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import type { FeedbackTunables } from '../config/feedback';
import { echoPresets, palette, type EchoPresetId } from '../config/palette';
import type { ShotCues } from '../feedback/shotCues';
import { ShotEffects } from './effects';
import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';

const VIEWMODEL_BASE_Z = -0.34;

/**
 * Per-shot visuals as a render layer: the effects drawn from the shot-cue model (tracers, impacts,
 * shatter, muzzle flash) and the placeholder viewmodel with its recoil kick. The kill shatter
 * takes the enemy colour preset (`renderer.echoPreset`).
 */
export class ShotLayer implements RenderLayer {
  private readonly effects: ShotEffects;
  private readonly viewmodel: Mesh;
  /** The preset the shard colour was last set for (the renderer's default to start). */
  private preset: EchoPresetId;

  constructor(private readonly renderer: GameRenderer, private readonly cues: ShotCues, cfg: FeedbackTunables) {
    const camera = renderer.camera;
    this.effects = new ShotEffects(renderer.scene, camera, cues, cfg);
    this.preset = renderer.echoPreset;
    // Placeholder first-person weapon model, parented to the camera.
    this.viewmodel = new Mesh(new BoxGeometry(0.05, 0.07, 0.36), new MeshLambertMaterial({ color: palette.steel }));
    this.viewmodel.position.set(0.15, -0.14, VIEWMODEL_BASE_Z);
    camera.add(this.viewmodel);
  }

  update(frame: RenderFrame): void {
    const preset = this.renderer.echoPreset;
    if (preset !== this.preset) {
      this.preset = preset;
      this.effects.setShardColor(echoPresets[preset].color);
    }
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
