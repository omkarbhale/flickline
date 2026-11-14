import {
  bindKey, clearKey, defaultKeys, KEY_ACTIONS, KEY_LABELS, KEYS_PER_ACTION, keyLabel, type KeyAction,
} from '../settings/keys';
import type { SettingsStore } from '../settings/settings';
import { button, h } from './kit/kit';

/** Keys that are not rebindable, shown so the table is complete (design §13.3 lists `Esc`). */
const FIXED_ROWS: readonly { label: string; key: string; why: string }[] = [
  { label: 'Menu / pause', key: 'Esc', why: 'the browser releases the mouse with Esc' },
  { label: 'Debug overlay', key: '`', why: 'fixed' },
];

/**
 * The Keys group of the settings menu (design §13.3): every action with two binding slots. Click a
 * slot (or press Enter on it) and press the new key; `Esc` cancels. A key another action already
 * uses is refused and the message names that action; the `×` beside a slot clears it; Reset puts the
 * defaults back. Bindings persist through the settings store and take effect at once.
 */
export class KeysEditor {
  readonly el: HTMLElement;
  private readonly slots = new Map<string, HTMLButtonElement>();
  private readonly clears = new Map<string, HTMLButtonElement>();
  private readonly status: HTMLElement;
  private capture: { action: KeyAction; slot: number } | null = null;

  constructor(private readonly store: SettingsStore) {
    this.status = h('p', { class: 'set-status', attrs: { role: 'status', 'aria-live': 'polite' } });
    const table = h('div', { class: 'keys-table', attrs: { role: 'group', 'aria-label': 'Key bindings' } });
    for (const action of KEY_ACTIONS) {
      const row = h('div', { class: 'keys-row', attrs: { 'data-action': action } }, [h('span', { class: 'keys-name', text: KEY_LABELS[action] })]);
      const cells = h('span', { class: 'keys-slots' });
      for (let slot = 0; slot < KEYS_PER_ACTION; slot++) {
        const label = `${KEY_LABELS[action]}, ${slot === 0 ? 'primary' : 'second'} key`;
        const b = h('button', { class: 'keys-slot', attrs: { type: 'button', 'data-action': action, 'data-slot': String(slot), 'aria-label': label } });
        b.addEventListener('click', () => this.begin(action, slot));
        const x = h('button', { class: 'keys-clear', text: '×', attrs: { type: 'button', 'aria-label': `Clear ${label}`, title: 'Clear' } });
        x.addEventListener('click', () => this.clear(action, slot));
        this.slots.set(`${action}:${slot}`, b);
        this.clears.set(`${action}:${slot}`, x);
        cells.append(h('span', { class: 'keys-cell' }, [b, x]));
      }
      row.append(cells);
      table.append(row);
    }
    for (const f of FIXED_ROWS) {
      table.append(
        h('div', { class: 'keys-row keys-row--fixed' }, [
          h('span', { class: 'keys-name', text: f.label }),
          h('span', { class: 'keys-slots' }, [h('kbd', { class: 'fl-kbd', text: f.key }), h('span', { class: 'set-hint', text: f.why })]),
        ]),
      );
    }
    const reset = button('Reset keys to defaults', {
      variant: 'secondary',
      onClick: () => {
        this.cancel();
        this.store.set({ keys: defaultKeys() });
        this.say('Keys reset to the defaults.');
      },
    });
    reset.dataset.k = 'keysReset';
    this.el = h('div', { class: 'set-section' }, [
      h('p', { class: 'note', text: 'Click a key, then press the one you want. A key can only do one thing. Esc cancels.' }),
      table,
      h('div', { class: 'set-actions' }, [reset]),
      this.status,
    ]);
    this.sync();
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  /** Refresh the slot labels from the store. */
  sync(): void {
    const keys = this.store.get().keys;
    for (const action of KEY_ACTIONS) {
      for (let slot = 0; slot < KEYS_PER_ACTION; slot++) {
        const b = this.slots.get(`${action}:${slot}`)!;
        const code = keys[action][slot];
        const active = this.capture?.action === action && this.capture.slot === slot;
        b.textContent = active ? 'Press a key…' : code === undefined ? '—' : keyLabel(code);
        b.classList.toggle('is-capturing', active);
        b.classList.toggle('is-empty', code === undefined);
        b.dataset.code = code ?? '';
        this.clears.get(`${action}:${slot}`)!.style.visibility = code === undefined || active ? 'hidden' : 'visible';
      }
    }
  }

  /** Start listening for the new key for one slot. */
  begin(action: KeyAction, slot: number): void {
    this.cancel();
    this.capture = { action, slot };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('blur', this.onBlur);
    this.say(`Press the new key for ${KEY_LABELS[action]}. Esc cancels.`);
    this.sync();
  }

  /** Stop listening without changing anything. */
  cancel(): void {
    if (!this.capture) return;
    this.capture = null;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('blur', this.onBlur);
    this.sync();
  }

  private clear(action: KeyAction, slot: number): void {
    this.cancel();
    this.store.set({ keys: clearKey(this.store.get().keys, action, slot) });
    this.say(`${KEY_LABELS[action]}: key cleared.`);
  }

  private readonly onBlur = (): void => this.cancel();

  /** Capture phase: nothing else (menu keys, game input, the results card) sees the key while binding. */
  private readonly onKey = (e: KeyboardEvent): void => {
    const cap = this.capture;
    if (!cap) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.cancel();
      this.say('Cancelled.');
      this.slots.get(`${cap.action}:${cap.slot}`)?.focus();
      return;
    }
    const r = bindKey(this.store.get().keys, cap.action, cap.slot, e.code);
    if (r.ok) {
      this.cancel();
      this.store.set({ keys: r.keys });
      this.say(`${KEY_LABELS[cap.action]} is now ${keyLabel(e.code)}.`);
      this.slots.get(`${cap.action}:${cap.slot}`)?.focus();
      return;
    }
    const name = keyLabel(e.code);
    if (r.reason === 'conflict') {
      this.say(r.with === cap.action ? `${name} is already this action's other key.` : `${name} is already used by ${KEY_LABELS[r.with!]}. Pick another key, or change that one first.`, true);
    } else if (r.reason === 'reserved') {
      this.say(`${name} can't be used here. Pick another key.`, true);
    } else {
      this.say('That key can not be used. Pick another.', true);
    }
  };

  private say(text: string, warn = false): void {
    this.status.textContent = text;
    this.status.dataset.tone = warn ? 'warn' : 'info';
  }

  /** The text of the status line (tests, debug hook). */
  get message(): string {
    return this.status.textContent ?? '';
  }
}
