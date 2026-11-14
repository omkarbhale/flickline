import type { Economy } from '../config/economy';

/**
 * Events about what the player carries into a fight: the sector's economy (design §4.6) and the
 * primary picked on the `ready` screen (design §4.1). Emitted by the mode host; presentation reads
 * them (the health bar, the sector banner, the save).
 */
export interface EconomyEvents {
  /**
   * An economy was applied to both sides (a Sweep sector's condition). `shield`/`maxShield` are the
   * player's shield points now and what his shield can hold in this economy; `holstered` is true when the
   * primary is away for the sector (eco).
   */
  economyApplied: { tick: number; economy: Economy; shield: number; maxShield: number; holstered: boolean };
  /** The player picked a primary on the `ready` screen (`weapon` is its id); the run starts at once. */
  primaryPicked: { tick: number; weapon: string };
}

declare module '../core/gameEvents' {
  interface GameEvents extends EconomyEvents {}
}
