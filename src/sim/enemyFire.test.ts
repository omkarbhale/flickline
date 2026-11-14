import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { cloneTunables, type Tunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import { createShotRoll, enemyHitChance, rollShot, rollZone } from './enemyFire';
import { fireParams, straferParams } from './enemyParams';
import { PEEK_HOLD } from './peeker';
import { STRAFER_DECEL, STRAFER_STAND } from './strafer';
import { createTickInput, type LevelDef, type SimEvents, type TargetState } from './types';
import { World } from './world';

const arena = (extra: LevelDef['boxes'] = []): LevelDef => ({
  name: 'arena',
  boxes: [{ tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) }, ...extra],
  spawn: { pos: vec3(0, 0, 20), yaw: 0 },
  targets: [],
});

const base = cloneTunables();
const fireCfg = base.enemies.fire;

// ---- the hit chance model ------------------------------------------------------------------------

describe('enemy hit chance (design §5.3)', () => {
  it('starts from the dial and falls with distance', () => {
    expect(enemyHitChance(0.6, 5, false, false, fireCfg)).toBeCloseTo(0.6, 9);
    expect(enemyHitChance(0.6, fireCfg.falloffNearM, false, false, fireCfg)).toBeCloseTo(0.6, 9);
    expect(enemyHitChance(0.6, fireCfg.falloffFarM, false, false, fireCfg)).toBeCloseTo(0.6 * fireCfg.falloffFarMult, 9);
    expect(enemyHitChance(0.6, 200, false, false, fireCfg)).toBeCloseTo(0.6 * fireCfg.falloffFarMult, 9);
    const mid = enemyHitChance(0.6, 30, false, false, fireCfg);
    expect(mid).toBeLessThan(0.6);
    expect(mid).toBeGreaterThan(0.6 * fireCfg.falloffFarMult);
  });

  it('x0.5 when the player is above the accuracy threshold, x0.7 when crouched at range, both multiply', () => {
    expect(enemyHitChance(0.4, 5, true, false, fireCfg)).toBeCloseTo(0.2, 9);
    expect(enemyHitChance(0.4, 5, false, true, fireCfg)).toBeCloseTo(0.4, 9); // not "at range"
    expect(enemyHitChance(0.4, 20, false, true, fireCfg)).toBeCloseTo(enemyHitChance(0.4, 20, false, false, fireCfg) * 0.7, 9);
    expect(enemyHitChance(0.4, 20, true, true, fireCfg)).toBeCloseTo(enemyHitChance(0.4, 20, false, false, fireCfg) * 0.35, 9);
  });

  const CASES: { name: string; base: number; dist: number; moving: boolean; crouched: boolean }[] = [
    { name: 'dial 0, standing, close', base: 0.15, dist: 8, moving: false, crouched: false },
    { name: 'dial 50, standing, 15 m', base: 0.375, dist: 15, moving: false, crouched: false },
    { name: 'dial 100, standing, 30 m', base: 0.6, dist: 30, moving: false, crouched: false },
    { name: 'dial 50, strafing', base: 0.375, dist: 15, moving: true, crouched: false },
    { name: 'dial 100, crouched at range', base: 0.6, dist: 25, moving: false, crouched: true },
    { name: 'dial 100, strafing and crouched at range', base: 0.6, dist: 25, moving: true, crouched: true },
  ];
  for (const c of CASES) {
    it(`10,000 seeded rolls land within 2% of the expected rate: ${c.name}`, () => {
      const p = enemyHitChance(c.base, c.dist, c.moving, c.crouched, fireCfg);
      const rng = new Rng(20260101);
      const out = createShotRoll();
      let hits = 0;
      for (let i = 0; i < 10000; i++) if (rollShot(rng, p, fireCfg, out).hit) hits++;
      expect(Math.abs(hits / 10000 - p)).toBeLessThan(0.02);
    });
  }

  it('a landed shot picks its zone by the configured weights', () => {
    const rng = new Rng(77);
    const out = createShotRoll();
    const n = { head: 0, body: 0, leg: 0 };
    for (let i = 0; i < 10000; i++) n[rollShot(rng, 1, fireCfg, out).zone]++;
    const total = fireCfg.zoneHead + fireCfg.zoneBody + fireCfg.zoneLeg;
    expect(Math.abs(n.head / 10000 - fireCfg.zoneHead / total)).toBeLessThan(0.02);
    expect(Math.abs(n.leg / 10000 - fireCfg.zoneLeg / total)).toBeLessThan(0.02);
    expect(rollZone(0, fireCfg)).toBe('head');
    expect(rollZone(0.999, fireCfg)).toBe('leg');
  });

  it('draws the same four numbers whatever the outcome', () => {
    const a = new Rng(5), b = new Rng(5);
    rollShot(a, 1, fireCfg, createShotRoll());
    rollShot(b, 0, fireCfg, createShotRoll());
    expect(a.getState()).toBe(b.getState());
  });
});

// ---- the fire controller in a running world --------------------------------------------------------

interface Fight {
  world: World;
  bus: EventBus<SimEvents>;
  target: TargetState;
  tells: { tick: number; durationMs: number; startTick: number }[];
  shots: { tick: number; hit: boolean; state: number; dist: number; moving: boolean; dir: { x: number; y: number; z: number }; mx: number; my: number; mz: number }[];
  damage: number;
  hits: number;
}

interface FightOpts {
  dial: number;
  seed: number;
  kind?: 'strafer' | 'peeker';
  fire?: boolean;
  enemiesFire?: boolean;
  tun?: Tunables;
  level?: LevelDef;
  at?: [number, number, number];
}

function fight(o: FightOpts): Fight {
  const tun = o.tun ?? cloneTunables();
  const world = new World({ level: o.level ?? arena(), tunables: tun, seed: o.seed });
  world.enemiesFire = o.enemiesFire ?? true;
  const bus = new EventBus<SimEvents>();
  const ax = axes(o.dial);
  const kind = o.kind ?? 'strafer';
  const [x, y, z] = o.at ?? [0, 0, 5];
  const id = world.spawnTarget(kind, x, y, z, bus, {
    ...(kind === 'strafer'
      ? { strafe: { ...straferParams(ax), laneA: vec3(-6, 0, z), laneB: vec3(6, 0, z) } }
      : { peek: { pattern: 'wide' as const, hold: vec3(x, y, z), out: vec3(x + 2, y, z), wideSec: ax.peekWideSec } }),
    fire: o.fire === false ? undefined : fireParams(ax),
  });
  const target = world.targetField.byId(id)!;
  const f: Fight = { world, bus, target, tells: [], shots: [], damage: 0, hits: 0 };
  bus.on('enemyTell', (e) => f.tells.push({ tick: e.tick, durationMs: e.durationMs, startTick: target.ai.tellStartTick }));
  bus.on('enemyFired', (e) => {
    const p = world.player;
    const eyeY = p.pos.y + p.eyeHeight;
    f.shots.push({
      tick: e.tick, hit: e.hit, state: target.fsm.state, moving: world.playerMoving(),
      dist: Math.hypot(p.pos.x - target.pos.x, eyeY - (target.pos.y + 1.4), p.pos.z - target.pos.z),
      dir: { x: e.dir.x, y: e.dir.y, z: e.dir.z }, mx: target.pos.x, my: target.pos.y + 1.4, mz: target.pos.z,
    });
  });
  bus.on('playerDamaged', (e) => {
    f.damage += e.amount + e.absorbed;
    f.hits++;
    expect(e.sourceId).toBe(id);
  });
  return f;
}

/** Step the fight; the player is kept alive (this is about the enemy's model, not about dying) and may strafe. */
function play(f: Fight, seconds: number, strafe = false): void {
  const input = createTickInput();
  const ticks = Math.round(seconds / TICK_DT);
  for (let i = 0; i < ticks; i++) {
    input.moveX = strafe ? (Math.floor(i / 64) % 2 === 0 ? 1 : -1) : 0;
    f.world.health.alive = true;
    f.world.health.hp = f.world.health.maxHp;
    f.world.step(input, f.bus);
  }
}

describe('shooting model: tells, bursts, fairness floors', () => {
  it('the tell is never shorter than 0.15 s (nor the dial floor) at any dial, and enemyTell fires at its start', () => {
    for (const kind of ['strafer', 'peeker'] as const) {
      for (const dial of [0, 25, 50, 75, 100]) {
        for (const seed of [1, 2]) {
          const f = fight({ dial, seed, kind });
          play(f, 25);
          expect(f.tells.length, `${kind} dial ${dial}`).toBeGreaterThan(1);
          for (const t of f.tells) {
            expect(t.durationMs).toBeGreaterThanOrEqual(150);
            expect(t.durationMs).toBeGreaterThanOrEqual(base.dial.floors.tellSec * 1000 - 1e-6);
            expect(t.startTick).toBe(t.tick);
            // The first shot after a tell comes no sooner than the tell's length.
            const shot = f.shots.find((s) => s.tick >= t.tick);
            if (shot) expect((shot.tick - t.tick) * TICK_DT * 1000).toBeGreaterThanOrEqual(150 - 1e-6);
            expect(f.tells.filter((x) => x === t).length).toBe(1);
          }
        }
      }
    }
  });

  it('the tell length follows the dial (0.7 s at dial 0, 0.30 s at dial 100)', () => {
    const lo = fight({ dial: 0, seed: 4 });
    const hi = fight({ dial: 100, seed: 4 });
    play(lo, 20);
    play(hi, 20);
    for (const t of lo.tells) expect(Math.abs(t.durationMs - axes(0).tellSec * 1000)).toBeLessThan(10);
    for (const t of hi.tells) expect(Math.abs(t.durationMs - axes(100).tellSec * 1000)).toBeLessThan(10);
  });

  it('bursts are 1-3 shots at the weapon\'s fire rate', () => {
    const f = fight({ dial: 50, seed: 6 });
    play(f, 60);
    const interval = Math.round(128 / base.weapon.kestrel.fireRateHz);
    const sizes = new Set<number>();
    let run = 1;
    for (let i = 1; i <= f.shots.length; i++) {
      const gap = i < f.shots.length ? f.shots[i]!.tick - f.shots[i - 1]!.tick : Infinity;
      if (gap === interval) run++;
      else {
        sizes.add(run);
        run = 1;
      }
      if (gap !== Infinity) expect(gap).toBeGreaterThanOrEqual(interval);
    }
    expect([...sizes].every((n) => n >= 1 && n <= 3)).toBe(true);
    expect(sizes.size).toBeGreaterThan(1);
  });

  it('a Strafer fires from its stop: every shot leaves while it stands still', () => {
    for (const dial of [0, 50, 100]) {
      const f = fight({ dial, seed: 8 });
      play(f, 40);
      expect(f.shots.length).toBeGreaterThan(10);
      for (const s of f.shots) expect(s.state, `dial ${dial}`).toBe(STRAFER_STAND);
      // ... and the tell starts as it brakes.
      expect(f.tells.length).toBeGreaterThan(5);
    }
    void STRAFER_DECEL;
  });

  it('a Peeker fires only on a wide peek, one or two bursts, from its full step out', () => {
    const f = fight({ dial: 30, seed: 9, kind: 'peeker' });
    let holdWithShot = 0;
    const input = createTickInput();
    const stateAt: number[] = [];
    f.bus.on('enemyFired', () => stateAt.push(f.target.fsm.state));
    for (let i = 0; i < 128 * 60; i++) {
      f.world.health.alive = true;
      f.world.health.hp = f.world.health.maxHp;
      f.world.step(input, f.bus);
    }
    expect(f.shots.length).toBeGreaterThan(5);
    for (const st of stateAt) expect(st).toBe(PEEK_HOLD);
    // Bursts per peek: group shots whose gap is under 1 s.
    const peeks: number[] = [];
    let burstsInPeek = 0;
    let lastTick = -1e9;
    let prev = -1;
    f.shots.forEach((s) => {
      if (s.tick - lastTick > 128) { if (burstsInPeek) peeks.push(burstsInPeek); burstsInPeek = 0; prev = -1; }
      if (prev < 0 || s.tick - prev > 20) burstsInPeek++;
      prev = s.tick;
      lastTick = s.tick;
    });
    if (burstsInPeek) peeks.push(burstsInPeek);
    expect(Math.max(...peeks)).toBeLessThanOrEqual(2);
    holdWithShot = peeks.length;
    expect(holdWithShot).toBeGreaterThan(2);
  });

  it('shoulder, jiggle and hop peekers never shoot', () => {
    for (const pattern of ['shoulder', 'jiggle', 'hop'] as const) {
      const tun = cloneTunables();
      const world = new World({ level: arena(), tunables: tun, seed: 5 });
      world.enemiesFire = true;
      const bus = new EventBus<SimEvents>();
      let n = 0;
      bus.on('enemyFired', () => n++);
      bus.on('enemyTell', () => n++);
      world.spawnTarget('peeker', 0, 0, 5, bus, {
        peek: { pattern, hold: vec3(0, 0, 5), out: vec3(2, 0, 5) },
        fire: fireParams(axes(60)),
      });
      const input = createTickInput();
      for (let i = 0; i < 128 * 30; i++) {
        world.health.alive = true;
        world.step(input, bus);
      }
      expect(n, pattern).toBe(0);
    }
  });

  it('never shoots without line of sight, and never beyond its acquire range', () => {
    const wall = arena([{ tag: 'wall', min: vec3(-30, 0, 10), max: vec3(30, 5, 11) }]);
    const blocked = fight({ dial: 80, seed: 2, level: wall });
    play(blocked, 30);
    expect(blocked.shots.length).toBe(0);
    expect(blocked.tells.length).toBe(0);
    const far = fight({ dial: 80, seed: 2, at: [0, 0, -100] });
    play(far, 20);
    expect(far.shots.length).toBe(0);
  });

  it('a near miss passes the player\'s head by the configured distance, on a seeded side', () => {
    const f = fight({ dial: 0, seed: 12 });
    play(f, 120);
    const misses = f.shots.filter((s) => !s.hit);
    expect(misses.length).toBeGreaterThan(20);
    const p = f.world.player;
    const ey = p.pos.y + p.eyeHeight;
    const sides = new Set<number>();
    for (const s of misses) {
      // Closest approach of the bullet line to the eye.
      const along = (p.pos.x - s.mx) * s.dir.x + (ey - s.my) * s.dir.y + (p.pos.z - s.mz) * s.dir.z;
      const cx = s.mx + s.dir.x * along, cy = s.my + s.dir.y * along, cz = s.mz + s.dir.z * along;
      const d = Math.hypot(cx - p.pos.x, cy - ey, cz - p.pos.z);
      expect(d).toBeGreaterThanOrEqual(fireCfg.missMinM - 0.01);
      expect(d).toBeLessThanOrEqual(fireCfg.missMaxM + 0.01);
      sides.add(Math.sign(cx - p.pos.x));
    }
    expect(sides.size).toBe(2);
  });
});

describe('enemies and the run', () => {
  it('never shoot in drills: an armed Strafer and Peeker are silent while the world flag is off', () => {
    const f = fight({ dial: 100, seed: 3, enemiesFire: false });
    play(f, 30);
    expect(f.shots.length).toBe(0);
    expect(f.tells.length).toBe(0);
    expect(f.damage).toBe(0);
    expect(f.world.health.hp).toBe(f.world.health.maxHp);
  });

  it('a target spawned without `fire` never shoots even where enemies fire', () => {
    const f = fight({ dial: 100, seed: 3, fire: false });
    play(f, 30);
    expect(f.shots.length).toBe(0);
  });

  it('is deterministic under the seed, and the seed matters', () => {
    const run = (seed: number): number => {
      const f = fight({ dial: 70, seed });
      play(f, 25, true);
      return f.world.hash();
    };
    expect(run(31)).toBe(run(31));
    expect(run(31)).not.toBe(run(32));
  });

  it('a hit goes through the player\'s damage entry point: damage, source and the shield', () => {
    const tun = cloneTunables();
    const f = fight({ dial: 100, seed: 13, tun });
    f.world.setShields(tun.player.shield.heavy, 0);
    play(f, 30);
    expect(f.hits).toBeGreaterThan(0);
    expect(f.world.health.shieldAbsorbed).toBeGreaterThan(0);
  });
});

// ---- the bot test ----------------------------------------------------------------------------------

/** What the model predicts for the shots actually fired (each shot's own distance and the player's state then). */
function expectedHits(f: Fight, baseChance: number): number {
  return f.shots.reduce((sum, s) => sum + enemyHitChance(baseChance, s.dist, s.moving, false, fireCfg), 0);
}

/** Expected HP lost per landed bullet: the zone weights x the Kestrel's bands, capped at 100 HP (the bot is reset each tick). */
function hpPerHit(): number {
  const total = fireCfg.zoneHead + fireCfg.zoneBody + fireCfg.zoneLeg;
  const b = base.weapon.kestrel.damageBands[0]!;
  const hp = base.player.health.max;
  return (fireCfg.zoneHead * Math.min(b.head, hp) + fireCfg.zoneBody * Math.min(b.body, hp) + fireCfg.zoneLeg * Math.min(b.leg, hp)) / total;
}

describe('bot playtest: damage taken over 60 s at dial 50', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6];
  const BASE = axes(50).enemyHitChance;

  type Totals = { shots: number; hits: number; damage: number; expected: number };
  const memo = new Map<string, Totals>();
  function totals(strafe: boolean, tagging: boolean): Totals {
    const key = `${strafe}/${tagging}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const r = measure(strafe, tagging);
    memo.set(key, r);
    return r;
  }

  function measure(strafe: boolean, tagging: boolean): Totals {
    let shots = 0, hits = 0, damage = 0, expected = 0;
    for (const seed of SEEDS) {
      const tun = cloneTunables();
      if (!tagging) tun.player.tag.speedScale = 1;
      const f = fight({ dial: 50, seed, tun });
      play(f, 60, strafe);
      shots += f.shots.length;
      hits += f.shots.filter((s) => s.hit).length;
      damage += f.damage;
      expected += expectedHits(f, BASE);
    }
    return { shots, hits, damage, expected };
  }

  it('a standing bot takes the expected damage', () => {
    const r = totals(false, true);
    expect(r.shots).toBeGreaterThan(300);
    expect(Math.abs(r.hits - r.expected) / r.expected).toBeLessThan(0.12);
    const expectedDamage = r.expected * hpPerHit();
    expect(Math.abs(r.damage - expectedDamage) / expectedDamage).toBeLessThan(0.25);
  });

  it('a strafing bot takes about half (the x0.5 rule, tagging off to isolate it)', () => {
    const standing = totals(false, true);
    const strafing = totals(true, false);
    const ratio = strafing.hits / strafing.shots / (standing.hits / standing.shots);
    // Each 0.5 s reversal brakes through the deadzone and accelerates out of it again (spec §2.3:
    // about 0.11 s below it), so the bot is accurate ~23% of the time: 0.77 x 0.5 + 0.23 = ~0.62.
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.66);
    // The model's own expectation holds for the strafing bot as well.
    expect(Math.abs(strafing.hits - strafing.expected) / strafing.expected).toBeLessThan(0.2);
  });

  it('with tagging on, a hit slows a strafing bot into the accurate range for a moment: the saving stays near half, never below', () => {
    const standing = totals(false, true);
    const strafing = totals(true, true);
    const ratio = strafing.hits / strafing.shots / (standing.hits / standing.shots);
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.85);
  });
});
