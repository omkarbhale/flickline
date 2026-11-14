import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import { zoneCentre } from '../sim/hitZones';
import { laneMap, rangeMap } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { World } from '../sim/world';
import type { GameEvents } from '../core/gameEvents';
import { ModeHost, MODES } from './modeHost';
import { testMode } from '../modes/testMode';
import type { ModeDef } from '../modes/modeDef';

/** The framework on the real sim, real Range anchors and the real skill model, with a bot that aims at the head. */
function playBot(seed: number, ticks: number) {
  const tunables = cloneTunables();
  const world = new World({ level: rangeMap, tunables, seed });
  const bus = new EventBus<GameEvents>();
  const host = new ModeHost(world, bus, rangeMap, tunables);
  const log: string[] = [];
  for (const type of ['skillTrial', 'scoreAwarded', 'chainUpdated', 'streakUpdated', 'beatStarted', 'runEnded'] as const) {
    bus.on(type, (e) => log.push(`${type}:${JSON.stringify(e)}`));
  }
  expect(host.start('test', { seed })).toBe(true);
  const input = createTickInput();
  const c = vec3();
  for (let i = 0; i < ticks; i++) {
    input.fire = false;
    for (const t of world.targets) {
      if (!t.alive) continue;
      zoneCentre(c, t, tunables.targets.hit, tunables.targets.kinds[t.kind], 'head');
      const p = world.player;
      const dx = c.x - p.pos.x, dy = c.y - (p.pos.y + p.eyeHeight), dz = c.z - p.pos.z;
      input.yaw = Math.atan2(-dx, -dz);
      input.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
      input.fire = host.runner.phase === 'live' && i % 40 === 0; // a deliberate shot now and then
      break;
    }
    world.step(input, bus);
    host.tick();
  }
  return { host, world, log };
}

describe('ModeHost on the real sim', () => {
  it('runs TestMode: spawns Range posts, scores kills, emits trials, respects the fairness floor', () => {
    const { host, world, log } = playBot(5, 128 * 12);
    const s = host.status();
    expect(s.mode).toBe('test');
    expect(s.phase).toBe('live');
    expect(s.kills).toBeGreaterThan(2);
    expect(s.score).toBeGreaterThan(0);
    expect(s.trialsWon).toBe(s.kills);
    expect(log.some((l) => l.startsWith('skillTrial:'))).toBe(true);
    expect(s.refusedSpawns).toBe(0);
    const eye = world.player.pos;
    for (const t of world.targets) if (t.alive) expect(Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z)).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic: the same seed and bot give the same events and world hash', () => {
    const a = playBot(11, 128 * 8);
    const b = playBot(11, 128 * 8);
    expect(a.log.length).toBeGreaterThan(3);
    expect(a.log).toEqual(b.log);
    expect(a.world.hash()).toBe(b.world.hash());
  });

  it('unknown modes are refused and stop() ends the run', () => {
    const { host } = playBot(1, 10);
    expect(host.start('nope')).toBe(false);
    host.stop();
    expect(host.status().mode).toBeNull();
  });

  it("a mode's weapon is put in hand even when the loadout lacks it, and swapping belongs to modes with a loadout", () => {
    const tunables = cloneTunables();
    const world = new World({ level: rangeMap, tunables, seed: 3 });
    const bus = new EventBus<GameEvents>();
    const host = new ModeHost(world, bus, rangeMap, tunables);
    const modes = MODES as Record<string, ModeDef<never>>;
    modes['__rill'] = { ...(testMode as ModeDef<never>), weapon: 'rill' };
    modes['__loadout'] = { ...(testMode as ModeDef<never>), weapon: 'rill', player: { allowSwap: true } };
    try {
      expect(host.start('test')).toBe(true); // Kestrel, no loadout: swap keys ignored
      expect(world.swapLocked).toBe(true);
      expect(world.weapon.slots.map((x) => x.id)).toEqual(['kestrel', 'pace']);

      expect(host.start('__rill')).toBe(true); // Rill is not in the loadout: it takes the primary slot
      expect([...world.loadout]).toEqual(['rill', 'pace']);
      expect(world.weapon.slots[world.weapon.active]!.id).toBe('rill');

      expect(host.start('__loadout')).toBe(true);
      expect(world.swapLocked).toBe(false);
      host.stop();
      expect(world.swapLocked).toBe(false); // free play can always swap
    } finally {
      delete modes['__rill'];
      delete modes['__loadout'];
    }
  });

  it("a mode's economy equips the player and the Echoes with the shield tier; drills and stop() clear it (design §5.1)", () => {
    const tunables = cloneTunables();
    const world = new World({ level: rangeMap, tunables, seed: 3 });
    const bus = new EventBus<GameEvents>();
    const host = new ModeHost(world, bus, rangeMap, tunables);
    // Same id as the test mode (the skill model only knows registered modes' dials), different economy.
    const modes = MODES as Record<string, ModeDef<never>>;
    modes['__armoured'] = { ...(testMode as ModeDef<never>), economy: 'full' };
    modes['__light'] = { ...(testMode as ModeDef<never>), economy: 'light' };
    try {
      expect(host.start('test')).toBe(true); // a drill: no economy, no shield
      expect(world.health.maxShield).toBe(0);
      expect(world.targetField.enemyShield).toBe(0);

      expect(host.start('__armoured')).toBe(true);
      expect(world.health).toMatchObject({ shield: 50, maxShield: 50 });
      expect(world.targetField.enemyShield).toBe(50);
      world.reset(); // a restart inside the run keeps it
      expect(world.health.maxShield).toBe(50);

      expect(host.start('__light')).toBe(true);
      expect(world.health.maxShield).toBe(25);
      expect(world.targetField.enemyShield).toBe(25);

      host.stop();
      expect(world.health.maxShield).toBe(0);
      expect(world.targetField.enemyShield).toBe(0);
    } finally {
      delete modes['__armoured'];
      delete modes['__light'];
    }
  });

  describe('starting a mode loads the map it is designed for (#184)', () => {
    function setup(seed = 3) {
      const tunables = cloneTunables();
      const world = new World({ level: rangeMap, tunables, seed });
      const bus = new EventBus<GameEvents>();
      const host = new ModeHost(world, bus, rangeMap, tunables);
      const loaded: string[] = [];
      bus.on('mapLoaded', (e) => loaded.push(e.mapId));
      return { world, host, loaded };
    }

    it('swaps the sim to Lane for Stop & Pop and back to Range for Orbit, announcing each load once', () => {
      const { world, host, loaded } = setup();
      expect(world.level).toBe(rangeMap);
      expect(host.start('stopAndPop', { seed: 5 })).toBe(true);
      expect(world.level).toBe(laneMap);
      expect(host.currentMap).toBe(laneMap);
      expect(loaded).toEqual(['lane']);
      // The player stands at Lane's spawn, not Range's.
      expect(world.player.pos).toMatchObject({ x: laneMap.spawn.pos.x, z: laneMap.spawn.pos.z });

      expect(host.start('stopAndPop', { seed: 6 })).toBe(true); // a restart on the same map loads nothing
      expect(loaded).toEqual(['lane']);

      expect(host.start('orbit', { seed: 5 })).toBe(true);
      expect(world.level).toBe(rangeMap);
      expect(loaded).toEqual(['lane', 'range']);
    });

    it('collision and placed targets follow the loaded map', () => {
      const { world, host } = setup();
      host.start('stopAndPop', { seed: 5 });
      expect(world.boxes).toBe(laneMap.boxes);
      // A mode owns its spawning: none of the map's own placed targets survive the start.
      expect(world.targets.some((t) => t.alive)).toBe(false);
    });

    it('a swapped world is the same world a fresh one on that map would be (same seed, same hash)', () => {
      const swapped = setup(9);
      swapped.host.start('stopAndPop', { seed: 9 });

      const tunables = cloneTunables();
      const fresh = new World({ level: laneMap, tunables, seed: 9 });
      const bus = new EventBus<GameEvents>();
      new ModeHost(fresh, bus, laneMap, tunables).start('stopAndPop', { seed: 9 });
      expect(swapped.world.hash()).toBe(fresh.hash());
    });
  });

  it('keeps benchmark trials out of the matched posterior (a mode with trialSource baseline, design 8.5)', () => {
    const tunables = cloneTunables();
    const world = new World({ level: rangeMap, tunables, seed: 5 });
    const bus = new EventBus<GameEvents>();
    const host = new ModeHost(world, bus, rangeMap, tunables);
    const modes = MODES as Record<string, ModeDef<never>>;
    modes['__bench'] = { ...(testMode as ModeDef<never>), trialSource: 'baseline' };
    const sources: (string | undefined)[] = [];
    bus.on('skillTrial', (e) => sources.push(e.source));
    try {
      const before = host.skills.rating('precision');
      expect(host.start('__bench', { seed: 5 })).toBe(true);
      const input = createTickInput();
      const c = vec3();
      for (let i = 0; i < 128 * 8; i++) {
        input.fire = false;
        for (const t of world.targets) {
          if (!t.alive) continue;
          zoneCentre(c, t, tunables.targets.hit, tunables.targets.kinds[t.kind], 'head');
          const p = world.player;
          const dx = c.x - p.pos.x, dy = c.y - (p.pos.y + p.eyeHeight), dz = c.z - p.pos.z;
          input.yaw = Math.atan2(-dx, -dz);
          input.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
          input.fire = host.runner.phase === 'live' && i % 40 === 0;
          break;
        }
        world.step(input, bus);
        host.tick();
      }
      expect(sources.length).toBeGreaterThan(2);
      expect(sources.every((x) => x === 'baseline')).toBe(true);
      expect(host.skills.trialCount('precision')).toBe(0);
      expect(host.skills.rating('precision')).toBe(before);
      // A matched trial (any other mode, or no tag) still feeds it.
      bus.emit('skillTrial', { tick: 1, t: 0, skill: 'precision', itemDifficulty: 40, success: true, source: 'matched' });
      bus.emit('skillTrial', { tick: 1, t: 0, skill: 'precision', itemDifficulty: 40, success: true });
      expect(host.skills.trialCount('precision')).toBe(2);
    } finally {
      delete modes['__bench'];
    }
  });
});
