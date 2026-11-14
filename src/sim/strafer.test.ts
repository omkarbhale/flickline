import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import { fireParams, straferParams } from './enemyParams';
import { brakeSeconds, STRAFER_DECEL, STRAFER_LEG, STRAFER_STAND } from './strafer';
import { createTickInput, type LevelDef, type SimEvents } from './types';
import { World } from './world';

const arena: LevelDef = {
  name: 'arena',
  boxes: [{ tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) }],
  spawn: { pos: vec3(0, 0, 20), yaw: 0 },
  targets: [],
};

interface Run {
  /** FSM state per tick, signed speed along the lane per tick, position per tick. */
  state: number[];
  vel: number[];
  x: number[];
  world: World;
}

/** A Strafer at the dial's endpoint on a 120 m lane, run for `ticks`; the player stands still. */
function run(dial: number, seed: number, ticks: number): Run {
  const tun = cloneTunables();
  const world = new World({ level: arena, tunables: tun, seed });
  const bus = new EventBus<SimEvents>();
  const id = world.spawnTarget('strafer', 0, 0, 0, bus, {
    strafe: { ...straferParams(axes(dial)), laneA: vec3(-60, 0, 0), laneB: vec3(60, 0, 0) },
  });
  const t = world.targetField.byId(id)!;
  const out: Run = { state: [], vel: [], x: [], world };
  const input = createTickInput();
  for (let i = 0; i < ticks; i++) {
    world.step(input, bus);
    out.state.push(t.fsm.state);
    out.vel.push(t.ai.vel);
    out.x.push(t.pos.x);
  }
  return out;
}

/** Lengths (seconds) of every complete run of `state`, ignoring the first and last (cut by the window). */
function spans(states: readonly number[], state: number): number[] {
  const out: number[] = [];
  let start = -1;
  for (let i = 0; i <= states.length; i++) {
    const inState = i < states.length && states[i] === state;
    if (inState && start < 0) start = i;
    if (!inState && start >= 0) {
      if (start > 0 && i < states.length) out.push((i - start) * TICK_DT);
      start = -1;
    }
  }
  return out;
}

const TICK = TICK_DT * 1.01;
const tun = cloneTunables();
const cfg = tun.enemies.strafer;

describe('Strafer FSM at the dial endpoints (design §5.2, §9.4, spec §5.3)', () => {
  it('dial 0: speed 2.0 m/s, legs in 0.35-1.0 s, stand-still in 0.25-0.4 s, real stops', () => {
    const r = run(0, 7, 128 * 60);
    expect(Math.max(...r.vel.map(Math.abs))).toBeCloseTo(2.0, 5);
    const legs = spans(r.state, STRAFER_LEG);
    expect(legs.length).toBeGreaterThan(30);
    // A leg lasts its drawn length, then the brake starts: the leg state is exactly the leg.
    for (const l of legs) {
      expect(l).toBeGreaterThanOrEqual(0.35 - TICK);
      expect(l).toBeLessThanOrEqual(1.0 + TICK);
    }
    // ... and the draw really spans the range, not a constant.
    expect(Math.max(...legs)).toBeGreaterThan(0.85);
    expect(Math.min(...legs)).toBeLessThan(0.5);
    const stands = spans(r.state, STRAFER_STAND);
    for (const s of stands) {
      expect(s).toBeGreaterThanOrEqual(0.25 - TICK);
      expect(s).toBeLessThanOrEqual(0.4 + TICK);
    }
    expect(Math.max(...stands)).toBeGreaterThan(0.35);
    // Stand-still really is still.
    r.state.forEach((st, i) => { if (st === STRAFER_STAND) expect(r.vel[i]).toBe(0); });
  });

  it('dial 100: speed 5.4 m/s, legs 0.35 s, stand-still 0.25 s (the adopted research values, #130)', () => {
    const r = run(100, 11, 128 * 60);
    expect(Math.max(...r.vel.map(Math.abs))).toBeCloseTo(5.4, 5);
    for (const l of spans(r.state, STRAFER_LEG)) expect(Math.abs(l - axes(100).strafeLegSec)).toBeLessThanOrEqual(TICK);
    for (const s of spans(r.state, STRAFER_STAND)) expect(Math.abs(s - axes(100).standStillSec)).toBeLessThanOrEqual(TICK);
  });

  it('every stop takes the spec\'s 0.16 s, at the slowest and the fastest speed', () => {
    expect(brakeSeconds(cfg)).toBeGreaterThan(0.155);
    expect(brakeSeconds(cfg)).toBeLessThan(0.165);
    for (const dial of [0, 100]) {
      const stops = spans(run(dial, 3, 128 * 40).state, STRAFER_DECEL);
      expect(stops.length).toBeGreaterThan(20);
      for (const d of stops) expect(Math.abs(d - 0.16)).toBeLessThanOrEqual(0.02);
    }
  });

  it('braking is constant deceleration in two bands (39 then 24 m/s^2 scaled by speed / 5.4)', () => {
    const r = run(100, 5, 128 * 10);
    // Find a stop and read the velocity ramp: 5.4 -> 1.485 at 39 m/s^2, then 24 m/s^2 to zero.
    const i0 = r.state.findIndex((s, i) => s === STRAFER_DECEL && r.state[i - 1] === STRAFER_LEG);
    const v = (k: number): number => Math.abs(r.vel[i0 + k]!);
    // The state flips on the tick the brake is decided; velocity starts falling on the next one.
    expect(v(0)).toBeCloseTo(5.4, 5);
    expect(v(0) - v(1)).toBeCloseTo(39 * TICK_DT, 5);
    expect(v(1) - v(2)).toBeCloseTo(39 * TICK_DT, 5);
    let k = 0;
    while (v(k) > 5.4 * 0.275 + 1e-9) k++;
    expect(v(k + 1) - v(k + 2)).toBeCloseTo(24 * TICK_DT, 5);
  });

  it('reverses on a seeded coin: both directions occur, and the same seed gives the same path', () => {
    const a = run(50, 21, 128 * 40);
    const b = run(50, 21, 128 * 40);
    const c = run(50, 22, 128 * 40);
    expect(a.x).toEqual(b.x);
    expect(a.x).not.toEqual(c.x);
    expect(a.world.hash()).toBe(b.world.hash());
    const dirs = new Set(a.vel.filter((v) => v !== 0).map(Math.sign));
    expect(dirs).toEqual(new Set([-1, 1]));
  });

  it('turns round at the end of its lane instead of leaving it', () => {
    const tun2 = cloneTunables();
    const world = new World({ level: arena, tunables: tun2, seed: 4 });
    const bus = new EventBus<SimEvents>();
    const id = world.spawnTarget('strafer', 0, 0, 0, bus, {
      strafe: { ...straferParams(axes(100)), laneA: vec3(-1.5, 0, 0), laneB: vec3(1.5, 0, 0) },
    });
    const t = world.targetField.byId(id)!;
    const input = createTickInput();
    let lo = 0, hi = 0;
    for (let i = 0; i < 128 * 30; i++) {
      world.step(input, bus);
      lo = Math.min(lo, t.pos.x);
      hi = Math.max(hi, t.pos.x);
    }
    expect(lo).toBeGreaterThanOrEqual(-1.5 - 1e-9);
    expect(hi).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(hi - lo).toBeGreaterThan(1.5);
  });

  it('without a lane it strafes across the player\'s view', () => {
    const world = new World({ level: arena, tunables: cloneTunables(), seed: 2 });
    const bus = new EventBus<SimEvents>();
    const id = world.spawnTarget('strafer', 0, 0, 0, bus);
    const t = world.targetField.byId(id)!;
    const input = createTickInput();
    let dz = 0;
    for (let i = 0; i < 128 * 10; i++) {
      world.step(input, bus);
      dz = Math.max(dz, Math.abs(t.pos.z));
    }
    expect(dz).toBeLessThan(1e-9);
    expect(Math.abs(t.pos.x)).toBeLessThanOrEqual(cfg.freeHalfRangeM + 1e-9);
  });
});

describe('Strafer on a route (meet sectors, #212)', () => {
  /** An Echo on a route from z = -30 to z = 0 towards the player at z = 20, at the dial's numbers; `fire` makes it shoot back. */
  function route(dial: number, seed: number, fire: boolean, speed?: number) {
    const tun = cloneTunables();
    const world = new World({ level: arena, tunables: tun, seed });
    world.enemiesFire = fire;
    const bus = new EventBus<SimEvents>();
    const ax = axes(dial);
    const id = world.spawnTarget('strafer', 0, 0, -30, bus, {
      strafe: { ...straferParams(ax), speed: speed ?? ax.strafeSpeed, laneA: vec3(0, 0, -30), laneB: vec3(0, 0, 0), travel: true },
      fire: fire ? fireParams(ax) : undefined,
    });
    return { world, bus, t: world.targetField.byId(id)!, input: createTickInput() };
  }

  it('without a player to react to it runs its route to the far end without reversing, and brakes inside the lane', () => {
    const { world, bus, t, input } = route(50, 3, false, 5.4);
    let maxV = 0, minZ = Infinity, firstStopTick = -1;
    for (let i = 0; i < 128 * 12; i++) {
      world.step(input, bus);
      if (firstStopTick < 0 && t.fsm.state === STRAFER_STAND) firstStopTick = i;
      if (firstStopTick < 0) {
        expect(t.ai.vel).toBeGreaterThanOrEqual(-1e-9); // never turns back before its first stop
        expect(t.pos.z).toBeLessThanOrEqual(1e-9);
      }
      maxV = Math.max(maxV, t.ai.vel);
      minZ = Math.min(minZ, t.pos.z);
    }
    expect(maxV).toBeCloseTo(5.4, 5);
    expect(minZ).toBeCloseTo(-30, 1);
    // 30 m at 5.4 m/s with the start ramp and the 0.16 s brake: about 5.6 s + 0.2 s, no timer stops on the way.
    expect(firstStopTick * TICK_DT).toBeGreaterThan(5.3);
    expect(firstStopTick * TICK_DT).toBeLessThan(6.5);
    expect(t.pos.z).toBeGreaterThan(-30);
    expect(t.pos.z).toBeLessThanOrEqual(0);
  });

  it('keeps running through its reaction to the player, then brakes with the spec\'s braking and shoots only from the stop', () => {
    for (const dial of [20, 60]) {
      const { world, bus, t, input } = route(dial, 11, true);
      const speedAtShot: number[] = [];
      let tellStartSpeed = -1;
      let speedDuringReaction = 0;
      bus.on('enemyTell', () => { if (tellStartSpeed < 0) tellStartSpeed = Math.abs(t.ai.vel); });
      bus.on('enemyFired', () => speedAtShot.push(Math.abs(t.ai.vel)));
      let sawAt = -1;
      for (let i = 0; i < 128 * 14 && speedAtShot.length === 0; i++) {
        world.step(input, bus);
        if (sawAt < 0 && t.ai.contactTick >= 0) sawAt = t.ai.contactTick;
        // Halfway through the reaction it is still moving at its gait.
        if (sawAt >= 0 && i === sawAt + Math.floor((t.ai.readyTick - sawAt) / 2)) speedDuringReaction = Math.abs(t.ai.vel);
      }
      expect(sawAt, `dial ${dial}`).toBeGreaterThanOrEqual(0);
      expect(speedDuringReaction, `dial ${dial}`).toBeGreaterThan(1.5);
      expect(speedAtShot.length).toBeGreaterThan(0);
      for (const v of speedAtShot) expect(v, `dial ${dial}`).toBe(0);
      expect(tellStartSpeed).toBeLessThan(speedDuringReaction);
    }
  });

  it('after its first stop it strafes on its line like any Strafer (the route is over)', () => {
    const { world, bus, t, input } = route(50, 5, false, 5.4);
    let reversed = false;
    for (let i = 0; i < 128 * 40; i++) {
      world.step(input, bus);
      if (t.ai.vel < -1) reversed = true;
    }
    expect(reversed).toBe(true);
    expect(t.ai.travel).toBe(false);
  });
});
