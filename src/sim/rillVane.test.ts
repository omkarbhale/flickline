import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { weapon as weaponTable, weaponRules, type WeaponDef, type WeaponId } from '../config/weapon';
import { EventBus } from '../core/eventBus';
import { RAD2DEG } from '../core/math';
import { Rng } from '../core/rng';
import { TICK_DT, TICK_RATE } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import { createTickInput, type LevelDef, type SimEvents, type TickInput } from './types';
import { applyRecoilKick, damageFor, patternAt, sprayAccumDeg, sprayIncrement, type RecoilState } from './weaponModel';
import { World } from './world';

const { kestrel, rill, vane } = weaponTable;

type Shot = SimEvents['shotFired'];
type Impact = SimEvents['shotImpact'];

const WALL_Z = -10;
const wallRoom: LevelDef = {
  name: 'spray range',
  boxes: [
    { tag: 'floor', min: vec3(-30, -1, -30), max: vec3(30, 0, 30) },
    { tag: 'wall', min: vec3(-30, 0, WALL_Z - 1), max: vec3(30, 30, WALL_Z) },
  ],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

/** A world with `primary` in hand (fresh, equipped), recording every sim event. */
function setup(primary: WeaponId, seed = 42) {
  const world = new World({ level: wallRoom, tunables: cloneTunables(), seed });
  expect(world.setLoadout({ primary, sidearm: 'pace' }).ok).toBe(true);
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; data: unknown }[] = [];
  bus.onAny((type, e) => log.push({ type, data: JSON.parse(JSON.stringify(e)) }));
  const input = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.reload = false;
      input.switchTo = -1;
    }
  };
  const all = <K extends keyof SimEvents>(t: K): SimEvents[K][] =>
    log.filter((l) => l.type === t).map((l) => l.data as SimEvents[K]);
  run(4); // settle on the floor
  log.length = 0;
  return { world, run, all, input };
}

function freshRecoil(): RecoilState {
  return { recoilIndex: 0, recoilPitch: 0, recoilYaw: 0, yawSign: 1, yawTarget: 1 };
}

/** Angle in degrees between the aim-plus-recoil direction and the actual impact. */
function deviationDeg(shot: Shot, impact: Impact, aimPitch: number): number {
  const aim: Vec3 = directionFromAngles(vec3(), -shot.recoilYawDeg / RAD2DEG, aimPitch + shot.recoilPitchDeg / RAD2DEG);
  const dx = impact.point.x - shot.origin.x;
  const dy = impact.point.y - shot.origin.y;
  const dz = impact.point.z - shot.origin.z;
  const l = Math.hypot(dx, dy, dz);
  return Math.acos(Math.min(1, (aim.x * dx + aim.y * dy + aim.z * dz) / l)) * RAD2DEG;
}

/** Hold fire at a flat wall until `n` bullets have left the gun (infinite magazine). */
function sprayBurst(primary: WeaponId, n: number) {
  const s = setup(primary);
  s.world.weapon.infiniteMagazine = true;
  const aimPitch = 0.05;
  for (let i = 0; i < TICK_RATE * 12 && s.world.weapon.shots < n; i++) s.run(1, { fire: true, pitch: aimPitch, yaw: 0 });
  return { shots: s.all('shotFired'), impacts: s.all('shotImpact'), aimPitch };
}

describe('Rill and Vane table entries (spec §7)', () => {
  it('Rill is the smg archetype with the spec numbers', () => {
    expect(rill.archetype).toBe('smg');
    expect(rill.slotClass).toBe('primary');
    expect(rill.fireMode).toBe('auto');
    expect([rill.fireRateHz, rill.magazine, rill.reserve, rill.reloadSec, rill.equipSec]).toEqual([13.333, 30, 90, 2.25, 0.75]);
    expect(rill.runSpeedMps).toBeCloseTo(0.85 * 6.75, 9);
    expect([rill.spreadFirstDeg, rill.spreadMaxDeg, rill.crouchSpreadMult]).toEqual([0.4, 1.3, 0.85]);
    expect([rill.recoverySec, rill.tapEfficiency, rill.spreadRampBullets]).toEqual([0.25, 3, 6]);
    expect([rill.errCrouchMoveDeg, rill.errWalkDeg, rill.errRunDeg, rill.errAirDeg]).toEqual([0.15, 1, 2.5, 10]);
    expect(rill.penetration).toBe('low');
    expect(rill.damageBands).toEqual([
      { upToM: 15, head: 78, body: 26, leg: 22.1 },
      { upToM: 30, head: 66, body: 22, leg: 18.7 },
      { upToM: 50, head: 60, body: 20, leg: 17 },
    ]);
    expect([rill.recoilProtectedBullets, rill.recoilFlipChance, rill.recoilFlipTimeSec]).toEqual([5, 0.1, 0.28]);
  });

  it('Vane is the rifle_precise archetype with the spec numbers', () => {
    expect(vane.archetype).toBe('rifle_precise');
    expect(vane.slotClass).toBe('primary');
    expect(vane.fireMode).toBe('auto');
    expect([vane.fireRateHz, vane.magazine, vane.reserve, vane.reloadSec, vane.equipSec]).toEqual([9.75, 25, 50, 2.5, 1]);
    expect(vane.runSpeedMps).toBeCloseTo(0.8 * 6.75, 9);
    expect([vane.spreadFirstDeg, vane.spreadMaxDeg, vane.crouchSpreadMult]).toEqual([0.25, 1, 0.85]);
    expect([vane.recoverySec, vane.tapEfficiency, vane.spreadRampBullets]).toEqual([0.375, 6, 8]);
    expect([vane.errCrouchMoveDeg, vane.errWalkDeg, vane.errRunDeg, vane.errAirDeg]).toEqual([0.8, 3, 6, 10]);
    expect(vane.penetration).toBe('medium');
    expect(vane.damageBands).toEqual([{ upToM: 50, head: 160, body: 40, leg: 34 }]);
    expect([vane.recoilProtectedBullets, vane.recoilFlipChance, vane.recoilFlipTimeSec]).toEqual([6, 0.1, 0.6]);
  });

  it('Pace is the sidearm; Kestrel, Vane and Rill are primaries', () => {
    expect(weaponTable.pace.slotClass).toBe('sidearm');
    expect([kestrel, vane, rill].map((d) => d.slotClass)).toEqual(['primary', 'primary', 'primary']);
  });

  it('is plain JSON data like the other weapons', () => {
    const t = cloneTunables();
    expect(t.weapon.rill).toEqual(rill);
    expect(t.weapon.vane).toEqual(vane);
  });
});

describe('damage by range (spec §3.2, §7.4)', () => {
  it('Rill falls off in three bands; past 50 m the last band holds', () => {
    expect(damageFor(rill, 'body', 10)).toBe(26);
    expect(damageFor(rill, 'body', 15)).toBe(26);
    expect(damageFor(rill, 'body', 15.1)).toBe(22);
    expect(damageFor(rill, 'head', 40)).toBe(60);
    expect(damageFor(rill, 'leg', 49)).toBe(17);
    expect(damageFor(rill, 'body', 120)).toBe(20);
  });

  it('Vane has no falloff: one head shot kills an unshielded player at any range', () => {
    for (const d of [2, 25, 50, 90]) {
      expect(damageFor(vane, 'head', d)).toBe(160);
      expect(damageFor(vane, 'body', d)).toBe(40);
      expect(damageFor(vane, 'leg', d)).toBe(34);
    }
  });
});

describe('Vane spread: first shot and tap recovery (spec §3.3)', () => {
  const tapAfter = (s: ReturnType<typeof setup>, gapTicks: number): Shot => {
    s.run(gapTicks, { fire: false });
    s.run(1, { fire: true });
    return s.all('shotFired').at(-1)!;
  };

  it('the first shot of a fresh gun is a 0.25 deg cone; crouched it is 0.2125', () => {
    const s = setup('vane');
    s.run(1, { fire: true });
    expect(s.all('shotFired')[0]!.spreadDeg).toBeCloseTo(0.25, 9);

    const c = setup('vane');
    c.run(40, { crouch: true });
    c.run(1, { crouch: true, fire: true });
    expect(c.all('shotFired')[0]!.spreadDeg).toBeCloseTo(0.25 * 0.85, 9);
  });

  it('a tap 0.375 s after the last shot is a fresh first shot; a quicker tap accrues 1/6 of a bullet', () => {
    const s = setup('vane');
    expect(tapAfter(s, 1).spreadDeg).toBeCloseTo(0.25, 9);
    // 0.30 s later: inside the recovery time, so this tap carries the previous tap's 1/6 bullet.
    const quick = tapAfter(s, Math.round(0.3 * TICK_RATE) - 1);
    expect(quick.spreadDeg).toBeCloseTo(sprayAccumDeg(vane, 1 / 6), 9);
    expect(quick.spreadDeg).toBeGreaterThan(0.25);
    // Exactly the recovery time after the last shot: fully recovered.
    expect(tapAfter(s, Math.round(0.375 * TICK_RATE) - 1).spreadDeg).toBeCloseTo(0.25, 9);
  });

  it('held fire accrues a full bullet per shot, taps only 1/6 (punishes spraying)', () => {
    expect(sprayIncrement(vane, weaponRules, 1 / 9.75)).toBe(1);
    expect(sprayIncrement(vane, weaponRules, 0.375)).toBeCloseTo(1 / 6, 12);
    expect(sprayAccumDeg(vane, 8)).toBeCloseTo(1, 12); // max cone after n_ramp = 8 held bullets
  });

  it('fires 9.75 shots per second while held and runs dry after 25', () => {
    const s = setup('vane');
    s.run(TICK_RATE, { fire: true });
    expect(s.all('shotFired').length).toBe(10); // t = 0, 0.1026, ... 0.9231 within 1 s
    s.run(TICK_RATE * 2, { fire: true });
    expect(s.all('shotFired').length).toBeGreaterThanOrEqual(25);
    expect(s.all('reloadStarted')).toHaveLength(1);
    expect(s.world.weapon.slots[0]!.mag).toBeLessThanOrEqual(25);
  });
});

describe('100 Rill bullets at a flat wall (headless spray test)', () => {
  const { shots, impacts, aimPitch } = sprayBurst('rill', 100);

  it('fires 100 bullets that all land on the wall', () => {
    expect(shots).toHaveLength(100);
    expect(impacts).toHaveLength(100);
    expect(shots.every((e) => e.weapon === 'rill')).toBe(true);
    expect(impacts.every((e) => e.result === 'miss' && Math.abs(e.point.z - WALL_Z) < 1e-6)).toBe(true);
  });

  it('every bullet lands inside its spread cone, which grows from 0.4 to 1.3 deg over 6 bullets', () => {
    for (let i = 0; i < 100; i++) {
      const e = shots[i]!;
      const n = i === 0 ? 0 : 1 / rill.tapEfficiency + (i - 1);
      expect(e.spreadDeg).toBeCloseTo(sprayAccumDeg(rill, n), 9);
      expect(deviationDeg(e, impacts[i]!, aimPitch)).toBeLessThanOrEqual(e.spreadDeg + 1e-6);
    }
    expect(shots[0]!.spreadDeg).toBeCloseTo(0.4, 9);
    expect(shots[7]!.spreadDeg).toBeCloseTo(1.3, 9);
    expect(shots[99]!.spreadDeg).toBeCloseTo(1.3, 9);
    // Centre-biased when still: mean radius = 0.4 * spread = 0.52 deg at max.
    const late = shots.slice(8).map((e, k) => deviationDeg(e, impacts[k + 8]!, aimPitch));
    const mean = late.reduce((a, b) => a + b, 0) / late.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.7);
  });

  it('follows the Rill recoil pattern: 0.22 deg up for 8 bullets then 0.06, no yaw before bullet 6', () => {
    let pitch = 0;
    for (let i = 0; i < 100; i++) {
      const e = shots[i]!;
      expect(e.recoilIndex).toBe(i);
      expect(e.recoilPitchDeg).toBeCloseTo(pitch, 9);
      pitch += patternAt(rill.recoilPitchDeg, i);
      if (i <= rill.recoilProtectedBullets) expect(e.recoilYawDeg).toBe(0);
    }
    expect(shots[30]!.recoilPitchDeg).toBeCloseTo(8 * 0.22 + 22 * 0.06, 9);
  });

  it('kicks less than the Kestrel: lower per-bullet magnitude and a lower total climb', () => {
    const kest = sprayBurst('kestrel', 100);
    const mag = (e: Shot): number => Math.hypot(e.recoilPitchDeg, e.recoilYawDeg);
    // Same seed class, same 100 bullets: the Rill's accumulated aim offset stays below the Kestrel's.
    expect(shots[99]!.recoilPitchDeg).toBeLessThan(kest.shots[99]!.recoilPitchDeg);
    const rillPeak = Math.max(...shots.map(mag));
    const kestPeak = Math.max(...kest.shots.map(mag));
    expect(rillPeak).toBeLessThan(kestPeak);
    // Per-bullet kick, from the data (flips only change yaw sign, not size).
    for (let i = 0; i < 100; i++) {
      const r = Math.hypot(patternAt(rill.recoilPitchDeg, i), patternAt(rill.recoilYawDeg, i));
      const k = Math.hypot(patternAt(kestrel.recoilPitchDeg, i), patternAt(kestrel.recoilYawDeg, i));
      expect(r).toBeLessThan(k + 1e-12);
    }
  });
});

describe('recoil of the new weapons as data (spec §3.5)', () => {
  const sum = (def: WeaponDef, n: number): RecoilState => {
    const noFlip: WeaponDef = { ...def, recoilFlipChance: 0 };
    const st = freshRecoil();
    const rng = new Rng(1);
    for (let i = 0; i < n; i++) applyRecoilKick(noFlip, st, rng, false, false);
    return st;
  };

  it('Vane: 0.35 deg up for 9 bullets then 0.08; 0.18 sideways after the 6 protected bullets', () => {
    const st = sum(vane, 30);
    expect(st.recoilPitch).toBeCloseTo(9 * 0.35 + 21 * 0.08, 9);
    expect(st.recoilYaw).toBeCloseTo(24 * 0.18, 9);
  });

  it('Rill: 0.22 deg up for 8 bullets then 0.06; 0.12 sideways after the 5 protected bullets', () => {
    const st = sum(rill, 30);
    expect(st.recoilPitch).toBeCloseTo(8 * 0.22 + 22 * 0.06, 9);
    expect(st.recoilYaw).toBeCloseTo(25 * 0.12, 9);
  });

  it('never switches yaw before the protected count and switches on about 10% after it', () => {
    for (const def of [vane, rill]) {
      const rng = new Rng(9);
      let flips = 0;
      let eligible = 0;
      for (let s = 0; s < 1000; s++) {
        const st = freshRecoil();
        for (let i = 0; i < 30; i++) {
          const flipped = applyRecoilKick(def, st, rng, false, false);
          if (i < def.recoilProtectedBullets) expect(flipped).toBe(false);
          else {
            eligible++;
            if (flipped) flips++;
          }
        }
      }
      expect(flips / eligible).toBeGreaterThan(0.09);
      expect(flips / eligible).toBeLessThan(0.11);
    }
  });

  it('a shot fired once the gun recovery time has passed is a centred first shot, after any burst (#191)', () => {
    for (const id of ['pace', 'kestrel', 'vane', 'rill'] as const) {
      const def = weaponTable[id];
      for (const burst of [1, 3, 10, 30]) {
        const s = setup(id === 'pace' ? 'kestrel' : id);
        const w = s.world.weapon;
        w.infiniteMagazine = true; // no reload between the burst and the tap
        if (id === 'pace') s.run(Math.ceil(def.equipSec * TICK_RATE) + 2, { switchTo: 1 });
        expect(s.world.weapon.slots[w.active]!.id).toBe(id);
        // Fire as fast as the gun allows (semi-auto: a fresh press every other tick).
        for (let i = 0; i < TICK_RATE * 10 && w.shots < burst; i++) {
          s.run(1, { fire: def.fireMode === 'auto' || i % 2 === 0 });
        }
        expect(w.shots).toBe(burst);
        expect(w.recoilPitch).toBeGreaterThan(0);
        // Release and fire on the first tick the reset allows.
        let k = 0;
        while ((k + 1) * TICK_DT < def.recoverySec - 1e-9) {
          s.run(1, { fire: false });
          k++;
        }
        s.run(1, { fire: true });
        const shots = s.all('shotFired');
        const tap = shots[shots.length - 1]!;
        expect(shots.length, `${id} burst ${burst}`).toBe(burst + 1);
        expect([tap.recoilIndex, tap.recoilPitchDeg, tap.recoilYawDeg], `${id} burst ${burst}`).toEqual([0, 0, 0]);
        expect(tap.spreadDeg, `${id} burst ${burst}`).toBeCloseTo(def.spreadFirstDeg, 9);
      }
    }
  });

  it('every weapon holds its aim offset for less than its recovery time, and autos through held fire', () => {
    for (const def of Object.values(weaponTable)) {
      expect(def.recoilReturnDelaySec, def.name).toBeLessThan(def.recoverySec);
      if (def.fireMode === 'auto') expect(def.recoilReturnDelaySec, def.name).toBeGreaterThan(1 / def.fireRateHz);
    }
  });
});
