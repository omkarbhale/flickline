/**
 * The one-time in-world hints (design §13.4) and the "are you sure" window of `Backspace` mid-run
 * (design §2.3). Pure data. Each hint teaches one new idea the first time the situation happens and
 * never again (the ids already shown are stored in the profile, so they survive a reload and travel
 * with the save). No tutorial text, no countdown: a short line near the crosshair that fades by itself.
 */
export const HINT_IDS = ['stopToShoot', 'walkQuiet', 'pickDoor'] as const;
export type HintId = (typeof HINT_IDS)[number];

export interface HintsTunables {
  /** What each hint says. */
  text: Record<HintId, string>;
  /** How long a hint stays on screen, seconds (it fades in the last part of it). */
  showSec: number;
  /**
   * "Walk to stay quiet" waits for an Echo to see a player whose last running footstep (not walking,
   * not crouched: the loud ones) was at most this many seconds ago. Real hearing arrives with the
   * honest-audio work (#99); until then a sighting right after loud steps is the closest fact there is.
   */
  loudStepWindowSec: number;
  /** `Backspace` mid-run asks once: a second press within this many seconds discards the run. */
  discardWindowSec: number;
  /** What the ask says. */
  discardText: string;
}

export const hints: HintsTunables = {
  text: {
    stopToShoot: 'Stop to shoot',
    walkQuiet: 'Walk to stay quiet',
    pickDoor: 'Pick a door',
  },
  showSec: 3.2,
  loudStepWindowSec: 1.5,
  discardWindowSec: 2.5,
  discardText: 'Press Backspace again to discard this run',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { hints };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
