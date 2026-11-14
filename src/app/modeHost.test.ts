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

  describe('the Daily Baseline', () => {
    function baselineRig(seed: number) {
      const tunables = cloneTunables();
      const world = new World({ level: rangeMap, tunables, seed });
      const bus = new EventBus<GameEvents>();
      const host = new ModeHost(world, bus, rangeMap, tunables);
      const trials: { skill: string; source?: string; itemDifficulty: number; success: boolean }[] = [];
      let ended: string | null = null;
      bus.on('skillTrial', (e) => trials.push({ skill: e.skill, source: e.source, itemDifficulty: e.itemDifficulty, success: e.success }));
      bus.on('runEnded', (e) => (ended = e.reason));
      const input = createTickInput();
      const c = vec3();
      /** A bot that aims at the live target's head and fires once it has settled; ticks until the run ends. */
      const play = (maxTicks: number): void => {
        for (let i = 0; i < maxTicks && host.runner.phase !== 'result'; i++) {
          input.fire = false;
          for (const t of world.targets) {
            if (!t.alive) continue;
            zoneCentre(c, t, tunables.targets.hit, tunables.targets.kinds[t.kind], 'head');
            const p = world.player;
            const dx = c.x - p.pos.x, dy = c.y - (p.pos.y + p.eyeHeight), dz = c.z - p.pos.z;
            input.yaw = Math.atan2(-dx, -dz);
            input.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
            input.fire = host.runner.phase === 'live' && i % 50 === 0;
            break;
          }
          world.step(input, bus);
          host.tick();
        }
      };
      return { host, world, bus, tunables, trials, play, ended: () => ended };
    }

    it('runs 40 trials on the real sim and ends complete, on the Kestrel, movement locked', () => {
      const r = baselineRig(3);
      expect(r.host.start('baseline', { seed: 3 })).toBe(true);
      expect(r.world.weapon.slots[r.world.weapon.active]!.id).toBe('kestrel');
      expect(r.world.movementLocked).toBe(true);
      r.play(128 * 400);
      expect(r.host.runner.phase).toBe('result');
      expect(r.ended()).toBe('complete');
      expect(r.trials).toHaveLength(40);
      expect(r.trials.every((t) => t.source === 'baseline')).toBe(true);
      expect(r.host.status().baseline).toMatchObject({ version: 1, started: 40, resolved: 40, of: 40 });
      expect(r.host.status().refusedSpawns).toBe(0);
    });

    it('is deterministic for a seed, and two seeds play different sequences', () => {
      const run = (seed: number) => {
        const r = baselineRig(seed);
        r.host.start('baseline', { seed });
        r.play(128 * 400);
        return { hash: r.world.hash(), trials: JSON.stringify(r.trials) };
      };
      expect(run(8)).toEqual(run(8));
      expect(run(8).hash).not.toBe(run(9).hash);
    });

    it('never feeds the matched posterior, while a matched trial still does', () => {
      const r = baselineRig(5);
      const before = [r.host.skills.rating('flick'), r.host.skills.rating('precision')];
      r.host.start('baseline', { seed: 5 });
      r.play(128 * 400);
      expect(r.host.skills.trialCount('flick')).toBe(0);
      expect(r.host.skills.trialCount('precision')).toBe(0);
      expect([r.host.skills.rating('flick'), r.host.skills.rating('precision')]).toEqual(before);
      r.bus.emit('skillTrial', { tick: 1, t: 0, skill: 'flick', itemDifficulty: 40, success: true, source: 'matched' });
      r.bus.emit('skillTrial', { tick: 1, t: 0, skill: 'flick', itemDifficulty: 40, success: true });
      expect(r.host.skills.trialCount('flick')).toBe(2);
    });

    it('takes each skill\'s level from its matched dial until the series exists (highest level at or below it)', () => {
      const r = baselineRig(1);
      const sk = r.host.skills;
      // Cold start prior: dial 40 -> flick matched 40 - 7.6 = 32.4 -> level 30; precision 40 - 0.9 = 39.1 -> 30.
      expect(r.host.baselineLevels()).toEqual({ flick: 30, precision: 30 });
      for (let i = 0; i < 80; i++) sk.observe('flick', { itemDifficulty: 70, success: true });
      const matched = sk.targetDial('flick', 0.7);
      expect(matched).toBeGreaterThan(60);
      const level = r.host.baselineLevels().flick;
      expect(level).toBeLessThanOrEqual(matched);
      expect(matched - level).toBeLessThan(15);
      expect(r.host.baselineLevels(52)).toEqual({ flick: 45, precision: 45 }); // a pinned dial stands in for both
    });

    it('scores each item at its own level and runs the trials at the levels', () => {
      const r = baselineRig(2);
      r.host.start('baseline', { seed: 2, pinDial: 61 });
      r.play(128 * 400);
      expect(r.trials.every((t) => t.itemDifficulty === 60)).toBe(true);
      expect(r.host.status().baseline!.levels).toEqual({ flick: 60, precision: 60 });
    });
  });
});
