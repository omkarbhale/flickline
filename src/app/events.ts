import type { ProfileEvents } from '../settings/profile';
import type { FeedbackEvents } from '../feedback/events';
import type { ModeEvents } from '../modes/contracts';
import type { SettingsEvents } from '../settings/settings';
import type { SimEvents } from '../sim/types';

/** UI/app level events (not produced by the simulation). */
export interface AppEvents {
  /** Pointer lock gained/lost; the game is "live" only while locked. */
  pointerLockChanged: { locked: boolean };
  /**
   * Whether the last pointer lock request got raw (unadjusted) mouse input. `on: false` means the
   * browser lacks it and the OS pointer acceleration may apply.
   */
  rawInputChanged: { on: boolean };
  /**
   * The first-run player entered the game: start the Placement run (#23). `priorMean`/`priorSd`
   * are the skill prior from the self-report chips (#17). Nothing subscribes until those land.
   */
  placementRunRequested: { priorMean: number; priorSd: number };
}

/** Everything that flows over the single shared bus. Add new event maps here. */
export type GameEvents = SimEvents & FeedbackEvents & SettingsEvents & ProfileEvents & AppEvents & ModeEvents;
