import { describe, expect, it } from 'vitest';
import { axes } from '../../adaptive/dial';
import { cloneTunables, type Tunables } from '../../config/tunables';
import { EventBus } from '../../core/eventBus';
import { TICK_DT, TICK_RATE } from '../../core/time';
import { vec3 } from '../../core/vec3';
import { HeadlessGame } from '../../debug/bot/headless';
import { FIRE_IDLE, FIRE_TELL, FIRE_WAIT, type FireParams } from '../enemyAi';
import { fireParams } from '../enemyParams';
import { ceilTicks } from '../enemySight';
import type { Expectation } from '../enemyTiming';
import { createTickInput, type HitZone, type LevelDef, type SimEvents, type TargetState } from '../types';
import { wrapPi } from '../aim';
import { World } from '../world';

/**
 * A mind-driven Echo in the real sim (issue #90): reaction (S1, expectation), the tell as the real
 * aim phase (F5), stop-gated fire, shots that go where the crosshair points through real walls and
 * zones (no hit roll), determinism and isolation (S11), and Sweep spawning minds.
 */

const DEG = Math.PI / 180;

function arena(extra: LevelDef['boxes'] = []): LevelDef {
  return {
    name: 'duel',
    boxes: [{ tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) }, ...extra],
    spawn: { pos: vec3(0, 0, 0), yaw: 0 },
    targets: [],
  };
}

interface Duel {
  world: World;
  bus: EventBus<SimEvents>;
  tun: Tunables;
}

function duel(seed: number, tun = cloneTunables(), level = arena()): Duel {
  const world = new World({ level, tunables: tun, seed });
  world.enemiesFire = true;
  return { world, bus: new EventBus<SimEvents>(), tun };
}

/** A mind Echo standing still `dist` metres in front of the player (-Z), on a lane of length 0. */
function spawnStill(d: Duel, mindSkill: number, dist: number, extra: Partial<FireParams> = {}, x = 0): TargetState {
  const id = d.world.spawnTarget('strafer', x, 0, -dist, d.bus, {
    strafe: { speed: 0, legSec: 1, standStillSec: 1, laneA: vec3(x, 0, -dist), laneB: vec3(x, 0, -dist) },
    fire: fireParams(axes(mindSkill), { mindSkill, ...extra }),
  });
  return d.world.targetField.byId(id)!;
}

/** Turn an Echo's view and hold `deg` degrees away from where it looks now. */
function turnHold(t: TargetState, deg: number): void {
  const a = t.ai.aim;
  a.yaw = a.holdYaw = wrapPi(a.holdYaw + deg * DEG);
}

/** Step with the player kept alive (and still unless `input` says otherwise). */
function play(d: Duel, ticks: number, input = createTickInput()): void {
  for (let i = 0; i < ticks; i++) {
    d.world.health.alive = true;
    d.world.health.hp = d.world.health.maxHp;
    d.world.step(input, d.bus);
  }
}

/** The reaction (first sight to the aim phase) of `n` fresh Echoes, seconds, at a mind skill and expectation. */
function reactions(mindSkill: number, expectation: Expectation, n: number, offAxisDeg = 0): number[] {
  const d = duel(1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    d.world.enemiesFire = false; // it spawns facing the player; the contact starts when firing turns on
    const t = spawnStill(d, mindSkill, 10, { expectation });
    // Turn the Echo's hold away from the player: the player now appears outside its attention.
    if (offAxisDeg !== 0) turnHold(t, offAxisDeg);
    d.world.enemiesFire = true;
    play(d, 1);
    expect(t.ai.phase).toBe(FIRE_WAIT);
    // The draw itself (the aim phase starts on the tick it rounds to).
    expect(Math.abs((t.ai.readyTick - t.ai.contactTick) * TICK_DT - t.ai.reactionDrawSec)).toBeLessThanOrEqual(TICK_DT / 2 + 1e-9);
    out.push(t.ai.reactionDrawSec);
    d.world.despawnTarget(t.id, d.bus);
  }
  return out;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;

describe('S1 reaction (first sight to the aim phase)', () => {
  const tun = cloneTunables();
  for (const m of tun.mind.anchorSkills) {
    it(`mind skill ${m}: right-skewed ex-Gaussian, never under the 0.25 s floor, no spike`, () => {
      const r = reactions(m, 'attending', 600);
      const mu = mean(r);
      const sd = Math.sqrt(mean(r.map((x) => (x - mu) ** 2)));
      expect(Math.min(...r)).toBeGreaterThanOrEqual(tun.dial.floors.enemyReactionSec - 1e-9);
      expect(mu - median(r), 'mean above median').toBeGreaterThan(0.005);
      expect(sd / mu, 'CV').toBeGreaterThanOrEqual(0.1);
      expect(sd / mu).toBeLessThanOrEqual(0.35);
      const bins = new Map<number, number>();
      for (const x of r) bins.set(Math.floor(x / 0.005), (bins.get(Math.floor(x / 0.005)) ?? 0) + 1);
      expect(Math.max(...bins.values()) / r.length, 'largest 5 ms bin').toBeLessThanOrEqual(0.08);
    });
  }

  it('expectation: a prepared holder is 35 ms quicker (floor 0.15 s), an unaware one pays the orientation cost', () => {
    const exp = tun.expectation;
    // m = 0 (mean 0.65 s): the floors almost never bind, and the same serials draw the same reactions.
    const att = reactions(0, 'attending', 300);
    const prep = reactions(0, 'prepared', 300);
    const off = reactions(0, 'attending', 300, 40);
    expect(mean(att) - mean(prep)).toBeCloseTo(exp.preparedBonusSec, 2);
    expect(mean(off) - mean(att)).toBeCloseTo(exp.orientationSec, 2);
    expect(Math.min(...reactions(100, 'prepared', 300))).toBeGreaterThanOrEqual(tun.dial.floors.preparedReactionSec - 1e-9);
    // A prepared holder the player surprises off its attention is only attending.
    const prepOff = reactions(0, 'prepared', 300, 40);
    expect(mean(prepOff)).toBeCloseTo(mean(att), 2);
  });
});

/** Record the first contact of one Echo: when it saw, when its tell started and how long, its first shot. */
function firstContact(d: Duel, t: TargetState, maxTicks = 4 * TICK_RATE) {
  let tellTick = -1, tellMs = 0, shotTick = -1;
  const offT = d.bus.on('enemyTell', (e) => { if (e.id === t.id && tellTick < 0) { tellTick = e.tick; tellMs = e.durationMs; } });
  const offS = d.bus.on('enemyFired', (e) => { if (e.id === t.id && shotTick < 0) shotTick = e.tick; });
  let contactTick = -1, readyTick = -1;
  for (let i = 0; i < maxTicks && shotTick < 0; i++) {
    play(d, 1);
    if (contactTick < 0 && t.ai.contactTick >= 0) { contactTick = t.ai.contactTick; readyTick = t.ai.readyTick; }
  }
  offT();
  offS();
  return { contactTick, readyTick, tellTick, tellMs, shotTick };
}

describe('the tell is the real aim phase (F5) and the floors hold (F4)', () => {
  it('a surprised Echo: the tell starts when the aim starts, enemyTell at its start, max(aim phase, floor) long', () => {
    for (const m of [0, 35, 65, 100]) {
      for (let seed = 1; seed <= 6; seed++) {
        const d = duel(seed);
        // Off to one side so there is a real flick to make.
        const t = spawnStill(d, m, 12, {}, 0);
        turnHold(t, 30);
        const c = firstContact(d, t);
        const floor = Math.max(axes(m).tellSec, d.tun.dial.floors.tellSec);
        expect(c.tellTick, `m ${m} seed ${seed}`).toBe(c.readyTick);
        expect(c.tellMs).toBeGreaterThanOrEqual(floor * 1000 - 1e-6);
        expect(c.shotTick, `m ${m} seed ${seed}`).toBeGreaterThan(0);
        expect(c.shotTick - c.tellTick).toBeGreaterThanOrEqual(ceilTicks(floor));
      }
    }
  });

  it('a surprised Echo already on target holds its fire for the floor; a prepared holder does not hold at all (#127)', () => {
    const tun = cloneTunables();
    // Its hold rests exactly on the point it aims at: no aim phase is left to do.
    tun.mind.anchors.holdOffsetMeanDeg = [0, 0, 0, 0];
    tun.mind.anchors.holdOffsetSdDeg = [0, 0, 0, 0];
    tun.mind.anchors.aimDropM = [0, 0, 0, 0];
    tun.mind.spread.aimNoise = 0;
    const floorTicks = ceilTicks(Math.max(axes(100).tellSec, tun.dial.floors.tellSec));
    let preparedEarly = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const d = duel(seed, tun);
      const t = spawnStill(d, 100, 10);
      const c = firstContact(d, t);
      expect(c.shotTick - c.tellTick).toBeGreaterThanOrEqual(floorTicks);

      const d2 = duel(seed, tun);
      const h = spawnStill(d2, 100, 10, { expectation: 'prepared' });
      const p = firstContact(d2, h);
      expect(p.tellTick, 'a prepared tell starts at first sight').toBe(p.contactTick);
      if (p.shotTick - p.readyTick < floorTicks) preparedEarly++;
    }
    expect(preparedEarly).toBeGreaterThan(4);
  });
});

describe('stop-gated fire', () => {
  function gatedShots(movingShotShare: number) {
    const tun = cloneTunables();
    tun.mind.anchors.movingShotShare = [movingShotShare, movingShotShare, movingShotShare, movingShotShare];
    tun.mind.spread.aggression = 0;
    const d = duel(3, tun);
    const ax = axes(35);
    const id = d.world.spawnTarget('strafer', 0, 0, -12, d.bus, {
      strafe: { speed: ax.strafeSpeed, legSec: ax.strafeLegSec, standStillSec: ax.standStillSec, laneA: vec3(-6, 0, -12), laneB: vec3(6, 0, -12) },
      fire: fireParams(ax, { mindSkill: 35 }),
    });
    const t = d.world.targetField.byId(id)!;
    const def = tun.weapon[t.ai.weapon];
    const gate = def.deadzoneFraction * def.runSpeedMps;
    let above = 0, total = 0;
    d.bus.on('enemyFired', () => {
      total++;
      if (Math.hypot(t.pos.x - t.prevPos.x, t.pos.z - t.prevPos.z) * TICK_RATE > gate) above++;
    });
    play(d, 30 * TICK_RATE);
    return { above, total };
  }

  it('with the moving-shot habit off, every shot leaves from under the accuracy gate', () => {
    const r = gatedShots(0);
    expect(r.total).toBeGreaterThan(10);
    expect(r.above).toBe(0);
  });

  it('with the habit always on, the Echo also shoots on the move (and those shots carry the movement error)', () => {
    const r = gatedShots(1);
    expect(r.above).toBeGreaterThan(0);
  });
});

describe('shots are aimed, not rolled', () => {
  it('only what the crosshair can reach is hit: behind a chest-high wall every hit is a headshot', () => {
    // A wall just in front of the player up to 1.53 m: the torso (to 1.52 m) is behind it, the head shows above.
    const wall = { tag: 'wall' as const, min: vec3(-3, 0, -0.6), max: vec3(3, 1.53, -0.5) };
    const zones: HitZone[] = [];
    let shots = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const d = duel(seed, cloneTunables(), arena([wall]));
      spawnStill(d, 100, 10);
      d.bus.on('enemyFired', () => shots++);
      d.bus.on('playerDamaged', (e) => zones.push(e.zone));
      play(d, 20 * TICK_RATE);
    }
    expect(shots).toBeGreaterThan(20);
    expect(zones.length).toBeGreaterThan(0);
    expect(new Set(zones)).toEqual(new Set(['head']));
  });

  it('a still player is hit far more often than a strafing one (strafing is a real defence)', () => {
    const rate = (strafe: boolean): number => {
      let shots = 0, hits = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const d = duel(seed);
        spawnStill(d, 65, 12);
        d.bus.on('enemyFired', (e) => { shots++; if (e.hit) hits++; });
        const input = createTickInput();
        for (let i = 0; i < 20 * TICK_RATE; i++) {
          input.moveX = strafe ? (Math.floor(i / 50) % 2 === 0 ? 1 : -1) : 0;
          play(d, 1, input);
        }
      }
      return hits / shots;
    };
    expect(rate(false)).toBeGreaterThan(2 * rate(true));
  });
});

describe('determinism and isolation (S11)', () => {
  function trace(seed: number, enemies: number): number[][] {
    const d = duel(seed);
    // A player no burst can kill: a death would end the run's fire for everyone, which is not about isolation.
    d.world.health.maxHp = 1e9;
    const ts: TargetState[] = [];
    for (let i = 0; i < enemies; i++) ts.push(spawnStill(d, [35, 65, 100][i]!, 10 + 3 * i, {}, 3 * i - 3));
    const out: number[][] = ts.map(() => []);
    for (let k = 0; k < 6 * TICK_RATE; k++) {
      play(d, 1);
      for (let i = 0; i < ts.length; i++) out[i]!.push(ts[i]!.ai.aim.yaw, ts[i]!.ai.aim.pitch);
    }
    return out;
  }

  it('the same seed gives identical traces; another seed differs', () => {
    expect(trace(5, 2)).toEqual(trace(5, 2));
    expect(trace(6, 2)).not.toEqual(trace(5, 2));
  });

  // Their bodies still draw leg timers from the world stream until the shared body (#87), so this is
  // about the mind: the view of each Echo depends only on its own streams and what it sees.
  it('adding a third Echo leaves the first two Echoes\' aim untouched (each draws only from its own streams)', () => {
    const two = trace(5, 2);
    const three = trace(5, 3);
    expect(three[0]).toEqual(two[0]);
    expect(three[1]).toEqual(two[1]);
  });
});

describe('Sweep spawns mind-driven Echoes', () => {
  it('every Echo of a Sweep run carries the run\'s mind skill', () => {
    const g = new HeadlessGame({ seed: 4 });
    expect(g.modes.start('sweep', { seed: 4, pick: g.modes.primary })).toBe(true);
    const input = createTickInput();
    for (let k = 0; k < Math.ceil(g.tunables.run.readySec * TICK_RATE) + 2; k++) g.advance(input);
    const echoes = g.world.targets.filter((t) => t.alive && (t.kind === 'strafer' || t.kind === 'peeker'));
    expect(echoes.length).toBeGreaterThan(0);
    for (const t of echoes) {
      expect(t.ai.mind).toBe(true);
      expect(t.ai.profile.mindSkill).toBe(g.modes.runner.mindSkill);
      expect(t.ai.phase === FIRE_IDLE || t.ai.phase === FIRE_WAIT || t.ai.phase === FIRE_TELL).toBe(true);
    }
  });
});
