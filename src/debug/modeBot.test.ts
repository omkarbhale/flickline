import { describe, expect, it } from 'vitest';
import { ModeHost } from '../app/modeHost';
import type { GameEvents } from '../core/gameEvents';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { zoneCentre } from '../sim/hitZones';
import { rangeMap } from '../sim/mapLoader';
import { rayBox } from '../sim/collision';
import { createTickInput } from '../sim/types';
import { World } from '../sim/world';
import { playMode, type BotHost, type BotOptions } from './modeBot';

/** The real World + ModeHost wiring the game uses, minus the DOM (the same host the `__flickline` bot drives). */
function headless(): { host: BotHost; mode: ModeHost; world: World; bus: EventBus<GameEvents>; trials: Record<string, unknown>[] } {
  const tunables = cloneTunables();
  const bus = new EventBus<GameEvents>();
  const world = new World({ level: rangeMap, tunables, seed: 1 });
  const mode = new ModeHost(world, bus, rangeMap, tunables);
  const input = createTickInput();
  const trials: Record<string, unknown>[] = [];
  bus.on('skillTrial', (e) => trials.push(JSON.parse(JSON.stringify(e)) as Record<string, unknown>));
  const scratch = { x: 0, y: 0, z: 0 };
  const firstAlive = () => world.targets.find((t) => t.alive) ?? null;
  const host: BotHost = {
    startMode: (id, o) => mode.start(id, o),
    tick(yaw, pitch, fire) {
      input.yaw = yaw;
      input.pitch = pitch;
      input.fire = fire;
      world.step(input, bus);
      mode.tick();
    },
    eye(out) {
      const p = world.player;
      out.x = p.pos.x;
      out.y = p.pos.y + p.eyeHeight;
      out.z = p.pos.z;
    },
    view: () => ({ yaw: world.player.yaw, pitch: world.player.pitch }),
    nextTarget(out) {
      const t = firstAlive();
      if (!t) return false;
      const tt = tunables.targets;
      const c = zoneCentre(scratch, t, tt.hit, tt.kinds[t.kind], 'head');
      out.x = c.x;
      out.y = c.y;
      out.z = c.z;
      return true;
    },
    targetId: () => firstAlive()?.id ?? -1,
    status: () => mode.status(),
    hash: () => world.hash(),
  };
  return { host, mode, world, bus, trials };
}

function play(id: string, o: Partial<BotOptions> = {}): Omit<ReturnType<typeof playMode>, 'trials'> & { trialLog: Record<string, unknown>[]; trials: number } {
  const h = headless();
  const r = playMode(h.host, id, { seed: 7, ...o });
  return { ...r, trialLog: h.trials };
}

/** [mode, min trials, max trials] over a full run for a human-paced aimer (design §4: ~45 / ~70 / 25-30 for a slower first run). */
const EXPECTED: [string, number, number][] = [['coldStart', 35, 60], ['orbit', 50, 90], ['placement', 25, 50], ['strafeTrack', 40, 110]];

describe('scripted aimer plays each mode for a full run', () => {
  for (const [id, lo, hi] of EXPECTED) {
    it(`${id}: scores, finishes on time, trial count in range, deterministic for a fixed seed`, () => {
      const a = play(id);
      const b = play(id);
      expect(a.phase).toBe('result');
      expect(a.score).toBeGreaterThan(0);
      expect(a.kills).toBeGreaterThan(0);
      expect(a.trials).toBeGreaterThanOrEqual(lo);
      expect(a.trials).toBeLessThanOrEqual(hi);
      expect(a.trialLog.length).toBe(a.trials);
      // Same seed, same bot: identical world, score and trial log.
      expect(b.hash).toBe(a.hash);
      expect(b.score).toBe(a.score);
      expect(b.trialLog).toEqual(a.trialLog);
      // A different seed plays a different run.
      expect(play(id, { seed: 8 }).hash).not.toBe(a.hash);
    });
  }

  it('Strafe Track at dial 10 and 90 runs with the parameters the dial sets (design §9.4), and the same dial and seed repeat exactly', () => {
    const at = (dial: number) => {
      const h = headless();
      const r = playMode(h.host, 'strafeTrack', { seed: 7, pinDial: dial });
      return { r, axes: h.mode.status().axes };
    };
    const lo = at(10);
    const hi = at(90);
    expect(lo.axes.strafeSpeed).toBeCloseTo(2.0 + 3.4 * 0.1, 9);
    expect(hi.axes.strafeSpeed).toBeCloseTo(2.0 + 3.4 * 0.9, 9);
    expect(hi.axes.strafeLegSec).toBeLessThan(lo.axes.strafeLegSec!);
    expect(hi.axes.standStillSec).toBeLessThan(lo.axes.standStillSec!);
    expect(hi.axes.strafeLimitSec).toBeLessThan(lo.axes.strafeLimitSec!);
    expect(hi.axes.distance).toBeGreaterThan(lo.axes.distance!);
    expect(hi.axes.density).toBeGreaterThan(lo.axes.density!);
    for (const x of [lo, hi]) {
      expect(x.r.phase).toBe('result');
      expect(x.r.score).toBeGreaterThan(0);
      expect(x.r.trials).toBeGreaterThanOrEqual(40);
      expect(x.r.trials).toBeLessThanOrEqual(110);
    }
    // The harder dial is harder on the same aimer: fewer of the Strafers die within their limit.
    expect(hi.r.trialsWon / hi.r.trials).toBeLessThan(lo.r.trialsWon / lo.r.trials);
    expect(at(10).r.hash).toBe(lo.r.hash);
  });

  it('every trial carries its first-bullet data, and flick error is recorded for Orbit', () => {
    const o = play('orbit');
    for (const t of o.trialLog) {
      expect(t.skill).toBe('flick');
      expect(typeof t.itemDifficulty).toBe('number');
      const e = t.extra as Record<string, number>;
      expect(e).toHaveProperty('overshootDeg');
      expect(e).toHaveProperty('errDeg');
      if (t.success) expect(t.rtMs).toBeGreaterThan(0);
    }
    const c = play('coldStart');
    for (const t of c.trialLog) {
      expect(t.skill).toBe('precision');
      const e = t.extra as Record<string, number>;
      expect(e.offsetDeg).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(e.offsetDeg).toBeLessThanOrEqual(25 + 1e-6);
    }
  });
});

describe('the host applies each mode\'s player setup', () => {
  it('Orbit: stands at the shell centre with Pace, locked in place, infinite magazine; Cold Start: spawn, Kestrel, free', () => {
    const h = headless();
    expect(h.mode.start('orbit', { seed: 1 })).toBe(true);
    const p = h.world.player;
    expect(p.pos.x).toBeCloseTo(0, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);
    expect(p.pos.y).toBeCloseTo(0, 9);
    expect(h.world.weapon.slots[h.world.weapon.active]!.id).toBe('pace');
    expect(h.world.weapon.infiniteMagazine).toBe(true);
    expect(h.world.movementLocked).toBe(true);
    const input = createTickInput();
    input.moveZ = 1;
    input.moveX = 1;
    input.jump = true;
    for (let i = 0; i < 128; i++) h.world.step(input, h.bus);
    expect(p.pos.x).toBeCloseTo(0, 9);
    expect(p.pos.z).toBeCloseTo(0, 9);

    expect(h.mode.start('coldStart', { seed: 1 })).toBe(true);
    expect(h.world.player.pos.z).toBeCloseTo(25, 9); // the Range spawn
    expect(h.world.weapon.slots[h.world.weapon.active]!.id).toBe('kestrel');
    expect(h.world.movementLocked).toBe(false);
    h.mode.stop();
    expect(h.world.weapon.infiniteMagazine).toBe(false); // restored
  });

  it('no Beacon is ever hidden behind a pillar: every one is in line of sight of the stand point', () => {
    const h = headless();
    const eye = { x: 0, y: 1.62, z: 0 };
    let checked = 0;
    h.bus.on('targetSpawned', (e) => {
      if (e.kind !== 'beacon') return;
      const p = e.pos;
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
      const len = Math.hypot(dx, dy, dz);
      for (const b of rangeMap.boxes) {
        if (b.tag === 'floor' || b.tag === 'ceiling') continue;
        const hit = rayBox(eye.x, eye.y, eye.z, dx / len, dy / len, dz / len, b, len - 0.01, { x: 0, y: 0, z: 0 });
        expect(hit < 0 || hit >= len - 0.01, `box ${b.id ?? b.tag} blocks a Beacon at ${JSON.stringify(p)}`).toBe(true);
      }
      checked++;
    });
    playMode(h.host, 'orbit', { seed: 12, noiseDeg: 0.2 });
    expect(checked).toBeGreaterThan(40);
  });
});

describe('Placement run result', () => {
  it('hands the skill model a posterior for both skills, bounded by the staircase, and feeds every trial', () => {
    const h = headless();
    const before = h.mode.skills.rating('flick');
    const r = playMode(h.host, 'placement', { seed: 7 });
    expect(r.phase).toBe('result');
    const out = h.mode.status().placement!;
    expect(out).not.toBeNull();
    expect(out.reversals).toBeGreaterThanOrEqual(4);
    expect(out.flick).toBeGreaterThan(before);
    expect(out.precision).toBeGreaterThan(before);
    expect(out.flick).toBe(h.mode.skills.rating('flick'));
    // Within the sanity bound of the staircase's own estimate (design §9.2).
    expect(Math.abs(out.flick - out.staircaseEstimate)).toBeLessThanOrEqual(10 + 1e-6);
    expect(h.mode.skills.trialCount('flick') + h.mode.skills.trialCount('precision')).toBe(r.trials);
  });

  it('a quit run does not touch the posterior bound', () => {
    const h = headless();
    h.mode.start('placement', { seed: 3 });
    h.mode.stop();
    expect(h.mode.status().placement).toBeNull();
  });
});
