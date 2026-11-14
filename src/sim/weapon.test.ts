import { describe, expect, it } from 'vitest';
import { movement } from '../config/movement';
import { cloneTunables } from '../config/tunables';
import { weapon as weaponTable, weaponRules, type WeaponDef } from '../config/weapon';
import { EventBus } from '../core/eventBus';
import { RAD2DEG } from '../core/math';
import { Rng } from '../core/rng';
import { TICK_RATE } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import { testRoom } from './levels';
import { createTickInput, type LevelDef, type SimEvents, type TickInput } from './types';
import {
  applyRecoilKick,
  damageFor,
  isMovingShot,
  movementErrorDeg,
  patternAt,
  sprayAccumDeg,
  sprayIncrement,
  type RecoilState,
} from './weaponModel';
import { World } from './world';

const kestrel = weaponTable.kestrel;
const pace = weaponTable.pace;

type Shot = SimEvents['shotFired'];
type Impact = SimEvents['shotImpact'];

function setup(level: LevelDef = testRoom, seed = 1) {
  const world = new World({ level, tunables: cloneTunables(), seed });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; tick: number; data: unknown }[] = [];
  bus.onAny((type, e) => log.push({ type, tick: world.tick, data: JSON.parse(JSON.stringify(e)) }));
  const input = createTickInput();
  /** Run n ticks; `jump`, `reload` and `switchTo` apply to the first tick only. */
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
      input.reload = false;
      input.switchTo = -1;
    }
  };
  const all = <K extends keyof SimEvents>(t: K): SimEvents[K][] =>
    log.filter((l) => l.type === t).map((l) => l.data as SimEvents[K]);
  const ticksOf = (t: keyof SimEvents): number[] => log.filter((l) => l.type === t).map((l) => l.tick);
  run(4); // settle on the floor
  log.length = 0;
  return { world, bus, log, input, run, all, ticksOf };
}

/** Unprotected-bullet recoil state at rest. */
function freshRecoil(): RecoilState {
  return { recoilIndex: 0, recoilPitch: 0, recoilYaw: 0, yawSign: 1, yawTarget: 1 };
}

describe('weapon table (spec §7)', () => {
  it('has Pace and Kestrel keyed by id with the spec archetype numbers', () => {
    expect(kestrel.archetype).toBe('rifle_spray');
    expect([kestrel.fireRateHz, kestrel.magazine, kestrel.reloadSec, kestrel.equipSec]).toEqual([11, 30, 2.5, 1]);
    expect([kestrel.spreadFirstDeg, kestrel.spreadMaxDeg, kestrel.recoverySec, kestrel.tapEfficiency]).toEqual([0.2, 0.9, 0.35, 4]);
    expect(pace.archetype).toBe('pistol_accurate');
    expect(pace.fireMode).toBe('semi');
    expect([pace.fireRateHz, pace.magazine, pace.reloadSec, pace.equipSec]).toEqual([6.75, 13, 1.5, 0.75]);
    expect([pace.spreadFirstDeg, pace.spreadMaxDeg, pace.crouchSpreadMult]).toEqual([0.3, 1.65, 0.75]);
  });

  it('is plain JSON data (tunables can be cloned and replaced)', () => {
    const t = cloneTunables();
    expect(t.weapon.kestrel).toEqual(kestrel);
    expect(t.weaponRules).toEqual(weaponRules);
  });
});

describe('spread (spec §3.3)', () => {
  it('ramps from first-shot to max over n_ramp bullets', () => {
    expect(sprayAccumDeg(kestrel, 0)).toBeCloseTo(0.2, 12);
    expect(sprayAccumDeg(kestrel, 4)).toBeCloseTo(0.55, 12);
    expect(sprayAccumDeg(kestrel, 8)).toBeCloseTo(0.9, 12);
    expect(sprayAccumDeg(kestrel, 30)).toBeCloseTo(0.9, 12);
    expect(sprayAccumDeg(pace, 4)).toBeCloseTo(1.65, 12);
  });

  it('held fire adds 1 to the spray count, deliberate taps add 1/tap efficiency', () => {
    expect(sprayIncrement(kestrel, weaponRules, 1 / 11)).toBe(1);
    expect(sprayIncrement(kestrel, weaponRules, 1.5 / 11)).toBe(1);
    expect(sprayIncrement(kestrel, weaponRules, 0.2)).toBe(0.25);
    expect(sprayIncrement(pace, weaponRules, 1.5 / 6.75)).toBe(1);
    expect(sprayIncrement(pace, weaponRules, 0.3)).toBeCloseTo(1 / 3, 12);
  });

  it('a tap after the recovery time is a fresh first shot; a quicker tap accrues', () => {
    const s = setup();
    const tapAfter = (gapTicks: number): Shot => {
      s.run(gapTicks, { fire: false });
      s.run(1, { fire: true });
      return s.all('shotFired').at(-1)!;
    };
    expect(tapAfter(1).spreadDeg).toBeCloseTo(0.2, 9);
    // 0.25 s after: inside the 0.35 s recovery, so the second tap carries 1/4 of a bullet.
    expect(tapAfter(Math.round(0.25 * TICK_RATE) - 1).spreadDeg).toBeCloseTo(sprayAccumDeg(kestrel, 0.25), 9);
    // 0.35 s after the last shot: fully recovered.
    expect(tapAfter(Math.round(0.35 * TICK_RATE) - 1).spreadDeg).toBeCloseTo(0.2, 9);
  });

  it('crouching scales the stationary spread', () => {
    const s = setup();
    s.run(40, { crouch: true });
    s.run(1, { crouch: true, fire: true });
    expect(s.all('shotFired')[0]!.spreadDeg).toBeCloseTo(0.2 * 0.85, 9);
  });
});

describe('movement accuracy (spec §2.4, §3.4)', () => {
  it('movement error follows the deadzone / walk / run / air thresholds', () => {
    const m = movement;
    expect(movementErrorDeg(kestrel, m, 0, false, false)).toBe(0);
    expect(movementErrorDeg(kestrel, m, 0.275, false, false)).toBe(0);
    expect(movementErrorDeg(kestrel, m, 0.28, false, false)).toBeGreaterThan(0);
    expect(movementErrorDeg(kestrel, m, 0.5, false, false)).toBeCloseTo(3, 12);
    expect(movementErrorDeg(kestrel, m, 0.75, false, false)).toBeCloseTo(4.5, 12);
    expect(movementErrorDeg(kestrel, m, 1, false, false)).toBeCloseTo(6, 12);
    expect(movementErrorDeg(kestrel, m, 0.34, true, false)).toBeCloseTo(0.8, 12);
    expect(movementErrorDeg(kestrel, m, 0, false, true)).toBe(10);
    expect(movementErrorDeg(pace, m, 1, false, false)).toBeCloseTo(2.3, 12);
    expect(movementErrorDeg(pace, m, 0.5, false, false)).toBeCloseTo(1.1, 12);
    expect(movementErrorDeg(pace, m, 0, false, true)).toBe(7);
  });

  it('a shot is moving above 27.5% of the equipped run speed, or airborne', () => {
    const dz = 0.275 * 5.4;
    expect(isMovingShot(kestrel, dz, false)).toBe(false);
    expect(isMovingShot(kestrel, dz + 0.001, false)).toBe(true);
    expect(isMovingShot(kestrel, 0, true)).toBe(true);
    expect(isMovingShot(pace, 0.275 * 5.7375, false)).toBe(false);
    expect(isMovingShot(pace, 0.275 * 5.7375 + 0.001, false)).toBe(true);
  });

  it('flags shotFired.moving and adds the error in the world (still, walking, running, airborne, landing)', () => {
    const still = setup();
    still.run(1, { fire: true });
    const a = still.all('shotFired')[0]!;
    expect(a.moving).toBe(false);
    expect(a.airborne).toBe(false);
    expect(a.speed).toBe(0);

    const running = setup();
    running.run(TICK_RATE, { moveX: 1 });
    running.run(1, { moveX: 1, fire: true });
    const b = running.all('shotFired')[0]!;
    expect(b.speed).toBeCloseTo(5.4, 6);
    expect(b.moving).toBe(true);
    expect(b.spreadDeg).toBeCloseTo(0.2 + 6, 9);

    const walking = setup();
    walking.run(TICK_RATE, { moveX: 1, walk: true });
    walking.run(1, { moveX: 1, walk: true, fire: true });
    const c = walking.all('shotFired')[0]!;
    expect(c.moving).toBe(true);
    expect(c.spreadDeg).toBeCloseTo(0.2 + 3, 9); // placeholder walk speed 2.7 = 0.5 of 5.4

    const air = setup();
    air.run(1, { jump: true });
    air.run(10);
    air.run(1, { fire: true });
    const d = air.all('shotFired')[0]!;
    expect(d.airborne).toBe(true);
    expect(d.moving).toBe(true);
    expect(d.spreadDeg).toBeCloseTo(0.2 + 10, 9);

    const landed = setup();
    landed.run(1, { jump: true });
    let ticks = 0;
    while (!landed.world.player.grounded && ticks++ < TICK_RATE) landed.run(1);
    landed.run(1, { fire: true }); // one tick after touching down: inside the 0.225 s window
    expect(landed.all('shotFired')[0]!.spreadDeg).toBeCloseTo(0.2 + 7, 9);
    landed.run(Math.ceil(0.225 * TICK_RATE), { fire: false });
    landed.run(1, { fire: true }); // landing window over, but inside the recovery time: a tap accrues
    expect(landed.all('shotFired')[1]!.spreadDeg).toBeCloseTo(sprayAccumDeg(kestrel, 0.25), 9);
  });
});

describe('recoil as data (spec §3.5)', () => {
  /** Fire `sprays` sprays of `perSpray` bullets through the pure rule, counting flips by bullet index. */
  function simulate(def: WeaponDef, sprays: number, perSpray: number, seed = 7) {
    const rng = new Rng(seed);
    const flipsAt = new Array<number>(perSpray).fill(0);
    let flips = 0;
    let eligible = 0;
    for (let s = 0; s < sprays; s++) {
      const st = freshRecoil();
      for (let i = 0; i < perSpray; i++) {
        if (i >= def.recoilProtectedBullets) eligible++;
        if (applyRecoilKick(def, st, rng, false, false)) {
          flips++;
          flipsAt[i]!++;
        }
      }
    }
    return { flips, eligible, flipsAt };
  }

  it('never switches yaw direction before the protected bullet count', () => {
    const { flipsAt } = simulate(kestrel, 2000, 30);
    for (let i = 0; i < kestrel.recoilProtectedBullets; i++) expect(flipsAt[i]).toBe(0);
    expect(flipsAt.slice(kestrel.recoilProtectedBullets).some((n) => n > 0)).toBe(true);
  });

  it('switches on ~10% of unprotected bullets over 10,000 seeded bullets', () => {
    const perSpray = 30;
    const sprays = Math.ceil(10000 / (perSpray - kestrel.recoilProtectedBullets));
    const { flips, eligible } = simulate(kestrel, sprays, perSpray);
    expect(eligible).toBeGreaterThanOrEqual(10000);
    // Binomial sd at p = 0.1, n = 10,000 is 0.003: +-0.01 is > 3 sd.
    expect(flips / eligible).toBeGreaterThan(kestrel.recoilFlipChance - 0.01);
    expect(flips / eligible).toBeLessThan(kestrel.recoilFlipChance + 0.01);
  });

  it('kicks summed over 30 bullets match the spec starting values', () => {
    // 0.30 deg up for bullets 1-11 then 0.07; 0.15 deg sideways after the 8 protected bullets.
    const noFlip: WeaponDef = { ...kestrel, recoilFlipChance: 0 };
    const st = freshRecoil();
    const rng = new Rng(1);
    for (let i = 0; i < 30; i++) applyRecoilKick(noFlip, st, rng, false, false);
    expect(st.recoilPitch).toBeCloseTo(11 * 0.3 + 19 * 0.07, 9);
    expect(st.recoilYaw).toBeCloseTo(22 * 0.15, 9);
    expect(st.recoilIndex).toBe(30);

    // With flips the yaw can only cancel, never exceed the one-sided sum; pitch is unaffected.
    const flipped = freshRecoil();
    for (let i = 0; i < 30; i++) applyRecoilKick(kestrel, flipped, new Rng(3), false, false);
    expect(flipped.recoilPitch).toBeCloseTo(11 * 0.3 + 19 * 0.07, 9);
    expect(Math.abs(flipped.recoilYaw)).toBeLessThanOrEqual(22 * 0.15 + 1e-9);
  });

  it('moving and crouched multipliers scale the kick; the pistol kicks straight up', () => {
    const run = freshRecoil();
    for (let i = 0; i < 10; i++) applyRecoilKick(kestrel, run, new Rng(1), true, false);
    expect(run.recoilPitch).toBeCloseTo(10 * 0.3 * 1.8, 9);
    expect(run.recoilYaw).toBeCloseTo(2 * 0.15 * 1.5, 9);
    const crouch = freshRecoil();
    for (let i = 0; i < 10; i++) applyRecoilKick({ ...kestrel, recoilFlipChance: 0 }, crouch, new Rng(1), false, true);
    expect(crouch.recoilYaw).toBeCloseTo(2 * 0.15 * 0.85, 9);
    const p = freshRecoil();
    for (let i = 0; i < 13; i++) applyRecoilKick(pace, p, new Rng(1), false, false);
    expect(p.recoilPitch).toBeCloseTo(13 * 0.6, 9);
    expect(p.recoilYaw).toBe(0);
  });

  it('the last pattern entry repeats past the end of the table', () => {
    expect(patternAt(kestrel.recoilPitchDeg, 0)).toBe(0.3);
    expect(patternAt(kestrel.recoilPitchDeg, 11)).toBe(0.07);
    expect(patternAt(kestrel.recoilPitchDeg, 99)).toBe(0.07);
    expect(patternAt([], 3)).toBe(0);
  });

  it('the aim offset returns to the crosshair after the gun recovery time', () => {
    const s = setup();
    const w = s.world.weapon;
    while (w.shots < 10) s.run(1, { fire: true });
    const peak = w.recoilPitch;
    expect(peak).toBeCloseTo(10 * 0.3, 9);
    s.run(Math.floor(0.34 * TICK_RATE), { fire: false });
    expect(w.recoilPitch).toBe(peak); // still inside the 0.35 s delay
    s.run(2, { fire: false });
    expect(w.recoilPitch).toBeLessThan(peak);
    s.run(Math.ceil((peak / kestrel.recoilReturnDegPerSec) * TICK_RATE) + 1, { fire: false });
    expect(w.recoilPitch).toBe(0);
    expect(w.recoilYaw).toBe(0);
  });
});

describe('damage (spec §3.2)', () => {
  it('uses the band containing the distance, per zone; past 50 m the last band', () => {
    expect(damageFor(kestrel, 'head', 5)).toBe(156);
    expect(damageFor(kestrel, 'body', 20)).toBe(39);
    expect(damageFor(kestrel, 'body', 20.01)).toBe(35);
    expect(damageFor(kestrel, 'leg', 10)).toBe(33.15);
    expect(damageFor(kestrel, 'leg', 49)).toBe(29.75);
    expect(damageFor(kestrel, 'head', 80)).toBe(140);
    expect(damageFor(pace, 'head', 30)).toBe(105);
    expect(damageFor(pace, 'head', 31)).toBe(87.5);
    expect(damageFor(pace, 'body', 10)).toBe(30);
    expect(damageFor(pace, 'leg', 40)).toBe(21.25);
  });

  it('shotImpact and targetHit carry shot id, zone, damage and kill (design §14.3)', () => {
    const postRoom: LevelDef = {
      name: 'post',
      boxes: [{ tag: 'floor', min: vec3(-20, -1, -20), max: vec3(20, 0, 20) }],
      spawn: { pos: vec3(0, 0, 0), yaw: 0 },
      targets: [{ kind: 'post', pos: vec3(0, 0, -10) }],
    };
    const s = setup(postRoom);
    const id = s.world.targets.find((t) => t.alive)!.id;
    const eye = s.world.player.eyeHeight;
    const pitchTo = (y: number): number => Math.atan2(y - eye, 10);
    s.run(1, { yaw: 0, pitch: pitchTo(1.2), fire: true }); // chest
    const shot = s.all('shotFired')[0]!;
    const impact = s.all('shotImpact')[0]!;
    expect(shot).toMatchObject({ shotId: 1, weapon: 'kestrel', recoilIndex: 0, ammo: 29, moving: false });
    expect(impact).toMatchObject({ shotId: 1, result: 'hit', targetId: id, zone: 'body', damage: 39, killed: false, onTarget: true });
    expect(s.all('targetHit')[0]).toMatchObject({ targetId: id, zone: 'body', damage: 39, hpLeft: 61, killed: false });
    expect(impact.distance).toBeLessThan(10);

    s.run(Math.ceil(0.4 * TICK_RATE), { fire: false });
    s.run(1, { yaw: 0, pitch: pitchTo(1.66), fire: true }); // head
    expect(s.all('shotImpact')[1]).toMatchObject({ shotId: 2, zone: 'head', damage: 156, killed: true });
    expect(s.all('targetKilled')[0]).toMatchObject({ targetId: id, zone: 'head', bullets: 2 });
  });
});

describe('magazine, reload, equip, swap (spec §3.1)', () => {
  const firstShotTickAfter = (s: ReturnType<typeof setup>, from: number): number =>
    s.ticksOf('shotFired').find((t) => t > from)! - from;

  it('empties the magazine, auto-reloads in exactly the reload time, then fires again', () => {
    const s = setup();
    s.run(TICK_RATE * 6, { fire: true, pitch: 0.4 });
    const shots = s.all('shotFired');
    expect(shots[29]!.ammo).toBe(0);
    const reloadStart = s.ticksOf('reloadStarted')[0]!;
    expect(reloadStart).toBe(s.ticksOf('shotFired')[29]);
    const done = s.ticksOf('reloadCompleted')[0]!;
    expect(done - reloadStart).toBe(Math.round(kestrel.reloadSec * TICK_RATE));
    expect(s.all('reloadCompleted')[0]).toMatchObject({ weapon: 'kestrel', ammo: 30, reserve: 30 });
    expect(firstShotTickAfter(s, done - 1)).toBe(1); // first shot on the completion tick
  });

  it('manual reload only when the magazine is not full, using reserve ammo', () => {
    const s = setup();
    s.run(1, { reload: true });
    expect(s.all('reloadStarted')).toHaveLength(0);
    s.run(1, { fire: true });
    s.run(40, { fire: false });
    s.run(1, { reload: true });
    expect(s.all('reloadStarted')).toHaveLength(1);
    s.run(Math.round(kestrel.reloadSec * TICK_RATE) - 1);
    expect(s.world.weapon.slots[0]!.mag).toBe(29);
    s.run(1);
    expect(s.world.weapon.slots[0]).toMatchObject({ mag: 30, reserve: 59 });
  });

  it('cannot fire while reloading', () => {
    const s = setup();
    s.run(1, { fire: true });
    s.run(1, { fire: false, reload: true });
    s.run(TICK_RATE, { fire: true });
    expect(s.all('shotFired')).toHaveLength(1);
  });

  it('equip time gates the first shot after a swap (Kestrel 1.0 s, Pace 0.75 s)', () => {
    const s = setup();
    s.run(1, { switchTo: 1 });
    expect(s.all('weaponSwitched')[0]).toMatchObject({ weapon: 'pace', slot: 1, equipSec: 0.75 });
    const swapTick = s.world.tick;
    const paceTicks = Math.round(pace.equipSec * TICK_RATE);
    s.run(paceTicks - 2);
    s.run(1, { fire: true }); // tick swap+95: still equipping, and the press is spent
    s.run(1, { fire: false });
    expect(s.all('shotFired')).toHaveLength(0);
    expect(s.world.tick - swapTick).toBe(paceTicks);
    s.run(1, { fire: true });
    expect(s.all('shotFired')).toHaveLength(1);
    expect(s.all('shotFired')[0]!.weapon).toBe('pace');

    const k = setup();
    k.run(1, { switchTo: 1 });
    k.run(TICK_RATE);
    k.run(1, { switchTo: 0, fire: true });
    const back = k.world.tick;
    k.run(TICK_RATE * 2, { fire: true });
    expect(firstShotTickAfter(k, back)).toBe(Math.round(kestrel.equipSec * TICK_RATE));
  });

  it('a swap cancels a reload; the magazine keeps its ammo per weapon', () => {
    const s = setup();
    s.run(5, { fire: true });
    s.run(40, { fire: false });
    const mag = s.world.weapon.slots[0]!.mag;
    expect(mag).toBeLessThan(30);
    s.run(1, { reload: true });
    s.run(Math.round(kestrel.reloadSec * TICK_RATE) - 2);
    s.run(1, { switchTo: 1 }); // one tick before the reload would complete
    expect(s.all('reloadCancelled')).toHaveLength(1);
    expect(s.all('reloadCompleted')).toHaveLength(0);
    expect(s.world.weapon.slots[0]!.mag).toBe(mag);
    s.run(TICK_RATE * 3);
    s.run(1, { switchTo: 0 });
    s.run(TICK_RATE * 3);
    expect(s.world.weapon.slots[0]!.mag).toBe(mag); // the cancelled reload never completes
    expect(s.world.weapon.slots[1]!.mag).toBe(pace.magazine);
  });

  it('semi-auto fires once per press, never faster than its fire rate', () => {
    const s = setup();
    s.world.weapon.active = 1;
    s.run(TICK_RATE, { fire: true });
    expect(s.all('shotFired')).toHaveLength(1);
    s.log.length = 0;
    for (let i = 0; i < TICK_RATE * 2; i++) s.run(1, { fire: i % 2 === 0 }); // click every other tick
    expect(s.all('shotFired').length).toBeLessThanOrEqual(Math.ceil(2 * pace.fireRateHz) + 1);
    expect(s.all('shotFired').length).toBeGreaterThanOrEqual(Math.floor(2 * pace.fireRateHz) - 1);
  });

  it('infinite magazine never runs dry and survives reset()', () => {
    const s = setup();
    s.world.weapon.infiniteMagazine = true;
    s.world.reset();
    s.run(4);
    s.run(TICK_RATE * 10, { fire: true, pitch: 0.4 });
    expect(s.all('shotFired')).toHaveLength(110);
    expect(s.all('reloadStarted')).toHaveLength(0);
    expect(s.world.weapon.slots[0]!.mag).toBe(30);
  });
});

describe('100 Kestrel bullets at a flat wall (headless spray test)', () => {
  const WALL_Z = -10;
  const wallRoom: LevelDef = {
    name: 'spray wall',
    boxes: [
      { tag: 'floor', min: vec3(-30, -1, -30), max: vec3(30, 0, 30) },
      { tag: 'wall', min: vec3(-30, 0, WALL_Z - 1), max: vec3(30, 30, WALL_Z) },
    ],
    spawn: { pos: vec3(0, 0, 0), yaw: 0 },
    targets: [],
  };

  const s = setup(wallRoom, 42);
  s.world.weapon.infiniteMagazine = true;
  const aimPitch = 0.05;
  for (let i = 0; i < TICK_RATE * 12 && s.world.weapon.shots < 100; i++) s.run(1, { fire: true, pitch: aimPitch, yaw: 0 });
  const shots = s.all('shotFired');
  const impacts = s.all('shotImpact');

  /** Angle in degrees between the aim-plus-recoil direction and the actual impact. */
  const deviationDeg = (shot: Shot, impact: Impact): number => {
    const aim: Vec3 = directionFromAngles(vec3(), -shot.recoilYawDeg / RAD2DEG, aimPitch + shot.recoilPitchDeg / RAD2DEG);
    const dx = impact.point.x - shot.origin.x;
    const dy = impact.point.y - shot.origin.y;
    const dz = impact.point.z - shot.origin.z;
    const l = Math.hypot(dx, dy, dz);
    const c = (aim.x * dx + aim.y * dy + aim.z * dz) / l;
    return Math.acos(Math.min(1, c)) * RAD2DEG;
  };

  it('fires 100 bullets that all land on the wall', () => {
    expect(shots).toHaveLength(100);
    expect(impacts).toHaveLength(100);
    expect(impacts.every((e) => e.result === 'miss' && !e.onTarget && Math.abs(e.point.z - WALL_Z) < 1e-6)).toBe(true);
    expect(shots.every((e, i) => e.shotId === i + 1 && impacts[i]!.shotId === e.shotId)).toBe(true);
  });

  it('follows the recoil pattern: cumulative pitch kicks, no yaw before the protected bullets', () => {
    let pitch = 0;
    for (let i = 0; i < 100; i++) {
      const e = shots[i]!;
      expect(e.recoilIndex).toBe(i);
      expect(e.recoilPitchDeg).toBeCloseTo(pitch, 9); // no return during a held spray
      pitch += patternAt(kestrel.recoilPitchDeg, i);
      if (i <= kestrel.recoilProtectedBullets) expect(e.recoilYawDeg).toBe(0);
      if (i > 0) expect(Math.abs(e.recoilYawDeg - shots[i - 1]!.recoilYawDeg)).toBeLessThanOrEqual(0.15 + 1e-9);
    }
    expect(shots[30]!.recoilPitchDeg).toBeCloseTo(11 * 0.3 + 19 * 0.07, 9);
    // The pattern is visible on the wall: bullet 31 lands ~4.6 deg above bullet 1, within the cone.
    const elev = (e: Impact, o: Vec3): number => Math.atan2(e.point.y - o.y, o.z - e.point.z) * RAD2DEG;
    const rise = elev(impacts[30]!, shots[30]!.origin) - elev(impacts[0]!, shots[0]!.origin);
    expect(Math.abs(rise - shots[30]!.recoilPitchDeg)).toBeLessThan(kestrel.spreadMaxDeg + kestrel.spreadFirstDeg);
  });

  it('every bullet lands inside its spread cone, which grows from 0.2 to 0.9 deg', () => {
    for (let i = 0; i < 100; i++) {
      const e = shots[i]!;
      const n = i === 0 ? 0 : 1 / kestrel.tapEfficiency + (i - 1);
      expect(e.spreadDeg).toBeCloseTo(sprayAccumDeg(kestrel, n), 9);
      expect(deviationDeg(e, impacts[i]!)).toBeLessThanOrEqual(e.spreadDeg + 1e-6);
    }
    expect(shots[0]!.spreadDeg).toBeCloseTo(0.2, 9);
    expect(shots[99]!.spreadDeg).toBeCloseTo(0.9, 9);
    // Still shots are centre-biased (radius = spread * U^1.5, mean 0.4 * spread = 0.36 deg at max).
    const late = shots.slice(9).map((e, k) => deviationDeg(e, impacts[k + 9]!));
    const mean = late.reduce((a, b) => a + b, 0) / late.length;
    expect(mean).toBeGreaterThan(0.25);
    expect(mean).toBeLessThan(0.48);
  });
});
