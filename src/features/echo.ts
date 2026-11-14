import { defineFeature } from '../app/feature';
import { ECHO_PRESET_IDS, type EchoPresetId } from '../config/palette';
import type { ShowcaseItem } from '../render/targetsView';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Enemy colour preset: ember, magenta, lime, amber or contrast. Returns false for an unknown id. */
    echoPreset(id: EchoPresetId): boolean;
    /**
     * Draw display-only enemy props (`look`: echo | beacon | gnat) next to the real targets, for
     * screenshots and the Gnat (no sim kind yet). `null` clears them. Returns how many were set.
     */
    echoShowcase(items: ShowcaseItem[] | null): number;
    /** Pin the Echo clock (kill shards, Gnat spin) at `sec` seconds, or resume it with null. */
    echoClock(sec: number | null): void;
  }
}

/** Debug control of the enemy look: colour presets, showcase props and the Echo clock. */
export const feature = defineFeature({
  id: 'echo',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      echoPreset(id) {
        if (!(ECHO_PRESET_IDS as readonly string[]).includes(id)) return false;
        game.renderer.setEchoPreset(id);
        game.renderNow();
        return true;
      },
      echoShowcase(items) {
        const view = game.renderer.enemies;
        if (view) view.showcase = items;
        game.renderNow();
        return items?.length ?? 0;
      },
      echoClock(sec) {
        game.renderer.enemies?.setTime(sec);
        game.renderNow();
      },
    });
  },
});
