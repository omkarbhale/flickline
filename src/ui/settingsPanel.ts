import { cmPer360, sensitivityFromCmPer360 } from '../core/sensitivity';
import { QUALITY_LEVELS } from '../config/render';
import type { Tunables } from '../config/tunables';
import type { Settings, SettingsStore } from '../settings/settings';
import { CrosshairEditor } from './crosshairEditor';
import { HudSettingsPanel } from './hudSettings';
import { h, tabs, toggle, type TabsHandle } from './kit/kit';

const TOGGLES: readonly [keyof Settings, string][] = [
  ['coachingCues', 'Coaching cues (amber moving-shot tracer, ⇆)'],
  ['missGhost', 'Miss ghost ring'],
  ['damageNumbers', 'Damage numbers'],
  ['reduceFlashing', 'Reduce flashing (no screen pulses)'],
];

/**
 * The settings screen's body: a tab strip over the existing controls. The contents are #42's (key
 * rebinding, audio, graphics, gameplay, data); this shell gives them tabs to grow into. Values
 * sync from the stores and write straight back, so every setting persists and applies live.
 */
export class SettingsPanel {
  readonly el: HTMLElement;
  /** Sensitivity, DPI and cm/360: also shown by the first-run panel, so the menu can move it. */
  readonly basics: HTMLElement;
  private readonly sens: HTMLInputElement;
  private readonly dpi: HTMLInputElement;
  private readonly cm: HTMLInputElement;
  private readonly vol: HTMLInputElement;
  private readonly quality: HTMLSelectElement;
  private readonly flinch: HTMLSelectElement;
  private readonly toggles: [keyof Settings, HTMLInputElement][] = [];
  private readonly raw: HTMLElement;
  private readonly crosshair: CrosshairEditor;
  private readonly hudPanel: HudSettingsPanel;
  private readonly tabs: TabsHandle;
  private readonly sections = new Map<string, HTMLElement>();

  /** `onFieldEnter`: Enter pressed in a number field (the value is committed first). */
  constructor(
    private readonly store: SettingsStore,
    tunables: Tunables,
    onFieldEnter: (e: KeyboardEvent) => void,
  ) {
    const field = (cls: string, html: string): HTMLLabelElement => {
      const l = h('label');
      l.className = cls;
      l.innerHTML = html;
      return l;
    };
    this.basics = h('div', { class: 'grid basics' });
    this.basics.innerHTML = `
      <label><span>Sensitivity <small>(reference scale)</small></span><input data-k="sens" name="sens" id="set-sens" type="number" step="any" min="0.01" max="20" /></label>
      <label>Mouse DPI<input data-k="dpi" name="dpi" id="set-dpi" type="number" step="50" min="100" max="32000" /></label>
      <label>cm / 360°<input data-k="cm" name="cm" id="set-cm" type="number" step="any" min="1" max="1000" /></label>`;
    const q = <T extends HTMLElement>(root: HTMLElement, k: string): T => root.querySelector(`[data-k="${k}"]`) as T;
    this.sens = q(this.basics, 'sens');
    this.dpi = q(this.basics, 'dpi');
    this.cm = q(this.basics, 'cm');

    // --- Mouse ---
    const mouse = h('div', { class: 'set-section' });
    this.raw = h('p', { class: 'raw' });
    mouse.append(this.basics, this.raw, h('p', { class: 'note', text: tunables.view.fovLockNote }));

    // --- Gameplay ---
    const gameplay = h('div', { class: 'set-section' });
    const toggleGrid = h('div', { class: 'set-toggles' });
    for (const [key, label] of TOGGLES) {
      const t = toggle(label, { 'data-k': key });
      this.toggles.push([key, t.input]);
      t.input.addEventListener('change', () => this.store.set({ [key]: t.input.checked }));
      toggleGrid.append(t.el);
    }
    const flinch = field(
      'set-select',
      `Hit flinch<select data-k="flinch" name="flinch" id="set-flinch"><option value="0">off</option><option value="0.5">half</option><option value="1">normal</option><option value="2">strong</option></select>`,
    );
    this.flinch = q(flinch, 'flinch');
    const chDetails = h('details', { class: 'ch-editor' }, [h('summary', { text: 'Crosshair' }), h('div', { attrs: { 'data-k': 'crosshair' } })]);
    const hudDetails = h('details', { class: 'ch-editor' }, [h('summary', { text: 'HUD' }), h('div', { attrs: { 'data-k': 'hud' } })]);
    gameplay.append(toggleGrid, flinch, chDetails, hudDetails);
    this.crosshair = new CrosshairEditor(q(chDetails, 'crosshair'), store);
    this.hudPanel = new HudSettingsPanel(q(hudDetails, 'hud'), store);

    // --- Audio and video ---
    const av = h('div', { class: 'set-section grid' });
    av.append(
      field('set-range', `Volume<input data-k="vol" name="vol" id="set-vol" type="range" min="0" max="1" step="0.01" />`),
      field('set-select', `Graphics<select data-k="quality" name="quality" id="set-quality">${QUALITY_LEVELS.map((l) => `<option value="${l}">${l}</option>`).join('')}</select>`),
    );
    this.vol = q(av, 'vol');
    this.quality = q(av, 'quality');

    this.sections.set('mouse', mouse);
    this.sections.set('gameplay', gameplay);
    this.sections.set('av', av);
    this.tabs = tabs(
      [
        { id: 'mouse', label: 'Mouse' },
        { id: 'gameplay', label: 'Gameplay' },
        { id: 'av', label: 'Audio & video' },
      ],
      (id) => this.showSection(id),
    );
    this.el = h('div', { class: 'settings-body' }, [this.tabs.el, mouse, gameplay, av]);
    this.showSection('mouse');

    // Enter in a sensitivity field commits the value and lets the menu decide what follows (first run: go in).
    this.basics.querySelectorAll('input').forEach((input) =>
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        input.blur();
        onFieldEnter(e);
      }),
    );

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
    this.flinch.addEventListener('change', () => this.store.set({ flinchStrength: parseFloat(this.flinch.value) }));
    this.setRawInput(null);
    this.sync();
  }

  private showSection(id: string): void {
    for (const [k, el] of this.sections) el.hidden = k !== id;
  }

  /** Refresh the form from the store. */
  sync(): void {
    const s = this.store.get();
    this.sens.value = s.sensitivity.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    this.dpi.value = String(Math.round(s.dpi));
    this.cm.value = cmPer360(s.sensitivity, s.dpi).toFixed(1);
    this.vol.value = String(s.volume);
    this.quality.value = s.quality;
    this.flinch.value = String(s.flinchStrength);
    for (const [key, el] of this.toggles) el.checked = s[key] as boolean;
    this.crosshair.sync();
    this.hudPanel.sync();
  }

  /** Raw-input state of the last lock request (null: not asked yet). */
  setRawInput(on: boolean | null): void {
    this.raw.dataset.state = on === null ? 'unknown' : on ? 'on' : 'off';
    this.raw.textContent =
      on === null
        ? 'Raw input: requested when you click play'
        : on
          ? 'Raw input: on'
          : 'Raw input: off (this browser cannot disable mouse acceleration; turn off "Enhance pointer precision" in your OS)';
  }
}
