import { defineFeature } from '../app/feature';
import { cloneHud, HUD_ELEMENTS, type HudElementId } from '../settings/hud';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Live HUD (design 7.2, 13.1): `state()` reads what is displayed (text per element), `pb()` installs a
     * fake personal best (a straight line to `finalScore` over `durationSec`; `null` removes it, so the
     * ghost-pace bar hides), `hp()` shows a health bar (`null` hides it), `show()` toggles an element and
     * `scale()` sets the HUD scale (both through the real settings store).
     */
    readonly hud: {
      state(): unknown;
      pb(curve: { finalScore: number; durationSec: number } | null): void;
      hp(hp: number | null, max?: number): void;
      show(id: HudElementId, visible: boolean): void;
      scale(s: number): void;
    };
  }
}

/** Debug access to the live HUD: read what it shows, fake a personal best, toggle and scale elements. */
export const feature = defineFeature({
  id: 'hud',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      hud: {
        state() {
          const out: Record<string, unknown> = { scale: game.settings.get().hud.scale, edge: { rate: game.edge.rate, count: game.edge.count } };
          for (const id of HUD_ELEMENTS) {
            const el = game.hud.root.querySelector(`[data-el="${id}"]`) as HTMLElement | null;
            out[id] = el ? { hidden: el.hidden || el.classList.contains('off'), text: el.textContent?.replace(/\s+/g, ' ').trim() } : null;
          }
          return out;
        },
        pb(curve) {
          game.hud.live.setPersonalBest(curve ? { scoreAt: (_m, t) => (curve.finalScore * Math.min(t, curve.durationSec)) / curve.durationSec } : null);
        },
        hp: (hp, max) => game.hud.live.setHp(hp, max),
        show(id, visible) {
          const h = cloneHud(game.settings.get().hud);
          h.show[id] = visible;
          game.settings.set({ hud: h });
        },
        scale(s) {
          const h = cloneHud(game.settings.get().hud);
          h.scale = s;
          game.settings.set({ hud: h });
        },
      },
    });
  },
});
