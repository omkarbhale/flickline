import { describe, expect, it } from 'vitest';
import type { DamageBand } from '../config/weapon';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import { bulletsToKill, economyShield, shieldAbsorbed, zoneDamage } from './damage';
import { createTickInput, type HitZone, type LevelDef, type SimEvents } from './types';
import { World } from './world';

const tun = cloneTunables();
const ABSORB = tun.player.shield.absorb;
const HP = tun.player.health.max;
const SHIELDS = [0, tun.player.shield.light, tun.player.shield.heavy] as const;

const arena: LevelDef = {
  name: 'arena',
  boxes: [{ tag: 'floor', min: vec3(-40, -1, -40), max: vec3(40, 0, 40) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

function makeWorld() {
  const world = new World({ level: arena, tunables: cloneTunables(), seed: 1 });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; data: Record<string, unknown> }[] = [];
  for (const type of [
    'targetHit', 'targetKilled', 'shotImpact', 'playerDamaged', 'playerHealed', 'playerDied',
  ] as const) bus.on(type, (e) => log.push({ type, data: JSON.parse(JSON.stringify(e)) }));
  const of = (type: keyof SimEvents): Record<string, unknown>[] => log.filter((l) => l.type === type).map((l) => l.data);
  return { world, bus, log, of };
}

/** Aim at a live Post's head centre and hold fire until a shot lands (or give up after `maxSec`). */
function shootHead(world: World, bus: EventBus<SimEvents>, id: number, maxSec = 1.5): void {
  const t = world.targets.find((x) => x.id === id)!;
  const p = world.player;
  const dy = tun.targets.hit.headCentreStand - (p.pos.y + p.eyeHeight);
  const input = createTickInput();
  input.yaw = Math.atan2(-(t.pos.x - p.pos.x), -(t.pos.z - p.pos.z));
  input.pitch = Math.atan2(dy, Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z));
  input.fire = true;
  const shots = world.weapon.shots;
  for (let i = 0; i < Math.ceil(maxSec / TICK_DT) && world.weapon.shots === shots; i++) world.step(input, bus);
}

// ---- the spec's §7.4 damage bands (archetypes the game does not have a weapon for yet) ----------
const bands = (...b: [number, number, number, number][]): DamageBand[] => b.map(([upToM, head, body, leg]) => ({ upToM, head, body, leg }));
const PRECISE = bands([50, 160, 40, 34]);
const SPRAY = bands([20, 156, 39, 33.15], [50, 140, 35, 29.75]);
const SMG = bands([15, 78, 26, 22.1], [30, 66, 22, 18.7], [50, 60, 20, 17]);
const LIGHT = bands([30, 78, 26, 22.1], [50, 66, 22, 18.7]);
const ACCURATE = bands([30, 105, 30, 25.5], [50, 87.5, 25, 21.25]);
const HEAVY = bands([30, 159.5, 55, 46.75], [50, 145, 50, 42.5]);
const SNIPER = bands([50, 255, 150, 120]);

/**
 * Spec §6, every cell: bullets to kill at shield 0 / 25 / 50. `d` = [from, to] metres of the
 * table row; the test shoots at the row's start, middle and end (the end is inclusive: stepwise
 * falloff puts exactly 20 m in the first band).
 */
const TTK_TABLE: { id: string; bands: DamageBand[]; d: [number, number]; zone: HitZone; bullets: [number, number, number] }[] = [
  ...(['head', 'body', 'leg'] as const).flatMap((zone, i) => [
    { id: 'rifle_precise', bands: PRECISE, d: [0, 50] as [number, number], zone, bullets: ([[1, 1, 1], [3, 4, 4], [3, 4, 5]] as const)[i]! as [number, number, number] },
    { id: 'rifle_spray', bands: SPRAY, d: [0, 20] as [number, number], zone, bullets: ([[1, 1, 1], [3, 4, 4], [4, 4, 5]] as const)[i]! as [number, number, number] },
    { id: 'rifle_spray', bands: SPRAY, d: [20, 50] as [number, number], zone, bullets: ([[1, 1, 2], [3, 4, 5], [4, 5, 6]] as const)[i]! as [number, number, number] },
    { id: 'smg', bands: SMG, d: [0, 15] as [number, number], zone, bullets: ([[2, 2, 2], [4, 5, 6], [5, 6, 7]] as const)[i]! as [number, number, number] },
    { id: 'smg', bands: SMG, d: [15, 30] as [number, number], zone, bullets: ([[2, 2, 3], [5, 6, 7], [6, 7, 9]] as const)[i]! as [number, number, number] },
    { id: 'smg', bands: SMG, d: [30, 50] as [number, number], zone, bullets: ([[2, 3, 3], [5, 7, 8], [6, 8, 9]] as const)[i]! as [number, number, number] },
    { id: 'pistol_heavy', bands: HEAVY, d: [0, 30] as [number, number], zone, bullets: ([[1, 1, 1], [2, 3, 3], [3, 3, 4]] as const)[i]! as [number, number, number] },
    { id: 'pistol_heavy', bands: HEAVY, d: [30, 50] as [number, number], zone, bullets: ([[1, 1, 2], [2, 3, 3], [3, 3, 4]] as const)[i]! as [number, number, number] },
    { id: 'pistol_light', bands: LIGHT, d: [0, 30] as [number, number], zone, bullets: ([[2, 2, 2], [4, 5, 6], [5, 6, 7]] as const)[i]! as [number, number, number] },
    { id: 'pistol_light', bands: LIGHT, d: [30, 50] as [number, number], zone, bullets: ([[2, 2, 3], [5, 6, 7], [6, 7, 9]] as const)[i]! as [number, number, number] },
    { id: 'pistol_accurate', bands: ACCURATE, d: [0, 30] as [number, number], zone, bullets: ([[1, 2, 2], [4, 5, 5], [4, 5, 6]] as const)[i]! as [number, number, number] },
    { id: 'pistol_accurate', bands: ACCURATE, d: [30, 50] as [number, number], zone, bullets: ([[2, 2, 2], [4, 5, 6], [5, 6, 8]] as const)[i]! as [number, number, number] },
    { id: 'sniper', bands: SNIPER, d: [0, 50] as [number, number], zone, bullets: ([[1, 1, 1], [1, 1, 1], [1, 2, 2]] as const)[i]! as [number, number, number] },
  ]),
];

/** The distances a §6 row is checked at: just inside its start, the middle, its (inclusive) end. */
function rowDistances([from, to]: [number, number]): number[] {
  return [from + 0.25, (from + to) / 2, to];
}

/** The Echo path: bullets fired at a fresh shielded Post (through `TargetField.applyHit`) until it dies. */
function bulletsToKillEcho(b: readonly DamageBand[], zone: HitZone, distance: number, shield: number): number {
  const { world, bus } = makeWorld();
  const id = world.spawnTarget('post', 0, 0, -10, bus, { shield });
  const slot = world.targets.findIndex((t) => t.alive && t.id === id);
  const point = vec3(0, 1, -10);
  let n = 0;
  while (world.targets[slot]!.alive && world.targets[slot]!.id === id && n < 50) {
    world.targetField.applyHit(slot, zone, point, distance, zoneDamage(b, zone, distance), world.tick, bus);
    n++;
  }
  return n;
}

/** The player path: bullets taken by a player equipped with `shield` until dead. */
function bulletsToKillPlayer(b: readonly DamageBand[], zone: HitZone, distance: number, shield: number): number {
  const { world, bus } = makeWorld();
  world.setShields(shield, 0);
  let n = 0;
  while (world.health.alive && n < 50) {
    world.damagePlayer(zoneDamage(b, zone, distance), zone, 0, 1.6, -distance, 1, bus);
    n++;
  }
  return n;
}

describe('shield absorption rule (spec §4.1)', () => {
  it('absorbs 66% of a hit, capped by what the shield has left; the rest goes to health', () => {
    expect(shieldAbsorbed(30, 50, ABSORB)).toBeCloseTo(19.8, 9);
    expect(shieldAbsorbed(30, 10, ABSORB)).toBe(10); // nearly spent: it gives all it has, the overflow hits health
    expect(shieldAbsorbed(30, 0, ABSORB)).toBe(0);
    expect(shieldAbsorbed(0, 50, ABSORB)).toBe(0);
    expect(shieldAbsorbed(-5, 50, ABSORB)).toBe(0);
  });

  it('the spec numbers: 66%, light 25, heavy 50, health 100', () => {
    expect(tun.player.shield).toEqual({ absorb: 0.66, light: 25, heavy: 50 });
    expect(HP).toBe(100);
  });

  it('total damage to kill is always health + shield (125 light, 150 heavy), with floats', () => {
    for (const shield of SHIELDS) {
      let hp = HP, sh = shield, dealt = 0;
      while (hp > 0) {
        const a = shieldAbsorbed(39, sh, ABSORB);
        sh -= a;
        hp -= 39 - a;
        dealt += 39;
      }
      // The last bullet may overshoot, but never by a whole bullet: the 4th Kestrel body bullet kills at 25, the 4th and 5th at 50.
      expect(dealt - 39).toBeLessThan(HP + shield);
      expect(dealt).toBeGreaterThanOrEqual(HP + shield);
    }
  });

  it('economy maps to the published tiers: full 50, light 25, eco none', () => {
    const { economy } = tun;
    expect(economyShield('full', economy, tun.player.shield)).toBe(50);
    expect(economyShield('light', economy, tun.player.shield)).toBe(25);
    expect(economyShield('eco', economy, tun.player.shield)).toBe(0);
    expect(economy.defaultEnemyFire).toBe('full');
  });
});

describe('spec §6 conformance: bullets to kill at shield 0 / 25 / 50', () => {
  it('the table is complete (13 rows x 3 zones)', () => {
    expect(TTK_TABLE.length).toBe(13 * 3);
  });

  for (const row of TTK_TABLE) {
    it(`${row.id} ${row.d[0]}-${row.d[1]} m ${row.zone}: ${row.bullets.join(' / ')}`, () => {
      for (const distance of rowDistances(row.d)) {
        SHIELDS.forEach((shield, k) => {
          const want = row.bullets[k]!;
          expect(bulletsToKill(row.bands, row.zone, distance, HP, shield, ABSORB), `pure, shield ${shield}, ${distance} m`).toBe(want);
          expect(bulletsToKillEcho(row.bands, row.zone, distance, shield), `echo, shield ${shield}, ${distance} m`).toBe(want);
          expect(bulletsToKillPlayer(row.bands, row.zone, distance, shield), `player, shield ${shield}, ${distance} m`).toBe(want);
        });
      }
    });
  }

  it("the game's own weapons carry the spec's bands (Kestrel = rifle_spray, Pace = pistol_accurate)", () => {
    expect(tun.weapon.kestrel.damageBands).toEqual(SPRAY);
    expect(tun.weapon.pace.damageBands).toEqual(ACCURATE);
  });

  it('TTK of the Kestrel and the Pace follows from the fire rate: (bullets - 1) / rate', () => {
    const k = tun.weapon.kestrel;
    const kBody = bulletsToKill(k.damageBands, 'body', 10, HP, 50, ABSORB);
    expect((kBody - 1) / k.fireRateHz).toBeCloseTo(0.273, 3); // spec §6: 4 (0.273)
    const p = tun.weapon.pace;
    const pHead = bulletsToKill(p.damageBands, 'head', 10, HP, 50, ABSORB);
    expect((pHead - 1) / p.fireRateHz).toBeCloseTo(0.148, 3); // spec §6: 2 (0.148)
  });

  it('the issue headline cases: Pace head 1 -> 2, Kestrel long head 1 -> 2, Kestrel body 3 -> 4', () => {
    const p = tun.weapon.pace.damageBands, k = tun.weapon.kestrel.damageBands;
    expect(bulletsToKill(p, 'head', 10, HP, 0, ABSORB)).toBe(1);
    expect(bulletsToKill(p, 'head', 10, HP, 50, ABSORB)).toBe(2);
    expect(bulletsToKill(k, 'head', 35, HP, 0, ABSORB)).toBe(1);
    expect(bulletsToKill(k, 'head', 35, HP, 50, ABSORB)).toBe(2);
    expect(bulletsToKill(k, 'body', 10, HP, 0, ABSORB)).toBe(3);
    expect(bulletsToKill(k, 'body', 10, HP, 50, ABSORB)).toBe(4);
  });
});

describe('the player\'s shield', () => {
  it('a shielded hit splits into shield and health, and the event says so', () => {
    const { world, bus, of } = makeWorld();
    world.setShields(50, 0);
    expect(world.health).toMatchObject({ shield: 50, maxShield: 50, hp: 100 });
    world.hitPlayer('kestrel', 'body', 0, 1.6, -10, 7, bus); // 39 damage
    expect(world.health.shield).toBeCloseTo(50 - 0.66 * 39, 9);
    expect(world.health.hp).toBeCloseTo(100 - 0.34 * 39, 9);
    expect(world.health.shieldAbsorbed).toBeCloseTo(0.66 * 39, 9);
    expect(world.health.damageTaken).toBeCloseTo(0.34 * 39, 9);
    const ev = of('playerDamaged')[0]!;
    expect(ev['amount']).toBeCloseTo(0.34 * 39, 9); // HP lost, as before
    expect(ev['absorbed']).toBeCloseTo(0.66 * 39, 9);
    expect(ev['shield']).toBeCloseTo(50 - 0.66 * 39, 9);
    expect(ev['maxShield']).toBe(50);
  });

  it('the hit that breaks the shield passes the overflow to health (no lost damage)', () => {
    const { world, bus } = makeWorld();
    world.setShields(25, 0);
    world.damagePlayer(39, 'body', 0, 1.6, -10, 1, bus); // absorbs 25.74 -> capped at 25
    expect(world.health.shield).toBeCloseTo(25 - 25, 9);
    expect(world.health.hp).toBeCloseTo(100 - (39 - 25), 9);
    world.damagePlayer(39, 'body', 0, 1.6, -10, 1, bus); // shield gone: full damage to health
    expect(world.health.shield).toBe(0);
    expect(world.health.hp).toBeCloseTo(100 - 14 - 39, 9);
  });

  it('a player with no shield is exactly the unarmoured player (nothing changes for drills)', () => {
    const { world, bus, of } = makeWorld();
    world.hitPlayer('kestrel', 'body', 0, 1.6, -10, 7, bus);
    expect(world.health.hp).toBeCloseTo(61, 9);
    expect(world.health.maxShield).toBe(0);
    expect(of('playerDamaged')[0]).toMatchObject({ absorbed: 0, shield: 0, maxShield: 0 });
  });

  it('survives reset() until changed, and a new life starts with a full shield', () => {
    const { world, bus } = makeWorld();
    world.setShields(50, 0);
    world.damagePlayer(39, 'body', 0, 1.6, -10, 1, bus);
    world.reset();
    expect(world.health).toMatchObject({ shield: 50, maxShield: 50, hp: 100, shieldAbsorbed: 0 });
    world.setShields(0, 0);
    expect(world.health).toMatchObject({ shield: 0, maxShield: 0 });
    world.reset();
    expect(world.health.maxShield).toBe(0);
  });

  it('kill-heal restores health, never shield (#31)', () => {
    const { world, bus, of } = makeWorld();
    world.setShields(50, 0);
    world.damagePlayer(39, 'body', 0, 1.6, -10, 1, bus);
    const shield = world.health.shield, hp = world.health.hp;
    const id = world.spawnTarget('post', 0, 0, -10, bus); // unshielded: one Kestrel headshot (156) kills it
    shootHead(world, bus, id);
    expect(of('targetKilled').length).toBe(1);
    expect(of('playerHealed')[0]).toMatchObject({ source: 'kill', amount: 10 });
    expect(world.health.hp).toBeCloseTo(hp + 10, 9);
    expect(world.health.shield).toBe(shield); // the shield stays as the hit left it
  });

  it('dies at 100 + shield worth of damage, not before', () => {
    const { world, bus, of } = makeWorld();
    world.setShields(50, 0);
    let n = 0;
    while (world.health.alive) { world.hitPlayer('kestrel', 'body', 0, 1.6, -10, 1, bus); n++; }
    expect(n).toBe(4);
    expect(of('playerDied').length).toBe(1);
  });

  it('is part of the determinism hash', () => {
    const a = makeWorld().world, b = makeWorld().world;
    expect(a.hash()).toBe(b.hash());
    a.setShields(50, 0);
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe("Echoes' shields", () => {
  it('humanoids spawn with the enemy shield; orbs never carry one; an explicit shield overrides the default', () => {
    const { world, bus } = makeWorld();
    world.setShields(0, 50);
    const spawn = (kind: 'post' | 'beacon', x: number, y: number, z: number, opts?: { shield?: number }) => {
      const id = world.spawnTarget(kind, x, y, z, bus, opts);
      return world.targets.find((t) => t.id === id)!;
    };
    const post = spawn('post', 0, 0, -10);
    expect(post).toMatchObject({ shield: 50, maxShield: 50, hp: 100 });
    const beacon = spawn('beacon', 0, 1.6, -12);
    expect(beacon).toMatchObject({ shield: 0, maxShield: 0 });
    const light = spawn('post', 3, 0, -10, { shield: 25 });
    expect(light.maxShield).toBe(25);
    world.setShields(0, 0);
    const bare = spawn('post', -3, 0, -10);
    expect(bare.maxShield).toBe(0);
  });

  it('a bullet reports what the shield took, and a kill reports the shield the Echo spawned with', () => {
    const { world, bus, of } = makeWorld();
    world.setShields(0, 50);
    const id = world.spawnTarget('post', 0, 0, -10, bus);
    const slot = world.targets.findIndex((t) => t.id === id);
    world.targetField.applyHit(slot, 'body', vec3(0, 1, -10), 10, 39, 1, bus);
    expect(of('targetHit')[0]).toMatchObject({ damage: 39, killed: false });
    expect(of('targetHit')[0]!['absorbed']).toBeCloseTo(0.66 * 39, 9);
    expect(of('targetHit')[0]!['shieldLeft']).toBeCloseTo(50 - 0.66 * 39, 9);
    expect(of('targetHit')[0]!['hpLeft']).toBeCloseTo(100 - 0.34 * 39, 9);
    for (let i = 0; i < 3; i++) world.targetField.applyHit(slot, 'body', vec3(0, 1, -10), 10, 39, 1, bus);
    const k = of('targetKilled');
    expect(k.length).toBe(1);
    expect(k[0]).toMatchObject({ shield: 50 });
  });

  it('level-placed and respawned Echoes get the shield too', () => {
    const level: LevelDef = { ...arena, targets: [{ pos: vec3(0, 0, -10), kind: 'post' }] };
    const world = new World({ level, tunables: cloneTunables(), seed: 1 });
    expect(world.targets.find((t) => t.alive)!.maxShield).toBe(0);
    world.setShields(0, 50);
    world.reset(); // level targets are re-placed by a reset
    expect(world.targets.find((t) => t.alive)!.maxShield).toBe(50);
  });

  it('shotImpact.killed accounts for the shield (Pace headshot on an armoured Post does not kill)', () => {
    const { world, bus, of } = makeWorld();
    world.setShields(0, 50);
    world.equipWeapon('pace');
    const id = world.spawnTarget('post', 0, 0, -10, bus);
    shootHead(world, bus, id);
    const hit = of('shotImpact').find((e) => e['result'] === 'hit');
    expect(hit, 'a shot should land').toBeTruthy();
    expect(hit!['zone']).toBe('head');
    expect(hit!['killed']).toBe(false); // 105 damage: the shield takes 50, health 55
    expect(world.targets.find((x) => x.id === id)!.hp).toBeCloseTo(100 - (105 - 50), 9);
  });
});
