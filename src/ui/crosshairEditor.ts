import { CrosshairView } from '../hud/crosshairView';
import {
  CROSSHAIR_LIMITS as L,
  CROSSHAIR_PRESETS,
  cloneCrosshair,
  colorToHex,
  crosshairEquals,
  decodeCrosshair,
  encodeCrosshair,
  hexToColor,
  type CrosshairParams,
} from '../settings/crosshair';
import type { SettingsStore } from '../settings/settings';

type Kind = 'bool' | 'int' | 'opacity' | 'color';

interface Control {
  label: string;
  /** Dot path into CrosshairParams, e.g. `inner.length`. */
  path: string;
  kind: Kind;
  min?: number;
  max?: number;
}

interface Group {
  title: string;
  controls: Control[];
}

const GROUPS: Group[] = [
  { title: 'Colour', controls: [{ label: 'Colour', path: 'color', kind: 'color' }] },
  {
    title: 'Outline',
    controls: [
      { label: 'Show', path: 'outline.show', kind: 'bool' },
      { label: 'Thickness', path: 'outline.thickness', kind: 'int', min: L.outlineThickness.min, max: L.outlineThickness.max },
      { label: 'Opacity', path: 'outline.opacity', kind: 'opacity' },
    ],
  },
  {
    title: 'Inner lines',
    controls: [
      { label: 'Show', path: 'inner.show', kind: 'bool' },
      { label: 'Length', path: 'inner.length', kind: 'int', min: L.length.min, max: L.length.max },
      { label: 'Thickness', path: 'inner.thickness', kind: 'int', min: L.thickness.min, max: L.thickness.max },
      { label: 'Gap', path: 'inner.gap', kind: 'int', min: L.gap.min, max: L.gap.max },
      { label: 'Opacity', path: 'inner.opacity', kind: 'opacity' },
    ],
  },
  {
    title: 'Outer lines',
    controls: [
      { label: 'Show', path: 'outer.show', kind: 'bool' },
      { label: 'Length', path: 'outer.length', kind: 'int', min: L.length.min, max: L.length.max },
      { label: 'Thickness', path: 'outer.thickness', kind: 'int', min: L.thickness.min, max: L.thickness.max },
      { label: 'Gap', path: 'outer.gap', kind: 'int', min: L.gap.min, max: L.gap.max },
      { label: 'Opacity', path: 'outer.opacity', kind: 'opacity' },
    ],
  },
  {
    title: 'Centre dot',
    controls: [
      { label: 'Show', path: 'dot.show', kind: 'bool' },
      { label: 'Size', path: 'dot.size', kind: 'int', min: L.dotSize.min, max: L.dotSize.max },
      { label: 'Opacity', path: 'dot.opacity', kind: 'opacity' },
    ],
  },
  {
    title: 'Firing error',
    controls: [
      { label: 'Spread when shooting while moving', path: 'firingError.show', kind: 'bool' },
      { label: 'Amount', path: 'firingError.amount', kind: 'int', min: L.errorAmount.min, max: L.errorAmount.max },
    ],
  },
  { title: 'Hit marker', controls: [{ label: 'Colour', path: 'hitMarkerColor', kind: 'color' }] },
];

function getPath(p: CrosshairParams, path: string): unknown {
  let o: unknown = p;
  for (const k of path.split('.')) o = (o as Record<string, unknown>)[k];
  return o;
}

function setPath(p: CrosshairParams, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = p as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]!] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
}

/**
 * Crosshair editor: presets, every parameter with a live preview, and share-code import/export.
 * It only talks to the settings store; the in-game crosshair updates from `settingsChanged`.
 */
export class CrosshairEditor {
  private readonly inputs = new Map<string, HTMLInputElement>();
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly preview: CrosshairView;
  private readonly codeOut: HTMLInputElement;
  private readonly codeIn: HTMLInputElement;
  private readonly msg: HTMLElement;
  private readonly presetButtons: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, private readonly store: SettingsStore) {
    const presetHtml = CROSSHAIR_PRESETS.map(
      (pr) => `<button type="button" class="ch-preset" data-preset="${pr.id}">${pr.name}</button>`,
    ).join('');
    const groupHtml = GROUPS.map((g) => {
      const rows = g.controls
        .map((c) => {
          const id = `ch-${c.path.replace('.', '-')}`;
          const input =
            c.kind === 'bool' ? `<input type="checkbox" id="${id}" name="${id}" data-path="${c.path}" />`
            : c.kind === 'color' ? `<input type="color" id="${id}" name="${id}" data-path="${c.path}" />`
            : c.kind === 'opacity' ? `<input type="range" id="${id}" name="${id}" data-path="${c.path}" min="0" max="1" step="0.01" /><output data-out="${c.path}"></output>`
            : `<input type="range" id="${id}" name="${id}" data-path="${c.path}" min="${c.min}" max="${c.max}" step="1" /><output data-out="${c.path}"></output>`;
          return `<label class="ch-row" for="${id}"><span>${c.label}</span>${input}</label>`;
        })
        .join('');
      return `<fieldset class="ch-group"><legend>${g.title}</legend>${rows}</fieldset>`;
    }).join('');

    root.innerHTML = `
      <div class="ch-top">
        <div class="ch-preview" data-ch="preview" aria-label="Crosshair preview"></div>
        <div class="ch-side">
          <div class="ch-presets">${presetHtml}</div>
          <button type="button" class="ch-test" data-ch="test">Test a moving shot</button>
        </div>
      </div>
      <div class="ch-groups">${groupHtml}</div>
      <div class="ch-share">
        <label class="ch-code" for="ch-code-out"><span>Your code</span>
          <span class="ch-codebox"><input id="ch-code-out" name="ch-code-out" data-ch="code-out" type="text" readonly spellcheck="false" /><button type="button" data-ch="copy">Copy</button></span>
        </label>
        <label class="ch-code" for="ch-code-in"><span>Import a code</span>
          <span class="ch-codebox"><input id="ch-code-in" name="ch-code-in" data-ch="code-in" type="text" spellcheck="false" autocomplete="off" placeholder="Paste a code" /><button type="button" data-ch="import">Import</button></span>
        </label>
        <p class="ch-msg" data-ch="msg" role="status"></p>
      </div>`;

    const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
    this.codeOut = q('[data-ch="code-out"]');
    this.codeIn = q('[data-ch="code-in"]');
    this.msg = q('[data-ch="msg"]');
    for (const el of root.querySelectorAll<HTMLInputElement>('input[data-path]')) {
      this.inputs.set(el.dataset.path!, el);
      el.addEventListener('input', () => this.onControl(el));
    }
    for (const el of root.querySelectorAll<HTMLElement>('output[data-out]')) this.readouts.set(el.dataset.out!, el);
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.ch-preset')) {
      this.presetButtons.push(btn);
      btn.addEventListener('click', () => {
        const preset = CROSSHAIR_PRESETS.find((x) => x.id === btn.dataset.preset);
        if (preset) this.apply(cloneCrosshair(preset.params), `${preset.name} preset applied.`);
      });
    }
    this.preview = new CrosshairView(q('[data-ch="preview"]'), store.get().crosshair);
    q('[data-ch="test"]').addEventListener('click', () => {
      if (!this.store.get().crosshair.firingError.show) this.say('Turn on Firing error to see the spread.', false);
      else this.preview.pulse();
    });
    q('[data-ch="copy"]').addEventListener('click', () => void this.copy());
    q('[data-ch="import"]').addEventListener('click', () => this.importCode());
    this.codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.importCode();
      e.stopPropagation();
    });
    this.sync();
  }

  /** Refresh every control, the preview and the share code from the store. */
  sync(): void {
    const p = this.store.get().crosshair;
    for (const [path, el] of this.inputs) {
      const v = getPath(p, path);
      if (typeof v === 'boolean') el.checked = v;
      else if (path === 'color' || path === 'hitMarkerColor') el.value = colorToHex(v as number);
      else {
        el.value = String(v);
        const out = this.readouts.get(path);
        if (out) out.textContent = path.endsWith('opacity') ? `${Math.round((v as number) * 100)}%` : String(v);
      }
    }
    this.preview.setParams(p);
    this.codeOut.value = encodeCrosshair(p);
    for (const btn of this.presetButtons) {
      const preset = CROSSHAIR_PRESETS.find((x) => x.id === btn.dataset.preset);
      btn.classList.toggle('active', !!preset && crosshairEquals(preset.params, p));
    }
  }

  private onControl(el: HTMLInputElement): void {
    const path = el.dataset.path!;
    const next = cloneCrosshair(this.store.get().crosshair);
    if (el.type === 'checkbox') setPath(next, path, el.checked);
    else if (el.type === 'color') setPath(next, path, hexToColor(el.value) ?? getPath(next, path));
    else setPath(next, path, parseFloat(el.value));
    this.say('', true);
    this.store.set({ crosshair: next });
  }

  private apply(next: CrosshairParams, message: string): void {
    this.store.set({ crosshair: next });
    this.say(message, true);
  }

  private importCode(): void {
    const res = decodeCrosshair(this.codeIn.value);
    if (!res.ok) {
      this.say(res.error, false); // invalid: nothing changes
      return;
    }
    this.apply(res.params, 'Crosshair imported.');
    this.codeIn.value = '';
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codeOut.value);
      this.say('Code copied.', true);
    } catch {
      this.codeOut.select();
      this.say('Press Ctrl+C to copy the selected code.', true);
    }
  }

  private say(text: string, ok: boolean): void {
    this.msg.textContent = text;
    this.msg.classList.toggle('bad', !ok);
  }
}
