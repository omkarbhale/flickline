import type { HitZone } from '../sim/types';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const word = (n: number): string => WORDS[n] ?? String(n);

const NOUN: Record<HitZone, [string, string]> = {
  head: ['headshot', 'headshots'],
  body: ['body shot', 'body shots'],
  leg: ['leg shot', 'leg shots'],
};

/**
 * The results / fix-engine line for a kill on a shielded target (spec §4.1, §6): the bullet count
 * differs from what the player's habits expect (a one-tap, a three-tap body kill). Returns `null`
 * when the shield made no difference to the count, so there is nothing to explain.
 *
 *   armourNote('Pace', 'head', 2, 1)  -> "Your Pace needed two headshots on an armoured target (one kills an unarmoured one)."
 *
 * `bullets` is what the kill took; `unarmouredBullets` what the same zone at the same range takes
 * with no shield (`bulletsToKill` in `sim/damage.ts`, shield 0). Pure; the caller supplies the
 * display name of the weapon.
 */
export function armourNote(weaponName: string, zone: HitZone, bullets: number, unarmouredBullets: number): string | null {
  if (!(bullets > unarmouredBullets) || unarmouredBullets < 1) return null;
  const [one, many] = NOUN[zone];
  return `Your ${weaponName} needed ${word(bullets)} ${bullets === 1 ? one : many} on an armoured target `
    + `(${word(unarmouredBullets)} ${unarmouredBullets === 1 ? 'kills' : 'kill'} an unarmoured one).`;
}
