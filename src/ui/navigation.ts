/**
 * Key rules of the menus and of a run (design section 2 "Instant restart", section 13.3 keys,
 * section 13.4 first-run). One table, pure, so the rules are tested instead of scattered over
 * handlers. The DOM layer (`menu.ts`) only describes the situation and performs the action.
 *
 *  - In a run: `Backspace` (the `restart` key) asks for a new run; the game decides whether to ask
 *    (`DiscardAsk`: a live run asks once). `Esc` is the browser's: it releases the pointer, and that
 *    opens the pause menu. `Enter` on the result card is the card's (`ui/resultsCard.ts`): it starts the
 *    next run on a new seed, and `R` replays the seed.
 *  - In the Lobby (pointer locked, no run): `Enter` starts a run; `Backspace` resets the Lobby.
 *  - Pause menu: `Esc`/`Enter` resume, `Backspace` starts a new run, `S` settings, `M` menu.
 *  - Main menu: `Enter` plays (a Sweep run on a new seed), `D` the Daily Route (design §4.8), `S` settings.
 *  - First-run panel: `Enter` plays unless a field or button has it.
 *  - Settings: `Esc` goes back. Nothing is a trap: every screen has a way back or on, one key away.
 */
export type Screen = 'firstRun' | 'main' | 'pause' | 'settings';

export type RunPhase = 'idle' | 'ready' | 'live' | 'result';

export type NavAction =
  | { type: 'play' }
  | { type: 'playDaily' }
  | { type: 'resume' }
  | { type: 'newRun' }
  | { type: 'openSettings' }
  | { type: 'back' }
  | { type: 'toMenu' };

export interface NavState {
  /** The menu is on screen (the pointer is released). */
  menuOpen: boolean;
  screen: Screen;
  runPhase: RunPhase;
  /** A text field, number field, select or slider has the focus: keys are typing there. */
  typing: boolean;
  /** A button has the focus: `Enter` and `Space` belong to it. */
  onButton: boolean;
}

const PLAY: NavAction = { type: 'play' };
const PLAY_DAILY: NavAction = { type: 'playDaily' };
const RESUME: NavAction = { type: 'resume' };
const NEW_RUN: NavAction = { type: 'newRun' };
const OPEN_SETTINGS: NavAction = { type: 'openSettings' };
const BACK: NavAction = { type: 'back' };
const TO_MENU: NavAction = { type: 'toMenu' };

/** The rebindable keys the menus honour (design §13.3: `restart` is Backspace and `confirm` Enter by default). */
export interface NavKeys {
  readonly restart: readonly string[];
  readonly confirm: readonly string[];
}

export const DEFAULT_NAV_KEYS: NavKeys = { restart: ['Backspace'], confirm: ['Enter'] };

/** What `code` (a `KeyboardEvent.code`) does in this situation, or null to leave it alone. */
export function resolveKey(code: string, st: NavState, keys: NavKeys = DEFAULT_NAV_KEYS): NavAction | null {
  const restart = keys.restart.includes(code);
  const confirm = keys.confirm.includes(code);
  if (!st.menuOpen) {
    // Pointer locked: in a run, or in the Lobby (no run), where Enter starts one.
    if (restart) return NEW_RUN;
    if (confirm && st.runPhase === 'idle') return PLAY;
    return null;
  }

  if (st.typing) {
    if (code === 'Escape') return st.screen === 'settings' ? BACK : null;
    return null;
  }

  switch (st.screen) {
    case 'firstRun':
      return confirm && !st.onButton ? PLAY : null;
    case 'settings':
      return code === 'Escape' ? BACK : null;
    case 'pause':
      if (code === 'Escape') return RESUME;
      if (confirm && !st.onButton) return RESUME;
      if (restart) return NEW_RUN;
      if (code === 'KeyS') return OPEN_SETTINGS;
      if (code === 'KeyM') return TO_MENU;
      return null;
    case 'main':
      if (confirm && !st.onButton) return PLAY;
      if (code === 'KeyD') return PLAY_DAILY;
      if (code === 'KeyS') return OPEN_SETTINGS;
      return null;
  }
}

/**
 * Arrow-key focus movement over `count` items laid out in rows of `columns`: Left/Right step by one
 * (wrapping at the ends), Up/Down by a row (stopping at the first and last row). Returns the new
 * index, or `index` unchanged for any other key. A single column is a vertical list.
 */
export function gridMove(index: number, key: string, columns: number, count: number): number {
  if (count <= 0) return -1;
  const cols = Math.max(1, Math.min(columns, count));
  const i = Math.min(Math.max(index, 0), count - 1);
  switch (key) {
    case 'ArrowLeft':
      return i === 0 ? count - 1 : i - 1;
    case 'ArrowRight':
      return i === count - 1 ? 0 : i + 1;
    case 'ArrowUp':
      return i - cols >= 0 ? i - cols : i;
    case 'ArrowDown':
      return i + cols < count ? i + cols : i;
    default:
      return index;
  }
}

/**
 * `Backspace` mid-run asks once before it discards a run (design §2.3: a run is worth minutes). The
 * first press of a *live* run only asks; a second press within `windowSec` confirms. Anything else
 * (a run that has not gone live yet, a finished run, the Lobby) goes straight through: nothing is lost.
 * Pure: the caller passes the clock (seconds), so it is tested without one.
 */
export class DiscardAsk {
  private askedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowSec: number) {}

  /** A new-run key press while the run is in `phase`: `go` = do it now, `ask` = show the prompt and wait. */
  press(phase: RunPhase, nowSec: number): 'go' | 'ask' {
    if (phase !== 'live') {
      this.askedAt = Number.NEGATIVE_INFINITY;
      return 'go';
    }
    if (nowSec - this.askedAt <= this.windowSec) {
      this.askedAt = Number.NEGATIVE_INFINITY;
      return 'go';
    }
    this.askedAt = nowSec;
    return 'ask';
  }

  /** Forget a pending ask (the run changed or ended). */
  clear(): void {
    this.askedAt = Number.NEGATIVE_INFINITY;
  }
}
