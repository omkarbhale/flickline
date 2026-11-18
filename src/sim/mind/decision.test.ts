import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../../config/tunables';
import { EventBus } from '../../core/eventBus';
import { RAD2DEG } from '../../core/math';
import { Rng } from '../../core/rng';
import { TICK_DT, TICK_RATE } from '../../core/time';
import { vec3, type Vec3 } from '../../core/vec3';
import { fsmGoto } from '../fsm';
import { elbowMap } from '../mapLoader';
import { createTickInput, type BoxDef, type LevelDef, type SimEvents, type TargetState } from '../types';
import { World } from '../world';
import {
  chooseRepeekWay, decisionProfile, drawLeg, drawRepeekDelay, MIND_DISENGAGE, MIND_STATE_NAMES, mindBehaviour, planTo,
} from './decision';
import { createMindProfile, profileFor } from './profile';
import { REPEEK_SAME, type MindParams } from './state';

const floor: BoxDef = { tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) };
const wall = (x0: number, z0: number, x1: number, z1: number, h = 3): BoxDef => ({ tag: 'wall', min: vec3(x0, 0, z0), max: vec3(x1, h, z1) });
const arena = (extra: BoxDef[] = []): LevelDef => ({ name: 'arena', boxes: [floor, ...extra], spawn: { pos: vec3(0, 0, 0), yaw: 0 }, targets: [] });

interface Setup {
  world: World;
  bus: EventBus<SimEvents>;
  t: TargetState;
  input: ReturnType<typeof createTickInput>;
  /** Step `n` ticks; the player never dies (a probe, not a fight). */
  run(n: number, each?: (tick: number) => void): void;
  names: string[];
}

function setup(opts: {
  skill: number; level?: LevelDef; player?: [number, number]; echo?: [number, number]; seed?: number; fire?: boolean;
  mind?: Partial<MindParams>; kind?: 'strafer' | 'post'; crouched?: boolean;
}): Setup {
  const tun = cloneTunables();
  const world = new World({ level: opts.level ?? arena(), tunables: tun, seed: opts.seed ?? 1 });
  const bus = new EventBus<SimEvents>();
  const names: string[] = [];
  bus.on('enemyStateChanged', (e) => names.push(e.state));
  const [px, pz] = opts.player ?? [0, 12];
  world.placePlayer(px, 0, pz, 0);
  world.enemiesFire = opts.fire ?? false;
  const [ex, ez] = opts.echo ?? [0, 0];
  const id = world.spawnTarget(opts.kind ?? 'strafer', ex, 0, ez, bus, { crouched: opts.crouched, mind: { skill: opts.skill, ...opts.mind } });
  const t = world.targetField.byId(id)!;
  const input = createTickInput();
  const run = (n: number, each?: (tick: number) => void): void => {
    for (let i = 0; i < n; i++) {
      world.health.hp = 1e6;
      world.step(input, bus);
      each?.(world.tick);
    }
  };
  return { world, bus, t, input, run, names };
}

const stateOf = (t: TargetState): string => MIND_STATE_NAMES[t.fsm.state]!;
const speedOf = (t: TargetState): number => Math.hypot(t.body.kin.vel.x, t.body.kin.vel.z);

describe('the mind decision FSM (#91): states and transitions of research §5.2', () => {
  it('a fresh mind holds: it announces `hold`, keeps the attended sector and its view is never still', () => {
    const s = setup({ skill: 65, level: arena([wall(10, -5, 11, 5)]), player: [30, 0], mind: { watch: vec3(0, 0, -10) } });
    expect(s.names).toEqual(['hold']);
    const yaws: number[] = [];
    s.run(TICK_RATE * 6, () => yaws.push(s.t.body.kin.yaw));
    expect(stateOf(s.t)).toBe('hold');
    // The view drifts (and glances): never frozen for a whole second.
    for (let i = TICK_RATE; i < yaws.length; i += TICK_RATE) {
      const win = yaws.slice(i - TICK_RATE, i);
      expect(Math.max(...win) - Math.min(...win)).toBeGreaterThan(1e-4);
    }
    // Most of the time it looks at the watched point (straight down -Z), within a glance's reach.
    const onWatch = yaws.filter((y) => Math.abs(y) * RAD2DEG < 12).length / yaws.length;
    expect(onWatch).toBeGreaterThan(0.6);
    expect(s.t.mind.perceiver!.sector.active).toBe(true);
  });

  it('spawn emits enemyStateChanged hold (from null)', () => {
    const tun = cloneTunables();
    const world = new World({ level: arena(), tunables: tun, seed: 3 });
    const bus = new EventBus<SimEvents>();
    const seen: SimEvents['enemyStateChanged'][] = [];
    bus.on('enemyStateChanged', (e) => seen.push({ ...e }));
    world.placePlayer(0, 0, 20, 0);
    world.spawnTarget('strafer', 0, 0, 0, bus, { mind: { skill: 50 } });
    expect(seen.map((e) => [e.state, e.from])).toEqual([['hold', null]]);
  });

  it('sees the player -> react (reaction drawn, never under the floor) -> duel, with enemyReacted', () => {
    // The player stands behind a wall, then steps out into the holder's view.
    const level = arena([wall(2, 2, 2.5, 16)]);
    const s = setup({ skill: 50, level, player: [5, 12], echo: [0, 0], mind: { watch: vec3(1, 0, 12) } });
    const reacted: SimEvents['enemyReacted'][] = [];
    s.bus.on('enemyReacted', (e) => reacted.push({ ...e }));
    s.run(TICK_RATE);
    expect(stateOf(s.t)).toBe('hold');
    s.world.placePlayer(0.5, 0, 12, 0);
    s.run(TICK_RATE * 2);
    expect(s.names).toContain('react');
    expect(s.names).toContain('duel');
    expect(reacted.length).toBe(1);
    const floorMs = s.world.tunables.dial.floors.preparedReactionSec * 1000;
    expect(reacted[0]!.reactMs).toBeGreaterThanOrEqual(floorMs - 1e-6);
    expect(s.names.indexOf('react')).toBeLessThan(s.names.indexOf('duel'));
  });

  it('hears running footsteps behind a wall -> alert, turns towards the sound; forgets -> hold', () => {
    const level = arena([wall(-6, -4, 6, -3.5)]);
    const s = setup({ skill: 65, level, player: [0, -12], echo: [0, 0], mind: { watch: vec3(0, 0, 10) } });
    s.run(TICK_RATE / 2);
    expect(stateOf(s.t)).toBe('hold');
    // Run behind the wall, out of sight but in earshot.
    s.input.moveX = 1;
    s.run(TICK_RATE);
    s.input.moveX = 0;
    expect(s.names).toContain('alert');
    s.run(TICK_RATE / 2);
    // Facing roughly towards the sound (behind it, -Z side: yaw near 0).
    expect(Math.abs(s.t.body.kin.yaw) * RAD2DEG).toBeLessThan(45);
    // Memory decays and it goes back to holding.
    s.run(TICK_RATE * 15);
    expect(stateOf(s.t)).toBe('hold');
  });

  it('decision points come at jittered lognormal intervals with median ~0.12 s, different per enemy', () => {
    const s = setup({ skill: 50, player: [30, 30] });
    const p = s.t.mind.perceiver!;
    const at: number[] = [];
    let last = p.decisions;
    s.run(TICK_RATE * 20, (tick) => { if (p.decisions !== last) { last = p.decisions; at.push(tick); } });
    const gaps = at.slice(1).map((v, i) => (v - at[i]!) * TICK_DT).sort((a, b) => a - b);
    const med = gaps[gaps.length >> 1]!;
    expect(med).toBeGreaterThan(0.1);
    expect(med).toBeLessThan(0.14);
    expect(new Set(gaps.map((g) => g.toFixed(4))).size).toBeGreaterThan(5);
  });

  it('every state of §5.2 this issue owns is reachable and named', () => {
    expect([...MIND_STATE_NAMES]).toEqual(['hold', 'alert', 'react', 'duel', 'disengage', 'reposition', 'repeek', 'peek']);
  });
});

/** A long duel against a standing (or strafing) player who never dies, recorded per tick. */
function duelTrace(skill: number, seed: number, sec: number, distance = 14, strafe = false) {
  const s = setup({ skill, seed, fire: true, player: [0, distance], echo: [0, 0] });
  s.world.placePlayer(0, 0, distance, 0);
  const gate = s.t.mind.gate;
  const shots: { tick: number; moving: boolean }[] = [];
  const gateOpen: number[] = [];
  /** Gate openings where it could shoot (not reloading, the tell over): the stops S5 times. */
  const armedOpen = new Set<number>();
  let wasAbove = true;
  let lastShots = s.t.body.weapon.shots;
  const crouchesPerDuel: number[] = [];
  let duelCrouches = 0;
  let prevState = '';
  s.run(Math.round(sec * TICK_RATE), (tick) => {
    if (strafe) s.input.moveX = Math.floor(tick / 70) % 2 === 0 ? 1 : -1;
    const st = stateOf(s.t);
    if (st === 'duel' && prevState !== 'duel') duelCrouches = 0;
    if (st !== 'duel' && prevState === 'duel') crouchesPerDuel.push(duelCrouches);
    duelCrouches = s.t.mind.crouchCount;
    prevState = st;
    const v = speedOf(s.t);
    const above = v > gate;
    if (wasAbove && !above) {
      gateOpen.push(tick);
      if (s.t.body.weapon.reloadLeft === 0 && tick >= s.t.mind.fireReadyTick && stateOf(s.t) === 'duel') armedOpen.add(tick);
    }
    wasAbove = above;
    const n = s.t.body.weapon.shots - lastShots;
    lastShots = s.t.body.weapon.shots;
    for (let i = 0; i < n; i++) shots.push({ tick, moving: above });
  });
  crouchesPerDuel.push(duelCrouches);
  return { s, shots, gateOpen, armedOpen, crouchesPerDuel };
}

describe('duel (§2.3, §2.4): stop discipline (S5), strafe legs (S6), crouch habit', () => {
  /** Duels per anchor for the S5 shares: enough bursts that sampling noise stays well inside the ±5-point band. */
  const SEEDS = 10;
  for (const skill of [0, 35, 65, 100]) {
    it(`m = ${skill}: the share of shots above the gate is within ±5 points of the profile's moving-shot habit`, () => {
      let total = 0, moving = 0;
      let want = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const { s } = duelTrace(skill, seed, 60);
        total += s.t.mind.stats.shots;
        moving += s.t.mind.stats.movingShots;
        want += s.t.mind.profile.movingShotShare;
      }
      expect(total).toBeGreaterThan(150);
      expect(Math.abs(moving / total - want / SEEDS)).toBeLessThanOrEqual(0.05);
    });
  }

  for (const skill of [0, 100]) {
    it(`m = ${skill}: the shot-after-gate median is within ±25% of the profile's`, () => {
      const delays: number[] = [];
      let want = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const { s, shots, gateOpen, armedOpen } = duelTrace(skill, seed, 60);
        want += s.t.mind.profile.shotAfterGateSec / 4;
        // For each stop that opened the gate, the first shot after it (before the next gate opening) fired from the stop.
        for (let i = 0; i < gateOpen.length; i++) {
          const g = gateOpen[i]!, next = gateOpen[i + 1] ?? Infinity;
          if (!armedOpen.has(g)) continue;
          const shot = shots.find((x) => x.tick >= g && x.tick < next);
          if (shot && !shot.moving) delays.push((shot.tick - g) * TICK_DT);
        }
      }
      delays.sort((a, b) => a - b);
      expect(delays.length).toBeGreaterThan(40);
      const med = delays[delays.length >> 1]!;
      expect(Math.abs(med - want) / want).toBeLessThanOrEqual(0.25);
    });
  }

  it('the crouch habit fires at most twice per duel at mind skill 100', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const { s, crouchesPerDuel } = duelTrace(100, seed, 40);
      expect(s.t.mind.profile.crouchMaxPerDuel).toBeLessThanOrEqual(2);
      for (const c of crouchesPerDuel) expect(c).toBeLessThanOrEqual(2);
      expect(s.t.mind.stats.crouches).toBeGreaterThan(0);
    }
  });

  it('a low-tier duel crouches more often than a top-tier one', () => {
    const lo = duelTrace(0, 2, 40).s.t.mind.stats;
    const hi = duelTrace(100, 2, 40).s.t.mind.stats;
    expect(lo.crouches / Math.max(1, lo.legs)).toBeGreaterThan(hi.crouches / Math.max(1, hi.legs));
  });

  it('S6: strafe legs follow the profile lognormal: CV within ±0.08, no two consecutive legs within 10 ms at m = 100', () => {
    const tun = cloneTunables();
    for (const skill of [0, 35, 65, 100]) {
      const pr = profileFor(skill, new Rng(skill + 7), createMindProfile(), tun);
      const rng = new Rng(99 + skill);
      const legs: number[] = [];
      let last = -1;
      for (let i = 0; i < 4000; i++) { last = drawLeg(rng, pr.strafeLegMedianSec, pr.strafeLegCv, last, tun.mindDecision.duel); legs.push(last); }
      const mean = legs.reduce((a, b) => a + b, 0) / legs.length;
      const sd = Math.sqrt(legs.reduce((a, b) => a + (b - mean) ** 2, 0) / legs.length);
      expect(Math.abs(sd / mean - pr.strafeLegCv)).toBeLessThanOrEqual(0.08);
      const sorted = [...legs].sort((a, b) => a - b);
      expect(Math.abs(sorted[sorted.length >> 1]! / pr.strafeLegMedianSec - 1)).toBeLessThan(0.08);
      if (skill === 100) {
        let close = 0;
        for (let i = 1; i < legs.length; i++) if (Math.abs(legs[i]! - legs[i - 1]!) < 0.01) close++;
        expect(close / legs.length).toBeLessThanOrEqual(0.05);
      }
    }
  });

  it('in a real duel the strafe keys are held for the profile\'s legs (median of held-key runs near the profile median)', () => {
    const s = setup({ skill: 35, seed: 5, fire: true, player: [0, 14], echo: [0, 0] });
    const runs: number[] = [];
    let held = 0;
    s.run(TICK_RATE * 40, () => {
      const c = s.t.body.cmd;
      const strafing = stateOf(s.t) === 'duel' && s.t.mind.duelPhase === 2 && (c.moveX !== 0 || c.moveZ !== 0);
      if (strafing) held++;
      else if (held > 0) { runs.push(held * TICK_DT); held = 0; }
    });
    runs.sort((a, b) => a - b);
    expect(runs.length).toBeGreaterThan(15);
    const med = runs[runs.length >> 1]!;
    expect(Math.abs(med / s.t.mind.profile.strafeLegMedianSec - 1)).toBeLessThan(0.25);
  });

  it('bursts by distance: taps far, sprays close (m = 100)', () => {
    const far = duelTrace(100, 3, 20, 28);
    const close = duelTrace(100, 3, 20, 6);
    const perBurst = (r: ReturnType<typeof duelTrace>): number => {
      let bursts = 0;
      for (let i = 0; i < r.shots.length; i++) if (i === 0 || r.shots[i]!.tick - r.shots[i - 1]!.tick > 30) bursts++;
      return r.shots.length / Math.max(1, bursts);
    };
    expect(perBurst(far)).toBeLessThan(1.5);
    expect(perBurst(close)).toBeGreaterThan(3);
  });
});

describe('disengage, reposition, re-peek (§2.7, S8)', () => {
  it('S8: the same-angle-same-way share is within ±10 points of the profile at every anchor', () => {
    const tun = cloneTunables();
    for (const skill of [0, 35, 65, 100]) {
      const pr = profileFor(skill, new Rng(3), createMindProfile(), tun);
      const rng = new Rng(17 + skill);
      let same = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) if (chooseRepeekWay(rng, pr.repeekSame, tun.mindDecision.repeek.otherWayShare) === REPEEK_SAME) same++;
      expect(Math.abs(same / n - pr.repeekSame)).toBeLessThanOrEqual(0.1);
    }
  });

  it('re-peek delays: never within 10% of the previous one; median near the profile; an instant share under 0.6 s', () => {
    const tun = cloneTunables();
    for (const skill of [0, 100]) {
      const pr = profileFor(skill, new Rng(5), createMindProfile(), tun);
      const rng = new Rng(23 + skill);
      const ds: number[] = [];
      let last = -1;
      for (let i = 0; i < 3000; i++) {
        last = drawRepeekDelay(rng, pr.repeekDelayMedianSec, pr.repeekInstantShare, last, tun.mind.variety.repeekDelayMinDifference, tun.mindDecision.repeek);
        ds.push(last);
      }
      for (let i = 1; i < ds.length; i++) expect(Math.abs(ds[i]! - ds[i - 1]!)).toBeGreaterThanOrEqual(0.1 * ds[i - 1]! - 1e-9);
      const instant = ds.filter((d) => d < 0.6).length / ds.length;
      expect(Math.abs(instant - pr.repeekInstantShare)).toBeLessThan(0.05);
    }
  });

  it('a disengaging Echo backs into cover out of the threat\'s sight, reloads, then re-peeks or repositions', () => {
    // An open lane with a pillar to one side: cover a few metres away.
    const level = arena([wall(0.8, 1, 3, 2, 3)]);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = setup({ skill: 100, seed, level, player: [0, 12], echo: [0, 0], fire: true });
      for (let i = 0; i < TICK_RATE * 2 && stateOf(s.t) !== 'duel'; i++) s.run(1); // sees, reacts, duels
      expect(stateOf(s.t)).toBe('duel');
      s.t.body.weapon.slots[0]!.mag = 3; // low on ammo
      const w = s.world;
      fsmGoto(mindBehaviour, s.t, { tick: w.tick, rng: w.rng, tunables: w.tunables, events: s.bus, world: w }, MIND_DISENGAGE);
      s.run(TICK_RATE * 6);
      const after = s.names.slice(s.names.lastIndexOf('disengage') + 1);
      expect(after[0] === 'repeek' || after[0] === 'reposition').toBe(true);
      expect(s.t.body.weapon.slots[0]!.mag).toBeGreaterThan(3); // reloaded behind cover
    }
  });

  it('decision rows interpolate by skill: backing out aiming grows with skill, re-peeking falls', () => {
    const tun = cloneTunables();
    const lo = decisionProfile(0, tun.mindDecision, tun.mind.anchorSkills, { backOutAiming: 0, repeekChance: 0, strafeReverse: 0, glanceIntervalMedianSec: 0, repositionWalk: 0 });
    const hi = decisionProfile(100, tun.mindDecision, tun.mind.anchorSkills, { backOutAiming: 0, repeekChance: 0, strafeReverse: 0, glanceIntervalMedianSec: 0, repositionWalk: 0 });
    expect(hi.backOutAiming).toBeGreaterThan(lo.backOutAiming);
    expect(hi.repeekChance).toBeLessThan(lo.repeekChance);
  });
});

/** Ticks of the longest run where a movement key is held and the body is (nearly) still. */
function longestStuck(s: Setup, ticks: number): number {
  let run = 0, worst = 0;
  s.run(ticks, () => {
    const c = s.t.body.cmd;
    const pushing = c.moveX !== 0 || c.moveZ !== 0;
    if (pushing && speedOf(s.t) < 0.1) { run++; worst = Math.max(worst, run); } else run = 0;
  });
  return worst;
}

describe('moving: nav, look-ahead steering and the anti-stuck watchdog (§5.7)', () => {
  it('never stands against a wall for more than 0.5 s while trying to move (a goal straight through a wall, no nav graph)', () => {
    const level = arena([wall(-3, -3, 3, -2.5)]);
    for (const seed of [1, 2, 3]) {
      const s = setup({ skill: 50, seed, level, player: [40, 40], echo: [0, 0] });
      s.world.minds.perception.remove(s.t.id); // movement alone: it never sees nor hears the player
      s.run(10);
      planTo(s.t, { tick: s.world.tick, rng: s.world.rng, tunables: s.world.tunables, events: s.bus, world: s.world }, 0, 0, -8, false);
      const worst = longestStuck(s, TICK_RATE * 5);
      expect(worst * TICK_DT).toBeLessThanOrEqual(0.5);
      expect(s.t.mind.stats.unsticks).toBeGreaterThan(0);
    }
  });

  it('walks across Elbow through the nav graph to a spot it cannot walk to straight, never stuck', () => {
    // From the south arm (by the door) to the west arm: round the arm's walls, through doorways.
    const s = setup({ skill: 50, level: elbowMap, player: [11.5, 9.5], echo: [4, 8.6] });
    s.world.minds.perception.remove(s.t.id); // movement alone: it never sees nor hears the player
    s.run(10);
    const goal: Vec3 = vec3(-8.5, 0, 2.5);
    planTo(s.t, { tick: s.world.tick, rng: s.world.rng, tunables: s.world.tunables, events: s.bus, world: s.world }, goal.x, goal.y, goal.z, false);
    expect(s.t.mind.wpN).toBeGreaterThan(2);
    let arrivedAt = -1;
    let worst = 0, run = 0;
    s.run(TICK_RATE * 15, (tick) => {
      const c = s.t.body.cmd;
      if ((c.moveX !== 0 || c.moveZ !== 0) && speedOf(s.t) < 0.1) { run++; worst = Math.max(worst, run); } else run = 0;
      if (arrivedAt < 0 && s.t.mind.arrived) arrivedAt = tick;
    });
    expect(arrivedAt).toBeGreaterThan(0);
    expect(Math.hypot(s.t.pos.x - goal.x, s.t.pos.z - goal.z)).toBeLessThan(0.7);
    expect(worst * TICK_DT).toBeLessThanOrEqual(0.5);
  });
});

describe('determinism', () => {
  it('identical seeds give identical traces; the mind draws only from its own streams', () => {
    const trace = (seed: number): number[] => {
      const { s } = duelTrace(65, seed, 8, 12, true);
      return [s.world.hash(), s.t.mind.stats.shots, s.t.mind.stats.legs, s.t.body.kin.pos.x];
    };
    expect(trace(4)).toEqual(trace(4));
    expect(trace(4)).not.toEqual(trace(5));
  });

  it('a reaction is at least the surprised floor for an unaware contact', () => {
    // Player appears behind the Echo's back (outside its attention): unaware, floored at 0.25 s.
    const s = setup({ skill: 100, player: [0, -30], echo: [0, 0], mind: { watch: vec3(0, 0, 10) } });
    const reacted: SimEvents['enemyReacted'][] = [];
    s.bus.on('enemyReacted', (e) => reacted.push({ ...e }));
    s.run(TICK_RATE);
    s.input.moveX = 1;
    s.run(TICK_RATE * 4);
    for (const r of reacted) if (r.contact !== 'prepared') expect(r.reactMs).toBeGreaterThanOrEqual(s.world.tunables.dial.floors.enemyReactionSec * 1000 - 1e-6);
  });
});
