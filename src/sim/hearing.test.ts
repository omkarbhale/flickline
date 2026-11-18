import { describe, expect, it } from 'vitest';
import { SOUND_KINDS, type EnemySoundKind } from '../config/attribution';
import type { WeaponId } from '../config/weapon';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import { Rng } from '../core/rng';
import { createMindProfile, profileFor } from './mind/profile';
import { PerceptionSystem } from './perception';
import { applySoundRadii, createSoundRadii, isAudible } from './hearing';
import { createTickInput, type LevelDef, type SimEvents } from './types';
import { World } from './world';

const floor = { tag: 'floor' as const, min: vec3(-300, -1, -300), max: vec3(300, 0, 300) };
const level = (hearing?: LevelDef['hearing']): LevelDef => ({ name: 'hearing', boxes: [floor], spawn: { pos: vec3(0, 0, 0), yaw: 0 }, targets: [], ...(hearing ? { hearing } : {}) });

/** Whether an enemy `d` metres from the player hears a sound of `kind` the player makes, in a world with this level. */
function enemyHears(kind: EnemySoundKind, d: number, mapHearing?: LevelDef['hearing'], mindSkill = 50): boolean {
  const tun = cloneTunables();
  const world = new World({ level: level(mapHearing), tunables: tun, seed: 3 });
  const bus = new EventBus<SimEvents>();
  const sys = new PerceptionSystem(tun, world.level.boxes, world.player, bus, 3);
  sys.setRadii(world.soundRadii);
  world.placePlayer(0, 0, 0, 0);
  const p = sys.add(1, new Rng(7), profileFor(mindSkill, new Rng(9), createMindProfile(), tun))!;
  p.eye.x = d; p.eye.y = tun.movement.standEyeHeight; p.eye.z = 0;
  let heard = 0;
  bus.on('perceiverHeard', () => heard++);
  sys.hear(kind, 1);
  return heard === 1;
}

/** Whether the player hears a sound of `kind` an enemy makes `d` metres away, in a world with this level. */
function playerHears(kind: EnemySoundKind, d: number, mapHearing?: LevelDef['hearing']): boolean {
  const world = new World({ level: level(mapHearing), tunables: cloneTunables(), seed: 3 });
  world.placePlayer(0, 0, 0, 0);
  return world.soundAudible(kind, d, 0);
}

describe('honest information channels: one radius table, symmetric (engagement-information §4.2, #99)', () => {
  it('for every sound kind the player hears an enemy exactly as far as the enemy hears the player, at every mind skill', () => {
    const table = cloneTunables().attribution.soundRadiusM;
    for (const kind of SOUND_KINDS) {
      const r = table[kind];
      for (const skill of [0, 25, 50, 75, 100]) {
        for (const d of [1, r - 0.01, r, r + 0.01, r * 2]) {
          expect(enemyHears(kind, d, undefined, skill), `${kind} at ${d} m, skill ${skill}`).toBe(playerHears(kind, d));
        }
        expect(enemyHears(kind, r, undefined, skill)).toBe(true); // the edge is inside
        expect(enemyHears(kind, r + 0.01, undefined, skill)).toBe(false);
      }
    }
  });

  it('a map\'s own radii change both directions together and leave the other kinds alone', () => {
    const hearing = { footstep: 18, reload: 9 } as const;
    const table = cloneTunables().attribution.soundRadiusM;
    for (const kind of SOUND_KINDS) {
      const r = hearing[kind as 'footstep' | 'reload'] ?? table[kind];
      for (const d of [r - 0.01, r, r + 0.01]) expect(enemyHears(kind, d, hearing), `${kind} ${d}`).toBe(playerHears(kind, d, hearing));
      expect(playerHears(kind, r, hearing)).toBe(true);
      expect(playerHears(kind, r + 0.01, hearing)).toBe(false);
    }
  });

  it('nothing else carries a radius: the audio config and the mind config have none', () => {
    const t = cloneTunables() as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(t.audio!.enemy as object).filter((k) => /audible|radius|hear/i.test(k))).toEqual([]);
    expect(t.mind).not.toHaveProperty('hearing');
    expect(Object.keys(t.attribution!.soundRadiusM as object).sort()).toEqual([...SOUND_KINDS].sort());
  });

  it('applySoundRadii lays a map\'s kinds over the table in place', () => {
    const base = cloneTunables().attribution.soundRadiusM;
    const out = createSoundRadii(base);
    applySoundRadii(out, base, { shot: 40 });
    expect(out).toEqual({ ...base, shot: 40 });
    applySoundRadii(out, base);
    expect(out).toEqual(base);
    expect(isAudible(out, 'shot', base.shot)).toBe(true);
    expect(isAudible(out, 'shot', base.shot + 0.001)).toBe(false);
  });

  it('World.setLevel re-lays the table with the new map\'s radii', () => {
    const world = new World({ level: level(), tunables: cloneTunables(), seed: 1 });
    const same = world.soundRadii;
    world.setLevel(level({ footstep: 12 }));
    expect(world.soundRadii).toBe(same); // filled in place: every listener's reference stays valid
    expect(same.footstep).toBe(12);
    world.setLevel(level());
    expect(same.footstep).toBe(cloneTunables().attribution.soundRadiusM.footstep);
  });
});

const WEAPON_IDS: readonly WeaponId[] = ['pace', 'kestrel', 'vane', 'rill'];

describe('enemy footsteps follow the shared body\'s speed (design §4.4, #87)', () => {
  /** One Echo run through its body (`driven`), the player 20 m away: the footstep events in `seconds` of holding the keys. */
  function steps(weapon: WeaponId, keys: { walk?: boolean; crouch?: boolean }, seconds: number) {
    const tun = cloneTunables();
    const w = new World({ level: level(), tunables: tun, seed: 2 });
    const bus = new EventBus<SimEvents>();
    w.placePlayer(0, 0, 20, 0);
    const id = w.spawnTarget('post', 0, 0, 0, bus);
    const t = w.targetField.byId(id)!;
    t.body.driven = true;
    t.body.gait.runSpeedMps = tun.weapon[weapon].runSpeedMps;
    const out: { audible: boolean; speed: number }[] = [];
    bus.on('enemyFootstep', (e) => out.push({ audible: e.audibleToPlayer, speed: Math.hypot(t.body.kin.vel.x, t.body.kin.vel.z) }));
    const input = createTickInput();
    w.step(input, bus);
    t.body.cmd.moveX = 1;
    t.body.cmd.walk = !!keys.walk;
    t.body.cmd.crouch = !!keys.crouch;
    for (let i = 0; i < Math.round(seconds * 128); i++) w.step(input, bus);
    return { out, speed: Math.hypot(t.body.kin.vel.x, t.body.kin.vel.z) };
  }

  it('a walk and a crouch-walk are silent for every weapon; a run is heard, one step per stride', () => {
    const stride = cloneTunables().audio.enemy.strideM;
    for (const weapon of WEAPON_IDS) {
      const walk = steps(weapon, { walk: true }, 4);
      expect(walk.out, `${weapon} walking (${walk.speed.toFixed(2)} m/s)`).toEqual([]);
      const crouch = steps(weapon, { crouch: true }, 4);
      expect(crouch.out, `${weapon} crouch-walking`).toEqual([]);
      const run = steps(weapon, {}, 3);
      expect(run.out.length, `${weapon} running`).toBeGreaterThan(2);
      expect(run.out.every((s) => s.audible)).toBe(true);
      // The run covers about speed x time: the step count follows the distance, one per stride.
      expect(Math.abs(run.out.length - Math.floor((run.speed * 3 - 0.5 * run.speed * 0.3) / stride))).toBeLessThanOrEqual(2);
    }
  });

  it('the silent speed sits above the body\'s walk of every weapon and below its run (the threshold is the body\'s, not a free number)', () => {
    const tun = cloneTunables();
    for (const weapon of WEAPON_IDS) {
      const run = tun.weapon[weapon].runSpeedMps;
      expect(run * tun.movement.walkFraction, weapon).toBeLessThan(tun.audio.enemy.silentBelowMps);
      expect(run * tun.movement.crouchWalkFraction, weapon).toBeLessThan(tun.audio.enemy.silentBelowMps);
      expect(run, weapon).toBeGreaterThan(tun.audio.enemy.silentBelowMps);
    }
  });

  it('a step beyond the footstep radius is announced but not audible, and a landing and a reload start are announced too', () => {
    const tun = cloneTunables();
    const w = new World({ level: level(), tunables: tun, seed: 2 });
    const bus = new EventBus<SimEvents>();
    w.placePlayer(0, 0, 100, 0);
    const id = w.spawnTarget('post', 0, 0, 0, bus);
    const t = w.targetField.byId(id)!;
    t.body.driven = true;
    const seen: string[] = [];
    bus.on('enemyFootstep', (e) => seen.push(`step ${e.audibleToPlayer}`));
    bus.on('enemyLanded', (e) => seen.push(`land ${e.audibleToPlayer}`));
    bus.on('enemyReloadStarted', (e) => seen.push(`reload ${e.audibleToPlayer}`));
    const input = createTickInput();
    w.step(input, bus);
    t.body.cmd.moveX = 1;
    for (let i = 0; i < 128; i++) w.step(input, bus);
    expect(seen.filter((s) => s.startsWith('step')).every((s) => s === 'step false') && seen.length > 0).toBe(true);
    // Close: a jump and a reload.
    const w2 = new World({ level: level(), tunables: tun, seed: 2 });
    w2.placePlayer(0, 0, 10, 0);
    const id2 = w2.spawnTarget('post', 0, 0, 0, bus);
    const t2 = w2.targetField.byId(id2)!;
    t2.body.driven = true;
    t2.body.cmd.yaw = 0; // facing away from the player: its practice shot must not hit him
    seen.length = 0;
    w2.step(input, bus);
    t2.body.cmd.jump = true;
    for (let i = 0; i < 160; i++) w2.step(input, bus);
    t2.body.cmd.fire = true; // spend the magazine's first round so a reload may start
    w2.step(input, bus);
    t2.body.cmd.fire = false;
    for (let i = 0; i < 64; i++) {
      t2.body.cmd.reload = true; // an edge: pressed again each tick until the gun takes it
      w2.step(input, bus);
    }
    expect(seen).toContain('land true');
    expect(seen).toContain('reload true');
  });
});
