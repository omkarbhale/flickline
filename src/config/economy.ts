/**
 * Economy: how well equipped both sides of an enemy-fire fight are (design §5.1, vision review 1).
 * In the reference game rifles and full shields are bought together, so duels are mostly fought
 * with armour on; training only unarmoured bullet counts would teach the wrong thresholds (a
 * three-tap body kill, a one-tap Pace headshot). An economy picks the shield tier of the player
 * and of every Echo and the weapon the Echoes carry. The scenario card (#97) carries one of these;
 * a mode that fires back declares a default. A mode without one has nothing that shoots the player.
 */
import type { WeaponId } from './weapon';

/** `full` = rifles and heavy shields, `light` = light shields, `eco` = no shield. */
export type Economy = 'full' | 'light' | 'eco';
export const ECONOMIES: readonly Economy[] = ['full', 'light', 'eco'];

/** Which published armour tier (`player.shield`) an economy equips. */
export type ShieldTier = 'heavy' | 'light' | 'none';

export interface EconomyDef {
  tier: ShieldTier;
  /** The weapon the Echoes fire in this economy (#32/#98 read it). */
  enemyWeapon: WeaponId;
}

export interface EconomyTunables {
  levels: Record<Economy, EconomyDef>;
  /** The economy of a mode that fires back and whose card does not set one (design §5.1: Sweep). */
  defaultEnemyFire: Economy;
}

export const economy: EconomyTunables = {
  levels: {
    full: { tier: 'heavy', enemyWeapon: 'kestrel' },
    // The SMG (Rill, #30) is the light-buy weapon in the reference game; until it exists the Kestrel stands in.
    light: { tier: 'light', enemyWeapon: 'kestrel' },
    eco: { tier: 'none', enemyWeapon: 'pace' },
  },
  defaultEnemyFire: 'full',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { economy };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
