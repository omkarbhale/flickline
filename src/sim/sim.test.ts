import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { rayBox, raySphere } from './collision';
import { testRoom } from './levels';
import { createTickInput, type LevelDef, type RunAndSimEvents, type SimEvents, type TickInput } from './types';
import { World } from './world';

function setup(level: LevelDef = testRoom, seed = 1) {
  const world = new World({ level, tunables: cloneTunables(), seed });
  const bus = new EventBus<RunAndSimEvents>();
  const log: { type: keyof SimEvents; data: unknown }[] = [];
  for (const t of ['shotFired', 'shotImpact', 'targetHit', 'targetKilled', 'targetRespawned', 'playerJumped', 'playerLanded', 'footstep'] as const) {
    bus.on(t, (e) => log.push({ type: t, data: JSON.parse(JSON.stringify(e)) }));
  }
  const input = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
    }
  };
  const count = (t: keyof SimEvents): number => log.filter((l) => l.type === t).length;
  return { world, bus, log, input, run, count };
}

describe('collision primitives', () => {
  const b = { tag: 'wall' as const, min: vec3(-1, -1, -1), max: vec3(1, 1, 1) };
  it('rayBox hits the near face with the right normal', () => {
    const n = vec3();
    expect(rayBox(0, 0, 5, 0, 0, -1, b, 100, n)).toBeCloseTo(4, 9);
    expect(n.z).toBe(1);
    expect(rayBox(0, 0, 5, 0, 0, 1, b, 100, n)).toBe(-1);
    expect(rayBox(0, 0, 5, 0, 0, -1, b, 3, n)).toBe(-1); // beyond range
    expect(rayBox(5, 0, 0, -1, 0, 0, b, 100, n)).toBeCloseTo(4, 9);
    expect(n.x).toBe(1);
  });
  it('raySphere returns entry distance or miss', () => {
    expect(raySphere(0, 0, 0, 0, 0, -1, 0, 0, -10, 1, 100)).toBeCloseTo(9, 9);
    expect(raySphere(0, 0, 0, 0, 0, -1, 3, 0, -10, 1, 100)).toBe(-1);
    expect(raySphere(0, 0, 0, 0, 0, 1, 0, 0, -10, 1, 100)).toBe(-1);
  });
});

describe('player movement', () => {
  it('lands and stays grounded on the floor', () => {
    const { world, run } = setup();
    run(4);
    expect(world.player.grounded).toBe(true);
    expect(world.player.pos.y).toBeCloseTo(0, 6);
    expect(world.player.vel.y).toBe(0);
  });

  it('accelerates to run speed and never exceeds it', () => {
    const { world, run } = setup();
    run(4);
    run(TICK_RATE, { moveZ: 1 });
    const speed = Math.hypot(world.player.vel.x, world.player.vel.z);
    expect(speed).toBeCloseTo(world.tunables.movement.runSpeed, 3);
    expect(world.player.pos.z).toBeLessThan(8 - 4); // moved forward (-Z)
  });

  it('does not go faster diagonally', () => {
    const { world, run } = setup();
    run(4);
    run(TICK_RATE, { moveZ: 1, moveX: 1 });
    expect(Math.hypot(world.player.vel.x, world.player.vel.z)).toBeCloseTo(world.tunables.movement.runSpeed, 3);
    expect(world.player.vel.x).toBeGreaterThan(0); // +X is right
  });

  it('walk and crouch are slower than run', () => {
    const a = setup();
    a.run(4);
    a.run(TICK_RATE, { moveZ: 1, walk: true });
    expect(Math.hypot(a.world.player.vel.x, a.world.player.vel.z)).toBeCloseTo(a.world.tunables.movement.walkSpeed, 3);
    const b = setup();
    b.run(4);
    b.run(TICK_RATE, { moveZ: 1, crouch: true });
    expect(Math.hypot(b.world.player.vel.x, b.world.player.vel.z)).toBeCloseTo(b.world.tunables.movement.crouchSpeed, 3);
  });

  it('is stopped by walls', () => {
    const { world, run } = setup();
    run(4);
    run(TICK_RATE * 8, { moveZ: 1 });
    const hw = world.tunables.movement.hullHalfWidth;
    expect(world.player.pos.z).toBeCloseTo(-20 + hw, 4);
    expect(world.player.vel.z).toBe(0);
  });

  it('jumps to the expected height and lands again', () => {
    const { world, run, count } = setup();
    run(4);
    const m = world.tunables.movement;
    const expected = (m.jumpSpeed * m.jumpSpeed) / (2 * m.gravity);
    let peak = 0;
    run(1, { jump: true });
    for (let i = 0; i < TICK_RATE; i++) {
      run(1);
      peak = Math.max(peak, world.player.pos.y);
    }
    expect(peak).toBeGreaterThan(expected - 0.03);
    expect(peak).toBeLessThan(expected + 0.03);
    expect(world.player.grounded).toBe(true);
    expect(count('playerJumped')).toBe(1);
    expect(count('playerLanded')).toBe(1);
  });

  it('cannot jump in mid-air', () => {
    const { world, run, count } = setup();
    run(4);
    run(1, { jump: true });
    run(10, { jump: true });
    run(1, { jump: true });
    expect(world.player.grounded).toBe(false);
    expect(count('playerJumped')).toBe(1);
  });

  it('lands on top of a crate and is blocked by its side', () => {
    const { world, run } = setup();
    run(4);
    // crate at x 3..4, z -10..-9, top y=0.7: drop onto it from above.
    world.player.pos.x = 3.5;
    world.player.pos.y = 2;
    world.player.pos.z = -9.5;
    run(TICK_RATE);
    expect(world.player.pos.y).toBeCloseTo(0.7, 3);
    expect(world.player.grounded).toBe(true);

    // walking into the side of the 1.2 m crate (x -3..-1.5, z -8..-6.5) stops at its face
    const w2 = setup();
    w2.run(4);
    w2.world.player.pos.x = -2.2;
    w2.world.player.pos.z = -3;
    w2.run(TICK_RATE * 2, { moveZ: 1 });
    expect(w2.world.player.pos.z).toBeCloseTo(-6.5 + w2.world.tunables.movement.hullHalfWidth, 4);
    expect(w2.world.player.pos.y).toBeCloseTo(0, 6);
  });

  it('fits under a low gap only when crouched, and cannot stand up inside it', () => {
    const stand = setup();
    stand.run(4);
    stand.world.player.pos.x = 11;
    stand.world.player.pos.z = 8;
    stand.run(TICK_RATE * 3, { moveZ: 1 });
    expect(stand.world.player.pos.z).toBeGreaterThan(6); // blocked by the lintel (z 3..6)

    const crouch = setup();
    crouch.run(4);
    crouch.world.player.pos.x = 11;
    crouch.world.player.pos.z = 8;
    crouch.run(TICK_RATE * 3, { moveZ: 1, crouch: true });
    expect(crouch.world.player.pos.z).toBeLessThan(3);

    const stuck = setup();
    stuck.run(4);
    stuck.world.player.pos.x = 11;
    stuck.world.player.pos.z = 4.5;
    stuck.run(2, { crouch: true });
    stuck.run(30, { crouch: false });
    expect(stuck.world.player.crouching).toBe(true);
    stuck.world.player.pos.z = 8;
    stuck.run(30, { crouch: false });
    expect(stuck.world.player.crouching).toBe(false);
  });

  it('clamps pitch', () => {
    const { world, run } = setup();
    run(1, { pitch: 3 });
    expect(world.player.pitch).toBeLessThan(Math.PI / 2);
  });
});

describe('hitscan weapon', () => {
  const aimAtTarget0 = (w: World): { yaw: number; pitch: number } => {
    const t = w.targets[0]!;
    const p = w.player;
    const dy = t.pos.y - (p.pos.y + p.eyeHeight);
    return { yaw: 0, pitch: Math.atan2(dy, p.pos.z - t.pos.z) };
  };

  it('flags shotFired.moving only above the accuracy deadzone speed', () => {
    const still = setup();
    still.run(8, { fire: true });
    const shots = still.log.filter((l) => l.type === 'shotFired');
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every((l) => (l.data as { moving: boolean }).moving === false)).toBe(true);

    const run = setup();
    run.run(40, { moveZ: 1 }); // reach run speed
    run.run(1, { moveZ: 1, fire: true });
    const first = run.log.find((l) => l.type === 'shotFired')!;
    expect((first.data as { moving: boolean }).moving).toBe(true);

    const walk = setup();
    walk.run(40, { moveZ: 1, walk: true }); // walk speed 2.7 of 5.4 is above 27.5%
    walk.run(1, { moveZ: 1, walk: true, fire: true });
    expect((walk.log.find((l) => l.type === 'shotFired')!.data as { moving: boolean }).moving).toBe(true);
  });

  it('hits, damages and kills a target, then it respawns', () => {
    const { world, run, count, log } = setup();
    run(4);
    const aim = aimAtTarget0(world);
    run(1, { ...aim, fire: true });
    expect(count('shotFired')).toBe(1);
    expect(count('targetHit')).toBe(1);
    expect(world.targets[0]!.hp).toBe(world.tunables.targets.maxHp - world.tunables.weapon.damage);
    run(TICK_RATE, aim); // fire stays held
    expect(count('targetKilled')).toBe(1);
    expect(world.targets[0]!.alive).toBe(false);
    run(0, { fire: false });
    run(Math.ceil(TICK_RATE * 1.5), { fire: false });
    expect(world.targets[0]!.alive).toBe(true);
    expect(count('targetRespawned')).toBeGreaterThanOrEqual(1);
    expect(log.some((l) => l.type === 'shotImpact')).toBe(true);
  });

  it('respects the fire interval', () => {
    const { run, count } = setup();
    run(4);
    run(TICK_RATE, { fire: true, pitch: 0.5 });
    const expected = Math.ceil(TICK_RATE / Math.round(0.1 * TICK_RATE));
    expect(count('shotFired')).toBeGreaterThanOrEqual(expected - 1);
    expect(count('shotFired')).toBeLessThanOrEqual(expected + 1);
  });

  it('shots hit the world when nothing else is in the way', () => {
    const { world, run, log } = setup();
    run(4);
    run(1, { yaw: Math.PI / 2, pitch: 0, fire: true }); // look left (-X), wall at x=-20
    const hit = log.find((l) => l.type === 'shotImpact')!;
    const d = hit.data as { point: { x: number }; onTarget: boolean; distance: number };
    expect(d.onTarget).toBe(false);
    expect(d.point.x).toBeCloseTo(-20, 3);
    expect(d.distance).toBeCloseTo(20, 3);
    expect(world.targets.every((t) => t.hp === t.maxHp)).toBe(true);
  });

  it('a wall between you and a target blocks the shot', () => {
    const level: LevelDef = {
      name: 'occlusion',
      boxes: [
        { tag: 'floor', min: vec3(-10, -1, -10), max: vec3(10, 0, 10) },
        { tag: 'wall', min: vec3(-2, 0, -6), max: vec3(2, 4, -5) },
      ],
      spawn: { pos: vec3(0, 0, 0), yaw: 0 },
      targets: [{ pos: vec3(0, 1.62, -9) }],
    };
    const { world, run, count } = setup(level);
    run(4);
    run(1, { fire: true });
    expect(count('shotFired')).toBe(1);
    expect(count('targetHit')).toBe(0);
    expect(world.targets[0]!.hp).toBe(world.targets[0]!.maxHp);
  });
});

describe('determinism', () => {
  const script = (s: ReturnType<typeof setup>): void => {
    const t0 = s.world.targets[0]!;
    const pitch = Math.atan2(t0.pos.y - 1.62, 20);
    s.run(30, { moveZ: 1, moveX: 0.5, yaw: 0.2 });
    s.run(1, { jump: true });
    s.run(100, { moveZ: 0, moveX: 0, yaw: 0, pitch, fire: true });
    s.run(400, { fire: false, crouch: true, moveZ: -1 });
  };

  it('same seed + same inputs => identical state hash', () => {
    const a = setup(testRoom, 123);
    const b = setup(testRoom, 123);
    script(a);
    script(b);
    expect(a.world.hash()).toBe(b.world.hash());
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('reset() restores the exact initial state', () => {
    const a = setup(testRoom, 9);
    const initial = a.world.hash();
    script(a);
    expect(a.world.hash()).not.toBe(initial);
    a.world.reset(9);
    expect(a.world.hash()).toBe(initial);
  });

  it('a different seed changes seeded outcomes (respawn jitter)', () => {
    const a = setup(testRoom, 1);
    const b = setup(testRoom, 2);
    for (const s of [a, b]) {
      s.run(4);
      const t0 = s.world.targets[0]!;
      s.run(TICK_RATE * 3, { pitch: Math.atan2(t0.pos.y - 1.62, 20), fire: true });
      s.run(TICK_RATE * 2, { fire: false });
    }
    expect(a.world.targets[0]!.pos.x).not.toBe(b.world.targets[0]!.pos.x);
  });
});
