/**
 * Key rules of the menus and of a run (design section 2 "Instant restart", section 13.3 keys,
 * section 13.4 first-run). One table, pure, so the rules are tested instead of scattered over
 * handlers. The DOM layer (`menu.ts`) only describes the situation and performs the action.
 *
 *  - In a run: `Backspace` restarts it from anywhere (ready, live, result). `Esc` is the browser's: it
 *    releases the pointer, and that opens the pause menu. `Enter` on the result card is the card's
 *    (`ui/resultsCard.ts`): it starts the next run through `Game.playAgain`.
 *  - Pause menu: `Esc`/`Enter` resume, `Backspace` restarts, `S` settings, `M` menu, `K` skips the session step.
 *  - Main menu: `Enter` plays today's session, `1`-`9` start that card, `S` settings, `K` skips.
 *  - Settings: `Esc` goes back. Nothing is a trap: every screen has a way back or on, one key away.
 */
export type Screen = 'firstRun' | 'main' | 'pause' | 'settings';

export type RunPhase = 'idle' | 'ready' | 'live' | 'result';

export type NavAction =
  | { type: 'playSession' }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'openSettings' }
  | { type: 'back' }
  | { type: 'toMenu' }
  | { type: 'skipStep' }
  | { type: 'launchCard'; index: number };

export interface NavState {
  /** The menu is on screen (the pointer is released). */
  menuOpen: boolean;
  screen: Screen;
  runPhase: RunPhase;
  /** A text field, number field, select or slider has the focus: keys are typing there. */
  typing: boolean;
  /** A button has the focus: `Enter` and `Space` belong to it. */
  onButton: boolean;
  /** Today's session has a step to skip. */
  sessionActive: boolean;
}

const PLAY_SESSION: NavAction = { type: 'playSession' };
const RESUME: NavAction = { type: 'resume' };
const RESTART: NavAction = { type: 'restart' };
const OPEN_SETTINGS: NavAction = { type: 'openSettings' };
const BACK: NavAction = { type: 'back' };
const TO_MENU: NavAction = { type: 'toMenu' };
const SKIP_STEP: NavAction = { type: 'skipStep' };

const DIGIT = /^Digit([1-9])$/;

/** What `code` (a `KeyboardEvent.code`) does in this situation, or null to leave it alone. */
export function resolveKey(code: string, st: NavState): NavAction | null {
  if (!st.menuOpen) {
    // In a run (pointer locked).
    if (code === 'Backspace') return RESTART; // also in free play: a reset from the seed
    return null;
  }

  if (st.typing) {
    if (code === 'Escape') return st.screen === 'settings' ? BACK : null;
    return null;
  }

  switch (st.screen) {
    case 'firstRun':
      return null;
    case 'settings':
      return code === 'Escape' ? BACK : null;
    case 'pause':
      if (code === 'Escape') return RESUME;
      if (code === 'Enter' && !st.onButton) return RESUME;
      if (code === 'Backspace') return RESTART;
      if (code === 'KeyS') return OPEN_SETTINGS;
      if (code === 'KeyM') return TO_MENU;
      if (code === 'KeyK' && st.sessionActive) return SKIP_STEP;
      return null;
    case 'main': {
      if (code === 'Enter' && !st.onButton) return PLAY_SESSION;
      if (code === 'KeyS') return OPEN_SETTINGS;
      if (code === 'KeyK' && st.sessionActive) return SKIP_STEP;
      const m = DIGIT.exec(code);
      if (m) return { type: 'launchCard', index: Number(m[1]) - 1 };
      return null;
    }
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
