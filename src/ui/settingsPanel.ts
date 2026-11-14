import { cmPer360, sensitivityFromCmPer360 } from '../core/sensitivity';
import { horizontalFovDeg, REFERENCE_ASPECT, verticalFovDeg } from '../core/view';
import { QUALITY_LEVELS } from '../config/render';
import { ECHO_PRESET_IDS, type EchoPresetId } from '../config/palette';
import type { Tunables } from '../config/tunables';
import { VIEWMODEL_MODES } from '../config/viewmodel';
import { FPS_CAPS, OVERRIDES, RENDER_SCALE_MAX, RENDER_SCALE_MIN, type Override, type SettingsStore } from '../settings/settings';
import { CrosshairEditor } from './crosshairEditor';
import { DataPanel, type DataHost } from './dataPanel';
import { HudSettingsPanel } from './hudSettings';
import { h, tabs, toggle, type TabsHandle } from './kit/kit';
import { KeysEditor } from './keysEditor';
import { FieldSet, percent } from './settingsFields';
import { rawInputText } from './rawInputText';

/** What the settings screen needs from the game beyond the stores. */
export interface SettingsHost extends DataHost {
  /** The modes that can have a difficulty pin: id and card name. */
  pinnableModes(): readonly { id: string; name: string }[];
  /** Tier name for a dial value ("Cobalt II"). */
  tierLabel(dial: number): string;
}

const ECHO_LABELS: Readonly<Record<EchoPresetId, string>> = {
  ember: 'Ember (default)',
  magenta: 'Magenta',
  lime: 'Lime',
  amber: 'Amber',
  contrast: 'Contrast (white with a black outline)',
};

const OVERRIDE_LABELS: Readonly<Record<Override, string>> = { auto: 'Follow the preset', on: 'On', off: 'Off' };

const TAB_IDS = ['mouse', 'keys', 'audio', 'graphics', 'gameplay', 'data'] as const;
export type SettingsTab = (typeof TAB_IDS)[number];

/**
 * The settings screen's body (design §13.3): a tab strip over six groups (Mouse and field of view,
 * Keys, Audio, Graphics, Gameplay, Data). Every control is native and every value syncs from the
 * store and writes straight back, so each setting persists the moment it changes and applies live
 * (the game reacts to `settingsChanged`). Nothing here is drawn per frame.
 */
export class SettingsPanel {
  readonly el: HTMLElement;
  /** Sensitivity, DPI and cm/360: also shown by the first-run panel, so the menu can move it. */
  readonly basics: HTMLElement;
  private readonly sens: HTMLInputElement;
  private readonly dpi: HTMLInputElement;
  private readonly cm: HTMLInputElement;
  private readonly raw: HTMLElement;
  private readonly fovValue: HTMLElement;
  private readonly fovNow: HTMLElement;
  private readonly fields: FieldSet;
  private readonly crosshair: CrosshairEditor;
  private readonly hudPanel: HudSettingsPanel;
  private readonly keys: KeysEditor;
  private readonly data: DataPanel;
  private readonly pinsEl: HTMLElement;
  private readonly tabs: TabsHandle;
  private readonly sections = new Map<SettingsTab, HTMLElement>();
  private pinRows: { id: string; toggle: HTMLInputElement; range: HTMLInputElement; out: HTMLElement }[] = [];
  private pinKey = '';
  private rawState: boolean | null = null;
  private rawRequested = true;

  /** `onFieldEnter`: Enter pressed in a number field (the value is committed first). */
  constructor(
    private readonly store: SettingsStore,
    private readonly tunables: Tunables,
    onFieldEnter: (e: KeyboardEvent) => void,
    private readonly host: SettingsHost,
  ) {
    const f = (this.fields = new FieldSet(store));
    const q = <T extends HTMLElement>(root: HTMLElement, k: string): T => root.querySelector(`[data-k="${k}"]`) as T;

    this.basics = h('div', { class: 'grid basics' });
    this.basics.innerHTML = `
      <label><span>Sensitivity <small>(reference scale)</small></span><input data-k="sens" name="sens" id="set-sens" type="number" step="any" min="0.01" max="20" /></label>
      <label>Mouse DPI<input data-k="dpi" name="dpi" id="set-dpi" type="number" step="50" min="100" max="32000" /></label>
      <label>cm / 360°<input data-k="cm" name="cm" id="set-cm" type="number" step="any" min="1" max="1000" /></label>`;
    this.sens = q(this.basics, 'sens');
    this.dpi = q(this.basics, 'dpi');
    this.cm = q(this.basics, 'cm');

    // --- Mouse (sensitivity, raw input, invert Y) and the locked field of view ---
    const mouse = h('div', { class: 'set-section' });
    this.raw = h('p', { class: 'raw' });
    this.fovValue = h('output', { class: 'fov-value' });
    this.fovNow = h('p', { class: 'set-hint' });
    const fov = h('div', { class: 'set-fov', attrs: { 'data-k': 'fov', role: 'group', 'aria-label': 'Field of view, locked' } }, [
      h('div', { class: 'set-fov-head' }, [h('span', { class: 'set-label', text: 'Field of view' }), this.fovValue, h('span', { class: 'set-lock', text: 'Locked' })]),
      h('p', { class: 'note', text: tunables.view.fovLockNote }),
      this.fovNow,
    ]);
    mouse.append(
      this.basics,
      f.toggleRow('invertY', 'Invert Y (mouse up looks down)'),
      f.toggleRow('rawInput', 'Raw mouse input', 'Bypasses the operating system’s pointer acceleration. Applies the next time the mouse is captured.'),
      this.raw,
      fov,
    );

    // --- Keys ---
    this.keys = new KeysEditor(store);
    const keysSection = this.keys.el;

    // --- Audio ---
    const audio = h('div', { class: 'set-section' });
    const vol = { min: 0, max: 1, step: 0.01, format: percent };
    audio.append(
      f.rangeRow('volume', 'Master volume', vol),
      f.rangeRow('weaponsVolume', 'Weapons', vol),
      f.rangeRow('hitsVolume', 'Hit sounds', vol),
      f.rangeRow('enemiesVolume', 'Enemies', vol),
      f.rangeRow('tellVolume', 'Enemy tell', vol, 'The rising tone that says an enemy is about to shoot. It also follows the Enemies volume.'),
      f.rangeRow('uiVolume', 'Interface', vol),
      f.selectRow('hitSoundStyle', 'Hit sound style', [
        { value: 'standard', label: 'Standard' },
        { value: 'soft', label: 'Soft' },
      ], 'Soft rounds off and lowers the hit sounds. Each hit stays distinct.'),
      f.toggleRow('monoAudio', 'Mono audio', 'Plays everything in the middle. Sounds lose their direction.'),
    );

    // --- Graphics ---
    const graphics = h('div', { class: 'set-section' });
    graphics.append(
      f.selectRow('quality', 'Preset', QUALITY_LEVELS.map((l) => ({ value: l, label: l[0]!.toUpperCase() + l.slice(1) })), 'Low draws the simplest scene; High adds bloom, the vignette and enemy outlines.'),
      f.rangeRow('renderScale', 'Render scale', { min: RENDER_SCALE_MIN, max: RENDER_SCALE_MAX, step: 0.05, format: percent }, 'Draws the world at a fraction of the screen’s pixels. Lower is faster; the HUD stays sharp.'),
      f.selectRow('fpsCap', 'FPS cap', FPS_CAPS.map((c) => ({ value: String(c), label: c === 0 ? 'Uncapped' : String(c) })), 'Uncapped follows your display’s refresh rate.', true),
      f.toggleRow('showFps', 'Show FPS and 1% lows'),
      f.selectRow('postEffects', 'Post effects', OVERRIDES.map((o) => ({ value: o, label: OVERRIDE_LABELS[o] })), 'Bloom and the vignette.'),
      f.selectRow('enemyOutline', 'Enemy outline', OVERRIDES.map((o) => ({ value: o, label: OVERRIDE_LABELS[o] }))),
      f.selectRow('echoPreset', 'Enemy colour', ECHO_PRESET_IDS.map((id) => ({ value: id, label: ECHO_LABELS[id] })), 'Contrast is for the highest visibility.'),
      f.toggleRow('reduceFlashing', 'Reduce flashing', 'Turns off screen pulses, chromatic effects and the Surge glow, and softens the damage flash. On by default when your system asks for reduced motion.'),
      f.toggleRow('chromaticPulse', 'Chromatic kill pulse', 'A 50 ms red/blue split on each kill. Needs a preset with the full post stack (High) or Post effects on; Reduce flashing overrides it. Off by default.'),
      f.selectRow('viewmodel', 'Weapon', VIEWMODEL_MODES.map((m) => ({ value: m, label: m === 'hidden' ? 'Hidden' : `${m[0]!.toUpperCase()}${m.slice(1)} hand` }))),
    );

    // --- Gameplay ---
    const gameplay = h('div', { class: 'set-section' });
    const chDetails = h('details', { class: 'ch-editor' }, [h('summary', { text: 'Crosshair' }), h('div', { attrs: { 'data-k': 'crosshair' } })]);
    const hudDetails = h('details', { class: 'ch-editor' }, [h('summary', { text: 'HUD scale and stat strip' }), h('div', { attrs: { 'data-k': 'hud' } })]);
    this.pinsEl = h('div', { class: 'set-pins', attrs: { role: 'group', 'aria-label': 'Difficulty pin per mode' } });
    gameplay.append(
      f.toggleRow('coachingCues', 'Coaching cues', 'The amber moving-shot tracer, the ⇆ glyph and the moving-shot tock. Turn off for a view that matches the reference game.'),
      f.toggleRow('cueFading', 'Fade cues as I improve', 'The coaching cues and enemy tells step back as your rating rises. Off keeps them at full strength.'),
      f.toggleRow('cleanRun', 'One clean run per session', 'A run with no coaching cues, like the reference game, as a benchmark.'),
      f.toggleRow('missGhost', 'Miss ghost', 'After a miss, a faint ring where the nearest target’s head was.'),
      f.toggleRow('damageNumbers', 'Damage numbers'),
      f.selectRow('flinchStrength', 'Hit flinch', [
        { value: '0', label: 'Off' },
        { value: '0.5', label: 'Half' },
        { value: '1', label: 'Normal' },
        { value: '2', label: 'Strong' },
      ], 'How far your aim is knocked when you are hit.', true),
      chDetails,
      hudDetails,
      h('h3', { class: 'set-group', text: 'Difficulty pin' }),
      h('p', { class: 'note', text: 'Matched difficulty is the default. Pin a mode to hold it at one level, for fair comparisons between runs.' }),
      this.pinsEl,
    );
    this.crosshair = new CrosshairEditor(q(chDetails, 'crosshair'), store);
    this.hudPanel = new HudSettingsPanel(q(hudDetails, 'hud'), store);

    // --- Data ---
    this.data = new DataPanel(host);

    const sections: [SettingsTab, HTMLElement][] = [
      ['mouse', mouse], ['keys', keysSection], ['audio', audio], ['graphics', graphics], ['gameplay', gameplay], ['data', this.data.el],
    ];
    const labels: Record<SettingsTab, string> = { mouse: 'Mouse', keys: 'Keys', audio: 'Audio', graphics: 'Graphics', gameplay: 'Gameplay', data: 'Data' };
    for (const [id, el] of sections) {
      el.setAttribute('role', 'tabpanel');
      el.setAttribute('aria-label', labels[id]);
      el.dataset.panel = id;
      this.sections.set(id, el);
    }
    this.tabs = tabs(
      TAB_IDS.map((id) => ({ id, label: labels[id] })),
      (id) => this.showSection(id as SettingsTab),
    );
    this.el = h('div', { class: 'settings-body' }, [this.tabs.el, ...sections.map(([, el]) => el)]);
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
    this.setRawInput(null);
    this.sync();
  }

  private showSection(id: SettingsTab): void {
    this.keys.cancel();
    this.data.disarm();
    for (const [k, el] of this.sections) el.hidden = k !== id;
    if (id === 'gameplay') this.syncPins();
    if (id === 'mouse') this.syncFov();
  }

  /** Switch tab (debug hook, tests). */
  select(id: SettingsTab): void {
    this.tabs.select(id);
  }

  get selected(): string {
    return this.tabs.selected;
  }

  /** A key is being captured: the menu's own key handling stays out of the way (the editor swallows the key itself). */
  get capturingKey(): boolean {
    return this.keys.capturing;
  }

  /** Leave whatever is half-done (a key capture, an armed reset): the screen is closing. */
  close(): void {
    this.keys.cancel();
    this.data.disarm();
  }

  /** Refresh the form from the store. */
  sync(): void {
    const s = this.store.get();
    this.sens.value = s.sensitivity.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    this.dpi.value = String(Math.round(s.dpi));
    this.cm.value = cmPer360(s.sensitivity, s.dpi).toFixed(1);
    this.fields.sync();
    this.keys.sync();
    this.crosshair.sync();
    this.hudPanel.sync();
    this.syncPins();
    this.syncFov();
    this.renderRaw();
  }

  /** The reference field of view, read-only: horizontal at 16:9, the constant vertical, and what this window shows. */
  private syncFov(): void {
    const hfov = this.tunables.view.hfovDeg;
    const vfov = verticalFovDeg(hfov, REFERENCE_ASPECT);
    this.fovValue.textContent = `${hfov}° horizontal at 16:9 · ${vfov.toFixed(1)}° vertical`;
    const aspect = typeof window === 'undefined' || window.innerHeight <= 0 ? REFERENCE_ASPECT : window.innerWidth / window.innerHeight;
    this.fovNow.textContent = `This window (${aspect.toFixed(2)}:1) shows ${horizontalFovDeg(vfov, aspect).toFixed(1)}° horizontally. The vertical field of view stays constant, as in the reference game.`;
  }

  /** Difficulty pin rows: one per pinnable mode (built when the list changes), each a toggle and a dial slider. */
  private syncPins(): void {
    const modes = this.host.pinnableModes();
    const key = modes.map((m) => m.id).join(',');
    if (key !== this.pinKey) {
      this.pinKey = key;
      this.pinRows = [];
      this.pinsEl.replaceChildren();
      for (const m of modes) {
        const t = toggle(`${m.name}`, { 'data-pin': m.id, name: `pin-${m.id}` });
        const range = h('input', { attrs: { type: 'range', min: '0', max: '100', step: '1', 'data-pin-dial': m.id, name: `pin-dial-${m.id}`, 'aria-label': `${m.name} pinned difficulty` } });
        const out = h('output', { class: 'set-value' });
        const write = (): void => {
          const pins = { ...this.store.get().difficultyPin };
          if (t.input.checked) pins[m.id] = parseFloat(range.value);
          else delete pins[m.id];
          this.store.set({ difficultyPin: pins });
        };
        t.input.addEventListener('change', write);
        range.addEventListener('input', () => {
          t.input.checked = true;
          write();
        });
        this.pinsEl.append(h('div', { class: 'set-row set-pin' }, [t.el, h('span', { class: 'set-slider' }, [range, out])]));
        this.pinRows.push({ id: m.id, toggle: t.input, range, out });
      }
      if (modes.length === 0) this.pinsEl.append(h('p', { class: 'note', text: 'No modes are registered yet.' }));
    }
    const pins = this.store.get().difficultyPin;
    for (const r of this.pinRows) {
      const v = pins[r.id];
      r.toggle.checked = v !== undefined;
      r.range.value = String(v ?? 50);
      r.range.disabled = v === undefined;
      r.out.textContent = v === undefined ? 'matched to you' : `${this.host.tierLabel(v)} · dial ${v}`;
    }
  }

  /** Raw-input state of the last lock request (null: not asked yet). */
  setRawInput(on: boolean | null, requested = true): void {
    this.rawState = on;
    this.rawRequested = requested;
    this.renderRaw();
  }

  private renderRaw(): void {
    const requested = this.store.get().rawInput;
    // Before the first lock request the note follows the setting; afterwards it shows what the browser gave.
    const on = this.rawState;
    this.raw.dataset.state = on === null ? 'unknown' : on ? 'on' : 'off';
    this.raw.textContent = rawInputText(on, on === null ? requested : this.rawRequested && requested);
  }
}
