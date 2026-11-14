import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { bulletsToKill } from '../sim/damage';
import { armourNote } from './armourNote';

const tun = cloneTunables();
const { absorb } = tun.player.shield;
const hp = tun.player.health.max;

describe('armourNote (fix-engine line for armoured kills)', () => {
  it('says what the issue asks for: a Pace needing two headshots on an armoured target', () => {
    expect(armourNote('Pace', 'head', 2, 1)).toBe('Your Pace needed two headshots on an armoured target (one kills an unarmoured one).');
  });

  it('works from the real numbers: Pace head 10 m, heavy shield vs none', () => {
    const bands = tun.weapon.pace.damageBands;
    const armoured = bulletsToKill(bands, 'head', 10, hp, tun.player.shield.heavy, absorb);
    const bare = bulletsToKill(bands, 'head', 10, hp, 0, absorb);
    expect(armourNote('Pace', 'head', armoured, bare)).toContain('two headshots');
  });

  it('a Kestrel body kill: four instead of three', () => {
    const bands = tun.weapon.kestrel.damageBands;
    const n = bulletsToKill(bands, 'body', 10, hp, 50, absorb);
    expect(armourNote('Kestrel', 'body', n, bulletsToKill(bands, 'body', 10, hp, 0, absorb)))
      .toBe('Your Kestrel needed four body shots on an armoured target (three kill an unarmoured one).');
  });

  it('is silent when the shield changed nothing (Kestrel head at short range, any shield tier)', () => {
    const bands = tun.weapon.kestrel.damageBands;
    expect(armourNote('Kestrel', 'head', bulletsToKill(bands, 'head', 10, hp, 50, absorb), 1)).toBeNull();
  });
});
