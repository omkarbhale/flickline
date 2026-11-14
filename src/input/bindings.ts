import { DEFAULT_KEYS, KEY_ACTIONS, type KeyAction, type KeyBindings } from '../settings/keys';

/**
 * What the input manager listens for: the player's rebindable keys (`settings/keys.ts`, design
 * §13.3) plus the debug-overlay toggle, which is fixed. Codes are `KeyboardEvent.code`, so they do
 * not depend on the keyboard layout.
 */
export type Bindings = KeyBindings & { toggleDebug: readonly string[] };
export type BoundAction = KeyAction | 'toggleDebug';

export const DEBUG_KEYS: readonly string[] = ['Backquote'];

export const defaultBindings: Bindings = { ...DEFAULT_KEYS, toggleDebug: DEBUG_KEYS };

/** The code -> action lookup for `bindings`, written into `out` (cleared first). */
export function indexBindings(bindings: Readonly<Bindings>, out: Map<string, BoundAction>): void {
  out.clear();
  for (const action of KEY_ACTIONS) for (const code of bindings[action]) out.set(code, action);
  for (const code of bindings.toggleDebug) out.set(code, 'toggleDebug');
}

export function withKeys(keys: Readonly<KeyBindings>): Bindings {
  return { ...keys, toggleDebug: DEBUG_KEYS };
}
