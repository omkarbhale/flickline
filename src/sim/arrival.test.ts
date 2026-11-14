import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import { fireParams, straferParams } from './enemyParams';
import { PEEK_ARRIVE, PEEK_HIDDEN } from './peeker';
import { STRAFER_ARRIVE, STRAFER_LEG } from './strafer';
import { createTickInput, type BoxDef, type LevelDef, type SimEvents } from './types';
import { walkReach } from './arrival';
import { World } from './world';

const FLOOR: BoxDef = { tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) };

function arena(extra: BoxDef[] = [], spawn = vec3(0, 0, 0)): LevelDef {
  return { name: 'arena', boxes: [FLOOR, ...extra], spawn: { pos: spawn, yaw: 0 }, targets: [] };
}

/** A world with enemies firing, the player at `at` looking along `yaw` (0 = -Z). */
function setup(level: LevelDef, seed = 3) {
  const tun = cloneTunables();
  const world = new World({ level, tunables: tun, seed });
  world.enemiesFire = true;
  const bus = new EventBus<SimEvents>();
  const input = createTickInput();
  return { tun, world, bus, input };
}

const P = (x: number, z: number): Vec3 => vec3(x, 0, z);

describe('arrivals (design §4.2, §9.3: hold sectors)', () => {
  it('a Strafer spawns at the first route point, walks the route at its speed and hands over to its legs at the end', () => {
    const { world, bus, input } = setup(arena([], vec3(0, 0, 60)));
    const id = world.spawnTarget('strafer', 0, 0, 0, bus, {
      strafe: straferParams(axes(50)),
      arrive: { route: [P(-20, -20), P(-20, 0), P(0, 0)], speed: 4, engageM: 0.5 },
    });
    const t = world.targetField.byId(id)!;
    expect(t.pos.x).toBe(-20);
    expect(t.pos.z).toBe(-20);
    expect(t.fsm.state).toBe(STRAFER_ARRIVE);
    expect(t.ai.arriving).toBe(true);
    let ticks = 0;
    while (t.ai.arriving && ticks < 128 * 30) {
      world.step(input, bus);
      ticks++;
    }
    // 20 m + 20 m at 4 m/s = 10 s.
    expect(ticks / 128).toBeGreaterThan(9.9);
    expect(ticks / 128).toBeLessThan(10.2);
    expect(Math.hypot(t.pos.x - 0, t.pos.z - 0)).toBeLessThan(0.1);
    expect(t.fsm.state).toBe(STRAFER_LEG);
  });

  it('a Peeker walks to its cover, stands up for the walk, and starts hidden at the hold position', () => {
    const { world, bus, input } = setup(arena([], vec3(0, 0, 80)));
    const id = world.spawnTarget('peeker', 0, 0, 0, bus, {
      crouched: true,
      peek: { pattern: 'wide', hold: P(10, -10), out: P(12, -10) },
      fire: fireParams(axes(50)),
      arrive: { route: [P(10, -40), P(10, -10)], speed: 3, engageM: 9 },
    });
    const t = world.targetField.byId(id)!;
    expect(t.fsm.state).toBe(PEEK_ARRIVE);
    expect(t.crouched).toBe(false);
    for (let k = 0; k < 128 * 12 && t.ai.arriving; k++) world.step(input, bus);
    expect(t.ai.arriving).toBe(false);
    expect(t.fsm.state).toBe(PEEK_HIDDEN);
    expect(t.pos.x).toBeCloseTo(10, 6);
    expect(t.pos.z).toBeCloseTo(-10, 6);
    expect(t.crouched).toBe(true);
  });

  it('a Strafer stops at the spawn floors and fights: 4 m anywhere, 5 m in the view cone (design §9.3.5)', () => {
    for (const [name, fromZ, minD] of [['in view', -40, 5], ['behind', 40, 4]] as const) {
      const { tun, world, bus, input } = setup(arena());
      const id = world.spawnTarget('strafer', 0, 0, fromZ, bus, {
        strafe: straferParams(axes(50)),
        // It would walk right through the player.
        arrive: { route: [P(0, fromZ), P(0, -fromZ)], speed: 5, engageM: 0.1 },
      });
      const t = world.targetField.byId(id)!;
      let min = Infinity;
      for (let k = 0; k < 128 * 20 && t.ai.arriving; k++) {
        world.step(input, bus);
        min = Math.min(min, Math.hypot(t.pos.x - world.player.pos.x, t.pos.z - world.player.pos.z));
      }
      expect(t.ai.arriving, name).toBe(false);
      expect(min, name).toBeGreaterThanOrEqual(minD - 1e-6);
      expect(min, name).toBeLessThan(minD + 0.2);
      expect(tun.dial.floors.spawnMinDistance).toBe(4);
    }
  });

  it('a Peeker whose way is blocked by the floor waits where it is; once the player has moved off it goes on', () => {
    const { world, bus, input } = setup(arena());
    const id = world.spawnTarget('peeker', 0, 0, 0, bus, {
      peek: { pattern: 'wide', hold: P(0, 20), out: P(2, 20) },
      fire: fireParams(axes(50)),
      arrive: { route: [P(0, -30), P(0, 20)], speed: 5, engageM: 9 },
    });
    const t = world.targetField.byId(id)!;
    for (let k = 0; k < 128 * 10; k++) world.step(input, bus);
    const z = t.pos.z;
    expect(t.ai.arriving).toBe(true);
    expect(Math.hypot(t.pos.x, t.pos.z)).toBeGreaterThanOrEqual(4 - 1e-6);
    for (let k = 0; k < 128 * 2; k++) world.step(input, bus);
    expect(t.pos.z).toBe(z); // still waiting
    world.placePlayer(0, 0, 50, 0);
    for (let k = 0; k < 128 * 20 && t.ai.arriving; k++) world.step(input, bus);
    expect(t.ai.arriving).toBe(false);
    expect(t.pos.z).toBeCloseTo(20, 6);
  });

  it('walking is silent and running is not: the sim counts audible steps (`audibleTick`) from runs within the audible range only', () => {
    const { tun } = setup(arena());
    const silent = tun.audio.enemy.silentMps;
    /** A walker 5 m from a player who is `playerX` metres along X, on a 25 m route, for up to 5 s. */
    const walker = (speed: number, playerX: number) => {
      const { world, bus, input } = setup(arena([], vec3(0, 0, 100)));
      const id = world.spawnTarget('strafer', 0, 40, 0, bus, {
        strafe: straferParams(axes(50)),
        arrive: { route: [P(40, 0), P(40, 25)], speed, engageM: 0.1 },
      });
      const t = world.targetField.byId(id)!;
      world.placePlayer(playerX, 0, 25, Math.PI);
      for (let k = 0; k < 128 * 5 && t.ai.arriving; k++) world.step(input, bus);
      return t;
    };
    expect(walker(silent - 0.2, 55).ai.audibleTick, 'a walk, 15 m away').toBe(-1);
    expect(walker(silent + 0.5, 55).ai.audibleTick, 'a run, 15 m away').toBeGreaterThan(0);
    expect(walker(silent + 2, 40 + tun.audio.enemy.maxAudibleM + 20).ai.audibleTick, 'a run, out of earshot').toBe(-1);
  });

  it('an arrival never starts a contact before the player has seen it or heard it: the player looks away, a walking Strafer does not fire, then it runs its legs and is heard', () => {
    const { world, bus, input } = setup(arena());
    const fired: { tick: number }[] = [];
    bus.on('enemyFired', (e) => fired.push({ tick: e.tick }));
    // It walks to 10 m in front of the player, who looks the other way.
    const id = world.spawnTarget('strafer', 0, 0, -30, bus, {
      strafe: straferParams(axes(100)),
      fire: fireParams(axes(100)),
      arrive: { route: [P(0, -30), P(0, -10)], speed: 2.4, engageM: 12 },
    });
    const t = world.targetField.byId(id)!;
    input.yaw = Math.PI;
    const firedAtInformed: { tick: number; informed: boolean }[] = [];
    bus.on('enemyFired', (e) => firedAtInformed.push({ tick: e.tick, informed: t.visibleTick >= 0 || t.ai.audibleTick >= 0 }));
    for (let k = 0; k < 128 * 25; k++) world.step(input, bus);
    expect(t.ai.arriving).toBe(false);
    expect(t.visibleTick).toBe(-1); // never in his view
    // Its first sound came from running its legs, then it fought; nothing it fired was a surprise.
    expect(t.ai.audibleTick).toBeGreaterThan(0);
    expect(fired.length).toBeGreaterThan(0);
    expect(firedAtInformed.every((f) => f.informed)).toBe(true);
    expect(fired[0]!.tick).toBeGreaterThanOrEqual(t.ai.audibleTick);
  });

  it('an arrival that comes into the player\'s view may fight at once (seen = informed)', () => {
    const { world, bus, input } = setup(arena());
    let first = -1;
    bus.on('enemyFired', (e) => { if (first < 0) first = e.tick; });
    const id = world.spawnTarget('strafer', 0, 0, -30, bus, {
      strafe: straferParams(axes(100)),
      fire: fireParams(axes(100)),
      arrive: { route: [P(0, -30), P(0, -10)], speed: 2.4, engageM: 12 },
    });
    const t = world.targetField.byId(id)!;
    for (let k = 0; k < 128 * 20; k++) world.step(input, bus);
    expect(t.visibleTick).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(0);
  });

  it('a hurt arrival stops walking and fights', () => {
    const { world, bus, input } = setup(arena([], vec3(0, 0, 60)));
    const id = world.spawnTarget('strafer', 0, 0, -50, bus, {
      strafe: straferParams(axes(50)),
      arrive: { route: [P(0, -50), P(0, -10)], speed: 3, engageM: 1 },
    });
    const t = world.targetField.byId(id)!;
    for (let k = 0; k < 128; k++) world.step(input, bus);
    expect(t.ai.arriving).toBe(true);
    t.hp -= 10;
    world.step(input, bus);
    expect(t.ai.arriving).toBe(false);
  });

  it('the strafe lane of a Strafer that stops in a corridor stays inside its walls', () => {
    // A corridor 3 m wide along Z: walls at x = -1.5 and 1.5 (full height).
    const walls: BoxDef[] = [
      { tag: 'wall', min: vec3(-3, 0, -100), max: vec3(-1.5, 4, 100) },
      { tag: 'wall', min: vec3(1.5, 0, -100), max: vec3(3, 4, 100) },
    ];
    const { tun, world, bus, input } = setup(arena(walls));
    const id = world.spawnTarget('strafer', 0, 0, -60, bus, {
      strafe: straferParams(axes(100)),
      arrive: { route: [P(0, -60), P(0, -30)], speed: 5, engageM: 0.1 },
    });
    world.placePlayer(0, 0, 40, 0);
    const t = world.targetField.byId(id)!;
    let xmin = Infinity, xmax = -Infinity;
    for (let k = 0; k < 128 * 25; k++) {
      world.step(input, bus);
      if (!t.ai.arriving) {
        xmin = Math.min(xmin, t.pos.x);
        xmax = Math.max(xmax, t.pos.x);
      }
    }
    const hull = tun.movement.hullHalfWidth;
    expect(xmin).toBeGreaterThanOrEqual(-1.5 + hull - 1e-6);
    expect(xmax).toBeLessThanOrEqual(1.5 - hull + 1e-6);
    // Too narrow to strafe across: it strafes along the corridor instead.
    expect(t.ai.laneLen).toBeGreaterThan(1);
  });

  it('walkReach: how far a body can walk before a wall, with a margin', () => {
    const wall: BoxDef = { tag: 'wall', min: vec3(5, 0, -10), max: vec3(6, 4, 10) };
    const r = walkReach([FLOOR, wall], 0.3, 0, 0, 0, 1, 0, 8, 0.25);
    expect(r).toBeGreaterThan(4);
    expect(r).toBeLessThan(5);
    expect(walkReach([FLOOR], 0.3, 0, 0, 0, 1, 0, 3, 0.25)).toBeCloseTo(2.75, 6);
  });
});

