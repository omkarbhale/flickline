import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { VIEWMODEL_IDS, type ViewmodelId } from '../config/viewmodel';
import type { WeaponId } from '../config/weapon';
import { EventBus } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import { testRoom } from '../sim/levels';
import { createTickInput, type SimEvents, type WeaponState } from '../sim/types';
import { World } from '../sim/world';
import { buildViewmodel } from './viewmodelModel';
import { createViewmodelPose, poseTimeSec, transformPoint, viewmodelPose, type ViewmodelPose } from './viewmodelPose';

const tun = cloneTunables();
const cfg = tun.viewmodel;

function poseOf(w: WeaponState, id: ViewmodelId, tick: number, alpha: number, mirror = false): ViewmodelPose {
  const sim: WeaponId = w.slots[w.active]!.id;
  return viewmodelPose(createViewmodelPose(), w, tun.weapon[sim], cfg.weapons[id], cfg, tick * TICK_DT, poseTimeSec(tick, alpha), mirror);
}

function expectSamePose(a: ViewmodelPose, b: ViewmodelPose): void {
  for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) expect(a[k]).toBeCloseTo(b[k], 9);
  expect(a.mirror).toBe(b.mirror);
}

/** Run a seeded world through a scripted input and return the pose at every tick. */
function run(seed: number, ticks: number): { poses: ViewmodelPose[]; world: World } {
  const world = new World({ level: testRoom, tunables: cloneTunables(), seed });
  const bus = new EventBus<SimEvents>();
  const input = createTickInput();
  const poses: ViewmodelPose[] = [];
  for (let t = 0; t < ticks; t++) {
    input.fire = t >= 8 && t < 200; // a held spray, then release
    input.reload = t === 300;
    world.step(input, bus);
    poses.push(poseOf(world.weapon, 'kestrel', world.tick, 1));
  }
  return { poses, world };
}

describe('viewmodel pose is a pure function of the sim weapon state', () => {
  it('two identical seeded runs give identical transforms at every tick', () => {
    const a = run(7, 520);
    const b = run(7, 520);
    expect(b.poses).toEqual(a.poses); // exact, no tolerance
    expect(a.poses.some((p) => p.rx !== a.poses[0]!.rx)).toBe(true); // and it actually moves
  });

  it('follows the sim recoil: a different seed flips the yaw sway where the sim flips its direction', () => {
    const a = run(1, 200);
    const sides = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) sides.add(Math.sign(run(seed, 200).poses[199]!.ry - cfg.weapons.kestrel.restYawDeg * DEG2RAD));
    expect(sides.size).toBeGreaterThan(1);
    expect(a.poses.length).toBe(200);
  });

  it('depends on nothing but its arguments: repeated calls agree, the state is not mutated', () => {
    const { world } = run(3, 120);
    const before = JSON.stringify(world.weapon);
    const p1 = poseOf(world.weapon, 'kestrel', world.tick, 0.37);
    const p2 = poseOf(world.weapon, 'kestrel', world.tick, 0.37);
    expect(p1).toEqual(p2);
    expect(JSON.stringify(world.weapon)).toBe(before);
  });

  it('kicks the same frame as the shot, then settles back', () => {
    const world = new World({ level: testRoom, tunables: cloneTunables(), seed: 1 });
    const bus = new EventBus<SimEvents>();
    const input = createTickInput();
    for (let i = 0; i < 8; i++) world.step(input, bus);
    const rest = poseOf(world.weapon, 'kestrel', world.tick, 1);
    input.fire = true;
    world.step(input, bus);
    input.fire = false;
    expect(world.weapon.shots).toBe(1);
    const shot = poseOf(world.weapon, 'kestrel', world.tick, 1);
    expect(shot.z).toBeGreaterThan(rest.z + cfg.weapons.kestrel.kickBackM * 0.9); // back towards the player at once
    expect(shot.rx).toBeGreaterThan(rest.rx); // muzzle up
    for (let i = 0; i < 128; i++) world.step(input, bus);
    const later = poseOf(world.weapon, 'kestrel', world.tick, 1);
    expect(later.z).toBeCloseTo(rest.z, 3);
    expect(later.rx).toBeCloseTo(rest.rx, 3);
  });

  it('climbs with the sim aim offset and comes back when the sim returns it', () => {
    const { world } = run(5, 120); // mid-spray
    expect(world.weapon.recoilPitch).toBeGreaterThan(0.5);
    const mid = poseOf(world.weapon, 'kestrel', world.tick, 1);
    const w2 = { ...world.weapon, recoilPitch: 0, recoilYaw: 0, lastShotTime: -1e9 };
    const rest = poseOf(w2, 'kestrel', world.tick, 1);
    expect(mid.rx).toBeGreaterThan(rest.rx + 0.01);
  });

  it('is smooth between ticks (alpha) and never produces NaN', () => {
    const { world } = run(2, 150);
    let prev = poseOf(world.weapon, 'kestrel', world.tick, 0);
    for (let a = 0.1; a <= 1.0001; a += 0.1) {
      const p = poseOf(world.weapon, 'kestrel', world.tick, a);
      for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const) {
        expect(Number.isFinite(p[k])).toBe(true);
        expect(Math.abs(p[k] - prev[k])).toBeLessThan(0.02);
      }
      prev = p;
    }
  });
});

describe('equip and reload animations come from the sim timers', () => {
  function afterSwitch(ticks: number): World {
    const world = new World({ level: testRoom, tunables: cloneTunables(), seed: 1 });
    const bus = new EventBus<SimEvents>();
    const input = createTickInput();
    input.switchTo = 1;
    world.step(input, bus);
    input.switchTo = -1;
    for (let i = 0; i < ticks; i++) world.step(input, bus);
    return world;
  }

  it('equip: lowered at the start, back at rest when the sim says equipped', () => {
    const w0 = afterSwitch(0);
    expect(w0.weapon.equipLeft).toBeGreaterThan(0);
    const start = poseOf(w0.weapon, 'pace', w0.tick, 1);
    const rest = poseOf({ ...w0.weapon, equipLeft: 0 }, 'pace', w0.tick, 1);
    expect(start.y).toBeLessThan(rest.y - cfg.equip.dropM * 0.9);
    expect(start.rx).toBeLessThan(rest.rx - 0.3);
    const w1 = afterSwitch(Math.ceil(tun.weapon.pace.equipSec / TICK_DT) + 2);
    expect(w1.weapon.equipLeft).toBe(0);
    expectSamePose(poseOf(w1.weapon, 'pace', w1.tick, 1), rest);
    // Monotonic rise in between.
    let last = -Infinity;
    for (let t = 0; t < 96; t += 8) {
      const w = afterSwitch(t);
      const y = poseOf(w.weapon, 'pace', w.tick, 1).y;
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
  });

  it('reload: lowered and tilted mid-reload, back at rest when the reload completes', () => {
    const world = new World({ level: testRoom, tunables: cloneTunables(), seed: 1 });
    const bus = new EventBus<SimEvents>();
    const input = createTickInput();
    input.fire = true;
    for (let i = 0; i < 8 * 128 && world.weapon.reloadLeft === 0; i++) world.step(input, bus); // empty the magazine
    input.fire = false;
    expect(world.weapon.reloadLeft).toBeGreaterThan(0);
    const total = tun.weapon.kestrel.reloadSec;
    const rest = poseOf({ ...world.weapon, reloadLeft: 0, lastShotTime: -1e9, recoilPitch: 0, recoilYaw: 0 }, 'kestrel', world.tick, 1);
    let lowest = Infinity;
    for (let i = 0; i < Math.ceil(total / TICK_DT) + 2; i++) {
      world.step(input, bus);
      const p = poseOf({ ...world.weapon, lastShotTime: -1e9, recoilPitch: 0, recoilYaw: 0 }, 'kestrel', world.tick, 1);
      lowest = Math.min(lowest, p.y);
    }
    expect(lowest).toBeLessThan(rest.y - cfg.reload.dropM * 0.8);
    expect(world.weapon.reloadLeft).toBe(0);
    const done = poseOf({ ...world.weapon, lastShotTime: -1e9, recoilPitch: 0, recoilYaw: 0 }, 'kestrel', world.tick, 1);
    expectSamePose(done, rest);
  });
});

describe('left-handed is an exact mirror of right-handed', () => {
  it('mirrors x, yaw and roll and flags the mesh', () => {
    const { world } = run(4, 140);
    const r = poseOf(world.weapon, 'kestrel', world.tick, 0.5, false);
    const l = poseOf(world.weapon, 'kestrel', world.tick, 0.5, true);
    expect(l.mirror).toBe(true);
    expect(l.x).toBeCloseTo(-r.x, 12);
    expect(l.y).toBe(r.y);
    expect(l.z).toBe(r.z);
    expect(l.rx).toBe(r.rx);
    expect(l.ry).toBeCloseTo(-r.ry, 12);
    expect(l.rz).toBeCloseTo(-r.rz, 12);
    const m = buildViewmodel('kestrel', cfg.colors).muzzle;
    const a = transformPoint(r, m.x, m.y, m.z, { x: 0, y: 0, z: 0 });
    const b = transformPoint(l, m.x, m.y, m.z, { x: 0, y: 0, z: 0 });
    expect(b.x).toBeCloseTo(-a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(b.z).toBeCloseTo(a.z, 9);
  });

  it('transformPoint matches three.js (scale.x = -1 when mirrored, rotation YXZ)', () => {
    for (const mirror of [false, true]) {
      const pose: ViewmodelPose = { x: 0.13, y: -0.12, z: -0.35, rx: 0.2, ry: -0.15, rz: 0.1, mirror };
      const m = new Matrix4().compose(
        new Vector3(pose.x, pose.y, pose.z),
        new Quaternion().setFromEuler(new Euler(pose.rx, pose.ry, pose.rz, 'YXZ')),
        new Vector3(mirror ? -1 : 1, 1, 1),
      );
      const p = new Vector3(0.02, 0.03, -0.4).applyMatrix4(m);
      const q = transformPoint(pose, 0.02, 0.03, -0.4, { x: 0, y: 0, z: 0 });
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
      expect(q.z).toBeCloseTo(p.z, 6);
    }
  });
});

describe('the viewmodel never covers the crosshair or the screen centre', () => {
  const tanHalf = Math.tan((cfg.vfovDeg * DEG2RAD) / 2);
  const half = cfg.centreSafeHalf;

  /** Offence, if any: a point of the model (or its flash) inside the centre box. */
  function violation(id: ViewmodelId, pose: ViewmodelPose): string | null {
    const d = buildViewmodel(id, cfg.colors);
    const out = { x: 0, y: 0, z: 0 };
    const check = (x: number, y: number, z: number, what: string): string | null => {
      const m = transformPoint(pose, x, y, z, out);
      if (-m.z <= cfg.near) return null; // behind the camera plane: not drawn
      // Hor+: in units of half the screen height, so the same at every aspect ratio.
      const sx = m.x / (-m.z * tanHalf);
      const sy = m.y / (-m.z * tanHalf);
      return Math.abs(sx) < half && Math.abs(sy) < half ? `${what} at (${sx.toFixed(3)}, ${sy.toFixed(3)})` : null;
    };
    for (let v = 0; v < d.vertexCount; v++) {
      const bad = check(d.position[3 * v]!, d.position[3 * v + 1]!, d.position[3 * v + 2]!, 'vertex');
      if (bad) return bad;
    }
    // The flash: a disc of its largest radius around the muzzle (the sprite fades out by r = 1).
    const fs = (cfg.weapons[id].flash.size * 1.2) / 2;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]] as const) {
      const bad = check(d.muzzle.x + dx * fs, d.muzzle.y + dy * fs, d.muzzle.z, 'flash');
      if (bad) return bad;
    }
    return null;
  }

  function states(): WeaponState[] {
    const base = run(1, 4).world.weapon;
    const out: WeaponState[] = [];
    // Worst-case aim offsets either side, fresh kick, mid-spray.
    for (const rp of [0, 2, 4, 6]) for (const ry of [-4, 0, 4]) {
      out.push({ ...base, recoilPitch: rp, recoilYaw: ry, lastShotTime: poseTimeSec(4, 1) });
    }
    return out;
  }

  for (const id of VIEWMODEL_IDS) {
    for (const mirror of [false, true]) {
      it(`${id} (${mirror ? 'left' : 'right'} hand): clear of the centre at rest, mid-spray and at maximum recoil`, () => {
        for (const w of states()) {
          const sim: WeaponId = w.slots[w.active]!.id;
          const t = 4;
          const pose = viewmodelPose(createViewmodelPose(), w, tun.weapon[sim], cfg.weapons[id], cfg, t * TICK_DT, poseTimeSec(t, 1), mirror);
          expect(violation(id, pose), `recoil ${w.recoilPitch}/${w.recoilYaw}`).toBeNull();
        }
      });
      it(`${id} (${mirror ? 'left' : 'right'} hand): clear of the centre through every equip and reload frame`, () => {
        const base = run(1, 4).world.weapon;
        for (const [key, secs] of [['equipLeft', tun.weapon.kestrel.equipSec], ['reloadLeft', tun.weapon.kestrel.reloadSec]] as const) {
          for (let f = 0; f <= 40; f++) {
            const w = { ...base, [key]: (f / 40) * secs, lastShotTime: -1e9 } as WeaponState;
            const pose = viewmodelPose(createViewmodelPose(), w, tun.weapon.kestrel, cfg.weapons[id], cfg, 4 * TICK_DT, poseTimeSec(4, 1), mirror);
            expect(violation(id, pose), `${key} ${f}/40`).toBeNull();
          }
        }
      });
    }
  }

  it('the viewmodel FOV is its own number, independent of the locked world FOV', () => {
    expect(cfg.vfovDeg).not.toBeCloseTo(70.5, 0);
    expect(cfg.vfovDeg).toBeGreaterThan(30);
    expect(cfg.vfovDeg).toBeLessThan(90);
  });
});
