import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { accuracyThreshold } from './runProbe';
import type { RunEvents } from './runEvents';
import { createTickInput, type LevelDef, type RunAndSimEvents, type SimEvents, type TickInput } from './types';
import { World } from './world';

function level(opts: { target?: boolean; wall?: boolean } = {}): LevelDef {
  const boxes: LevelDef['boxes'] = [{ tag: 'floor', min: vec3(-30, -1, -30), max: vec3(30, 0, 30) }];
  if (opts.wall) boxes.push({ tag: 'wall', min: vec3(-3, 0, -6), max: vec3(3, 4, -5) });
  return {
    name: 'probe',
    boxes,
    spawn: { pos: vec3(0, 0, 0), yaw: 0 },
    targets: opts.target === false ? [] : [{ pos: vec3(0, 1.62, -10) }],
  };
}

function setup(lv: LevelDef = level()) {
  const world = new World({ level: lv, tunables: cloneTunables(), seed: 1 });
  const bus = new EventBus<RunAndSimEvents>();
  const seen: { type: string; data: Record<string, number | boolean | string> }[] = [];
  for (const t of [
    'shotFired', 'targetVisible', 'aimOnTarget', 'headHeightSampled', 'playerStopped', 'targetSpawned',
  ] as (keyof SimEvents | keyof RunEvents)[]) {
    bus.on(t, (e) => seen.push({ type: t, data: JSON.parse(JSON.stringify(e)) }));
  }
  const input = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
    }
  };
  const of = (t: string) => seen.filter((s) => s.type === t);
  return { world, bus, run, of, seen, input };
}

describe('accuracy threshold and the moving-shot flag (spec §2.4)', () => {
  const t = cloneTunables();

  it('threshold = the equipped weapon\'s deadzoneFraction x runSpeedMps (0.275 x 5.4 for Kestrel)', () => {
    const w = new World({ level: level(), tunables: t, seed: 1 }).weapon;
    const def = t.weapon[w.slots[w.active]!.id];
    expect(def.deadzoneFraction).toBeCloseTo(0.275, 9);
    expect(accuracyThreshold(w, t)).toBeCloseTo(def.deadzoneFraction * def.runSpeedMps, 9);
    // the fraction comes from the tunables, not from code
    const t2 = cloneTunables();
    t2.weapon[w.slots[w.active]!.id].deadzoneFraction = 0.5;
    expect(accuracyThreshold(w, t2)).toBeCloseTo(0.5 * def.runSpeedMps, 9);
  });

  it('is set on shotFired at fire time from the live movement state', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(1, { fire: true }); // standing still
    run(1, { fire: false });
    run(TICK_RATE / 2, { moveZ: 1 });
    run(1, { fire: true }); // at full run speed
    run(1, { fire: false, moveZ: 0 });
    run(TICK_RATE / 2, { moveZ: 0 });
    run(1, { fire: true }); // stopped again
    run(20, { fire: false });
    run(1, { jump: true });
    run(1, { fire: true }); // in the air
    const shots = of('shotFired').map((s) => s.data);
    expect(shots.map((s) => s.moving)).toEqual([false, true, false, true]);
    expect(shots[1]!.speed as number).toBeGreaterThan(5);
    expect(shots[3]!.airborne).toBe(true);
    expect(shots.map((s) => s.shotId)).toEqual([1, 2, 3, 4]);
  });

  it('numbers the position in a burst and restarts it after a pause', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(40, { fire: true });
    run(TICK_RATE, { fire: false });
    run(1, { fire: true });
    const idx = of('shotFired').map((s) => s.data.recoilIndex as number);
    expect(idx.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(idx[idx.length - 1]).toBe(0);
  });
});

describe('targetVisible', () => {
  it('fires once, the first tick the target is in view, with the pre-aim error', () => {
    const { run, of } = setup();
    run(4, { yaw: 0, pitch: 0 });
    expect(of('targetVisible')).toHaveLength(1);
    run(20);
    expect(of('targetVisible')).toHaveLength(1);
    const e = of('targetVisible')[0]!.data;
    expect(e.targetId).toBe(0);
    // aim point is 0 m above the eye height: straight ahead, level => ~0
    expect(e.preAim as number).toBeCloseTo(0, 6);
  });

  it('is not emitted while the target is outside the frustum, then is when it turns into view', () => {
    const { run, of } = setup();
    run(4, { yaw: Math.PI }); // looking away (+Z)
    run(10);
    expect(of('targetVisible')).toHaveLength(0);
    run(1, { yaw: 40 * DEG2RAD }); // 40 deg to the left of the target: inside the 51.5 deg half-FOV
    expect(of('targetVisible')).toHaveLength(1);
    const e = of('targetVisible')[0]!.data;
    expect(e.preAim as number).toBeCloseTo(40 * DEG2RAD, 3);
    expect(e.dYaw as number).toBeCloseTo(-40 * DEG2RAD, 3); // the target is 40 deg to the right of the view
  });

  it('respects the horizontal field of view (103 deg at 16:9 => 51.5 deg half angle)', () => {
    const a = setup();
    a.run(4, { yaw: 50 * DEG2RAD });
    a.run(2);
    expect(a.of('targetVisible')).toHaveLength(1);
    const b = setup();
    b.run(4, { yaw: 53 * DEG2RAD });
    b.run(2);
    expect(b.of('targetVisible')).toHaveLength(0);
  });

  it('a wall in the way hides the target', () => {
    const { run, of } = setup(level({ wall: true }));
    run(20);
    expect(of('targetVisible')).toHaveLength(0);
  });

  it('does not run outside a live run (world.live = false), and beginLive announces the targets', () => {
    const { world, bus, run, of } = setup();
    world.live = false;
    run(10);
    expect(of('targetVisible')).toHaveLength(0);
    expect(of('targetSpawned')).toHaveLength(0);
    world.beginLive(bus);
    expect(of('targetSpawned')).toHaveLength(1);
    run(2);
    expect(of('targetVisible')).toHaveLength(1);
  });
});

describe('aimOnTarget', () => {
  it('emits edges as the crosshair enters and leaves the padded hit volume', () => {
    const { run, of } = setup();
    run(4, { yaw: 0 });
    expect(of('aimOnTarget').map((e) => e.data.on)).toEqual([true]);
    run(2, { yaw: 20 * DEG2RAD });
    expect(of('aimOnTarget').map((e) => e.data.on)).toEqual([true, false]);
    run(2, { yaw: 0 });
    expect(of('aimOnTarget').map((e) => e.data.on)).toEqual([true, false, true]);
  });

  it('is padded by 0.5 degrees beyond the hit volume', () => {
    // a Beacon (radius 0.14 m) at 10 m spans 0.8 deg: inside at 1.1 deg thanks to the pad, outside at 1.5 deg
    const a = setup();
    a.run(4, { yaw: 1.1 * DEG2RAD });
    expect(a.of('aimOnTarget').some((e) => e.data.on)).toBe(true);
    const b = setup();
    b.run(4, { yaw: 1.5 * DEG2RAD });
    expect(b.of('aimOnTarget').some((e) => e.data.on)).toBe(false);
  });
});

describe('playerStopped (stop latency)', () => {
  it('measures release -> speed at or below the accuracy threshold', () => {
    const { world, run, of } = setup(level({ target: false }));
    run(4);
    run(TICK_RATE / 2, { moveZ: 1 });
    expect(of('playerStopped')).toHaveLength(0);
    run(TICK_RATE / 2, { moveZ: 0 });
    const stops = of('playerStopped');
    expect(stops).toHaveLength(1);
    const ms = stops[0]!.data.latencyMs as number;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThan(150);
    expect(ms / (TICK_DT * 1000)).toBeCloseTo(Math.round(ms / (TICK_DT * 1000)), 6); // whole ticks
    expect(Math.hypot(world.player.vel.x, world.player.vel.z)).toBeLessThanOrEqual(accuracyThreshold(world.weapon, world.tunables));
  });

  it('a counter-strafe press starts the clock too', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(TICK_RATE / 2, { moveX: 1 });
    run(TICK_RATE / 4, { moveX: -1 });
    expect(of('playerStopped').length).toBeGreaterThanOrEqual(1);
  });

  it('does not fire when the player was never moving, or when they keep moving', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(60, { moveZ: 0 });
    run(TICK_RATE, { moveZ: 1 });
    expect(of('playerStopped')).toHaveLength(0);
  });
});

describe('headHeightSampled', () => {
  it('samples while moving with nobody in view, at the configured rate', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(TICK_RATE, { moveZ: 1 });
    const n = of('headHeightSampled').length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(9);
    const e = of('headHeightSampled')[0]!.data.err as number;
    expect(e).toBeCloseTo(Math.abs(0 - Math.atan2(1.66 - 1.62, 10)), 4);
  });

  it('measures the vertical angle only (pitch error)', () => {
    const { run, of } = setup(level({ target: false }));
    run(4);
    run(TICK_RATE / 2, { moveZ: 1, pitch: -10 * DEG2RAD });
    const errs = of('headHeightSampled').map((e) => e.data.err as number);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[errs.length - 1]).toBeCloseTo(10 * DEG2RAD + Math.atan2(0.04, 10), 3);
  });

  it('does not sample when standing still or while an enemy is visible', () => {
    const a = setup(level({ target: false }));
    a.run(4);
    a.run(TICK_RATE, { moveZ: 0 });
    expect(a.of('headHeightSampled')).toHaveLength(0);
    const b = setup(); // target straight ahead is visible
    b.run(4);
    b.run(TICK_RATE, { moveZ: 1 });
    expect(b.of('headHeightSampled')).toHaveLength(0);
  });
});

describe('shot aim data', () => {
  it('names the nearest visible target and the angular error to it', () => {
    const { run, of } = setup();
    run(4, { yaw: 3 * DEG2RAD });
    run(1, { fire: true });
    const s = of('shotFired')[0]!.data;
    expect(s.aimTargetId).toBe(0);
    expect(s.aimErr as number).toBeCloseTo(3 * DEG2RAD, 3);
    expect(s.aimDYaw as number).toBeCloseTo(-3 * DEG2RAD, 3);
  });

  it('is -1 when no target is visible', () => {
    const { run, of } = setup(level({ wall: true }));
    run(4);
    run(1, { fire: true });
    expect(of('shotFired')[0]!.data.aimTargetId).toBe(-1);
  });
});
