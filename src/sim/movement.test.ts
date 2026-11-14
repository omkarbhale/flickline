import { describe, expect, it } from 'vitest';
import type { WeaponId } from '../config/weapon';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { brakeSpeed } from './movement';
import { createTickInput, type LevelDef, type SimEvents, type TickInput } from './types';
import type { WeaponEvents } from './weapon';
import { World } from './world';

/** A flat floor with nothing on it: 200 m across, so no run in these tests reaches a wall. */
const FLAT: LevelDef = {
  name: 'flat',
  boxes: [{ tag: 'floor', min: vec3(-100, -1, -100), max: vec3(100, 0, 100) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

function setup(weapon?: WeaponId) {
  const tun = cloneTunables();
  const world = new World({ level: FLAT, tunables: tun, seed: 1 });
  if (weapon) world.equipWeapon(weapon) || world.setLoadout({ primary: weapon, sidearm: 'pace' });
  const bus = new EventBus<SimEvents>();
  const shots: WeaponEvents['shotFired'][] = [];
  let jumps = 0;
  let lands = 0;
  bus.on('shotFired', (e) => shots.push({ ...e, dir: { ...e.dir } }));
  bus.on('playerJumped', () => jumps++);
  bus.on('playerLanded', () => lands++);
  const input = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}, each?: () => void): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
      each?.();
    }
  };
  run(4); // settle onto the floor
  return { world, tun, run, shots, counts: () => ({ jumps, lands }) };
}

const speedOf = (w: World): number => Math.hypot(w.player.vel.x, w.player.vel.z);

/** Ticks until `cond` holds (checked after each tick), running `patch`; -1 if it never does within `max`. */
function ticksUntil(s: ReturnType<typeof setup>, patch: Partial<TickInput>, cond: () => boolean, max = TICK_RATE * 2): number {
  for (let i = 1; i <= max; i++) {
    s.run(1, patch);
    if (cond()) return i;
  }
  return -1;
}

const IDLE: Partial<TickInput> = { moveX: 0, moveZ: 0, walk: false, crouch: false, fire: false };

describe('run speed is the equipped weapon\'s (spec §2.1, §2.2)', () => {
  for (const id of ['kestrel', 'vane', 'rill', 'pace'] as const) {
    it(`${id}: run, walk and crouch-walk are 1 / 0.50 / 0.34 of runSpeedMps`, () => {
      const max = cloneTunables().weapon[id].runSpeedMps;
      const a = setup(id);
      expect(a.world.maxSpeed()).toBe(max);
      a.run(TICK_RATE, { moveZ: 1 });
      expect(speedOf(a.world)).toBeCloseTo(max, 9);
      a.run(TICK_RATE, { moveZ: 1, walk: true });
      expect(speedOf(a.world)).toBeCloseTo(max * 0.5, 9);
      a.run(TICK_RATE, { moveZ: 1, walk: false, crouch: true });
      expect(speedOf(a.world)).toBeCloseTo(max * 0.34, 9);
    });
  }

  it('Pace runs at 5.7375 m/s, so a full run is the full error of its movement ramp', () => {
    const s = setup('pace');
    s.run(TICK_RATE * 1.2, { moveX: 1 });
    s.run(1, { moveX: 1, fire: true });
    const def = s.tun.weapon.pace;
    expect(speedOf(s.world)).toBeCloseTo(5.7375, 9);
    expect(s.shots[0]!.moving).toBe(true);
    expect(s.shots[0]!.spreadDeg).toBeCloseTo(def.spreadFirstDeg + def.errRunDeg, 9);
  });

  it('diagonal input is no faster than straight', () => {
    const s = setup();
    s.run(TICK_RATE, { moveZ: 1, moveX: 1 });
    expect(speedOf(s.world)).toBeCloseTo(s.world.maxSpeed(), 9);
  });
});

describe('acceleration and two-band braking (spec §2.3)', () => {
  it('brakeSpeed: 39 m/s^2 above 25% of max, 24 m/s^2 below, a full stop from 5.4 m/s in 0.160 s', () => {
    const m = cloneTunables().movement;
    expect(brakeSpeed(5.4, 0, 5.4, m, 1, 0.05)).toBeCloseTo(5.4 - 39 * 0.05, 12);
    expect(brakeSpeed(1.0, 0, 5.4, m, 1, 0.01)).toBeCloseTo(1.0 - 24 * 0.01, 12);
    // Exactly across the band edge (1.35 m/s): (5.4 - 1.35) / 39 s at the high rate, the rest at the low one.
    const tHigh = (5.4 - 1.35) / 39;
    expect(brakeSpeed(5.4, 0, 5.4, m, 1, tHigh + 0.01)).toBeCloseTo(1.35 - 24 * 0.01, 12);
    expect(tHigh + 1.35 / 24).toBeCloseTo(0.16, 3);
    expect(brakeSpeed(5.4, 0, 5.4, m, 1, 0.1599)).toBeGreaterThan(0);
    expect(brakeSpeed(5.4, 0, 5.4, m, 1, 0.1601)).toBe(0);
    // Scaled by max / 5.4: the same 0.16 s from any weapon's run speed.
    expect(brakeSpeed(5.7375, 0, 5.7375, m, 1, 0.1599)).toBeGreaterThan(0);
    expect(brakeSpeed(5.7375, 0, 5.7375, m, 1, 0.1601)).toBe(0);
    // A floor stops the braking there (run -> walk).
    expect(brakeSpeed(5.4, 2.7, 5.4, m, 1, 1)).toBe(2.7);
  });

  for (const id of ['kestrel', 'rill'] as const) {
    it(`${id}: rest to full speed in 0.20 s, a release stops in 0.16 s`, () => {
      const s = setup(id);
      const max = s.world.maxSpeed();
      const up = ticksUntil(s, { moveZ: 1 }, () => speedOf(s.world) >= max - 1e-9);
      expect(up * TICK_DT).toBeCloseTo(0.2, 2);
      s.run(TICK_RATE / 2, { moveZ: 1 });
      const down = ticksUntil(s, IDLE, () => speedOf(s.world) === 0);
      expect(Math.abs(down * TICK_DT - 0.16)).toBeLessThanOrEqual(TICK_DT);
    });
  }

  it('a counter-strafe stops exactly as fast as a release, then accelerates the other way', () => {
    const release = setup();
    release.run(TICK_RATE, { moveX: 1 });
    const releaseTicks = ticksUntil(release, IDLE, () => release.world.player.vel.x <= 0);

    const counter = setup();
    counter.run(TICK_RATE, { moveX: 1 });
    const trace: number[] = [];
    counter.run(TICK_RATE / 2, { moveX: -1 }, () => trace.push(counter.world.player.vel.x));
    const counterTicks = trace.findIndex((v) => v <= 0) + 1;
    expect(counterTicks).toBe(releaseTicks);
    // Then it runs the other way, reaching full speed 0.20 s after the stop.
    expect(trace[trace.length - 1]).toBeCloseTo(-counter.world.maxSpeed(), 9);
    const full = trace.findIndex((v) => v <= -counter.world.maxSpeed() + 1e-9) + 1;
    expect((full - counterTicks) * TICK_DT).toBeCloseTo(0.2, 1);
  });

  it('the counter-strafe bonus is a tunable (default none)', () => {
    const s = setup();
    s.tun.movement.counterStrafeBrakeMult = 2;
    s.run(TICK_RATE, { moveX: 1 });
    const t = ticksUntil(s, { moveX: -1 }, () => s.world.player.vel.x <= 0);
    expect(Math.abs(t * TICK_DT - 0.08)).toBeLessThanOrEqual(TICK_DT);
  });

  it('pressing walk from a run brakes down to walk speed and holds it', () => {
    const s = setup();
    s.run(TICK_RATE, { moveZ: 1 });
    const t = ticksUntil(s, { moveZ: 1, walk: true }, () => speedOf(s.world) <= 2.7 + 1e-9);
    expect(t * TICK_DT).toBeCloseTo((5.4 - 2.7) / 39, 2);
    s.run(TICK_RATE / 2, { moveZ: 1, walk: true });
    expect(speedOf(s.world)).toBeCloseTo(2.7, 9);
  });

  it('turning 90 degrees never adds speed above the run speed', () => {
    const s = setup();
    s.run(TICK_RATE, { moveZ: 1 });
    let peak = 0;
    s.run(TICK_RATE, { moveZ: 0, moveX: 1 }, () => (peak = Math.max(peak, speedOf(s.world))));
    expect(peak).toBeLessThanOrEqual(s.world.maxSpeed() + 1e-9);
    expect(s.world.player.vel.x).toBeCloseTo(s.world.maxSpeed(), 9);
  });
});

describe('time to an accurate shot after stopping (spec §2.5)', () => {
  /** Full rifle strafe, release, fire on the `n`-th released tick: that tick's shot. */
  function shotAfterRelease(n: number) {
    const s = setup('kestrel');
    s.run(TICK_RATE * 1.2, { moveX: 1 }); // also past the 1.0 s equip
    s.run(n - 1, IDLE);
    s.run(1, { ...IDLE, fire: true });
    expect(s.shots).toHaveLength(1);
    return { shot: s.shots[0]!, def: s.tun.weapon.kestrel };
  }

  it('the first shot with zero movement error lands at t = 0.100 +- 0.01 s after the release', () => {
    let first = -1;
    for (let n = 1; n <= 20 && first < 0; n++) {
      const { shot, def } = shotAfterRelease(n);
      const stillSpread = Math.abs(shot.spreadDeg - def.spreadFirstDeg) < 1e-9;
      expect(stillSpread).toBe(!shot.moving);
      if (!shot.moving) first = n;
    }
    expect(Math.abs(first * TICK_DT - 0.1)).toBeLessThanOrEqual(0.01); // 13 ticks = 0.1016 s
    // One tick earlier the shot still carries movement error.
    const before = shotAfterRelease(first - 1);
    expect(before.shot.moving).toBe(true);
    expect(before.shot.spreadDeg).toBeGreaterThan(before.def.spreadFirstDeg);
  });
});

describe('jump, air control, body (spec §2.6, §2.7)', () => {
  it('jumps to a 1.0 m apex under 20 m/s^2 and lands after about 0.63 s', () => {
    const s = setup();
    let peak = 0;
    let air = 0;
    s.run(1, { jump: true });
    s.run(TICK_RATE, IDLE, () => {
      peak = Math.max(peak, s.world.player.pos.y);
      if (!s.world.player.grounded) air++;
    });
    expect(peak).toBeCloseTo(1.0, 2);
    expect(peak).toBeLessThanOrEqual(1.0 + 1e-9);
    expect(Math.abs((air + 1) * TICK_DT - 2 * Math.sqrt(2 / 20))).toBeLessThanOrEqual(TICK_DT);
    expect(s.counts()).toEqual({ jumps: 1, lands: 1 });
  });

  it('keeps its takeoff speed in the air with no input (no air braking)', () => {
    const s = setup();
    s.run(TICK_RATE, { moveZ: 1 });
    s.run(1, { moveZ: 1, jump: true });
    s.run(Math.floor(0.5 * TICK_RATE), IDLE);
    expect(s.world.player.grounded).toBe(false);
    expect(speedOf(s.world)).toBeCloseTo(s.world.maxSpeed(), 9);
  });

  it('steers in the air at 0.25 x the ground acceleration and never gains speed', () => {
    const s = setup();
    s.run(1, { jump: true });
    s.run(Math.floor(0.25 * TICK_RATE), { moveX: 1 });
    expect(s.world.player.grounded).toBe(false);
    const groundAccel = s.world.maxSpeed() / 0.2;
    expect(s.world.player.vel.x).toBeCloseTo(0.25 * groundAccel * Math.floor(0.25 * TICK_RATE) * TICK_DT, 9);

    const r = setup();
    r.run(TICK_RATE, { moveZ: 1 });
    r.run(1, { moveZ: 1, jump: true });
    let peak = 0;
    r.run(Math.floor(0.5 * TICK_RATE), { moveZ: 1, moveX: 1 }, () => (peak = Math.max(peak, speedOf(r.world))));
    expect(peak).toBeLessThanOrEqual(r.world.maxSpeed() + 1e-9);
  });

  it('uses the spec hull and eye heights, and crouches in 0.15 s', () => {
    const s = setup();
    const p = s.world.player;
    expect(p.height).toBe(1.8);
    expect(p.eyeHeight).toBe(1.62);
    const t = ticksUntil(s, { crouch: true }, () => p.eyeHeight === 1.17);
    expect(p.height).toBe(1.3);
    expect(Math.abs(t * TICK_DT - 0.15)).toBeLessThanOrEqual(TICK_DT);
  });
});
