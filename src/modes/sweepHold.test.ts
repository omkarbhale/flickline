import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { MAPS } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { sweepCatalog, sweepEnv, type SweepState } from './sweep';
import { drawHoldCard, entryEye, planFollowers, type RunPlan, type SectorPlan } from './sweepDirector';
import { planRoute } from './sweepGate';

/**
 * Hold sectors and the Finale (#204): the shape of a six-sector run, the arrivals of a hold sector, the
 * fairness floors and information honesty they keep, the exit that opens when the Echoes are dead, and the
 * survivors that follow the player.
 */

const tunables = cloneTunables();
const cfg = tunables.sweep;
const env = sweepEnv(tunables);

/** The route a seed gives when the player takes door `door(seed, depth)` at each gate. */
function route(seed: number, door: (seed: number, depth: number) => 0 | 1): RunPlan {
  return planRoute(seed, env, (_g, plan) => door(seed, plan.sectors.length));
}
const left = (): 0 | 1 => 0;
const right = (): 0 | 1 => 1;
const mixed = (seed: number, depth: number): 0 | 1 => ((seed + depth) & 1) as 0 | 1;
const ROUTES: readonly [string, (seed: number, depth: number) => 0 | 1][] = [['left doors', left], ['right doors', right], ['mixed doors', mixed]];

/** Every sector of the plan the player could have walked into: the route and both doors of every gate. */
function everySector(plan: RunPlan): SectorPlan[] {
  return [plan.sectors[0]!, ...plan.gates.flatMap((g) => [g.doors[0].sector, g.doors[1].sector])];
}

describe('the shape of a run: six sectors, a Finale that is a hold (#204)', () => {
  it('whatever doors are taken, over 150 seeds: the Opener is a take, the Finale a hold, a take and a hold among sectors 2 to 5, never three of a role in a row, never one sector twice in a row', () => {
    for (const [name, door] of ROUTES) {
      for (let seed = 1; seed <= 150; seed++) {
        const plan = route(seed, door);
        const roles = plan.sectors.map((x) => x.role);
        const where = `${name} seed ${seed}: ${roles}`;
        expect(plan.sectors, where).toHaveLength(6);
        expect(roles[0], where).toBe('take');
        expect(roles[5], where).toBe('hold');
        expect(plan.sectors[5]!.finale).toBe(true);
        expect(roles.slice(1, 5), where).toContain('take');
        expect(roles.slice(1, 5), where).toContain('hold');
        for (let k = 2; k < roles.length; k++) expect(roles[k] === roles[k - 1] && roles[k] === roles[k - 2], where).toBe(false);
        for (let k = 1; k < plan.sectors.length; k++) {
          const a = plan.sectors[k]!, b = plan.sectors[k - 1]!;
          expect(`${a.mapId}/${a.sectorId}`, where).not.toBe(`${b.mapId}/${b.sectorId}`);
        }
        // Both doors of every gate keep the rules too: the other door is just as planned.
        plan.gates.forEach((g) => {
          if (g.index === cfg.finaleSector - 1) for (const d of g.doors) expect(d.sector.role, `${where}: the Finale behind either door`).toBe('hold');
        });
      }
    }
  });

  it('the sector plays a role it can serve; a hold sector is one with approach lanes', () => {
    const cat = sweepCatalog(tunables);
    for (let seed = 1; seed <= 60; seed++) {
      for (const x of everySector(route(seed, mixed))) {
        const src = cat.find((c) => c.mapId === x.mapId && c.id === x.sectorId)!;
        expect(src.roles, `${x.sectorId}`).toContain(x.role);
        if (x.role === 'hold') expect(src.approaches.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('hold sectors deal hold, trade and flank; contacts stay within the per-sector range; the Finale has the run\'s largest contact count', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 200; seed++) {
      const plan = route(seed, mixed);
      for (const x of everySector(plan)) {
        if (x.role !== 'hold') continue;
        expect(x.contacts.length).toBeGreaterThanOrEqual(cfg.hold.contactsMin[Math.min(x.index, cfg.hold.contactsMin.length - 1)]!);
        expect(x.contacts.length).toBeLessThanOrEqual(cfg.hold.contactsMax[Math.min(x.index, cfg.hold.contactsMax.length - 1)]!);
        for (const c of x.contacts) {
          expect(['hold', 'trade', 'flank']).toContain(c.card);
          expect(c.echoes).toHaveLength(c.card === 'trade' ? 2 : 1);
          for (const e of c.echoes) expect(e.arrive).toBeDefined();
          counts[c.card] = (counts[c.card] ?? 0) + 1;
        }
      }
      const sizes = plan.sectors.map((x) => x.contacts.length);
      expect(sizes[5], `seed ${seed} ${sizes}`).toBeGreaterThan(Math.max(...sizes.slice(0, 5)));
    }
    for (const c of ['hold', 'trade', 'flank']) expect(counts[c] ?? 0, c).toBeGreaterThan(20);
  });

  it('the cards never run three alike along the route, and a crossfire never comes in sector 5 (the breather)', () => {
    for (const [name, door] of ROUTES) {
      for (let seed = 1; seed <= 100; seed++) {
        const plan = route(seed, door);
        const cards = plan.sectors.flatMap((x) => x.contacts.map((c) => c.card));
        for (let k = 2; k < cards.length; k++) expect(cards[k] === cards[k - 1] && cards[k] === cards[k - 2], `${name} ${seed} ${cards}`).toBe(false);
        for (const c of plan.sectors[4]!.contacts) expect(c.card).not.toBe('crossfire');
      }
    }
  });
});

describe('arrivals in the plan (#204)', () => {
  it('a hold sector\'s arrivals leave a lane of the sector from outside it, in order, within the sector\'s window; a flank always runs', () => {
    for (let seed = 1; seed <= 150; seed++) {
      for (const x of everySector(route(seed, mixed))) {
        if (x.role !== 'hold') continue;
        const src = sweepCatalog(tunables).find((c) => c.mapId === x.mapId && c.id === x.sectorId)!;
        const region = MAPS[x.mapId]!.sectors.find((m) => m.id === x.sectorId)!.region;
        const laneIds = new Set(src.approaches.map((a) => a.id));
        // The last arrival is due at most the latest first arrival plus one longest gap per later contact (#248).
        const lastDue = cfg.hold.firstArrivalSec[1] + Math.max(1, (x.contacts.length - 1) * cfg.hold.arrivalGapSec[1]);
        let lastAt = -1;
        for (const c of x.contacts) {
          for (const e of c.echoes) {
            const a = e.arrive!;
            expect(laneIds.has(a.lane), `${x.sectorId} ${a.lane}`).toBe(true);
            const first = a.route[0]!;
            const inside = first.x >= region.min.x && first.x <= region.max.x && first.z >= region.min.z && first.z <= region.max.z;
            expect(inside, `seed ${seed} ${x.sectorId}: an arrival starts outside the sector`).toBe(false);
            expect(a.route.length).toBeGreaterThanOrEqual(2);
            expect(a.route.length).toBeLessThanOrEqual(8);
            expect(a.speed).toBe(a.running ? cfg.hold.runMps : cfg.hold.walkMps);
            if (c.card === 'flank') expect(a.running, 'a flank is audible: it runs').toBe(true);
            else {
              expect(a.atSec).toBeLessThanOrEqual(lastDue + cfg.hold.tradeGapSec[1] + 1e-9);
              expect(a.atSec).toBeGreaterThanOrEqual(cfg.hold.firstArrivalSec[0]);
            }
          }
          if (c.card !== 'flank') {
            const at = c.echoes[0]!.arrive!.atSec;
            expect(at, `seed ${seed} ${x.sectorId}: arrivals in order`).toBeGreaterThan(lastAt);
            lastAt = at;
          }
        }
      }
    }
  });

  it('a flank is only dealt after a contact (the one it names), never after another flank, from a lane other than that contact\'s', () => {
    let flanks = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const x of everySector(route(seed, mixed))) {
        x.contacts.forEach((c, k) => {
          if (c.card !== 'flank') {
            expect(c.after).toBeUndefined();
            return;
          }
          flanks++;
          expect(x.role).toBe('hold');
          expect(c.after, `seed ${seed}`).toBe(k - 1);
          expect(k).toBeGreaterThan(0);
          expect(x.contacts[k - 1]!.card).not.toBe('flank');
          expect(c.echoes[0]!.arrive!.lane).not.toBe(x.contacts[k - 1]!.echoes[0]!.arrive!.lane);
        });
      }
    }
    expect(flanks).toBeGreaterThan(20);
  });

  it('a Peeker arrival walks to a peek anchor whose full step out shows from the entry, by a route that keeps clear of the entry', () => {
    let peekers = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const x of everySector(route(seed, mixed))) {
        if (x.role !== 'hold') continue;
        const src = sweepCatalog(tunables).find((c) => c.mapId === x.mapId && c.id === x.sectorId)!;
        const eye = entryEye(src, tunables.movement);
        for (const c of x.contacts) {
          for (const e of c.echoes) {
            if (e.kind !== 'peeker') continue;
            peekers++;
            expect(e.peek!.pattern).toBe('wide'); // the pattern that shoots
            expect(src.visible(eye, e.peek!.out, false), `${x.sectorId} ${e.spot}`).toBe(true);
            const end = e.arrive!.route[e.arrive!.route.length - 1]!;
            expect(Math.hypot(end.x - e.peek!.hold.x, end.z - e.peek!.hold.z)).toBeLessThan(1e-9);
            for (const p of e.arrive!.route) expect(Math.hypot(p.x - src.entry.x, p.z - src.entry.z)).toBeGreaterThanOrEqual(cfg.hold.minRouteFromEntryM);
          }
        }
      }
    }
    expect(peekers).toBeGreaterThan(10);
  });

  it('walking is silent and running is not: the walk speed is under the footstep audio\'s silent speed, the run at or above it', () => {
    expect(cfg.hold.walkMps).toBeLessThan(tunables.audio.enemy.silentBelowMps);
    expect(cfg.hold.runMps).toBeGreaterThanOrEqual(tunables.audio.enemy.silentBelowMps);
  });

  it('followers: planFollowers deals a flank after a won contact and a trade otherwise, along one of the sector\'s lanes, at most `follow.max`', () => {
    const src = sweepCatalog(tunables).find((c) => c.id === 'elbow-take-hub')!;
    const won = planFollowers(5, cfg, src, 5, true, 2, 99)!;
    expect(won.card).toBe('flank');
    expect(won.index).toBe(99);
    expect(won.echoes).toHaveLength(cfg.follow.max);
    expect(won.echoes.every((e) => e.arrive!.running)).toBe(true);
    const lost = planFollowers(5, cfg, src, 1, false, 2, 100)!;
    expect(lost.card).toBe('trade');
    expect(lost.echoes).toHaveLength(1);
    expect(planFollowers(5, cfg, src, 0, true, 2, 1)).toBeNull();
    expect(planFollowers(5, cfg, { ...src, approaches: [] }, 2, true, 2, 1)).toBeNull();
    expect(planFollowers(5, cfg, src, 2, true, 2, 1)).toEqual(planFollowers(5, cfg, src, 2, true, 2, 1));
  });

  it('drawHoldCard never deals a third card in a row or a flank that is not allowed', () => {
    const rng = new Rng(9);
    for (let k = 0; k < 500; k++) {
      expect(drawHoldCard(rng, cfg, true, ['hold', 'hold'])).not.toBe('hold');
      expect(drawHoldCard(rng, cfg, false, [])).not.toBe('flank');
    }
  });
});

/** Start a Sweep run headless and hand back what the tests read. */
function startRun(seed: number) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  for (const type of ['sectorEntered', 'sectorEnded', 'sectorExitOpened', 'contactSettled', 'runEnded', 'targetVisible'] as const) {
    g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  }
  expect(g.modes.start('sweep', { seed, pick: g.modes.primary })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  /** Out by the exit (a hold's is opened first: its Echoes are not played here), then through door `door` of the gate. */
  const next = (door: 0 | 1 = 0): void => {
    const st = state();
    const sp = st.plan.sectors[st.sector]!;
    if (st.role === 'hold') st.exitOpen = true;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    if (g.run.state === 'result') return;
    const gc = cfg.gate;
    g.world.placePlayer(gc.doors[door].x, 0, gc.doors[door].z - gc.commitDepthM - 0.1, 0);
    for (let k = 0; k <= Math.ceil(gc.commitSec * 128) + 3 && state().gate; k++) g.advance(input);
  };
  const begin = (): void => {
    for (let k = 0; k < Math.ceil(tunables.run.readySec * 128) + 1; k++) g.advance(input);
  };
  return { g, log, input, state, next, begin };
}

/** One hold sector played by a player who stands at its entry and shoots nothing: what the Echoes do, tick by tick. */
function camp(seed: number, maxSec: number) {
  const { g, input, state, next, begin } = startRun(seed);
  begin();
  // Walk out of the other sectors until the first hold sector.
  while (state().role !== 'hold' && g.run.state !== 'result') next((seed & 1) as 0 | 1);
  const floors = tunables.dial.floors;
  const sp = state().plan.sectors[state().sector]!;
  const region = MAPS[sp.mapId]!.sectors.find((x) => x.id === sp.sectorId)!.region;
  const out = { spawns: 0, startsInside: 0, minDist: Infinity, floorBreaks: 0, firedUninformed: 0, fired: 0 };
  const seen = new Set<number>();
  const off = g.bus.on('enemyFired', (e) => {
    const t = g.world.targetField.byId(e.id);
    out.fired++;
    if (t && t.visibleTick < 0 && t.ai.audibleTick < 0) out.firedUninformed++;
  });
  const p = g.world.player;
  for (let k = 0; k < Math.round(maxSec * 128) && g.world.health.alive && !state().exitOpen; k++) {
    g.advance(input);
    for (const t of g.world.targets) {
      if (!t.alive || !t.ai.honest) continue;
      if (!seen.has(t.id)) {
        seen.add(t.id);
        out.spawns++;
        if (t.pos.x >= region.min.x && t.pos.x <= region.max.x && t.pos.z >= region.min.z && t.pos.z <= region.max.z) out.startsInside++;
      }
      if (!t.ai.arriving) continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      out.minDist = Math.min(out.minDist, d);
      // The floors of design §9.3.5: 4 m anywhere, 5 m inside the view cone (the player stands still, so one yaw serves).
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      const inCone = d > 1e-6 && ((t.pos.x - p.pos.x) * fx + (t.pos.z - p.pos.z) * fz) / d > Math.cos((floors.spawnViewAngleDeg * Math.PI) / 180);
      if (d < floors.spawnMinDistance - 1e-6 || (inCone && d < floors.spawnViewConeDistance - 1e-6)) out.floorBreaks++;
    }
  }
  off();
  return { out, sp };
}

describe('hold sectors in the sim (#204)', () => {
  it('a hold sector starts empty; its arrivals spawn outside it, never come inside the fairness floors, and never fire before the player has seen or heard them (40 seeds, a player who stands at the entry)', () => {
    let spawns = 0, fired = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { out, sp } = camp(seed, 70);
      const where = `seed ${seed} ${sp.sectorId}`;
      expect(out.startsInside, where).toBe(0);
      expect(out.floorBreaks, `${where}: an arrival came inside the floor (min ${out.minDist.toFixed(2)} m)`).toBe(0);
      expect(out.firedUninformed, `${where}: an arrival fired before it was seen or heard`).toBe(0);
      spawns += out.spawns;
      fired += out.fired;
    }
    // The harness really saw arrivals, and some of them fought.
    expect(spawns).toBeGreaterThan(40);
    expect(fired).toBeGreaterThan(10);
  }, 120_000);

  it('the exit of a hold sector stays closed until every Echo of it has come and died, is announced once, and then leads on; a flank arrives only after the contact it follows is won', () => {
    const { g, input, state, next, begin, log } = startRun(1);
    begin();
    while (state().role !== 'hold') next();
    const st = state();
    const sector = st.sector;
    const sp = st.plan.sectors[sector]!;
    const field = g.world.targetField;
    expect(g.world.targets.filter((t) => t.alive)).toEqual([]);
    // Walking onto the exit does nothing while it is closed.
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    for (let k = 0; k < 10; k++) g.advance(input);
    expect(state().sector).toBe(sector);
    expect(state().gate).toBeNull();
    expect(state().exitOpen).toBe(false);
    g.world.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, 0);
    // A perfect player: every Echo is shot dead the tick it appears.
    const spawned: { tick: number; id: number }[] = [];
    const off = g.bus.on('targetSpawned', (e) => spawned.push({ tick: e.tick, id: e.targetId }));
    let opened = -1;
    let idle = 0;
    for (let k = 0; k < 128 * 200 && opened < 0; k++) {
      g.world.health.hp = 100;
      g.advance(input);
      for (let slot = 0; slot < field.slots.length; slot++) {
        const t = field.slots[slot]!;
        if (t.alive) field.applyHit(slot, 'head', t.pos, 10, 1000, g.world.tick, g.bus);
      }
      if (state().exitOpen) opened = k;
      // Closed means somebody is alive or still to come (the tick the last one dies the exit is still shut, it opens on the next).
      const busy = st.contacts.some((c) => c.pending > 0 || c.alive > 0);
      idle = busy ? 0 : idle + 1;
      if (!state().exitOpen) expect(idle, 'the exit stayed closed with nobody left').toBeLessThanOrEqual(2);
    }
    off();
    expect(opened).toBeGreaterThan(0);
    expect(spawned.length).toBe(st.contacts.reduce((n, c) => n + c.plan.echoes.length, 0));
    // A flank spawned on the clock of the win that armed it, never before.
    for (const c of st.contacts) {
      if (c.plan.after === undefined) continue;
      const before = st.contacts[c.plan.after]!;
      expect(before.engaged && before.alive === 0 && before.pending === 0).toBe(true);
      expect(c.armedTick).toBeGreaterThan(0);
      for (let e = 0; e < c.echoIds.length; e++) {
        const at = spawned.find((x) => x.id === c.echoIds[e])!.tick;
        expect(at).toBeGreaterThanOrEqual(c.armedTick + Math.round(c.plan.echoes[e]!.arrive!.atSec * 128));
      }
    }
    // Every contact of the sector was won, and the exit was announced once.
    expect(log.filter((l) => l.type === 'contactSettled' && l.e.outcome === 'cleared')).toHaveLength(st.contacts.length);
    expect(log.filter((l) => l.type === 'sectorExitOpened' && l.e.index === sector)).toHaveLength(1);
    // And it leads on, with the sector cleared.
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    expect(state().gate !== null || g.run.state === 'result').toBe(true);
    expect(log.filter((l) => l.type === 'sectorEnded' && l.e.index === sector).map((l) => l.e.cleared)).toEqual([true]);
  });

  it('a hold sector\'s exit opens by itself after the fallback when an Echo is stuck, so one Echo never holds the run', () => {
    const { g, input, state, next, begin } = startRun(1);
    begin();
    while (state().role !== 'hold') next();
    const st = state();
    const sp = st.plan.sectors[st.sector]!;
    g.world.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, 0);
    const last = Math.max(...sp.contacts.flatMap((c) => c.echoes.map((e) => e.arrive!.atSec)));
    // Nobody shoots and nobody is shot: the Echoes arrive and stay.
    g.world.enemiesFire = false;
    for (let k = 0; k < 128 * (last + cfg.hold.exitFallbackSec - 1); k++) {
      g.world.health.hp = 100;
      g.advance(input);
    }
    expect(state().exitOpen).toBe(false);
    for (let k = 0; k < 128 * 3; k++) {
      g.world.health.hp = 100;
      g.advance(input);
    }
    expect(state().exitOpen).toBe(true);
  }, 30_000);

  it('survivors that fought the player follow into the next sector: a flank after a won contact, else a trade; one that never met him does not', () => {
    const lead = (won: boolean, engaged: boolean) => {
      // Seed 7 opens with a take sector with an Echo.
      const { g, state, begin, next } = startRun(7);
      begin();
      const st = state();
      expect(st.role).toBe('take');
      const alive = st.contacts.filter((c) => c.alive > 0);
      expect(alive.length).toBeGreaterThan(0);
      for (const c of alive) c.engaged = engaged;
      st.wonSector = won ? 1 : 0;
      // Nothing opens a contact on the way out: nobody shoots and the player looks at the ceiling.
      g.world.enemiesFire = false;
      g.world.player.pitch = 1.5;
      const sp = st.plan.sectors[0]!;
      const up = createTickInput();
      up.pitch = 1.5;
      g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
      g.advance(up);
      // In the gate: the survivors are waiting to follow into whatever door is taken.
      const carry = st.carry;
      next(0);
      return { st, carry, planned: st.plan.sectors[1]!.contacts.length };
    };
    const flank = lead(true, true);
    expect(flank.carry).toEqual({ count: expect.any(Number), won: true });
    expect(flank.st.contacts).toHaveLength(flank.planned + 1);
    const f = flank.st.contacts[flank.planned]!;
    expect(f.plan.card).toBe('flank');
    expect(f.pending).toBe(f.plan.echoes.length);
    expect(f.plan.echoes.every((e) => e.arrive && e.arrive.running)).toBe(true);
    const trade = lead(false, true);
    expect(trade.st.contacts[trade.planned]!.plan.card).toBe('trade');
    const none = lead(true, false);
    expect(none.carry).toBeNull();
    expect(none.st.contacts).toHaveLength(none.planned);
  });

  it('bot harness, 30 seeds: a flank is only dealt after a won contact, and every hold sector ends with its exit opened by the last kill', () => {
    let flanksSeen = 0, holdsEnded = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const g = new HeadlessGame({ seed });
      const st = (): SweepState => g.modes.runner.state as SweepState;
      let wonThis = 0, wonPrev = 0;
      const opened: number[] = [];
      g.bus.on('sectorEntered', () => {
        wonPrev = wonThis;
        wonThis = 0;
      });
      g.bus.on('contactSettled', (e) => {
        if (e.outcome === 'cleared') wonThis++;
      });
      g.bus.on('sectorExitOpened', (e) => {
        opened.push(e.index);
        // The exit opens when the last Echo died, not before.
        expect(g.world.targets.filter((t) => t.alive).length, `seed ${seed} sector ${e.index}`).toBe(0);
      });
      g.bus.on('sectorEnded', (e) => {
        if (e.reason === 'exit' && st().plan.sectors[e.index]!.role === 'hold') holdsEnded++;
        // Every flank that came (one of its Echoes spawned) came after a won contact: the one it names, or, for a survivor that followed, one in the sector before.
        for (const c of st().contacts) {
          if (c.plan.card !== 'flank' || !c.echoIds.some((id) => id !== -2)) continue;
          flanksSeen++;
          if (c.plan.after !== undefined) {
            const before = st().contacts[c.plan.after]!;
            expect(before.alive === 0 && before.pending === 0 && before.engaged, `seed ${seed} flank after a contact not won`).toBe(true);
          } else expect(wonPrev, `seed ${seed} a follower flank without a won contact`).toBeGreaterThan(0);
        }
      });
      playMode(g, { mode: 'sweep', skill: 50, seed });
      for (const i of opened) expect(st().plan.sectors[i]!.role).toBe('hold');
    }
    expect(holdsEnded).toBeGreaterThan(15);
    expect(flanksSeen).toBeGreaterThan(0);
  }, 120_000);
});
