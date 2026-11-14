import { defineFeature } from '../app/feature';
import { StanceRings } from '../render/stanceRings';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Which stance rings are up: `[{ slot, up }]` for slots 0 and 1 (Stop & Pop; a double uses both). */
    stanceRings(): { slot: number; up: boolean }[];
  }
}

/**
 * Stop & Pop's stance rings: the render layer is driven by the mode's `stanceRing*` events and
 * cleared when a run ends or restarts. Pure presentation; nothing here touches the sim.
 */
export const feature = defineFeature({
  id: 'stanceRings',
  stage: 'presentation',
  setup(game) {
    const rings = new StanceRings(game.renderer.scene, game.tunables.stanceRing);
    game.renderer.addLayer(rings);
    game.bus.on('stanceRingShown', (e) => rings.show(e.slot, e.crouch, e.x, e.y, e.z));
    game.bus.on('stanceRingJudged', (e) => rings.judge(e.slot, e.ok));
    game.bus.on('stanceRingHidden', (e) => rings.hide(e.slot));
    game.bus.on('runEnded', () => rings.hideAll());
    game.onReset(() => rings.hideAll());
    game.addDebug({ stanceRings: () => [0, 1].map((slot) => ({ slot, up: rings.visible(slot) })) });
  },
});
