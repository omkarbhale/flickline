/**
 * Tunables for honest information (`docs/research/engagement-information.md` §4.2, #99) and the
 * fight-attribution facts built on it (`docs/research/fight-attribution.md` §3.2, #119): the one
 * table of sound radii, what a map may change in it, and where on the player the enemy's sight
 * samples sit.
 */

/** The enemy sounds the player can hear (positional information, design §12). */
export type EnemySoundKind = 'footstep' | 'landing' | 'reload' | 'shot';
export const SOUND_KINDS: readonly EnemySoundKind[] = ['footstep', 'landing', 'reload', 'shot'];

export interface AttributionTunables {
  /**
   * How far each sound carries, metres (horizontal distance): **the one table** both directions
   * read (engagement-information §4.2, rule F1). The player hears an enemy's step, landing, reload
   * or shot exactly as far as the enemy hears the player's: the audio, the attribution facts
   * (`audibleToPlayer`) and the enemy's hearing (`sim/perception.ts`) all take their radius from the
   * level's copy of this table (`sim/hearing.ts`: this table with the map's own `hearing` radii laid
   * over it), and nothing else carries a radius of its own (`hearing.test.ts`). Running steps,
   * landings, reloads and shots carry; walking and crouch-walking are silent
   * (`audio.enemy.silentBelowMps`). HYPOTHESIS: reload and landing carry less than a shot.
   */
  soundRadiusM: Readonly<Record<EnemySoundKind, number>>;
  /**
   * The warning a runner gives (engagement-information §4.2: "roughly 1-2 s of warning at run
   * speed", HYPOTHESIS 40%): the map-lint report measures, along each approach lane, the seconds
   * between an Echo's running steps first reaching the player at the sector's entry and its first
   * line of sight to him, at `runSpeedMps`, and warns outside `minSec`..`maxSec`. The radii are chosen
   * per map (`MapDef.hearing`) to put the main approach inside it.
   */
  warning: { minSec: number; maxSec: number; runSpeedMps: number };
  /**
   * Where an enemy samples the player to see him, as fractions of the player's hull height above
   * the feet, besides the eye itself (design: line of sight to the head or upper body,
   * player-like-enemies §5.3). The stand-in perception (`createSightPerception`) uses it.
   */
  upperBodyFrac: number;
}

export const attribution: AttributionTunables = {
  soundRadiusM: { footstep: 30, landing: 30, reload: 20, shot: 80 },
  warning: { minSec: 1, maxSec: 2, runSpeedMps: 5.4 },
  upperBodyFrac: 0.65,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { attribution };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
