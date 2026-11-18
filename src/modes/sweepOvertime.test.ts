import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { createTickInput } from '../sim/types';
import { atRisk, sweepEnv, type SweepState } from './sweep';
import { isOvertime, planRun, sectorDepth, sectorDialOffset, type RunPlan } from './sweepDirector';
import { commitGate, doorFacts, planGate, planOvertimeGate } from './sweepGate';

/**
 * Overtime (design §4.1, §4.7, §8.1, #206): after the Finale's exit gate the run may leave (every point banked) or push on through
 * another sector, harder each time; the points earned in Overtime are at risk until a Leave door.
 */

const tunables = cloneTunables();
const cfg = tunables.sweep;
const env = sweepEnv(tunables);

describe('Overtime numbers (design §4.1)', () => {
  it('the dial offset is +6 for the first Overtime sector, then +2 per sector; the depth multiplier x2.2, then +0.2 per sector', () => {
    expect([6, 7, 8, 9, 10].map((i) => sectorDialOffset(cfg, i))).toEqual([6, 8, 10, 12, 14]);
    expect([6, 7, 8, 9].map((i) => sectorDepth(cfg, i))).toEqual([2.2, 2.4, 2.6, 2.8].map((v) => expect.closeTo(v, 9)));
  });

  it('the route\'s own sectors keep their per-sector numbers, the Finale included', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => sectorDialOffset(cfg, i))).toEqual(cfg.dialOffset);
    expect([0, 1, 2, 3, 4, 5].map((i) => sectorDepth(cfg, i))).toEqual(cfg.depthMultiplier);
    expect([5, 6].map((i) => isOvertime(cfg, i))).toEqual([false, true]);
  });
});

/** A route of `cfg.sectors` sectors (door 0 at each gate), ready for the Finale's exit gate. */
function routeToFinale(seed: number): RunPlan {
  const plan = planRun(seed, env.catalog, env.cfg, env.body);
  while (plan.sectors.length < cfg.sectors) commitGate(plan, planGate(plan, env), 0);
  return plan;
}

describe('the Overtime gate plan', () => {
  it('has a Leave door on the left and the next sector behind the right one, drawn like any gate\'s door, deterministic per seed', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const plan = routeToFinale(seed);
      const gate = planOvertimeGate(plan, env);
      expect(gate.index).toBe(cfg.sectors);
      expect(gate.leave).toBe(0);
      const ahead = gate.doors[1].sector;
      expect(ahead.index).toBe(cfg.sectors);
      expect(ahead.finale).toBe(false);
      // Honest by construction: the door's facts are the sector's own.
      expect(gate.doors[1].facts).toEqual(doorFacts(ahead, cfg, env.hearM(ahead.mapId)));
      // The same seed and route give the same gate; the gate is the one an ordinary gate would draw.
      expect(planOvertimeGate(routeToFinale(seed), env)).toEqual(gate);
      expect(planGate(routeToFinale(seed), env).doors[1]).toEqual(gate.doors[1]);
    }
  });

  it('Overtime sectors deal their own contact counts, not the Finale\'s five holds', () => {
    let holds = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plan = routeToFinale(seed);
      for (const door of planOvertimeGate(plan, env).doors) {
        const s = door.sector;
        if (s.role === 'hold') {
          holds++;
          expect(s.contacts.length).toBeGreaterThanOrEqual(cfg.overtime.holdContacts[0]);
          expect(s.contacts.length).toBeLessThanOrEqual(cfg.overtime.holdContacts[1]);
        } else if (s.role === 'take') {
          expect(s.contacts.length).toBeLessThanOrEqual(cfg.overtime.takeContacts[1] + (s.stake === 'hot' ? cfg.gate.hotExtraContacts : 0));
        }
      }
    }
    expect(holds).toBeGreaterThan(20);
  });
});

/** A live Sweep run on `seed`, ready phase done, with helpers to walk it sector by sector. */
function startRun(seed: number) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  for (const type of ['sectorEntered', 'sectorEnded', 'runEnded', 'runBanked', 'overtimeLost', 'gateChosen'] as const) {
    g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  }
  expect(g.modes.start('sweep', { seed, pick: g.modes.primary })).toBe(true);
  const input = createTickInput();
  for (let k = 0; k < Math.ceil(tunables.run.readySec * 128) + 2; k++) g.advance(input);
  expect(g.run.state).toBe('live');
  const state = (): SweepState => g.modes.runner.state as SweepState;
  const score = (): number => g.modes.runner.stats.score;
  const toExit = (): void => {
    const sp = state().plan.sectors[state().sector]!;
    if (state().role === 'hold') state().exitOpen = true;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
  };
  const throughGate = (door: 0 | 1): void => {
    const gc = cfg.gate;
    expect(state().gate, 'in a gate').not.toBeNull();
    g.world.placePlayer(gc.doors[door].x, 0, gc.doors[door].z - gc.commitDepthM - 0.1, 0);
    g.advance(input);
    for (let k = 0; k <= Math.ceil(gc.commitSec * 128) + 1 && g.run.state === 'live' && state().gate; k++) g.advance(input);
  };
  /** Walk the route to the Finale's exit gate, taking door 0 at each gate, with `routePoints` earned on the way. */
  const toFinaleGate = (routePoints: number): void => {
    g.modes.runner.awardPoints(routePoints);
    for (let i = 0; i < cfg.sectors; i++) {
      toExit();
      if (i < cfg.sectors - 1) throughGate(0);
    }
    expect(state().gate!.plan.leave).toBe(0);
  };
  const kill = (): void => {
    for (let k = 0; k < 40 && g.world.health.alive; k++) g.world.hitPlayer('kestrel', 'head', 0, 1.4, 0, -1, g.bus);
    expect(g.world.health.alive).toBe(false);
  };
  return { g, log, input, state, score, toExit, throughGate, toFinaleGate, kill };
}

const events = (log: { type: string; e: Record<string, unknown> }[], type: string) => log.filter((l) => l.type === type).map((l) => l.e);

describe('Overtime: bank or push (design §4.7)', () => {
  it('the Finale\'s exit banks the score so far; the gate offers Leave on the left and Overtime on the right', () => {
    const { score, state, toFinaleGate, g } = startRun(11);
    toFinaleGate(600);
    expect(g.run.state).toBe('live');
    expect(state().banked).toBe(score());
    expect(score()).toBe(600);
    expect(atRisk(state(), score())).toBe(0);
    expect(state().overtime).toBe(0);
  });

  it('pushing on enters the Overtime sector with the Overtime dial offset and depth multiplier, and its exit offers the same two doors', () => {
    const { g, log, state, toFinaleGate, throughGate, toExit } = startRun(12);
    toFinaleGate(600);
    throughGate(1);
    expect(g.run.state).toBe('live');
    expect(state().sector).toBe(cfg.sectors);
    expect(state().overtime).toBe(1);
    const entered = events(log, 'sectorEntered');
    expect(entered).toHaveLength(cfg.sectors + 1);
    const ot = entered[cfg.sectors]!;
    expect(ot).toMatchObject({ index: 6, of: 6, opener: false });
    expect(ot.depth).toBeCloseTo(2.2, 9);
    expect(events(log, 'gateChosen').at(-1)).toMatchObject({ door: 1, leave: false });
    toExit();
    expect(state().gate!.plan.leave).toBe(0);
    expect(state().gate!.plan.index).toBe(cfg.sectors + 1);
    throughGate(1);
    expect(state().overtime).toBe(2);
    expect(events(log, 'sectorEntered')[cfg.sectors + 1]!.depth).toBeCloseTo(2.4, 9);
  });

  it('death in Overtime keeps the points of sectors 1-6 and loses only the unbanked Overtime points', () => {
    const { g, log, state, score, toFinaleGate, throughGate, toExit, kill } = startRun(13);
    toFinaleGate(900);
    const banked = score();
    expect(banked).toBe(900);
    throughGate(1);
    // Overtime sector 1 earns 400, its exit gate, Overtime sector 2 earns 250 more: 650 at risk when the player dies.
    g.modes.runner.awardPoints(400);
    toExit();
    throughGate(1);
    g.modes.runner.awardPoints(250);
    expect(atRisk(state(), score())).toBe(650);
    kill();
    expect(g.run.state).toBe('result');
    expect(events(log, 'runEnded').map((e) => e.reason)).toEqual(['death']);
    const lost = events(log, 'overtimeLost');
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ points: 650, overtimeSectors: 2, score: banked });
    expect(events(log, 'runBanked')).toEqual([]);
    // The final score is exactly what sectors 1-6 earned.
    expect(score()).toBe(banked);
    expect(g.run.liveStats().endReason).toBe('death');
  });

  it('death in Overtime sector 1 loses what that sector paid, and nothing of the route', () => {
    const { g, log, score, toFinaleGate, throughGate, kill } = startRun(14);
    toFinaleGate(1200);
    throughGate(1);
    g.modes.runner.awardPoints(75);
    kill();
    expect(events(log, 'overtimeLost')[0]).toMatchObject({ points: 75, overtimeSectors: 1, score: 1200 });
    expect(score()).toBe(1200);
  });

  it('death in the Finale itself loses nothing: no Overtime point was ever at risk', () => {
    const { g, log, score, kill } = startRun(15);
    g.modes.runner.awardPoints(500);
    kill();
    expect(events(log, 'overtimeLost')).toEqual([]);
    expect(score()).toBe(500);
  });

  it('Leave banks all: the run ends as left with every Overtime point in the score', () => {
    const { g, log, state, score, toFinaleGate, throughGate, toExit } = startRun(16);
    toFinaleGate(900);
    throughGate(1);
    g.modes.runner.awardPoints(400);
    toExit();
    throughGate(1);
    g.modes.runner.awardPoints(250);
    toExit();
    expect(state().gate!.plan.leave).toBe(0);
    throughGate(0);
    expect(g.run.state).toBe('result');
    expect(events(log, 'runEnded').map((e) => e.reason)).toEqual(['left']);
    expect(events(log, 'runBanked')).toEqual([expect.objectContaining({ points: 650, overtimeSectors: 2, score: 1550 })]);
    expect(events(log, 'overtimeLost')).toEqual([]);
    expect(score()).toBe(1550);
    expect(events(log, 'gateChosen').at(-1)).toMatchObject({ leave: true });
  });

  it('Leave straight after the Finale banks the route with no Overtime points: runBanked says so', () => {
    const { g, log, score, toFinaleGate, throughGate } = startRun(17);
    toFinaleGate(700);
    throughGate(0);
    expect(events(log, 'runEnded').map((e) => e.reason)).toEqual(['left']);
    expect(events(log, 'runBanked')).toEqual([expect.objectContaining({ points: 0, overtimeSectors: 0, score: 700 })]);
    expect(score()).toBe(700);
    expect(g.run.liveStats()).toMatchObject({ endReason: 'left', sectorsReached: 6 });
  });

  it('a run stopped between two Overtime sectors forfeits what was at risk, as a death does', () => {
    const { g, log, score, toFinaleGate, throughGate, toExit } = startRun(18);
    toFinaleGate(800);
    throughGate(1);
    g.modes.runner.awardPoints(300);
    toExit();
    g.modes.stop();
    expect(events(log, 'overtimeLost')[0]).toMatchObject({ points: 300, overtimeSectors: 1, score: 800 });
    expect(score()).toBe(800);
  });

  it('the same seed plays the same Overtime (sectors and doors)', () => {
    const route = (seed: number): string[] => {
      const r = startRun(seed);
      r.toFinaleGate(100);
      r.throughGate(1);
      r.toExit();
      r.throughGate(1);
      return r.state().plan.sectors.map((s) => `${s.mapId}/${s.sectorId}:${s.stake}:${s.contacts.map((c) => c.card).join(',')}`);
    };
    expect(route(21)).toEqual(route(21));
    expect(route(21)).toHaveLength(cfg.sectors + 2);
  });
});
