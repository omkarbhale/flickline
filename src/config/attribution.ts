/**
 * Tunables for the fight-attribution facts (`docs/research/fight-attribution.md` §3.2, #119): the
 * sound radii that decide whether the player could hear an enemy, and where on the player the
 * enemy's sight samples sit.
 */

/** The enemy sounds the player can hear (positional information, design §12). */
export type EnemySoundKind = 'footstep' | 'landing' | 'reload' | 'shot';

export interface AttributionTunables {
  /**
   * How far each enemy sound carries, metres (horizontal distance). **Stub table**: #99 defines the
   * real, symmetric radii (the player hears an enemy exactly as far as the enemy hears the player)
   * and replaces these values; the footstep radius is today's audio cull (`audio.enemy.maxAudibleM`,
   * asserted equal in `attribution.test.ts`). HYPOTHESIS: reload and landing carry less than a shot.
   */
  soundRadiusM: Readonly<Record<EnemySoundKind, number>>;
  /**
   * Where an enemy samples the player to see him, as fractions of the player's hull height above
   * the feet, besides the eye itself (design: line of sight to the head or upper body,
   * player-like-enemies §5.3). The stand-in perception (`createSightPerception`) uses it.
   */
  upperBodyFrac: number;
}

export const attribution: AttributionTunables = {
  soundRadiusM: { footstep: 30, landing: 30, reload: 20, shot: 80 },
  upperBodyFrac: 0.65,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { attribution };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
