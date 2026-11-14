import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { createMindProfile, profileFor } from './mind/profile';
import { PerceptionSystem, type Perceiver } from './perception';
import { createTickInput, type LevelDef, type SimEvents, type TickInput } from './types';
import { World } from './world';

/**
 * Signature S9, information honesty (`docs/research/player-like-enemies.md` §7.3): over a minute of
 * scripted play with the real movement code, no enemy perceives a player who is occluded and
 * unheard. The arena has a long wall at z 5..6 with four enemies in front of it (z 0) and the
 * player behind it; the player only ever makes sounds the enemies cannot hear (walking and
 * crouch-walking are silent, running is out of the footstep radius), and no ray can get through the
 * wall. The control runs prove the test is not vacuous: the same enemies do perceive when sight or
 * sound is allowed.
 */

const FACE_PLUS_Z = Math.PI;

function arena(wall: boolean): LevelDef {
  const boxes: LevelDef['boxes'] = [{ tag: 'floor', min: vec3(-300, -1, -300), max: vec3(300, 0, 300) }];
  if (wall) boxes.push({ tag: 'cover', min: vec3(-120, 0, 5), max: vec3(120, 6, 6) });
  return { name: 'honesty arena', boxes, spawn: { pos: vec3(0, 0, 12), yaw: 0 }, targets: [] };
}

interface Phase {
  seconds: number;
  input: Partial<TickInput>;
  /** moveX flips sign every this many seconds (0 = constant). */
  strafeEverySec?: number;
}

interface Result {
  events: { type: string; e: Record<string, unknown> }[];
  perceivers: Perceiver[];
  sys: PerceptionSystem;
  world: World;
  minPlayerDistance: number;
}

function play(opts: {
  wall: boolean;
  phases: Phase[];
  yaws?: number[];
  seed?: number;
  extraEnemy?: boolean;
  spawn?: { x: number; z: number };
}): Result {
  const tun = cloneTunables();
  const world = new World({ level: arena(opts.wall), tunables: tun, seed: 5 });
  if (opts.spawn) { world.player.pos.x = opts.spawn.x; world.player.pos.z = opts.spawn.z; }
  const bus = new EventBus<SimEvents>();
  const input = createTickInput();
  input.yaw = Math.PI; // facing +Z: forward runs away from the enemies
  for (let i = 0; i < 30; i++) world.step(input, bus); // settle onto the floor before anyone listens
  const sys = new PerceptionSystem(tun, world.level.boxes, world.player, bus, 11);
  sys.attach(bus);
  const events: Result['events'] = [];
  bus.onAny((type, e) => {
    if (String(type).startsWith('perceiver')) events.push({ type: String(type), e: { ...(e as object) } as Record<string, unknown> });
  });
  const xs = [-6, -2, 2, 6, 10];
  const yaws = opts.yaws ?? [FACE_PLUS_Z, FACE_PLUS_Z, FACE_PLUS_Z + 1, FACE_PLUS_Z - 1, 0];
  const n = opts.extraEnemy ? 5 : 4;
  const perceivers: Perceiver[] = [];
  const seed = opts.seed ?? 40;
  for (let i = 0; i < n; i++) {
    const p = sys.add(i + 1, new Rng(seed + i * 17), profileFor(20 + i * 20, new Rng(seed + i), createMindProfile(), tun))!;
    p.eye.x = xs[i]!; p.eye.y = 1.62; p.eye.z = 0; p.yaw = yaws[i]!;
    perceivers.push(p);
  }
  let minD = Infinity;
  for (const ph of opts.phases) {
    const ticks = Math.round(ph.seconds * TICK_RATE);
    for (let i = 0; i < ticks; i++) {
      Object.assign(input, { moveX: 0, moveZ: 0, jump: false, crouch: false, walk: false, fire: false, reload: false }, ph.input);
      if (ph.strafeEverySec) input.moveX = Math.floor(i / (ph.strafeEverySec * TICK_RATE)) % 2 === 0 ? 1 : -1;
      world.step(input, bus);
      sys.step(world.tick);
      for (const p of perceivers) minD = Math.min(minD, Math.hypot(world.player.pos.x - p.eye.x, world.player.pos.z - p.eye.z));
    }
  }
  return { events, perceivers, sys, world, minPlayerDistance: minD };
}

/** 60 s: silent walking behind the wall, silent crouch-walking, a silent walk away, then running beyond hearing. */
const HONEST_MINUTE: Phase[] = [
  { seconds: 15, input: { walk: true }, strafeEverySec: 2 },
  { seconds: 15, input: { crouch: true }, strafeEverySec: 2 },
  { seconds: 15, input: { walk: true, moveZ: 1 } },
  { seconds: 15, input: { moveZ: 1 }, strafeEverySec: 3 },
];

describe('S9 information honesty', () => {
  it('60 s of scripted play behind a wall, silent or out of earshot: zero perception events, no memory, no expectation', () => {
    const r = play({ wall: true, phases: HONEST_MINUTE });
    expect(r.world.tick).toBeGreaterThan(60 * TICK_RATE);
    expect(r.events).toEqual([]);
    for (const p of r.perceivers) {
      expect(p.sees).toBe(false);
      expect(p.memory.valid).toBe(false);
      expect(p.expect.active).toBe(false);
      expect(p.heardCount).toBe(0);
    }
    // The test is exercising the machinery: the enemies were looking, and the player really was near and really did move.
    expect(r.sys.decisionsTotal).toBeGreaterThan(4 * 55 * 8);
    expect(r.sys.raysTotal).toBeGreaterThan(500);
    expect(r.minPlayerDistance).toBeLessThan(15);
    expect(r.world.player.pos.z).toBeGreaterThan(40); // it did run far away in the last phase
  });

  it('the same minute is honest for every skill and seed', () => {
    for (const seed of [1, 99, 4242]) {
      const r = play({ wall: true, phases: HONEST_MINUTE, seed });
      expect(r.events, `seed ${seed}`).toEqual([]);
    }
  });

  it('control: the same enemies see him the moment the wall is gone', () => {
    const r = play({ wall: false, phases: [{ seconds: 5, input: { walk: true }, strafeEverySec: 2 }] });
    expect(r.events.filter((e) => e.type === 'perceiverHeard')).toHaveLength(0); // walking is still silent
    expect(r.events.filter((e) => e.type === 'perceiverSaw').length).toBeGreaterThan(0);
    expect(r.perceivers.some((p) => p.memory.valid)).toBe(true);
  });

  it('control: running behind the wall within earshot is heard (sound does not need sight) and still not seen', () => {
    const r = play({ wall: true, phases: [{ seconds: 5, input: {}, strafeEverySec: 1 }] });
    expect(r.events.filter((e) => e.type === 'perceiverHeard').length).toBeGreaterThan(0);
    expect(r.events.filter((e) => e.type === 'perceiverSaw')).toHaveLength(0);
    expect(r.perceivers.every((p) => !p.sees)).toBe(true);
    for (const p of r.perceivers) {
      if (p.memory.valid) expect(p.memory.source).toBe('sound');
    }
  });

  it('control: a shot behind the wall is heard out to the shot radius, far beyond a footstep', () => {
    const r = play({ wall: true, phases: [{ seconds: 0.2, input: {} }], spawn: { x: 0, z: 60 } });
    r.sys.hear('shot', r.world.tick); // 60 m from the enemies: past the footstep radius (30), inside the shot's (80)
    expect(r.events.filter((e) => e.type === 'perceiverHeard').length).toBe(4);
  });

  it('is deterministic: the same seeds give the same trace', () => {
    const a = play({ wall: false, phases: [{ seconds: 6, input: {}, strafeEverySec: 1 }] });
    const b = play({ wall: false, phases: [{ seconds: 6, input: {}, strafeEverySec: 1 }] });
    expect(a.events.length).toBeGreaterThan(10);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('S11 isolation: adding another enemy leaves the first four enemies\' own draws unchanged', () => {
    const phases: Phase[] = [{ seconds: 6, input: {}, strafeEverySec: 1 }];
    const base = play({ wall: false, phases });
    const more = play({ wall: false, phases, extraEnemy: true });
    const own = (r: Result): string => JSON.stringify(r.events.filter((e) => e.type === 'perceiverHeard' && (e.e.id as number) <= 4));
    expect(own(base).length).toBeGreaterThan(100);
    expect(own(more)).toBe(own(base));
    for (let i = 0; i < 4; i++) expect(more.perceivers[i]!.decisions).toBe(base.perceivers[i]!.decisions);
  });
});
