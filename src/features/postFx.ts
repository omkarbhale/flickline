import { defineFeature } from '../app/feature';
import { TICK_DT } from '../core/time';
import { GpuTimer } from '../render/gpuTimer';
import { PostFxState } from '../render/postFxState';
import { PostLayer } from '../render/postLayer';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The post stack: preset flags, pass counts (full-screen and quarter-resolution), render
     * targets allocated, the live damage/chromatic envelopes and the GPU time of the post passes
     * when `postTimer` is on.
     */
    postFx(): unknown;
    /** Hold the damage vignette and chromatic envelopes at fixed 0..1 values (screenshots); `null` releases them. */
    postHold(damage?: number, chroma?: number): void;
    /** Time the post passes on the GPU (`EXT_disjoint_timer_query_webgl2`). Returns whether the browser offers it. */
    postTimer(on?: boolean): boolean;
  }
}

/**
 * The timed post effects: the damage vignette (a hit closes the screen edge in red and lets it go,
 * on the High preset, in place of the HUD's CSS one) and the optional chromatic kill pulse. The
 * pipeline itself and the quality flags live in `render/post.ts`; this wires the events to it.
 */
export const feature = defineFeature({
  id: 'postFx',
  stage: 'presentation',
  setup(game) {
    const state = new PostFxState(game.tunables.post, game.tunables.damageFx.vignetteMs);
    const layer = new PostLayer(game.renderer, state);
    game.renderer.addLayer(layer);

    const sync = (): void => {
      const s = game.settings.get();
      state.setReduceFlashing(s.reduceFlashing);
      state.setChromaticEnabled(s.chromaticPulse && game.tunables.render.quality[s.quality].post.chromatic);
      // Where the post vignette runs it is the damage vignette; the HUD's CSS one covers the other presets.
      game.damage.setCssVignette(!game.tunables.render.quality[s.quality].post.vignette);
    };
    sync();
    game.bus.on('settingsChanged', ({ changed }) => {
      if (changed.includes('reduceFlashing') || changed.includes('chromaticPulse') || changed.includes('quality')) sync();
    });
    game.bus.on('playerDamaged', () => state.hurt());
    game.bus.on('targetKilled', (e) => state.kill(e.tick * TICK_DT));
    game.onReset(() => state.reset());

    const post = game.renderer.post;
    game.addOverlayLines(() => {
      const p = post.plan;
      const t = post.timer;
      const ms = t && t.samples > 0 ? `  gpu ${t.avgMs.toFixed(2)} ms` : '';
      return `post ${p.fullScreenPasses} full + ${p.quarterPasses} quarter passes, ${post.allocatedTargets} targets${ms}`;
    });
    game.addSnapshot('post', () => ({
      passes: { fullScreen: post.plan.fullScreenPasses, quarter: post.plan.quarterPasses },
      targets: post.allocatedTargets,
    }));
    game.addDebug({
      postFx() {
        const q = game.settings.get().quality;
        const t = post.timer;
        return {
          quality: q,
          flags: { ...game.tunables.render.quality[q].post },
          passes: { fullScreen: post.plan.fullScreenPasses, quarter: post.plan.quarterPasses },
          targets: { planned: post.plan.targets, allocated: post.allocatedTargets },
          damage: state.damage,
          chroma: state.chroma,
          gpu: t ? { avgMs: t.avgMs, maxMs: t.maxMs, samples: t.samples } : null,
        };
      },
      postHold(damage, chroma) {
        layer.hold = damage === undefined ? null : { damage, chroma: chroma ?? 0 };
        game.renderNow();
      },
      postTimer(on = true) {
        if (!on) {
          post.timer?.dispose();
          post.timer = null;
          return true;
        }
        if (post.timer) return true;
        post.timer = GpuTimer.create(game.renderer.renderer.getContext() as WebGL2RenderingContext);
        return post.timer !== null;
      },
    });
  },
});
