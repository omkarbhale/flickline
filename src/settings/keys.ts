/**
 * Key bindings (design §13.3 "Keys"): which `KeyboardEvent.code`s trigger which action. Pure data
 * and rules, no DOM: the settings screen edits them, `input/input.ts` reads them.
 *
 * Every action has up to two codes (a primary and an optional second one). No code is ever bound to
 * two actions: `sanitizeKeys` repairs a saved object that says so, and `bindKey` refuses the change
 * and names the action that already holds the key.
 */
export const KEY_ACTIONS = [
  'forward', 'back', 'left', 'right', 'walk', 'crouch', 'jump',
  'slotPrimary', 'slotSidearm', 'reload',
  'restart', 'confirm', 'statSheet', 'fullscreen',
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

/** At most this many codes per action. */
export const KEYS_PER_ACTION = 2;

export type KeyBindings = Readonly<Record<KeyAction, readonly string[]>>;
type MutableKeys = Record<KeyAction, string[]>;

/** Names as the settings screen shows them (design §13.3 wording). */
export const KEY_LABELS: Readonly<Record<KeyAction, string>> = {
  forward: 'Move forward',
  back: 'Move back',
  left: 'Move left',
  right: 'Move right',
  walk: 'Walk (hold)',
  crouch: 'Crouch',
  jump: 'Jump',
  slotPrimary: 'Primary weapon',
  slotSidearm: 'Sidearm',
  reload: 'Reload',
  restart: 'Restart run',
  confirm: 'Next run / confirm',
  statSheet: 'Stat sheet (hold)',
  fullscreen: 'Fullscreen',
};

/**
 * Defaults: design §13.3 (`WASD`, `Shift`, `Ctrl`, `Space`, `1`-`3`, `R`, `Backspace`, `Enter`,
 * `Tab`, `F11`). The loadout has two slots today (`sim/loadout.ts`: `1` primary, `2` sidearm); a
 * `3` action joins when a third slot exists (`sanitizeKeys` fills any new action with its default). The second code keeps what the game already accepted before keys were rebindable
 * (arrow keys to move, `C` to crouch, the numpad `Enter`).
 */
export const DEFAULT_KEYS: Readonly<KeyBindings> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  walk: ['ShiftLeft'],
  crouch: ['ControlLeft', 'KeyC'],
  jump: ['Space'],
  slotPrimary: ['Digit1'],
  slotSidearm: ['Digit2'],
  reload: ['KeyR'],
  restart: ['Backspace'],
  confirm: ['Enter', 'NumpadEnter'],
  statSheet: ['Tab'],
  fullscreen: ['F11'],
};

/**
 * Codes no action may use: `Esc` is the browser's (it releases the pointer and opens the menu),
 * the backtick is the debug overlay, and the Meta keys belong to the operating system.
 */
export const RESERVED_CODES: readonly string[] = ['Escape', 'Backquote', 'MetaLeft', 'MetaRight', 'ContextMenu'];

export function cloneKeys(k: Readonly<KeyBindings>): MutableKeys {
  const out = {} as MutableKeys;
  for (const a of KEY_ACTIONS) out[a] = [...k[a]];
  return out;
}

export function defaultKeys(): MutableKeys {
  return cloneKeys(DEFAULT_KEYS);
}

export function keysEqual(a: Readonly<KeyBindings>, b: Readonly<KeyBindings>): boolean {
  for (const action of KEY_ACTIONS) {
    const x = a[action];
    const y = b[action];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

const CODE_RE = /^[A-Za-z0-9]{1,24}$/;

/** A code a browser can send and the game can bind. */
export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code) && !RESERVED_CODES.includes(code);
}

/**
 * Validate arbitrary input into a full, conflict-free `KeyBindings`. An action missing from the input
 * gets its defaults; an action given as an empty list stays unbound; bad codes, reserved codes and
 * codes already taken by an earlier action are dropped (an action left with nothing that way falls
 * back to its defaults only where those are still free).
 */
export function sanitizeKeys(raw: unknown): KeyBindings {
  const out = {} as MutableKeys;
  const taken = new Set<string>();
  const src = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  for (const action of KEY_ACTIONS) {
    const given = src[action];
    let codes: string[];
    if (Array.isArray(given)) {
      codes = [];
      for (const c of given) {
        if (codes.length >= KEYS_PER_ACTION) break;
        if (isBindableCode(c) && !taken.has(c) && !codes.includes(c)) codes.push(c);
      }
    } else {
      codes = DEFAULT_KEYS[action].filter((c) => !taken.has(c));
    }
    for (const c of codes) taken.add(c);
    out[action] = codes;
  }
  return out;
}

/** The action that holds `code`, or null. */
export function actionOf(keys: Readonly<KeyBindings>, code: string): KeyAction | null {
  for (const action of KEY_ACTIONS) if (keys[action].includes(code)) return action;
  return null;
}

export type BindResult =
  | { ok: true; keys: KeyBindings }
  | { ok: false; reason: 'reserved' | 'invalid' | 'conflict'; /** The action that holds the key (`conflict` only). */ with?: KeyAction };

/**
 * Put `code` in slot `slot` (0 = primary, 1 = second) of `action`. Refuses a reserved or invalid code,
 * and a code another action already uses (naming it). Binding a code the action already holds in the
 * other slot swaps nothing and is refused as a conflict with itself, which keeps the rules uniform.
 */
export function bindKey(keys: Readonly<KeyBindings>, action: KeyAction, slot: number, code: string): BindResult {
  if (!isBindableCode(code)) return { ok: false, reason: RESERVED_CODES.includes(code) ? 'reserved' : 'invalid' };
  const holder = actionOf(keys, code);
  const already = keys[action][slot] === code;
  if (holder !== null && !already) return { ok: false, reason: 'conflict', with: holder };
  const next = cloneKeys(keys);
  const list = next[action];
  if (slot >= list.length) list.push(code);
  else list[slot] = code;
  return { ok: true, keys: next };
}

/** Remove the code in `slot` (the primary slot of an action can be cleared too: an unbound action). */
export function clearKey(keys: Readonly<KeyBindings>, action: KeyAction, slot: number): KeyBindings {
  const next = cloneKeys(keys);
  next[action].splice(slot, 1);
  return next;
}

/** Short text for a code: `KeyW` -> `W`, `ControlLeft` -> `Ctrl`, `ArrowUp` -> `↑`. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  const names: Record<string, string> = {
    ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', ShiftLeft: 'Shift', ShiftRight: 'R Shift', AltLeft: 'Alt', AltRight: 'R Alt',
    Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Backspace', Tab: 'Tab', CapsLock: 'Caps',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return names[code] ?? code;
}
