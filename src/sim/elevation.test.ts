import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { rayBox, rampY, supportBelow } from './collision';
import { createTickInput, type BoxDef, type BoxTag, type LevelDef, type RampRise, type SimEvents, type TickInput } from './types';
import { stepPlayer } from './movement';
import { World } from './world';

function box(tag: BoxTag, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  return { tag, min: vec3(x0, y0, z0), max: vec3(x1, y1, z1) };
}

function ramp(rise: RampRise, lowY: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  return { tag: 'ramp', min: vec3(x0, y0, z0), max: vec3(x1, y1, z1), ramp: { rise, lowY } };
}

function level(boxes: BoxDef[], spawn = vec3(0, 0, 0), yaw = 0): LevelDef {
  return { name: 'elevation', boxes: [box('floor', -40, -1, -40, 40, 0, 40), ...boxes], spawn: { pos: spawn, yaw }, targets: [] };
}

function setup(lv: LevelDef) {
  const world = new World({ level: lv, tunables: cloneTunables(), seed: 1 });
  const bus = new EventBus<SimEvents>();
  const counts: Record<string, number> = {};
  bus.onAny((type) => {
    counts[type] = (counts[type] ?? 0) + 1;
  });
  const input = createTickInput();
  input.yaw = lv.spawn.yaw;
  /** Run `n` ticks; `each` sees the world after every tick. */
  const run = (n: number, patch: Partial<TickInput> = {}, each?: () => void): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
      each?.();
    }
  };
  return { world, run, counts };
}

const FORWARD_YAW: Record<RampRise, number> = { '-z': 0, '+x': -Math.PI / 2, '-x': Math.PI / 2, '+z': Math.PI };

describe('step-up', () => {
  const m = cloneTunables().movement;

  it('walks up a 0.3 m step at run speed without slowing down or leaving the ground', () => {
    const { world, run } = setup(level([box('platform', -3, 0, -8, 3, 0.3, -4)], vec3(0, 0, 0)));
    run(4);
    let airborne = 0;
    let minSpeed = Infinity;
    // Reach full speed on the flat first, then hit the step.
    run(TICK_RATE / 2, { moveZ: 1 });
    run(TICK_RATE, { moveZ: 1 }, () => {
      const p = world.player;
      if (!p.grounded) airborne++;
      if (p.pos.z < -3.5) minSpeed = Math.min(minSpeed, Math.hypot(p.vel.x, p.vel.z));
    });
    expect(world.player.pos.z).toBeLessThan(-4.5);
    expect(world.player.pos.y).toBeCloseTo(0.3, 6);
    expect(world.player.grounded).toBe(true);
    expect(airborne).toBe(0);
    expect(minSpeed).toBeCloseTo(world.maxSpeed(), 3);
  });

  it('climbs a stair of 0.3 m risers', () => {
    const stairs = [0.3, 0.6, 0.9, 1.2].map((h, i) => box('platform', -3, 0, -4 - i, 3, h, -3 - i));
    const { world, run } = setup(level([...stairs, box('platform', -3, 0, -14, 3, 1.2, -7)]));
    run(4);
    run(TICK_RATE * 2, { moveZ: 1 });
    expect(world.player.pos.y).toBeCloseTo(1.2, 6);
    expect(world.player.grounded).toBe(true);
  });

  it('is blocked by a ledge higher than the step height and can still jump onto it', () => {
    const lv = level([box('crate', -3, 0, -14, 3, 0.6, -4)]);
    const a = setup(lv);
    a.run(4);
    a.run(TICK_RATE * 2, { moveZ: 1 });
    expect(a.world.player.pos.y).toBeCloseTo(0, 6);
    expect(a.world.player.pos.z).toBeCloseTo(-4 + m.hullHalfWidth, 4);

    const b = setup(lv);
    b.run(4);
    b.run(TICK_RATE, { moveZ: 1 });
    b.run(1, { moveZ: 1, jump: true });
    b.run(TICK_RATE, { moveZ: 1 });
    expect(b.world.player.pos.y).toBeCloseTo(0.6, 6);
  });

  it('does not step up with no headroom (a low lintel over a 0.3 m step)', () => {
    const lv = level([box('platform', -3, 0, -6, 3, 0.3, -4), box('wall', -3, 1.6, -6, 3, 3, -4)]);
    const { world, run } = setup(lv);
    run(4);
    run(TICK_RATE * 2, { moveZ: 1 });
    expect(world.player.pos.y).toBeCloseTo(0, 6);
    expect(world.player.pos.z).toBeCloseTo(-4 + m.hullHalfWidth, 4);
  });

  it('steps down a 0.3 m ledge without becoming airborne, but falls off a 1 m drop', () => {
    const lv = level([box('platform', -3, 0, -3, 3, 0.3, 3), box('platform', -3, 0, -9, 3, 1, -6)], vec3(0, 0.3, 0));
    const a = setup(lv);
    a.run(4);
    let airborne = 0;
    a.run(TICK_RATE, { moveZ: 1 }, () => {
      if (!a.world.player.grounded) airborne++;
    });
    expect(a.world.player.pos.z).toBeLessThan(-3.5);
    expect(a.world.player.pos.y).toBeCloseTo(0, 6);
    expect(airborne).toBe(0);
    expect(a.counts.playerLanded ?? 0).toBe(0);

    const b = setup(level([box('platform', -3, 0, -3, 3, 1, 3)], vec3(0, 1, 0)));
    b.run(4);
    let sawAir = false;
    b.run(TICK_RATE * 1.5, { moveZ: 1 }, () => {
      if (!b.world.player.grounded) sawAir = true;
    });
    expect(sawAir).toBe(true);
    expect(b.world.player.pos.y).toBeCloseTo(0, 6);
    expect(b.counts.playerLanded).toBe(1);
  });
});

describe('ramps', () => {
  const m = cloneTunables().movement;
  // A 4 m wide, 8 m long ramp rising 2 m (14 deg) with a 4 m landing at the top, built for each direction.
  function rampLevel(rise: RampRise): LevelDef {
    switch (rise) {
      case '+x':
        return level([ramp('+x', 0, -4, 0, -2, 4, 2, 2), box('platform', 4, 0, -2, 8, 2, 2)], vec3(-8, 0, 0), FORWARD_YAW[rise]);
      case '-x':
        return level([ramp('-x', 0, -4, 0, -2, 4, 2, 2), box('platform', -8, 0, -2, -4, 2, 2)], vec3(8, 0, 0), FORWARD_YAW[rise]);
      case '+z':
        return level([ramp('+z', 0, -2, 0, -4, 2, 2, 4), box('platform', -2, 0, 4, 2, 2, 8)], vec3(0, 0, -8), FORWARD_YAW[rise]);
      default:
        return level([ramp('-z', 0, -2, 0, -4, 2, 2, 4), box('platform', -2, 0, -8, 2, 2, -4)], vec3(0, 0, 8), FORWARD_YAW[rise]);
    }
  }

  for (const rise of ['+x', '-x', '+z', '-z'] as const) {
    it(`walks up a ramp rising ${rise} at run speed and ends on the landing`, () => {
      const { world, run } = setup(rampLevel(rise));
      run(4);
      run(TICK_RATE / 2, { moveZ: 1 });
      let airborne = 0;
      let slowest = Infinity;
      let lastY = world.player.pos.y;
      let monotone = true;
      run(TICK_RATE * 2, { moveZ: 1 }, () => {
        const p = world.player;
        if (!p.grounded) airborne++;
        slowest = Math.min(slowest, Math.hypot(p.vel.x, p.vel.z));
        if (p.pos.y < lastY - 1e-9) monotone = false;
        lastY = p.pos.y;
      });
      expect(world.player.pos.y).toBeCloseTo(2, 6);
      expect(airborne).toBe(0);
      expect(monotone).toBe(true);
      // The spec's speeds are unchanged on a ramp: horizontal speed is the flat run speed.
      expect(slowest).toBeCloseTo(world.maxSpeed(), 3);
    });
  }

  it('walks back down a ramp grounded, with no landing events', () => {
    const lv = rampLevel('-z');
    const { world, run, counts } = setup(lv);
    // start at the top of the landing facing back toward +z, then walk down the ramp
    world.player.pos.z = -7;
    world.player.pos.y = 2;
    world.player.grounded = true;
    let airborne = 0;
    run(2, { yaw: Math.PI });
    run(TICK_RATE * 3, { moveZ: 1, yaw: Math.PI }, () => {
      if (!world.player.grounded) airborne++;
    });
    expect(world.player.pos.y).toBeCloseTo(0, 6);
    expect(world.player.pos.z).toBeGreaterThan(4);
    expect(airborne).toBe(0);
    expect(counts.playerLanded ?? 0).toBe(0);
  });

  it('rests the feet on the surface under the uphill edge and stops mid-ramp when input is released', () => {
    const { world, run } = setup(rampLevel('-z'));
    run(4);
    run(TICK_RATE * 2, { moveZ: 1 });
    run(TICK_RATE, { moveZ: 0 });
    const p = world.player;
    expect(p.grounded).toBe(true);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(1e-6);
    const b = world.level.boxes[1]!;
    // surface height at the hull's uphill (-z) edge
    expect(p.pos.y).toBeCloseTo(rampY(b, p.pos.x, p.pos.z - m.hullHalfWidth), 9);
  });

  it('blocks a walk into the side of a ramp taller than the step height', () => {
    // The ramp (z -4..4, rising toward -z, 2 m high) seen from the +x side at z = -2: its side face is 1.5 m tall there.
    const lv = level([ramp('-z', 0, -2, 0, -4, 2, 2, 4)], vec3(8, 0, -2), Math.PI / 2);
    const { world, run } = setup(lv);
    run(4);
    run(TICK_RATE * 3, { moveZ: 1 });
    expect(world.player.pos.x).toBeCloseTo(2 + m.hullHalfWidth, 4);
    expect(world.player.pos.y).toBeCloseTo(0, 6);
  });

  it('steps onto the side of a ramp where its face is below the step height', () => {
    // Same ramp near the low end (z = 3.9): the side face there is under 0.1 m tall, so the hull steps onto it.
    const lv = level([ramp('-z', 0, -2, 0, -4, 2, 2, 4)], vec3(8, 0, 3.9), Math.PI / 2);
    const { world, run } = setup(lv);
    run(4);
    run(TICK_RATE * 2.5, { moveZ: 1 });
    expect(world.player.pos.x).toBeLessThan(-2.5); // walked over and off the other side

  });

  it('a hull standing inside a ramp wedge below the surface is blocked, above it is free', () => {
    const lv = level([ramp('+x', 0, 0, 0, -2, 4, 2, 2)]);
    const { world } = setup(lv);
    const boxes = world.level.boxes;
    // surface y = x/2: at x=3, 1.5
    expect(supportBelow(boxes, 3, 0, 0, 10)).toBeCloseTo(1.5, 9);
    expect(supportBelow(boxes, 3, 0, 0.3, 10)).toBeCloseTo(1.65, 9); // uphill edge of the hull
    expect(supportBelow(boxes, 9, 0, 0.3, 10)).toBe(0); // beyond the ramp: floor
  });

  it('is deterministic: the same inputs give the same world hash', () => {
    const run1 = setup(rampLevel('+z'));
    const run2 = setup(rampLevel('+z'));
    for (const r of [run1, run2]) {
      r.run(4);
      r.run(TICK_RATE * 3, { moveZ: 1, moveX: 0.2 });
    }
    expect(run1.world.hash()).toBe(run2.world.hash());
  });
});

describe('rays against ramps', () => {
  const n = vec3();
  // Surface rises +x from y=0 at x=0 to y=2 at x=4 (slope 0.5), 2 wide in z.
  const r = ramp('+x', 0, 0, 0, -1, 4, 2, 1);

  it('hits the sloped surface from above with a tilted normal', () => {
    const t = rayBox(2, 5, 0, 0, -1, 0, r, 100, n);
    expect(t).toBeCloseTo(4, 9); // surface at x=2 is y=1
    const inv = 1 / Math.sqrt(1.25);
    expect(n.x).toBeCloseTo(-0.5 * inv, 9);
    expect(n.y).toBeCloseTo(inv, 9);
    expect(n.z).toBeCloseTo(0, 9);
  });

  it('passes through the air above the surface where the plain box would block it', () => {
    // A level ray at y=1.5 over x=0..2 is above the surface (below the box top): it first meets the surface at x=3.
    const t = rayBox(-3, 1.5, 0, 1, 0, 0, r, 100, n);
    expect(t).toBeCloseTo(6, 9);
    expect(n.y).toBeGreaterThan(0.8);
  });

  it('hits the vertical high face when approached from the high side, and misses from above the box', () => {
    expect(rayBox(9, 1, 0, -1, 0, 0, r, 100, n)).toBeCloseTo(5, 9);
    expect(n.x).toBe(1);
    expect(rayBox(2, 5, 0, 1, 0, 0, r, 100, n)).toBe(-1);
  });

  it('a ray running parallel to the surface above it misses, below it hits the box part', () => {
    const above = rayBox(-3, 3, 0, 1, 0.5, 0, r, 100, n);
    expect(above).toBe(-1);
    const along = rayBox(-3, 0.5, 0, 1, 0, 0, r, 100, n);
    expect(along).toBeCloseTo(4, 9);
  });

  it('handles a ramp with a riser (lowY above the base)', () => {
    const rr = ramp('-z', 1, 0, 0, 0, 2, 3, 4); // surface rises toward -z from y=1 at z=4 to y=3 at z=0
    expect(rayBox(1, 0.5, 8, 0, 0, -1, rr, 100, n)).toBeCloseTo(4, 9); // hits the vertical riser at z=4
    expect(n.z).toBe(1);
    expect(rayBox(1, 6, 2, 0, -1, 0, rr, 100, n)).toBeCloseTo(4, 9); // surface at z=2 is y=2
  });
});

describe('shared movement code', () => {
  it('a body that is not the player (an enemy, #87) climbs steps and ramps through the same stepPlayer', () => {
    const t = cloneTunables();
    const lv = level([box('platform', -3, 0, -6, 3, 0.3, -2), ramp('-z', 0, -3, 0, -14, 3, 2, -6), box('platform', -3, 0, -30, 3, 2, -14)]);
    const body = {
      pos: vec3(0, 0, 0), prevPos: vec3(), vel: vec3(), yaw: 0, pitch: 0, grounded: false, crouching: false,
      height: t.movement.standHeight, eyeHeight: t.movement.standEyeHeight, prevEyeHeight: t.movement.standEyeHeight,
      stepAccum: 0, tagScale: 1, aimPunch: 0,
    };
    const bus = new EventBus<SimEvents>();
    const input = createTickInput();
    input.moveZ = 1;
    for (let i = 0; i < TICK_RATE * 4; i++) stepPlayer(body, input, lv.boxes, t.movement, t.weapon.kestrel, 1 / TICK_RATE, i + 1, bus);
    expect(body.pos.y).toBeCloseTo(2, 6);
    expect(body.grounded).toBe(true);
  });
});
