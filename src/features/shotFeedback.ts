import { defineFeature } from '../app/feature';
import { ShotLayer } from '../render/shotLayer';
import type { SimEvents } from '../sim/types';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Per-shot effect stats: cue-to-draw frame latency, pool sizes, JS heap (if exposed). */
    fx(): unknown;
    /** Hold transient effects still (dt = 0) so screenshots can catch them; CSS ones need the injected pause style. */
    freezeFx(on?: boolean): void;
    /** Render one frame advancing effect time by `sec` (use with freezeFx to step effects to a chosen moment). */
    fxAdvance(sec: number): void;
    /** Reset the effect latency counters. */
    fxResetStats(): void;
    /**
     * Emit a synthetic sim event on the bus (zones other than 'body', RT/TTK, ... before the enemy
     * framework exists), then render. Payload is merged over safe defaults; `point`, `origin`, `dir`
     * take {x,y,z}. Returns nothing; read the result on screen or with events().
     */
    emit(type: keyof SimEvents, payload?: Record<string, unknown>): void;
  }
}

/**
 * Per-shot visual feedback drawn from the shot-cue model (`game.cues`, which the HUD reads too):
 * the effects layer, its latency readout and the debug commands to inspect and freeze it.
 */
export const feature = defineFeature({
  id: 'shotFeedback',
  stage: 'presentation',
  setup(game) {
    const cues = game.cues;
    game.renderer.addLayer(new ShotLayer(game.renderer, cues, game.tunables.feedback));
    game.addOverlayLines(
      () => `fx latency max ${cues.latency.max} frame(s) over ${cues.latency.samples} cues, ${cues.latency.late} late`,
    );
    game.addDebug({
      fx() {
        const l = cues.latency;
        const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        return {
          frame: cues.frame,
          latencyMax: l.max,
          latencyLast: l.last,
          cuesDrawn: l.samples,
          late: l.late,
          tracers: cues.tracers.length,
          impacts: cues.impacts.length,
          decals: cues.decals.length,
          shatters: cues.shatters.length,
          heapBytes: heap ? heap.usedJSHeapSize : null,
          drawCalls: game.renderer.stats.drawCalls,
        };
      },
      freezeFx(on = true) {
        game.freezeFx = on;
      },
      fxAdvance(sec) {
        game.renderer.render(game.world, 1, game.input.yaw, game.input.pitch, sec);
      },
      fxResetStats() {
        cues.resetLatency();
      },
      emit(type, payload = {}) {
        const v = { x: 0, y: 1.5, z: -10 };
        const defaults: Record<string, unknown> = {
          tick: game.world.tick,
          point: v,
          origin: { x: 0, y: 1.62, z: 8 },
          dir: { x: 0, y: 0, z: -1 },
          normal: { x: 0, y: 0, z: 1 },
          moving: false,
          onTarget: false,
          distance: 10,
          targetId: 0,
          damage: 34,
          hpLeft: 66,
          zone: 'body',
          killed: false,
        };
        (game.bus as unknown as { emit(t: string, p: unknown): void }).emit(type, { ...defaults, ...payload });
        game.renderNow();
      },
    });
  },
});
