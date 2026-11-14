import type { ModeEvents } from '../modes/contracts';
import type { SettingsEvents } from '../settings/settings';
import type { SimEvents } from '../sim/types';

/** UI/app level events (not produced by the simulation). */
export interface AppEvents {
  /** Pointer lock gained/lost; the game is "live" only while locked. */
  pointerLockChanged: { locked: boolean };
}

/** Everything that flows over the single shared bus. Add new event maps here. */
export type GameEvents = SimEvents & SettingsEvents & AppEvents & ModeEvents;
