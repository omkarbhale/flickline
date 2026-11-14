import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { Rng } from '../core/rng';
import type { SectorRole } from '../config/sweep';
import { HeadlessGame } from '../debug/bot/headless';
import { meetReport } from '../debug/bot/sweepReport';
import { createTickInput, type TickInput } from '../sim/types';
import { sweepCatalog, sweepEnv, type SweepState } from './sweep';
import { drawRole, type RunPlan } from './sweepDirector';
import { planRoute } from './sweepGate';

const tunables = cloneTunables();
const cfg = tunables.sweep;

/** The door a player who takes door `(seed + depth) & 1` walks through at each gate (a mix of both). */
const doorAt = (seed: number, depth: number): 0 | 1 => ((seed + depth) & 1) as 0 | 1;
/** The whole route a seed gives along those doors (the gates are drawn as the run reaches them; this walks them offline). */
function sweepPlan(seed: number, t = tunables): RunPlan {
  return planRoute(seed, sweepEnv(t), (_g, plan) => doorAt(seed, plan.sectors.length));
}

/** The first seed whose plan has a meet sector at or after `from`, and that sector's index. */
function meetSeed(from = 1, pred: (n: number) => boolean = () => true): { seed: number; index: number } {
  for (let seed = from; seed < 2000; seed++) {
    const plan = sweepPlan(seed);
    const index = plan.sectors.findIndex((s) => s.role === 'meet' && pred(s.contacts[0]!.echoes.length));
    if (index >= 0) return { seed, index };
  }
  throw new Error('no meet seed');
}

describe('sector roles (design §4.2, #212)', () => {
  it('the Opener is a take; no role is drawn three times in a row; the mix follows takes 50 / holds 35 / meets 15', () => {
    const rng = new Rng(77);
    const counts: Record<SectorRole, number> = { take: 0, hold: 0, meet: 0 };
    for (let run = 0; run < 3000; run++) {
      const drawn: SectorRole[] = [];
      for (let i = 0; i < 6; i++) {
        const r = drawRole(rng, cfg, i, drawn);
        if (i === 0) expect(r).toBe('take');
        else counts[r]++;
        drawn.push(r);
        if (i >= 2) expect(drawn[i] === drawn[i - 1] && drawn[i] === drawn[i - 2]).toBe(false);
      }
    }
    const total = counts.take + counts.hold + counts.meet;
    expect(counts.meet / total).toBeGreaterThan(0.12);
    expect(counts.meet / total).toBeLessThan(0.2);
    expect(counts.hold / total).toBeGreaterThan(0.28);
    expect(counts.take / total).toBeGreaterThan(0.42);
  });

  it('a run plays takes and meets today (a drawn hold plays as a take until #204): about 13% of later sectors are meets, never two in a row', () => {
    let later = 0, meets = 0, runsWithMeet = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const roles = sweepPlan(seed).sectors.map((s) => s.role);
      expect(roles[0]).toBe('take');
      expect(roles.every((r) => r === 'take' || r === 'meet')).toBe(true);
      for (let i = 1; i < roles.length; i++) {
        later++;
        if (roles[i] === 'meet') {
          meets++;
          expect(roles[i - 1]).toBe('take'); // there is one meet sector: it is never dealt twice in a row
        }
      }
      if (roles.includes('meet')) runsWithMeet++;
    }
    expect(meets / later).toBeGreaterThan(0.09);
    expect(meets / later).toBeLessThan(0.17);
    expect(runsWithMeet).toBeGreaterThan(60);
  });

  it('a catalog without a meet sector plays a drawn meet as a take; so does a drawn hold today', () => {
    const takesOnly = sweepCatalog(tunables).filter((s) => !s.roles.includes('meet'));
    const t = cloneTunables();
    t.sweep.roleMix = { take: 0, hold: 1, meet: 1 };
    for (let seed = 1; seed <= 50; seed++) {
      const plan = planRoute(seed, { ...sweepEnv(t), catalog: takesOnly }, () => 0);
      expect(plan.sectors).toHaveLength(t.sweep.sectors);
      expect(plan.sectors.every((s) => s.role === 'take')).toBe(true);
    }
  });
});

describe('meet plans (design §4.2, #212)', () => {
  it('one `meet` contact of one or two Echoes on routes down the corridor, starting 15 m or more from the entry, 1000 seeds', () => {
    const sizes = new Set<number>();
    const gaits = new Set<string>();
    let groups = 0, sideBySide = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      for (const s of sweepPlan(seed).sectors) {
        if (s.role !== 'meet') continue;
        groups++;
        expect(s.sectorId).toBe('lane-meet-near');
        expect(s.contacts).toHaveLength(1);
        const c = s.contacts[0]!;
        expect(c.card).toBe('meet');
        expect(c.spots).toEqual([]);
        expect(c.echoes.length).toBeGreaterThanOrEqual(1);
        expect(c.echoes.length).toBeLessThanOrEqual(2);
        sizes.add(c.echoes.length);
        const lead = c.echoes[0]!;
        const gap = c.echoes.length === 2 ? Math.hypot(c.echoes[1]!.feet.x - lead.feet.x, c.echoes[1]!.feet.z - lead.feet.z) : 0;
        if (c.echoes.length === 2) expect(gap).toBeGreaterThan(cfg.meet.gapMinM - 1e-9);
        for (const e of c.echoes) {
          expect(e.kind).toBe('strafer');
          expect(e.expectation).toBe('attending');
          expect(e.gait === 'run' || e.gait === 'walk').toBe(true);
          expect(e.gait).toBe(lead.gait); // a group moves together
          gaits.add(e.gait!);
          // Far from where the player arrives, and moving towards it.
          expect(Math.hypot(e.feet.x - s.entry.x, e.feet.z - s.entry.z)).toBeGreaterThan(15);
          const a = e.laneA!, b = e.laneB!;
          expect(Math.hypot(b.x - s.entry.x, b.z - s.entry.z)).toBeGreaterThan(cfg.meet.endShortM - 0.01);
          expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(10);
          expect(a.x).toBeCloseTo(e.feet.x, 9);
        }
        // The second Echo walks beside the first, not in its footsteps (the corridor has room for it).
        if (c.echoes.length === 2) {
          expect(Math.abs(c.echoes[1]!.laneA!.x - lead.laneA!.x)).toBeCloseTo(cfg.meet.lateralM, 6);
          sideBySide++;
        }
      }
    }
    expect(groups).toBeGreaterThan(100);
    expect(sideBySide).toBeGreaterThan(20);
    expect([...sizes].sort()).toEqual([1, 2]);
    expect([...gaits].sort()).toEqual(['run', 'walk']);
  });

  it('routes are walkable from the Echo\'s start to the end (the Lane\'s cover stops stay clear of the lane)', () => {
    const lane = sweepCatalog(tunables).find((s) => s.id === 'lane-meet-near')!;
    for (let seed = 1; seed <= 1000; seed++) {
      for (const s of sweepPlan(seed).sectors) {
        if (s.role !== 'meet') continue;
        for (const e of s.contacts[0]!.echoes) expect(lane.walkable(e.laneA!, e.laneB!), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('the same seed gives the same meet; seeds differ', () => {
    const { seed } = meetSeed();
    expect(sweepPlan(seed)).toEqual(sweepPlan(seed));
    const shapes = new Set<string>();
    for (let s = 1; s <= 200; s++) for (const x of sweepPlan(s).sectors) if (x.role === 'meet') shapes.add(JSON.stringify(x.contacts[0]!.echoes.map((e) => [e.gait, e.laneA!.z.toFixed(2)])));
    expect(shapes.size).toBeGreaterThan(10);
  });
});

/** Leave the current sector by its exit and walk through the gate behind it by `doorAt`. */
function leave(g: HeadlessGame, input: TickInput, state: () => SweepState, seed: number): void {
  const sp = state().plan.sectors[state().sector]!;
  g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
  g.advance(input);
  const gc = cfg.gate;
  const d = doorAt(seed, state().gate!.plan.index);
  g.world.placePlayer(gc.doors[d].x, 0, gc.doors[d].z - gc.commitDepthM - 0.1, 0);
  for (let k = 0; k < Math.ceil(gc.commitSec * 128) + 3 && state().gate; k++) g.advance(input);
}

/** Run a seeded Sweep run headless to the start of sector `index` (leaving every earlier sector by its exit). */
function toSector(seed: number, index: number) {
  const g = new HeadlessGame({ seed });
  expect(g.modes.start('sweep', { seed })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  for (let k = 0; k < Math.ceil(tunables.run.readySec * 128) + 1; k++) g.advance(input);
  for (let i = 0; i < index; i++) leave(g, input, state, seed);
  expect(state().sector).toBe(index);
  return { g, input, state };
}

describe('a meet in the sim (#212)', () => {
  it('Echoes spawn on their routes in the corridor with the plan\'s gait and are all alive; sectorEntered says role meet', () => {
    const { seed, index } = meetSeed();
    const g = new HeadlessGame({ seed });
    const entered: { role: string; echoes: number }[] = [];
    g.bus.on('sectorEntered', (e) => entered.push({ role: e.role, echoes: e.echoes }));
    g.modes.start('sweep', { seed });
    const input = createTickInput();
    for (let k = 0; k < Math.ceil(tunables.run.readySec * 128) + 1; k++) g.advance(input);
    const state = (): SweepState => g.modes.runner.state as SweepState;
    for (let i = 0; i < index; i++) leave(g, input, state, seed);
    expect(entered[index]).toEqual({ role: 'meet', echoes: state().plan.sectors[index]!.contacts[0]!.echoes.length });
    const live = g.world.targets.filter((t) => t.alive);
    expect(live).toHaveLength(entered[index]!.echoes);
    expect(live.every((t) => t.ai.travel)).toBe(true);
  });

  it('they run their route towards the player; the Echo\'s speed is its gait; a run is heard and a walk is not (footstep stride)', () => {
    for (const gait of ['run', 'walk'] as const) {
      const { seed, index } = meetSeedWithGait(gait);
      const { g, input } = toSector(seed, index);
      const e = g.world.targets.find((t) => t.alive)!;
      let max = 0;
      for (let k = 0; k < 128; k++) {
        g.advance(input);
        max = Math.max(max, Math.hypot(e.ai.vel));
      }
      expect(max).toBeCloseTo(gait === 'run' ? cfg.meet.runSpeedMps : cfg.meet.walkSpeedMps, 3);
      // The audio rule the footsteps use: a walk is below the silent speed, a run above it.
      const heard = max >= tunables.audio.enemy.silentBelowMps;
      expect(heard).toBe(gait === 'run');
    }
  });

  it('every shot of a meet Echo leaves from a stop: speed 0 at the shot, and it was running before it reacted', () => {
    const { seed, index } = meetSeed();
    const { g, input } = toSector(seed, index);
    const speeds: number[] = [];
    const ids = new Set(g.world.targets.filter((t) => t.alive).map((t) => t.id));
    g.bus.on('enemyFired', (e) => {
      if (ids.has(e.id)) speeds.push(Math.abs(g.world.targetField.byId(e.id)!.ai.vel));
    });
    for (let k = 0; k < 128 * 8; k++) {
      g.world.health.hp = g.world.health.maxHp; // the player is a spectator here
      g.advance(input);
    }
    expect(speeds.length).toBeGreaterThan(0);
    for (const v of speeds) expect(v).toBe(0);
  });
});

function meetSeedWithGait(gait: 'run' | 'walk'): { seed: number; index: number } {
  for (let seed = 1; seed < 2000; seed++) {
    const plan = sweepPlan(seed);
    const index = plan.sectors.findIndex((s) => s.role === 'meet' && s.contacts[0]!.echoes[0]!.gait === gait);
    if (index >= 0) return { seed, index };
  }
  throw new Error('no seed');
}

describe('who stopped first (the meet contact fact, #212)', () => {
  /** Play a meet with a scripted player and settle it: the `contactSettled` of the meet. */
  function playMeet(script: (tick: number, input: TickInput) => void, ticks: number) {
    const { seed, index } = meetSeedWithGait('run');
    const { g, input, state } = toSector(seed, index);
    const settled: { card?: string; stopFirst?: string; outcome: string }[] = [];
    g.bus.on('contactSettled', (e) => settled.push({ card: e.card, stopFirst: e.stopFirst, outcome: e.outcome }));
    for (let k = 0; k < ticks; k++) {
      script(k, input);
      g.world.health.hp = g.world.health.maxHp;
      g.advance(input);
    }
    input.moveZ = 0;
    const sp = state().plan.sectors[state().sector]!;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    return settled.filter((s) => s.card === 'meet');
  }

  it('a player who stands still throughout stopped first; the event carries it', () => {
    const r = playMeet(() => undefined, 128 * 4);
    expect(r).toHaveLength(1);
    expect(r[0]!.stopFirst).toBe('player');
  });

  it('a player who keeps running at them while they brake and shoot did not: an Echo stopped first', () => {
    // Forward (-z) for 4 s: the Echoes' reaction is 0.3-1.2 s, they brake in 0.16 s, the player is still above the deadzone.
    const r = playMeet((_k, input) => { input.moveZ = 1; input.yaw = 0; }, 128 * 4);
    expect(r).toHaveLength(1);
    expect(r[0]!.stopFirst).toBe('echo');
  });

  it('other cards carry no stopFirst', () => {
    const { g, input, state } = toSector(1, 0);
    const settled: { card?: string; stopFirst?: string }[] = [];
    g.bus.on('contactSettled', (e) => settled.push({ card: e.card, stopFirst: e.stopFirst }));
    const e = g.world.targets.find((t) => t.alive)!;
    g.world.hitPlayer('kestrel', 'body', e.pos.x, 1.2, e.pos.z, e.id, g.bus); // opens its contact
    const sp = state().plan.sectors[0]!;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    expect(settled.length).toBeGreaterThan(0);
    for (const s of settled) expect(s.stopFirst).toBeUndefined();
  });
});

describe('bot harness: in meet contacts the side that stops first wins more often (#212)', () => {
  it('over 150 forced meet runs at skills 30 and 70 the player wins more when it stops first than when an Echo does', () => {
    const { rows } = meetReport([30, 70], 150, 200, 2.5);
    for (const r of rows) {
      const p = r.byStop.player, e = r.byStop.echo;
      expect(p.n, `skill ${r.skill}`).toBeGreaterThan(10);
      expect(e.n, `skill ${r.skill}`).toBeGreaterThan(10);
      expect(p.won / p.n, `skill ${r.skill}`).toBeGreaterThan(e.won / e.n + 0.05);
    }
  }, 60_000);
});
