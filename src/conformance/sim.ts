import { cloneTunables, type Tunables } from '../config/tunables';
import { weapon as defaultWeapons, type WeaponId } from '../config/weapon';
import { EventBus } from '../core/eventBus';
import { RAD2DEG } from '../core/math';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import { World } from '../sim/world';
import { createTickInput, type BoxDef, type HitZone, type LevelDef, type TickInput } from '../sim/types';

/**
 * Scripted-input harness for the behavioural conformance rows: the real deterministic `World`,
 * driven one tick at a time through `TickInput` exactly like `__flickline.step` does, on a flat
 * empty field so nothing but the mechanic under test is in play. Every number a row reports is read
 * from the simulation's own state and events, never from the config it is compared against.
 */

const floor: BoxDef = { tag: 'floor', min: vec3(-300, -1, -300), max: vec3(300, 0, 300) };

/** A 600 m flat floor, no walls, no targets; the player starts at the origin facing -Z. */
export const flatRange: LevelDef = {
  name: 'Conformance Range',
  boxes: [floor],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

/** The tick count of `seconds`, rounded to the nearest whole tick. */
export function ticksOf(seconds: number): number {
  return Math.round(seconds / TICK_DT);
}

/** What one `shotFired` event said (the payload object is reused by the sim, so copy what is kept). */
export interface ShotRecord {
  tick: number;
  weapon: WeaponId;
  spreadDeg: number;
  moving: boolean;
  speed: number;
  crouching: boolean;
  recoilIndex: number;
  /** Angle between the fired direction and the aim axis, degrees (the spread draw). */
  deviationDeg: number;
}

export interface ImpactRecord {
  tick: number;
  result: 'hit' | 'miss';
  zone: HitZone | null;
  damage: number;
  killed: boolean;
  distance: number;
}

/** Plain-data record of the events a row cares about. */
export interface Recorder {
  shots: ShotRecord[];
  impacts: ImpactRecord[];
  reloadStarted: number[];
  reloadCompleted: { tick: number; ammo: number; reserve: number }[];
  kills: number;
}

export interface Sim {
  world: World;
  bus: EventBus<import('../sim/types').SimEvents>;
  rec: Recorder;
  /** Advance one tick with the held inputs in `patch` (everything else released, view level). */
  tick(patch?: Partial<TickInput>): void;
  /** `n` ticks with the same inputs. */
  run(n: number, patch?: Partial<TickInput>): void;
  /** Horizontal speed, m/s. */
  speed(): number;
}

export interface SimOptions {
  tunables?: Tunables;
  seed?: number;
  /** Weapon in hand and in the loadout (default `kestrel`). A sidearm goes in slot 1. */
  weapon?: WeaponId;
  /** Shots never use ammo. */
  infiniteMagazine?: boolean;
  /** Let the first ticks pass so the player is standing on the floor (default true). */
  settle?: boolean;
}

/** Loadout that puts `id` in its own slot class and keeps the default weapon in the other. */
export function loadoutFor(id: WeaponId, t: Tunables): WeaponId[] {
  const sidearm = t.weapon[id].slotClass === 'sidearm';
  return sidearm ? ['kestrel', id] : [id, 'pace'];
}

export function createSim(opts: SimOptions = {}): Sim {
  const tunables = opts.tunables ?? cloneTunables();
  const id = opts.weapon ?? 'kestrel';
  const world = new World({ level: flatRange, tunables, seed: opts.seed ?? 1, loadout: loadoutFor(id, tunables) });
  world.equipWeapon(id);
  world.weapon.infiniteMagazine = opts.infiniteMagazine ?? false;
  const bus = new EventBus<import('../sim/types').SimEvents>();
  const rec: Recorder = { shots: [], impacts: [], reloadStarted: [], reloadCompleted: [], kills: 0 };
  bus.on('shotFired', (e) => {
    const dot = e.dir.x * e.aimDir.x + e.dir.y * e.aimDir.y + e.dir.z * e.aimDir.z;
    rec.shots.push({
      tick: e.tick, weapon: e.weapon, spreadDeg: e.spreadDeg, moving: e.moving, speed: e.speed,
      crouching: e.crouching, recoilIndex: e.recoilIndex,
      deviationDeg: Math.acos(Math.min(1, dot)) * RAD2DEG,
    });
  });
  bus.on('shotImpact', (e) => {
    rec.impacts.push({ tick: e.tick, result: e.result, zone: e.zone, damage: e.damage, killed: e.killed, distance: e.distance });
  });
  bus.on('reloadStarted', (e) => rec.reloadStarted.push(e.tick));
  bus.on('reloadCompleted', (e) => rec.reloadCompleted.push({ tick: e.tick, ammo: e.ammo, reserve: e.reserve }));
  bus.on('targetKilled', () => {
    rec.kills++;
  });

  const input = createTickInput();
  const sim: Sim = {
    world, bus, rec,
    tick(patch = {}) {
      input.moveX = 0; input.moveZ = 0; input.yaw = 0; input.pitch = 0;
      input.jump = false; input.crouch = false; input.walk = false; input.fire = false;
      input.reload = false; input.switchTo = -1;
      Object.assign(input, patch);
      world.step(input, bus);
    },
    run(n, patch) {
      for (let i = 0; i < n; i++) sim.tick(patch);
    },
    speed: () => Math.hypot(world.player.vel.x, world.player.vel.z),
  };
  if (opts.settle !== false) settle(sim);
  return sim;
}

/** Idle until the player is on the floor and the landing spread window (0.225 s) is well over. */
export function settle(sim: Sim): void {
  sim.run(ticksOf(0.5));
}

/** Run forward until the speed stops changing (3 s covers any acceleration time). */
export function runToFullSpeed(sim: Sim, patch: Partial<TickInput> = {}): void {
  sim.run(ticksOf(3), { moveZ: 1, ...patch });
}

/** The weapons a row set iterates: every id in the config's weapon table. */
export function weaponIds(): WeaponId[] {
  return Object.keys(defaultWeapons) as WeaponId[];
}
