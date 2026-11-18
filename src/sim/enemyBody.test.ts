import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { zoneDamage } from './damage';
import { commandLookAt, commandMoveToward } from './enemyBody';
import { createTickInput, type EnemyCommand, type LevelDef, type SimEvents, type TargetState, type TickInput } from './types';
import { World } from './world';

const floor = { tag: 'floor' as const, min: vec3(-200, -1, -200), max: vec3(200, 0, 200) };
const arena = (extra: LevelDef['boxes'] = []): LevelDef => ({
  name: 'arena',
  boxes: [floor, ...extra],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
});

// `EnemyCommand` is `TickInput` in shape, both ways (#87): a compile-time check.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameShape: Same<EnemyCommand, TickInput> = true;

/** A world with the player at `player` and one Post at `echo`, its body driven by the test (the FSM never runs). */
function setup(seed = 1, player: [number, number, number] = [0, 0, 20], echo: [number, number, number] = [0, 0, 0], level = arena()) {
  const tun = cloneTunables();
  const world = new World({ level, tunables: tun, seed });
  const bus = new EventBus<SimEvents>();
  world.placePlayer(player[0], player[1], player[2], 0);
  const id = world.spawnTarget('post', echo[0], echo[1], echo[2], bus);
  const t = world.targetField.byId(id)!;
  t.body.driven = true;
  return { tun, world, bus, t, input: createTickInput() };
}

const speedOf = (v: { x: number; z: number }): number => Math.hypot(v.x, v.z);

/** Run right for 1 s, then let go: the horizontal speed after every tick of the release, for the player and for an Echo. */
function releaseTraces(): { player: number[]; echo: number[]; runSpeed: number } {
  // The player: the strafe key, then nothing.
  const a = setup(3, [0, 0, 0], [50, 0, 50]);
  a.world.step(a.input, a.bus); // land
  const player: number[] = [];
  a.input.moveX = 1;
  for (let i = 0; i < TICK_RATE; i++) a.world.step(a.input, a.bus);
  a.input.moveX = 0;
  for (let i = 0; i < TICK_RATE / 2; i++) {
    a.world.step(a.input, a.bus);
    player.push(speedOf(a.world.player.vel));
  }
  // The Echo: the same command stream, through its body.
  const b = setup(3, [0, 0, 30], [0, 0, 0]);
  const cmd = b.t.body.cmd;
  cmd.yaw = 0;
  cmd.moveX = 1;
  for (let i = 0; i < TICK_RATE; i++) b.world.step(b.input, b.bus);
  cmd.moveX = 0;
  const echo: number[] = [];
  for (let i = 0; i < TICK_RATE / 2; i++) {
    b.world.step(b.input, b.bus);
    echo.push(speedOf(b.t.body.kin.vel));
  }
  return { player, echo, runSpeed: a.tun.weapon.kestrel.runSpeedMps };
}

describe('the shared body (#87): an Echo moves through the player\'s movement code', () => {
  it('EnemyCommand has TickInput\'s shape', () => {
    expect(sameShape).toBe(true);
  });

  it('released from a rifle run, an Echo reaches the accuracy gate at 0.100 s and stops at 0.16 s, tick for tick the player\'s trace', () => {
    const { player, echo, runSpeed } = releaseTraces();
    expect(echo).toEqual(player);
    const tun = cloneTunables();
    const gate = tun.weapon.kestrel.deadzoneFraction * runSpeed;
    const gateSec = (echo.findIndex((v) => v <= gate) + 1) * TICK_DT;
    const stopSec = (echo.findIndex((v) => v === 0) + 1) * TICK_DT;
    expect(Math.abs(gateSec - 0.1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(stopSec - 0.16)).toBeLessThanOrEqual(TICK_DT);
  });

  it('collides with the level, crouches and jumps like the player', () => {
    const { world, bus, t, input } = setup(1, [0, 0, 20], [0, 0, 0], arena([{ tag: 'wall', min: vec3(2, 0, -2), max: vec3(3, 3, 2) }]));
    const b = t.body;
    b.cmd.yaw = 0;
    b.cmd.moveX = 1;
    for (let i = 0; i < TICK_RATE; i++) world.step(input, bus);
    // Stopped by the wall at x = 2 (less the hull's half width), not through it.
    expect(t.pos.x).toBeLessThan(2);
    expect(t.pos.x).toBeGreaterThan(1.5);
    b.cmd.moveX = 0;
    b.cmd.crouch = true;
    for (let i = 0; i < TICK_RATE / 2; i++) world.step(input, bus);
    expect(t.crouched).toBe(true);
    expect(b.kin.eyeHeight).toBeCloseTo(world.tunables.movement.crouchEyeHeight, 9);
    b.cmd.crouch = false;
    b.cmd.jump = true;
    world.step(input, bus);
    expect(b.kin.grounded).toBe(false);
    expect(b.cmd.jump).toBe(false); // an edge: consumed by the tick
    let apex = 0;
    for (let i = 0; i < TICK_RATE; i++) {
      world.step(input, bus);
      apex = Math.max(apex, t.pos.y);
    }
    expect(apex).toBeCloseTo(world.tunables.movement.jumpApex, 2);
    expect(b.kin.grounded).toBe(true);
  });

  it('keeps prev* copies for rendering in the slot itself: pos and prevPos are the body\'s', () => {
    const { world, bus, t, input } = setup();
    expect(t.body.kin.pos).toBe(t.pos);
    expect(t.body.kin.prevPos).toBe(t.prevPos);
    t.body.cmd.moveZ = 1;
    for (let i = 0; i < 20; i++) {
      const x = t.pos.x, z = t.pos.z;
      world.step(input, bus);
      expect(t.prevPos.x).toBe(x);
      expect(t.prevPos.z).toBe(z);
    }
    expect(speedOf(t.body.kin.vel)).toBeGreaterThan(1);
  });

  it('a Strafer\'s steering is a command: it faces the player and holds the key along its lane', () => {
    const { world, bus, input } = setup();
    const id = world.spawnTarget('strafer', 0, 0, 0, bus, { strafe: { speed: 3, legSec: 1, standStillSec: 0.3, laneA: vec3(-5, 0, 0), laneB: vec3(5, 0, 0) } });
    const s = world.targetField.byId(id)!;
    for (let i = 0; i < 40; i++) {
      world.step(input, bus);
      const c = s.body.cmd;
      if (c.moveX === 0 && c.moveZ === 0) continue; // a stop: no key held
      // Written before this tick's move: the view at the player from where it stood then.
      const p = world.player.pos;
      expect(c.yaw).toBeCloseTo(Math.atan2(-(p.x - s.prevPos.x), -(p.z - s.prevPos.z)), 9);
      // The keys it holds run along the lane (+-X), whatever the view.
      const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
      expect(Math.abs(c.moveX * cos - c.moveZ * sin)).toBeCloseTo(1, 9);
      expect(-c.moveX * sin - c.moveZ * cos).toBeCloseTo(0, 9);
    }
    expect(speedOf(s.body.kin.vel)).toBeGreaterThan(0);
  });
});

/** One Echo shot at the player's chest from `dist` metres, standing still: its event and the damage. */
function chestShot(dist: number, wall = false) {
  const level = arena(wall ? [{ tag: 'wall', min: vec3(-2, 0, dist / 2), max: vec3(2, 3, dist / 2 + 0.2) }] : []);
  const f = setup(5, [0, 0, dist], [0, 0, 0], level);
  const fired: { hit: boolean; id: number }[] = [];
  const damage: { amount: number; absorbed: number; zone: string; sourceId: number }[] = [];
  f.bus.on('enemyFired', (e) => fired.push({ hit: e.hit, id: e.id }));
  f.bus.on('playerDamaged', (e) => damage.push({ amount: e.amount, absorbed: e.absorbed, zone: e.zone, sourceId: e.sourceId }));
  const shotFired: number[] = [];
  f.bus.on('shotFired', (e) => shotFired.push(e.tick));
  for (let i = 0; i < 10; i++) f.world.step(f.input, f.bus);
  const p = f.world.player;
  const chestY = p.pos.y + (f.tun.targets.hit.torsoBottomStand + f.tun.targets.hit.torsoTopStand) / 2;
  commandLookAt(f.t.body, p.pos.x, chestY, p.pos.z);
  f.t.body.cmd.fire = true;
  f.world.step(f.input, f.bus);
  f.t.body.cmd.fire = false;
  const eye = f.t.body.kin;
  const range = Math.hypot(p.pos.x - eye.pos.x, p.pos.y + p.eyeHeight - (eye.pos.y + eye.eyeHeight), p.pos.z - eye.pos.z);
  return { f, fired, damage, shotFired, range };
}

describe('an Echo\'s shots go through the player\'s weapon code (#87)', () => {
  it('a still first shot at the chest hits the body zone for the gun\'s body damage at that range', () => {
    for (const dist of [8, 25, 45]) {
      const { f, fired, damage, shotFired, range } = chestShot(dist);
      expect(fired, `${dist} m`).toEqual([{ hit: true, id: f.t.id }]);
      expect(damage).toHaveLength(1);
      expect(damage[0]!.zone).toBe('body');
      expect(damage[0]!.sourceId).toBe(f.t.id);
      expect(damage[0]!.amount + damage[0]!.absorbed).toBeCloseTo(zoneDamage(f.tun.weapon.kestrel.damageBands, 'body', range), 9);
      // An Echo's shot is not the player's: no `shotFired`, and its own magazine paid for it.
      expect(shotFired).toHaveLength(0);
      expect(f.t.body.weapon.slots[0]!.mag).toBe(f.tun.weapon.kestrel.magazine - 1);
    }
  });

  it('a wall between them stops the bullet (spec: bullets obey the same wall rules, F3)', () => {
    const { fired, damage } = chestShot(10, true);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.hit).toBe(false);
    expect(damage).toHaveLength(0);
  });

  it('fires at the gun\'s rate and recoils like the player\'s spray, and reloads an empty magazine', () => {
    const { world, bus, t, input, tun } = setup(2, [0, 0, 15]);
    const shots: number[] = [];
    bus.on('enemyFired', (e) => shots.push(e.tick));
    // Away from the player (behind it at +Z), so the test is not cut short by a kill.
    t.body.cmd.yaw = 0;
    t.body.cmd.fire = true;
    const worldDraws = world.rng.getState();
    for (let i = 0; i < TICK_RATE; i++) world.step(input, bus);
    // Its spread and recoil came from its own aim stream (#86), not the world's.
    expect(world.rng.getState()).toBe(worldDraws);
    const def = tun.weapon.kestrel;
    expect(shots.length).toBe(Math.ceil(def.fireRateHz));
    expect(t.body.weapon.recoilPitch).toBeGreaterThan(0);
    for (let i = 0; i < TICK_RATE * 5; i++) world.step(input, bus);
    // A 30-round magazine empties in under 3 s at 11 Hz, then a 2.5 s reload: more than one magazine fired.
    expect(shots.length).toBeGreaterThan(def.magazine);
  });

  it('a moving Echo\'s shot has exactly the moving player\'s error (same state, same draws, same command)', () => {
    /**
     * Both sides run right for `runTicks`, then fire one shot looking down -Z; returns the bullet
     * direction. An Echo's gun draws from its own decision stream (#86): the player's shot is given the
     * same numbers by starting the world's stream where that Echo's stream is.
     */
    const echoAimState = new Map<number, number>();
    const shoot = (side: 'player' | 'echo', runTicks: number): { x: number; y: number; z: number } => {
      // The player stands where the Echo would be and vice versa, so neither is in the other's line of fire.
      const s = setup(9, side === 'player' ? [0, 0, 0] : [0, 0, 40], side === 'player' ? [0, 0, 40] : [0, 0, 0]);
      const out = vec3();
      s.bus.on('shotFired', (e) => { out.x = e.dir.x; out.y = e.dir.y; out.z = e.dir.z; });
      s.bus.on('enemyFired', (e) => { out.x = e.dir.x; out.y = e.dir.y; out.z = e.dir.z; });
      s.world.step(s.input, s.bus); // the player lands
      const cmd = side === 'player' ? s.input : s.t.body.cmd;
      cmd.yaw = 0;
      cmd.pitch = 0;
      cmd.moveX = 1;
      for (let i = 0; i < runTicks; i++) s.world.step(s.input, s.bus);
      if (side === 'echo') echoAimState.set(runTicks, s.t.streams.decisions.getState());
      else s.world.rng.setState(echoAimState.get(runTicks)!);
      cmd.fire = true;
      s.world.step(s.input, s.bus);
      return out;
    };
    for (const runTicks of [0, 6, 64]) {
      const e = shoot('echo', runTicks);
      const p = shoot('player', runTicks);
      expect(e.x, `${runTicks} ticks`).toBeCloseTo(p.x, 12);
      expect(e.y).toBeCloseTo(p.y, 12);
      expect(e.z).toBeCloseTo(p.z, 12);
    }
    // ... and the error is real: running, the bullet leaves the view axis (-Z) by far more than a still first shot.
    const off = (d: { x: number; y: number; z: number }): number => Math.acos(Math.min(1, -d.z)) * (180 / Math.PI);
    expect(off(shoot('echo', 64))).toBeGreaterThan(5 * off(shoot('echo', 0)) + 0.5);
  });

  it('commandMoveToward turns a world direction into keys under the command\'s view', () => {
    const { t } = setup();
    const c = t.body.cmd;
    c.yaw = 0; // looking down -Z: right is +X
    commandMoveToward(t.body, 1, 0);
    expect(c.moveX).toBeCloseTo(1, 12);
    expect(c.moveZ).toBeCloseTo(0, 12);
    commandMoveToward(t.body, 0, -1);
    expect(c.moveX).toBeCloseTo(0, 12);
    expect(c.moveZ).toBeCloseTo(1, 12);
    c.yaw = Math.PI / 2; // looking down -X: forward is -X, right is -Z
    commandMoveToward(t.body, 0, -1);
    expect(c.moveX).toBeCloseTo(1, 12);
    expect(c.moveZ).toBeCloseTo(0, 12);
  });

  it('a respawned slot gets a fresh body: at rest, full magazine, keys released, behaviour back in charge', () => {
    const { world, bus, t, input, tun } = setup();
    t.body.cmd.fire = true;
    t.body.cmd.moveX = 1;
    for (let i = 0; i < 30; i++) world.step(input, bus);
    world.despawnTarget(t.id, bus);
    const id = world.spawnTarget('post', 3, 0, 3, bus);
    const u: TargetState = world.targetField.byId(id)!;
    expect(u).toBe(t); // the same slot, reused
    expect(u.body.driven).toBe(false);
    expect(u.body.cmd.fire).toBe(false);
    expect(u.body.cmd.moveX).toBe(0);
    expect(speedOf(u.body.kin.vel)).toBe(0);
    expect(u.body.weapon.slots[0]!.mag).toBe(tun.weapon.kestrel.magazine);
    expect(u.body.weapon.sprayCount).toBe(0);
  });
});
