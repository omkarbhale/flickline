import { defineFeature } from '../app/feature';
import { decodeCrosshair, encodeCrosshair } from '../settings/crosshair';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Crosshair state: current params, share code, redraw counter and last device-pixel geometry. */
    crosshair(): unknown;
    /** Import a crosshair share code through the real parser; returns `{ok, error?}`. */
    setCrosshairCode(code: string): { ok: boolean; error?: string };
  }
}

/** Debug access to the crosshair (the HUD draws it; settings persist it). */
export const feature = defineFeature({
  id: 'crosshair',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      crosshair() {
        const p = game.settings.get().crosshair;
        return { params: p, code: encodeCrosshair(p), draws: game.hud.crosshair.draws, view: game.hud.crosshair.describe() };
      },
      setCrosshairCode(code) {
        const res = decodeCrosshair(code);
        if (!res.ok) return { ok: false, error: res.error };
        game.settings.set({ crosshair: res.params });
        return { ok: true };
      },
    });
  },
});
