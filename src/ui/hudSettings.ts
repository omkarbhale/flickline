import { hud as hudTunables } from '../config/hud';
import { cloneHud, HUD_ELEMENTS, HUD_LABELS, type HudElementId } from '../settings/hud';
import type { SettingsStore } from '../settings/settings';

/**
 * The HUD group of the settings menu: one toggle per HUD element and the HUD scale (design 13.1,
 * 13.3). The full settings menu is #42; this is the part the HUD needs to be configurable now.
 */
export class HudSettingsPanel {
  private readonly boxes = {} as Record<HudElementId, HTMLInputElement>;
  private readonly scale: HTMLInputElement;
  private readonly scaleOut: HTMLOutputElement;

  constructor(root: HTMLElement, private readonly store: SettingsStore) {
    const items = HUD_ELEMENTS.map(
      (id) => `<label><input type="checkbox" data-hud="${id}" name="hud-${id}" /> ${HUD_LABELS[id]}</label>`,
    ).join('');
    root.innerHTML = `
      <div class="hud-set">
        <div class="hud-set-grid">${items}</div>
        <label class="scale">HUD scale
          <input type="range" data-hud-scale name="hud-scale" min="${hudTunables.scaleMin}" max="${hudTunables.scaleMax}" step="0.05" />
          <output></output>
        </label>
      </div>`;
    for (const id of HUD_ELEMENTS) {
      const box = root.querySelector(`[data-hud="${id}"]`) as HTMLInputElement;
      this.boxes[id] = box;
      box.addEventListener('change', () => {
        const next = cloneHud(this.store.get().hud);
        next.show[id] = box.checked;
        this.store.set({ hud: next });
      });
    }
    this.scale = root.querySelector('[data-hud-scale]') as HTMLInputElement;
    this.scaleOut = root.querySelector('output') as HTMLOutputElement;
    this.scale.addEventListener('input', () => {
      const v = parseFloat(this.scale.value);
      if (!Number.isFinite(v)) return;
      const next = cloneHud(this.store.get().hud);
      next.scale = v;
      this.store.set({ hud: next });
    });
    this.sync();
  }

  sync(): void {
    const h = this.store.get().hud;
    for (const id of HUD_ELEMENTS) this.boxes[id].checked = h.show[id];
    this.scale.value = String(h.scale);
    this.scaleOut.textContent = `${Math.round(h.scale * 100)}%`;
  }
}
