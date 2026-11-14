import type { FeedbackTunables } from '../config/feedback';
import { echoPresets, type EchoPresetId } from '../config/palette';
import type { ShotCues } from '../feedback/shotCues';
import { ShotEffects } from './effects';
import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';

/**
 * Per-shot world visuals as a render layer: the effects drawn from the shot-cue model (tracers,
 * impacts, decals, kill shatter). The kill shatter takes the enemy colour preset
 * (`renderer.echoPreset`). The first-person weapon and its muzzle flash are `render/viewmodel.ts`.
 */
export class ShotLayer implements RenderLayer {
  private readonly effects: ShotEffects;
  /** The preset the shard colour was last set for (the renderer's default to start). */
  private preset: EchoPresetId;

  constructor(private readonly renderer: GameRenderer, private readonly cues: ShotCues, cfg: FeedbackTunables) {
    this.effects = new ShotEffects(renderer.scene, cues, cfg);
    this.preset = renderer.echoPreset;
  }

  update(frame: RenderFrame): void {
    const preset = this.renderer.echoPreset;
    if (preset !== this.preset) {
      this.preset = preset;
      this.effects.setShardColor(echoPresets[preset].color);
    }
    this.effects.update(frame.dt);
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
