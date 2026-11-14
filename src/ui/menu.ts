import { cmPer360, sensitivityFromCmPer360 } from '../core/sensitivity';
import { QUALITY_LEVELS } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { Settings, SettingsStore } from '../settings/settings';
import { CrosshairEditor } from './crosshairEditor';

/**
 * Start / pause menu with the settings panel. Shown whenever the pointer is not locked.
 * Plain DOM, built once; values sync from the SettingsStore.
 */
export class Menu {
  private readonly el: HTMLElement;
  private readonly sens: HTMLInputElement;
  private readonly dpi: HTMLInputElement;
  private readonly cm: HTMLInputElement;
  private readonly vol: HTMLInputElement;
  private readonly quality: HTMLSelectElement;
  private readonly title: HTMLElement;
  private readonly toggles: [keyof Settings, HTMLInputElement][] = [];
  private readonly crosshair: CrosshairEditor;

  constructor(
    root: HTMLElement,
    private readonly store: SettingsStore,
    tunables: Tunables,
    onPlay: () => void,
  ) {
    this.el = root;
    root.innerHTML = `
      <div class="panel">
        <h1>FLICKLINE</h1>
        <p class="tag">First-person aim and movement trainer</p>
        <button class="play" type="button">Click to play</button>
        <p class="hint" data-title>Esc opens this menu</p>
        <div class="grid">
          <label>Sensitivity<input data-k="sens" name="sens" id="set-sens" type="number" step="0.01" min="0.01" max="20" /></label>
          <label>Mouse DPI<input data-k="dpi" name="dpi" id="set-dpi" type="number" step="50" min="100" max="32000" /></label>
          <label>cm / 360°<input data-k="cm" name="cm" id="set-cm" type="number" step="0.5" min="1" max="1000" /></label>
          <label>Volume<input data-k="vol" name="vol" id="set-vol" type="range" min="0" max="1" step="0.01" /></label>
          <label>Graphics<select data-k="quality" name="quality" id="set-quality">${QUALITY_LEVELS.map((q) => `<option value="${q}">${q}</option>`).join('')}</select></label>
        </div>
        <div class="grid toggles">
          <label class="check"><input data-k="coachingCues" type="checkbox" /> Coaching cues (amber moving-shot tracer, ⇆)</label>
          <label class="check"><input data-k="missGhost" type="checkbox" /> Miss ghost ring</label>
          <label class="check"><input data-k="damageNumbers" type="checkbox" /> Damage numbers</label>
          <label class="check"><input data-k="reduceFlashing" type="checkbox" /> Reduce flashing (no screen pulses)</label>
        </div>
        <details class="ch-editor"><summary>Crosshair</summary><div data-k="crosshair"></div></details>
        <p class="note"></p>
        <p class="keys">WASD move · Space jump · Ctrl/C crouch · Shift walk · LMB shoot · \` debug overlay</p>
      </div>`;
    const q = <T extends HTMLElement>(k: string): T => root.querySelector(`[data-k="${k}"]`) as T;
    this.sens = q('sens');
    this.dpi = q('dpi');
    this.cm = q('cm');
    this.vol = q('vol');
    this.quality = q('quality');
    this.crosshair = new CrosshairEditor(q('crosshair'), store);
    this.title = root.querySelector('[data-title]') as HTMLElement;
    (root.querySelector('.note') as HTMLElement).textContent = tunables.view.fovLockNote;

    root.querySelector('.play')!.addEventListener('click', onPlay);
    root.querySelector('.panel')!.addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('click', onPlay);

    const num = (el: HTMLInputElement): number => parseFloat(el.value);
    this.sens.addEventListener('change', () => {
      const v = num(this.sens);
      if (Number.isFinite(v)) this.store.set({ sensitivity: v });
      this.sync();
    });
    this.dpi.addEventListener('change', () => {
      const v = num(this.dpi);
      if (Number.isFinite(v)) this.store.set({ dpi: v });
      this.sync();
    });
    this.cm.addEventListener('change', () => {
      const v = num(this.cm);
      if (Number.isFinite(v) && v > 0) {
        this.store.set({ sensitivity: sensitivityFromCmPer360(v, this.store.get().dpi) });
      }
      this.sync();
    });
    this.vol.addEventListener('input', () => this.store.set({ volume: num(this.vol) }));
    this.quality.addEventListener('change', () => {
      this.store.set({ quality: this.quality.value as 'low' | 'medium' | 'high' });
    });
    for (const key of ['coachingCues', 'missGhost', 'damageNumbers', 'reduceFlashing'] as const) {
      const el = q<HTMLInputElement>(key);
      this.toggles.push([key, el]);
      el.addEventListener('change', () => this.store.set({ [key]: el.checked }));
    }
    this.sync();
  }

  /** Refresh the form from the store. */
  sync(): void {
    const s = this.store.get();
    this.sens.value = s.sensitivity.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    this.dpi.value = String(Math.round(s.dpi));
    this.cm.value = cmPer360(s.sensitivity, s.dpi).toFixed(1);
    this.vol.value = String(s.volume);
    this.quality.value = s.quality;
    for (const [key, el] of this.toggles) el.checked = s[key] as boolean;
    this.crosshair.sync();
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    this.el.classList.toggle('open', v);
  }

  setMessage(msg: string): void {
    this.title.textContent = msg;
  }
}
