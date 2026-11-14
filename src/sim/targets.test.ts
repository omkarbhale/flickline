import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { createTickInput, type LevelDef, type SimEvents, type TargetKind, type TickInput } from './types';
import { World } from './world';

const EVENTS = [
  'shotFired', 'shotImpact', 'targetSpawned', 'targetVisible', 'targetHit', 'targetKilled',
  'targetExpired', 'targetRespawned',
] as const;

/** An empty 40 m room with the player at the origin looking down -Z. */
const arena: LevelDef = {
  name: 'arena',
  boxes: [{ tag: 'floor', min: vec3(-40, -1, -40), max: vec3(40, 0, 40) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

function setup(level: LevelDef = arena, seed = 1) {
  const world = new World({ level, tunables: cloneTunables(), seed });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; data: Record<string, unknown> }[] = [];
  for (const type of EVENTS) bus.on(type, (e) => log.push({ type, data: JSON.parse(JSON.stringify(e)) }));
  const input: TickInput = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) world.step(input, bus);
  };
  const of = (type: keyof SimEvents): Record<string, unknown>[] => log.filter((l) => l.type === type).map((l) => l.data);
  const spawn = (kind: TargetKind, x: number, y: number, z: number, opts?: { crouched?: boolean; lifetimeSec?: number }): number =>
    world.spawnTarget(kind, x, y, z, bus, opts);
  /** Aim at a world point from the eye (yaw/pitch in radians). */
  const aimAt = (x: number, y: number, z: number): { yaw: number; pitch: number } => {
    const p = world.player;
    const dx = x - p.pos.x, dy = y - (p.pos.y + p.eyeHeight), dz = z - p.pos.z;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / Math.hypot(dx, dy, dz)) };
  };
  return { world, bus, log, input, run, of, spawn, aimAt };
}

/** Kestrel (the default primary) fires every 1/11 s = 11.6 ticks; 13 ticks always covers one shot. */
const FIRE_TICKS = 13;
/** Ticks from the first to the third bullet of a held Kestrel burst (shots at 0, 12, 24). */
const THIRD_SHOT_TICKS = Math.ceil((2 * TICK_RATE) / cloneTunables().weapon.kestrel.fireRateHz);

describe('spawning and the registry', () => {
  it('spawnTarget places a Post and a Beacon and emits targetSpawned with the roster data', () => {
    const s = setup();
    s.run(4);
    const post = s.spawn('post', 0, 0, -10);
    const beacon = s.spawn('beacon', 3, 1.5, -12);
    expect(post).toBe(0);
    expect(beacon).toBe(1);
    const ev = s.of('targetSpawned');
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ targetId: 0, kind: 'post', tags: ['echo', 'static'], pos: { x: 0, y: 0, z: -10 } });
    expect(ev[1]).toMatchObject({ targetId: 1, kind: 'beacon', pos: { x: 3, y: 1.5, z: -12 } });
    expect(s.world.targetField.aliveCount).toBe(2);
    expect(s.world.targetField.byId(1)!.hp).toBe(100);
  });

  it('ids are unique even when slots are reused', () => {
    const s = setup();
    const a = s.spawn('beacon', 0, 1.6, -10);
    s.world.despawnTarget(a, s.bus);
    const b = s.spawn('beacon', 0, 1.6, -10);
    expect(b).not.toBe(a);
    expect(s.world.targets[0]!.id).toBe(b); // same slot, new id
  });

  it('returns -1 when the registry is full', () => {
    const s = setup();
    const n = s.world.tunables.targets.maxTargets;
    for (let i = 0; i < n; i++) expect(s.spawn('beacon', 0, 1.6, -10)).toBe(i);
    expect(s.spawn('beacon', 0, 1.6, -10)).toBe(-1);
  });

  it('a lifetime expires the target: targetExpired, slot freed, no respawn', () => {
    const s = setup();
    const id = s.spawn('beacon', 0, 1.62, -10, { lifetimeSec: 0.5 });
    s.run(TICK_RATE / 2 - 2);
    expect(s.of('targetExpired')).toHaveLength(0);
    s.run(3);
    const ex = s.of('targetExpired');
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ targetId: id, kind: 'beacon' });
    expect(s.world.targetField.aliveCount).toBe(0);
    s.run(TICK_RATE * 3);
    expect(s.world.targetField.aliveCount).toBe(0);
  });

  it('despawnTarget emits targetExpired and reports unknown ids', () => {
    const s = setup();
    const id = s.spawn('post', 0, 0, -10);
    expect(s.world.despawnTarget(id, s.bus)).toBe(true);
    expect(s.world.despawnTarget(id, s.bus)).toBe(false);
    expect(s.of('targetExpired')).toHaveLength(1);
  });

  it('level-placed targets come back after a kill; spawned ones do not', () => {
    const level: LevelDef = { ...arena, targets: [{ kind: 'beacon', pos: vec3(0, 1.62, -10) }] };
    const s = setup(level);
    const loose = s.spawn('beacon', 5, 1.62, -10);
    s.run(1, s.aimAt(0, 1.62, -10));
    s.run(1, { fire: true });
    expect(s.of('targetKilled')).toHaveLength(1);
    s.run(1, { fire: false });
    s.run(TICK_RATE * 2);
    expect(s.of('targetRespawned')).toHaveLength(1);
    expect(s.world.targetField.byId(loose)).not.toBeNull();
    expect(s.world.targetField.aliveCount).toBe(2);
  });
});

describe('kill events and bullet counts (health.max 100, Kestrel damage)', () => {
  it('a Kestrel headshot kills in one bullet', () => {
    const s = setup();
    const id = s.spawn('post', 0, 0, -10);
    s.run(1, s.aimAt(0, 1.66, -10));
    s.run(1, { fire: true });
    const hit = s.of('targetHit');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ targetId: id, kind: 'post', zone: 'head', damage: 156, hpLeft: 0, killed: true });
    const kill = s.of('targetKilled');
    expect(kill).toHaveLength(1);
    expect(kill[0]).toMatchObject({ targetId: id, kind: 'post', zone: 'head', bullets: 1, firstBullet: true, clean: true, ttkMs: 0 });
    expect(s.world.targetField.byId(id)).toBeNull(); // removed
  });

  it('three body bullets kill (39 + 39 + 39 >= 100), two do not', () => {
    const s = setup();
    const id = s.spawn('post', 0, 0, -10);
    s.run(1, s.aimAt(0, 1.2, -10));
    s.run(1, { fire: true });
    s.run(FIRE_TICKS);
    expect(s.of('targetKilled')).toHaveLength(0);
    expect(s.of('targetHit').map((h) => h.hpLeft)).toEqual([61, 22]);
    expect(s.of('targetHit').every((h) => h.zone === 'body' && h.damage === 39 && h.killed === false)).toBe(true);
    s.run(FIRE_TICKS);
    s.input.fire = false;
    const kill = s.of('targetKilled');
    expect(kill).toHaveLength(1);
    expect(kill[0]).toMatchObject({ targetId: id, zone: 'body', bullets: 3, firstBullet: false, clean: true });
    // Held fire at 11 rps lands the third bullet 24 ticks after the first.
    expect(kill[0]!.ttkMs).toBeCloseTo(THIRD_SHOT_TICKS * TICK_DT * 1000, 6);
  });

  it('legs take four bullets (3 x 33.15 = 99.45)', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10);
    s.run(1, s.aimAt(0, 0.4, -10));
    s.run(1, { fire: true });
    s.run(FIRE_TICKS * 3);
    s.input.fire = false;
    expect(s.of('targetHit').map((h) => h.zone)).toEqual(['leg', 'leg', 'leg', 'leg']);
    expect(s.of('targetKilled')).toHaveLength(1);
    expect((s.of('targetKilled')[0]!).bullets).toBe(4);
  });

  it('a crouched Post is hit by crouched zones: standing head height misses, crouched head hits', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10, { crouched: true });
    s.run(1, s.aimAt(0, 1.66, -10));
    s.run(1, { fire: true });
    expect(s.of('targetHit')).toHaveLength(0);
    s.run(FIRE_TICKS + 1, { fire: false, ...s.aimAt(0, 1.16, -10) });
    s.run(1, { fire: true });
    expect(s.of('targetHit')[0]).toMatchObject({ zone: 'head', killed: true });
  });

  it('a Beacon dies to any hit on the orb (head-zone damage)', () => {
    const s = setup();
    s.spawn('beacon', 0, 1.5, -10);
    // Off-centre but inside the 0.14 m orb by more than the 0.2 deg first-shot cone (3.5 cm at 10 m).
    s.run(1, s.aimAt(0.1, 1.5, -10));
    s.run(1, { fire: true });
    expect(s.of('targetKilled')[0]).toMatchObject({ kind: 'beacon', zone: 'head', bullets: 1 });
  });

  it('damage uses the band at the hit distance: 20 m body bullet is 39, 30 m is 35', () => {
    const s = setup();
    s.spawn('post', 0, 0, -20.2); // body front surface at 20 m (radius 0.25 -> entry at 19.95)
    s.spawn('post', 5, 0, -30);
    s.run(1, s.aimAt(0, 1.2, -20.2));
    s.run(1, { fire: true });
    expect((s.of('targetHit')[0]!).damage).toBe(39);
    s.run(FIRE_TICKS, { fire: false, ...s.aimAt(5, 1.2, -30) });
    s.run(1, { fire: true });
    expect((s.of('targetHit')[1]!).damage).toBe(35);
  });

  it('a miss at the target (inside 1 degree) makes the kill unclean and counts a bullet', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10);
    // 0.16 m over the head centre at 10 m = 0.9 degrees: misses the sphere (top at 1.80) but is "at" it.
    s.run(1, s.aimAt(0, 1.66 + 0.16, -10));
    s.run(1, { fire: true });
    expect(s.of('targetHit')).toHaveLength(0);
    s.run(FIRE_TICKS + 1, { fire: false, ...s.aimAt(0, 1.66, -10) });
    s.run(1, { fire: true });
    const kill = s.of('targetKilled')[0]!;
    expect(kill).toMatchObject({ bullets: 2, firstBullet: false, clean: false });
  });

  it('a stray shot far from the target is not "at" it', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10);
    s.run(1, { yaw: 0.6, pitch: 0 });
    s.run(1, { fire: true });
    s.run(FIRE_TICKS + 1, { fire: false, ...s.aimAt(0, 1.66, -10) });
    s.run(1, { fire: true });
    expect(s.of('targetKilled')[0]).toMatchObject({ bullets: 1, firstBullet: true, clean: true });
  });

  it('a moving shot (airborne or fast) makes the kill unclean', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10);
    s.run(1, { ...s.aimAt(0, 1.66, -10), moveX: 1 });
    s.run(60, { moveX: 1 });
    expect(Math.hypot(s.world.player.vel.x, s.world.player.vel.z)).toBeGreaterThan(5);
    s.run(1, { ...s.aimAt(0, 1.66, -10), fire: true }); // one tick of travel is ~4 cm: still on the head
    expect(s.of('targetKilled')).toHaveLength(1);
    expect(s.of('targetKilled')[0]!.clean).toBe(false);
  });

  it('rtMs counts from becoming visible to the first shot aimed within 5 degrees', () => {
    const s = setup();
    s.run(1, { yaw: 0.3 }); // looking away
    const id = s.spawn('post', 0, 0, -10);
    s.run(60); // 60 ticks with the target out of... in view? aim is 0.3 rad (17 deg) off: still inside the 103 deg frustum
    const vis = s.of('targetVisible');
    expect(vis).toHaveLength(1);
    expect(vis[0]).toMatchObject({ targetId: id });
    const visibleTick = vis[0]!.tick as number;
    // A stray shot 17 degrees off is not within 5 degrees: it must not stop the reaction clock.
    s.run(1, { fire: true });
    s.run(FIRE_TICKS + 20, { fire: false, ...s.aimAt(0, 1.66, -10) });
    const shotTick = s.world.tick + 1;
    s.run(1, { fire: true });
    const kill = s.of('targetKilled')[0]!;
    expect(kill.rtMs).toBeCloseTo((shotTick - visibleTick) * TICK_DT * 1000, 6);
    expect(kill.rtMs as number).toBeGreaterThan(60 * TICK_DT * 1000 - 1);
  });
});

describe('targetVisible', () => {
  it('fires once, on the first unoccluded tick in view; never again', () => {
    const s = setup();
    s.run(2);
    const id = s.spawn('beacon', 0, 1.62, -10);
    expect(s.of('targetVisible')).toHaveLength(0); // sim announces it on the next tick, not at spawn
    s.run(1);
    const vis = s.of('targetVisible');
    expect(vis).toEqual([expect.objectContaining({ targetId: id, tick: s.world.tick })]);
    s.run(100);
    expect(s.of('targetVisible')).toHaveLength(1);
  });

  it('is not emitted while the target is behind the player, then fires when they turn', () => {
    const s = setup();
    s.spawn('beacon', 0, 1.62, 10);
    s.run(30);
    expect(s.of('targetVisible')).toHaveLength(0);
    s.run(1, { yaw: Math.PI });
    expect(s.of('targetVisible')).toHaveLength(1);
  });

  it('is not emitted while a wall blocks the eye, then fires once the line clears', () => {
    const level: LevelDef = {
      ...arena,
      boxes: [...arena.boxes, { tag: 'wall', min: vec3(-3, 0, -6), max: vec3(3, 5, -5) }],
    };
    const s = setup(level);
    s.spawn('post', 0, 0, -12);
    s.run(30);
    expect(s.of('targetVisible')).toHaveLength(0);
    s.run(1, { moveX: 1 });
    s.run(TICK_RATE * 2, { moveX: 1 });
    expect(s.world.player.pos.x).toBeGreaterThan(3);
    expect(s.of('targetVisible')).toHaveLength(1);
  });

  it('a hit announces visibility first, so targetVisible always precedes targetHit', () => {
    const s = setup();
    s.spawn('post', 0, 0, -10);
    s.run(1, s.aimAt(0, 1.2, -10));
    s.run(1, { fire: true });
    const order = s.log.filter((l) => l.type === 'targetVisible' || l.type === 'targetHit').map((l) => l.type);
    expect(order[0]).toBe('targetVisible');
    expect(order.filter((t) => t === 'targetVisible')).toHaveLength(1);
  });
});

describe('determinism', () => {
  const script = (s: ReturnType<typeof setup>): void => {
    s.run(10);
    s.spawn('post', 2, 0, -10);
    s.spawn('beacon', -2, 1.5, -14, { lifetimeSec: 1 });
    s.run(1, s.aimAt(2, 1.2, -10));
    s.run(40, { fire: true });
    s.run(1, { fire: false, ...s.aimAt(-2, 1.5, -14) });
    s.run(1, { fire: true });
    s.run(TICK_RATE * 3, { fire: false });
  };

  it('same seed + inputs => same hash and event stream; a different seed differs (sway)', () => {
    const a = setup(arena, 11);
    const b = setup(arena, 11);
    const c = setup(arena, 12);
    for (const s of [a, b, c]) {
      script(s);
      s.spawn('post', 6, 0, -10);
      s.run(TICK_RATE * 8);
    }
    expect(a.world.hash()).toBe(b.world.hash());
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(c.world.hash()).not.toBe(a.world.hash());
  });

  it('reset() clears spawned targets and restores the initial hash', () => {
    const s = setup(arena, 3);
    const initial = s.world.hash();
    script(s);
    expect(s.world.hash()).not.toBe(initial);
    s.world.reset(3);
    expect(s.world.hash()).toBe(initial);
    expect(s.world.targetField.aliveCount).toBe(0);
  });
});

describe('Beacon scale (design §9.4: ×3.0 → ×1.0 of real head size)', () => {
  it('scales the orb radius for hit detection and the bounding sphere; humanoids ignore it', () => {
    const { world, bus, run } = setup();
    // 10 m ahead, level with the eye; aim 0.3 m off to the side: misses a ×1 orb (0.14 m), hits a ×3 one (0.42 m).
    const eyeY = world.player.pos.y + world.player.eyeHeight;
    const small = world.spawnTarget('beacon', 0.3, eyeY, -10, bus, { scale: 1 });
    run(1);
    expect(world.targetField.byId(small)!.radius).toBeCloseTo(0.14, 9);
    expect(world.targetField.byId(small)!.scale).toBe(1);
    world.despawnTarget(small, bus);
    const big = world.spawnTarget('beacon', 0.3, eyeY, -10, bus, { scale: 3 });
    expect(world.targetField.byId(big)!.radius).toBeCloseTo(0.42, 9);
    const post = world.spawnTarget('post', 5, 0, -10, bus, { scale: 3 });
    expect(world.targetField.byId(post)!.scale).toBe(1);
  });

  it('a shot that grazes the scaled orb hits it, the same shot misses the real-size one', () => {
    for (const [scale, expectHit] of [[1, false], [3, true]] as const) {
      const { world, bus, log, run } = setup();
      const eyeY = world.player.pos.y + world.player.eyeHeight;
      world.spawnTarget('beacon', 0.3, eyeY, -10, bus, { scale });
      run(1, { fire: true });
      expect(log.filter((l) => l.type === 'targetHit')).toHaveLength(expectHit ? 1 : 0);
    }
  });
});

describe('player lock and instant weapon select (mode support)', () => {
  it('movementLocked ignores movement, jump and crouch but keeps look and fire', () => {
    const { world, run } = setup();
    world.movementLocked = true;
    run(64, { moveZ: 1, moveX: 1, jump: true, crouch: false, yaw: 0.5, pitch: 0.1 });
    expect(world.player.pos.x).toBe(0);
    expect(world.player.pos.z).toBe(0);
    expect(world.player.yaw).toBeCloseTo(0.5, 9);
    expect(world.player.pitch).toBeCloseTo(0.1, 9);
    world.movementLocked = false;
    run(64, { moveZ: 1, moveX: 0, jump: false, yaw: 0, pitch: 0 });
    expect(world.player.pos.z).toBeLessThan(-1);
  });

  it('equipWeapon puts the weapon in hand at once with a fresh spray, and refuses unknown ones', () => {
    const { world } = setup();
    expect(world.weapon.slots[world.weapon.active]!.id).toBe('kestrel');
    expect(world.equipWeapon('pace')).toBe(true);
    expect(world.weapon.slots[world.weapon.active]!.id).toBe('pace');
    expect(world.weapon.equipLeft).toBe(0);
    expect(world.weapon.sprayCount).toBe(0);
    expect(world.equipWeapon('nope' as never)).toBe(false);
  });

  it('placePlayer stands the player at rest, level, facing yaw', () => {
    const { world } = setup();
    world.player.vel.x = 5;
    world.player.pitch = 0.4;
    world.placePlayer(3, 0, -2, 1);
    expect(world.player.pos).toEqual({ x: 3, y: 0, z: -2 });
    expect(world.player.prevPos).toEqual({ x: 3, y: 0, z: -2 });
    expect(world.player.vel.x).toBe(0);
    expect(world.player.yaw).toBe(1);
    expect(world.player.pitch).toBe(0);
  });
});
