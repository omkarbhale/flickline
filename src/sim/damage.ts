import type { DamageBand } from '../config/weapon';
import type { EconomyTunables, Economy } from '../config/economy';
import type { PlayerTunables } from '../config/player';
import type { HitZone } from './types';

/**
 * Damage of one bullet by zone and distance (spec §3.2): hitscan picks the band that contains
 * the hit distance (stepwise falloff, no interpolation); beyond the last band the last band
 * applies. Floats are kept: only displays floor them.
 */
export function zoneDamage(bands: readonly DamageBand[], zone: HitZone, distance: number): number {
  let band = bands[bands.length - 1]!;
  for (let i = 0; i < bands.length; i++) {
    if (distance <= bands[i]!.upToM) {
      band = bands[i]!;
      break;
    }
  }
  return zone === 'head' ? band.head : zone === 'body' ? band.body : band.leg;
}

/**
 * The part of one hit of `damage` that a shield with `shield` points left absorbs (spec §4.1):
 * `min(absorb * damage, shield)`. The rest, `damage - absorbed`, goes to health. A shield that
 * cannot absorb its full share (it is nearly spent) hands the overflow to health in the same hit,
 * so the total damage to kill is always `health + shield` (floats, never rounded in the sim).
 */
export function shieldAbsorbed(damage: number, shield: number, absorb: number): number {
  if (!(damage > 0) || !(shield > 0)) return 0;
  return Math.min(absorb * damage, shield);
}

/** Shield capacity (damage points) the economy equips both sides with (0 = none). */
export function economyShield(economy: Economy, cfg: EconomyTunables, shield: PlayerTunables['shield']): number {
  const tier = cfg.levels[economy].tier;
  return tier === 'heavy' ? shield.heavy : tier === 'light' ? shield.light : 0;
}

/**
 * Bullets of one zone at one distance needed to take a target with `hp` health and `shield`
 * shield points to 0 (spec §6's convention: all bullets hit). Returns `Infinity` for a zone that
 * deals no damage.
 */
export function bulletsToKill(
  bands: readonly DamageBand[], zone: HitZone, distance: number, hp: number, shield: number, absorb: number,
): number {
  const dmg = zoneDamage(bands, zone, distance);
  if (!(dmg > 0)) return Infinity;
  let n = 0;
  while (hp > 0 && n < 1000) {
    const a = shieldAbsorbed(dmg, shield, absorb);
    shield -= a;
    hp -= dmg - a;
    n++;
  }
  return n;
}
