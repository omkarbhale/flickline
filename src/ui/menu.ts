import { cmPer360, sensitivityFromCmPer360 } from '../core/sensitivity';
import { SELF_REPORTS, type SelfReport } from '../config/profile';
import { QUALITY_LEVELS } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { ProfileStore } from '../settings/profile';
import type { SettingsStore } from '../settings/settings';
import { CrosshairEditor } from './crosshairEditor';

/**
 * - `firstRun`: a new player (design 13.4): compact bottom-centre panel over the live Range with
 *   the sensitivity field, self-report chips and Click to play. No tutorial text.
 * - `main`: a returning player's landing menu.
 * - `pause`: the pointer lock was lost (Esc, alt-tab): Click to resume, Backspace restarts.
 */
export type MenuMode = 'firstRun' | 'main' | 'pause';

export interface MenuHandlers {
  /** Enter the game (and take pointer lock); needs a user gesture. */
  onPlay: () => void;
  /** Restart from the pause panel (Backspace). */
  onRestart: () => void;
}

/**
 * Start / pause menu with the settings panel. Shown whenever the pointer is not locked.
 * Plain DOM, built once; values sync from the SettingsStore and ProfileStore.
 */
export class Menu {
  private readonly el: HTMLElement;
  private readonly sens: HTMLInputElement;
  private readonly dpi: HTMLInputElement;
  private readonly cm: HTMLInputElement;
  private readonly vol: HTMLInputElement;
  private readonly quality: HTMLSelectElement;
  private readonly title: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly raw: HTMLElement;
  private readonly chips: HTMLButtonElement[];
  private mode: MenuMode = 'main';
  private readonly crosshair: CrosshairEditor;

  constructor(
    root: HTMLElement,
    private readonly store: SettingsStore,
    private readonly profile: ProfileStore,
    tunables: Tunables,
    handlers: MenuHandlers,
  ) {
    this.el = root;
    root.innerHTML = `
      <div class="panel">
        <h1>FLICKLINE</h1>
        <p class="tag">First-person aim and movement trainer</p>
        <div class="chips only-first" role="group" aria-label="How experienced are you with shooters?">
          ${SELF_REPORTS.map((r) => `<button type="button" class="chip" data-chip="${r}" aria-pressed="false">${tunables.profile.chipLabels[r]}</button>`).join('')}
        </div>
        <button class="play" type="button">Click to play</button>
        <p class="raw" data-raw></p>
        <p class="hint not-first" data-title>Esc opens this menu</p>
        <div class="grid">
          <label><span>Sensitivity <small>(reference scale)</small></span><input data-k="sens" name="sens" id="set-sens" type="number" step="any" min="0.01" max="20" /></label>
          <label>Mouse DPI<input data-k="dpi" name="dpi" id="set-dpi" type="number" step="50" min="100" max="32000" /></label>
          <label>cm / 360°<input data-k="cm" name="cm" id="set-cm" type="number" step="any" min="1" max="1000" /></label>
          <label class="not-first">Volume<input data-k="vol" name="vol" id="set-vol" type="range" min="0" max="1" step="0.01" /></label>
          <label class="not-first">Graphics<select data-k="quality" name="quality" id="set-quality">${QUALITY_LEVELS.map((q) => `<option value="${q}">${q}</option>`).join('')}</select></label>
        </div>
        <details class="ch-editor not-first"><summary>Crosshair</summary><div data-k="crosshair"></div></details>
        <p class="note not-first"></p>
        <p class="keys not-first">WASD move · Space jump · Ctrl/C crouch · Shift walk · LMB shoot · \` debug overlay</p>
      </div>`;
    const q = <T extends HTMLElement>(k: string): T => root.querySelector(`[data-k="${k}"]`) as T;
    this.sens = q('sens');
    this.dpi = q('dpi');
    this.cm = q('cm');
    this.vol = q('vol');
    this.quality = q('quality');
    this.crosshair = new CrosshairEditor(q('crosshair'), store);
    this.title = root.querySelector('[data-title]') as HTMLElement;
    this.play = root.querySelector('.play') as HTMLButtonElement;
    this.raw = root.querySelector('[data-raw]') as HTMLElement;
    this.chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-chip]'));
    (root.querySelector('.note') as HTMLElement).textContent = tunables.view.fovLockNote;

    this.play.addEventListener('click', handlers.onPlay);
    root.querySelector('.panel')!.addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('click', handlers.onPlay);
    for (const chip of this.chips) {
      chip.addEventListener('click', () => {
        const r = chip.dataset.chip as SelfReport;
        // Clicking the picked chip again clears it (skip -> prior 40).
        this.profile.set({ selfReport: this.profile.get().selfReport === r ? null : r });
        this.sync();
      });
    }
    // Enter in a field commits the value and goes straight in (a keypress is a user gesture too).
    root.querySelectorAll('input').forEach((input) =>
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        input.blur();
        handlers.onPlay();
      }),
    );
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'pause' && this.el.classList.contains('open') && e.code === 'Backspace') {
        e.preventDefault();
        handlers.onRestart();
      }
    });
    this.setRawInput(null);
    this.setMode('main');

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
    const picked = this.profile.get().selfReport;
    for (const chip of this.chips) chip.setAttribute('aria-pressed', String(chip.dataset.chip === picked));
    this.crosshair.sync();
  }

  setMode(mode: MenuMode): void {
    this.mode = mode;
    this.el.dataset.mode = mode;
    this.play.textContent = mode === 'pause' ? 'Click to resume' : 'Click to play';
    this.title.textContent = mode === 'pause' ? 'Paused · Backspace restarts' : 'Esc opens this menu';
  }

  /** Show the raw-input state of the last lock request (null: not asked yet). */
  setRawInput(on: boolean | null): void {
    this.raw.dataset.state = on === null ? 'unknown' : on ? 'on' : 'off';
    this.raw.textContent =
      on === null
        ? 'Raw input: requested when you click play'
        : on
          ? 'Raw input: on'
          : 'Raw input: off (this browser cannot disable mouse acceleration; turn off "Enhance pointer precision" in your OS)';
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
    this.el.classList.toggle('open', v);
  }

}
