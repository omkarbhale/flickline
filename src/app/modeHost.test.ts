import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import { zoneCentre } from '../sim/hitZones';
import { rangeMap } from '../sim/mapLoader';
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
});
