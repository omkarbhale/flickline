import type { GameRenderer, RenderFrame, RenderLayer } from './gameRenderer';
import type { PostFxState } from './postFxState';

/**
 * Feeds the timed post effects (damage vignette, chromatic pulse) into the pipeline each frame,
 * before drawing: advance the state by the frame's time, then set the two uniforms. A `hold`
 * overrides the envelopes (debug screenshots); `null` hands control back to the state.
 */
export class PostLayer implements RenderLayer {
  /** Debug override of the envelopes (0..1 each), or null. */
  hold: { damage: number; chroma: number } | null = null;

  constructor(
    private readonly renderer: GameRenderer,
    readonly state: PostFxState,
  ) {}

  update(frame: RenderFrame): void {
    this.state.update(frame.dt);
    const h = this.hold;
    this.renderer.post.setDamage(h ? h.damage : this.state.damage);
    this.renderer.post.setChroma(h ? h.chroma : this.state.chroma);
  }

  dispose(): void {
    this.renderer.post.setDamage(0);
    this.renderer.post.setChroma(0);
  }
}
