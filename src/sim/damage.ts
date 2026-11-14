import type { DamageBand } from '../config/weapon';
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
