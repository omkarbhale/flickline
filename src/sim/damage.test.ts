import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import type { DamageBand } from '../config/weapon';
import { zoneDamage } from './damage';
import type { HitZone } from './types';

const tun = cloneTunables();
const kestrel = tun.weapon.damageBands; // spec §3.2 / §7.4 rifle_spray
const HP = tun.targets.maxHp;

/** Bullets of one zone at one range needed to take a full-health target to 0 (or below). */
function bulletsToKill(bands: readonly DamageBand[], zone: HitZone, distance: number): number {
  let hp = HP;
  let n = 0;
  while (hp > 0 && n < 100) {
    hp -= zoneDamage(bands, zone, distance);
    n++;
  }
  return n;
}

describe('health and damage (spec §3.2, §4.1)', () => {
  it('health.max is 100, no armour', () => {
    expect(HP).toBe(100);
  });

  it('Kestrel damage table matches spec §3.2', () => {
    expect(zoneDamage(kestrel, 'head', 10)).toBe(156);
    expect(zoneDamage(kestrel, 'body', 10)).toBe(39);
    expect(zoneDamage(kestrel, 'leg', 10)).toBe(33.15);
    expect(zoneDamage(kestrel, 'head', 30)).toBe(140);
    expect(zoneDamage(kestrel, 'body', 30)).toBe(35);
    expect(zoneDamage(kestrel, 'leg', 30)).toBe(29.75);
  });

  it('Kestrel: a headshot kills, three body bullets kill, four leg bullets kill', () => {
    for (const d of [1, 10, 20, 20.001, 35, 50]) {
      expect(bulletsToKill(kestrel, 'head', d)).toBe(1);
      expect(bulletsToKill(kestrel, 'body', d)).toBe(3);
      expect(bulletsToKill(kestrel, 'leg', d)).toBe(4); // 3 x 33.15 = 99.45 < 100
    }
  });

  it('falloff is stepwise: the band containing the distance applies (20 m belongs to band 1)', () => {
    expect(zoneDamage(kestrel, 'body', 20)).toBe(39);
    expect(zoneDamage(kestrel, 'body', 20.0001)).toBe(35);
    expect(zoneDamage(kestrel, 'body', 50)).toBe(35);
  });

  it('beyond the last band the last band is used', () => {
    expect(zoneDamage(kestrel, 'body', 200)).toBe(35);
    expect(zoneDamage(kestrel, 'head', 1000)).toBe(140);
  });

  it('works for other weapons as data (Pace / pistol_accurate: body takes four, head one)', () => {
    const pace: DamageBand[] = [
      { upToM: 30, head: 105, body: 30, leg: 25.5 },
      { upToM: 50, head: 87.5, body: 25, leg: 21.25 },
    ];
    expect(bulletsToKill(pace, 'head', 10)).toBe(1);
    expect(bulletsToKill(pace, 'body', 10)).toBe(4);
    expect(bulletsToKill(pace, 'head', 40)).toBe(2); // 87.5 does not kill alone beyond 30 m
    expect(bulletsToKill(pace, 'body', 40)).toBe(4);
  });
});
