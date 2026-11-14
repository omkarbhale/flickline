import type { FeedbackEvents } from '../feedback/events';
import type { SettingsEvents } from '../settings/settings';
import type { RunEvents } from '../sim/runEvents';
import type { SimEvents } from '../sim/types';

/** UI/app level events (not produced by the simulation). */
export interface AppEvents {
  /** Pointer lock gained/lost; the game is "live" only while locked. */
  pointerLockChanged: { locked: boolean };
}

/** Everything that flows over the single shared bus. Add new event maps here. */
export type GameEvents = SimEvents & RunEvents & FeedbackEvents & SettingsEvents & AppEvents;
