import type { Settings, SettingsStore } from '../settings/settings';
import { h, toggle } from './kit/kit';

/**
 * Small builders for the settings rows (a label, a native control, an optional hint). Each row reads
 * its value from the store on `sync()` and writes straight back on change, so a setting persists the
 * moment it moves and applies live (the game reacts to `settingsChanged`). Controls are native
 * (checkbox, select, range), so the whole screen works from the keyboard with no extra code.
 */
export class FieldSet {
  private readonly syncers: (() => void)[] = [];
  private seq = 0;

  constructor(readonly store: SettingsStore) {}

  sync(): void {
    for (const fn of this.syncers) fn();
  }

  /** Register a function that refreshes some control from the store. */
  onSync(fn: () => void): void {
    this.syncers.push(fn);
  }

  private id(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  /** A switch for a boolean setting. */
  toggleRow(key: keyof Settings, label: string, hint?: string): HTMLElement {
    const t = toggle(label, { 'data-k': key, name: key });
    t.input.addEventListener('change', () => this.store.set({ [key]: t.input.checked } as Partial<Settings>));
    this.onSync(() => {
      t.input.checked = this.store.get()[key] as boolean;
    });
    const row = h('div', { class: 'set-row set-row--toggle' }, [t.el]);
    if (hint) row.append(h('p', { class: 'set-hint', text: hint }));
    return row;
  }

  /** A drop-down for a setting with a fixed set of values (numbers are parsed back when `numeric`). */
  selectRow(key: keyof Settings, label: string, options: readonly { value: string; label: string }[], hint?: string, numeric = false): HTMLElement {
    const id = this.id(`set-${key}`);
    const select = h('select', { attrs: { id, name: key, 'data-k': key } });
    for (const o of options) select.append(h('option', { text: o.label, attrs: { value: o.value } }));
    select.addEventListener('change', () => {
      this.store.set({ [key]: numeric ? parseFloat(select.value) : select.value } as Partial<Settings>);
    });
    this.onSync(() => {
      select.value = String(this.store.get()[key]);
    });
    return this.row(id, label, select, hint);
  }

  /** A slider for a numeric setting; the current value shows beside it. */
  rangeRow(
    key: keyof Settings,
    label: string,
    o: { min: number; max: number; step: number; format: (v: number) => string },
    hint?: string,
  ): HTMLElement {
    const id = this.id(`set-${key}`);
    const input = h('input', { attrs: { id, type: 'range', name: key, 'data-k': key, min: String(o.min), max: String(o.max), step: String(o.step) } });
    const out = h('output', { class: 'set-value', attrs: { for: id } });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) this.store.set({ [key]: v } as Partial<Settings>);
      out.textContent = o.format(parseFloat(input.value));
    });
    this.onSync(() => {
      const v = this.store.get()[key] as number;
      input.value = String(v);
      out.textContent = o.format(v);
    });
    return this.row(id, label, h('span', { class: 'set-slider' }, [input, out]), hint);
  }

  private row(id: string, label: string, control: HTMLElement, hint?: string): HTMLElement {
    const row = h('div', { class: 'set-row' }, [h('label', { class: 'set-label', text: label, attrs: { for: id } }), control]);
    if (hint) row.append(h('p', { class: 'set-hint', text: hint }));
    return row;
  }
}

/** `0.65` -> `65%`. */
export const percent = (v: number): string => `${Math.round(v * 100)}%`;
