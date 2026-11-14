import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import type { Vec3 } from '../core/vec3';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { bodyTop, lineClear } from '../sim/exposure';
import { MAPS } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { planCards, sweepCatalog, sweepEnv, sweepPlan as startPlan, type SweepState } from './sweep';
import { cardSpots, drawCard, perSector, type RunPlan } from './sweepDirector';
import { planRoute } from './sweepGate';
import { Rng } from '../core/rng';

const tunables = cloneTunables();
const cfg = tunables.sweep;
const env = sweepEnv(tunables);

/** The whole route a seed gives when the player takes door `(seed + depth) & 1` at each gate (a mix of both doors). */
function sweepPlan(seed: number): RunPlan {
  return planRoute(seed, env, (_g, plan) => ((seed + plan.sectors.length) & 1) as 0 | 1);
}

/** A finer body grid than the director's own (9 x 13, crown included): an independent check that nothing shows. */
const showsMemo = new Map<string, boolean>();
function shows(mapId: string, eye: Vec3, feet: Vec3, crouched: boolean): boolean {
  const key = [mapId, eye.x, eye.y, eye.z, feet.x.toFixed(3), feet.y.toFixed(3), feet.z.toFixed(3), crouched].join();
  let v = showsMemo.get(key);
  if (v === undefined) {
    const hit = tunables.targets.hit;
    // The crown included (row 0 is the top of the head), then evenly down to the ankles, across the torso's width.
    const top = bodyTop(hit, crouched);
    v = false;
    for (let r = 0; r <= 12 && !v; r++) {
      const y = feet.y + top - (top - 0.02) * (r / 12);
      for (let c = 0; c <= 8 && !v; c++) {
        const off = (c / 8 - 0.5) * hit.torsoWidth;
        const dx = feet.x - eye.x, dz = feet.z - eye.z, l = Math.hypot(dx, dz) || 1;
        v = lineClear(MAPS[mapId]!.boxes, eye.x, eye.y, eye.z, feet.x - (dz / l) * off, y, feet.z + (dx / l) * off);
      }
    }
    showsMemo.set(key, v);
  }
  return v;
}

function* along(a: Vec3, b: Vec3, stepM = 0.1): Generator<Vec3> {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / stepM));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    yield { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u };
  }
}

describe('Sweep run director (#201)', () => {
  it('the catalog has the four take sectors of Elbow and Lane', () => {
    const takes = sweepCatalog(tunables).filter((s) => s.roles.includes('take')).map((s) => `${s.mapId}/${s.id}`).sort();
    expect(takes).toEqual(['elbow/elbow-take-door', 'elbow/elbow-take-hub', 'elbow/elbow-take-west', 'lane/lane-take-far']);
  });

  it('same seed, same plan; different seeds, different runs', () => {
    expect(sweepPlan(42)).toEqual(sweepPlan(42));
    const shapes = new Set<string>();
    for (let s = 1; s <= 30; s++) shapes.add(JSON.stringify(sweepPlan(s).sectors.map((x) => [x.sectorId, x.contacts.map((c) => [c.card, c.spots])])));
    expect(shapes.size).toBeGreaterThan(20);
  });

  it('the catalog has Lane\'s meet sector with a straight route from its exit to its entry', () => {
    const meets = sweepCatalog(tunables).filter((s) => s.roles.includes('meet'));
    expect(meets.map((s) => `${s.mapId}/${s.id}`)).toEqual(['lane/lane-meet-near']);
    const r = meets[0]!.meetRoute!;
    expect(r.from).toEqual(meets[0]!.exit);
    expect(Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z)).toBeGreaterThan(10);
    expect(meets[0]!.walkable(r.from, r.to)).toBe(true);
    expect(sweepCatalog(tunables).filter((s) => !s.roles.includes('meet')).every((s) => s.meetRoute === undefined)).toBe(true);
  });

  it('a plan is four sectors, the Opener a take, none twice in a row, with the card rules of design §4.4', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const plan = sweepPlan(seed);
      expect(plan.sectors).toHaveLength(cfg.sectors);
      expect(plan.sectors[0]!.role).toBe('take');
      for (let i = 0; i < plan.sectors.length; i++) {
        const s = plan.sectors[i]!;
        if (i > 0) expect(`${s.mapId}/${s.sectorId}`).not.toBe(`${plan.sectors[i - 1]!.mapId}/${plan.sectors[i - 1]!.sectorId}`);
        expect(s.contacts.length).toBeGreaterThanOrEqual(1);
        if (s.role === 'meet') {
          expect(s.contacts).toHaveLength(1);
          expect(s.contacts[0]!.card).toBe('meet');
          counts.meet = (counts.meet ?? 0) + 1;
          continue;
        }
        expect(s.contacts.length).toBeLessThanOrEqual(perSector(cfg.contactsMax, i) + (s.stake === 'hot' ? cfg.gate.hotExtraContacts : 0));
        const used = new Set<string>();
        for (const c of s.contacts) {
          if (c.card === 'crossfire') expect(i).toBeGreaterThanOrEqual(cfg.crossfireFromSector);
          expect(c.spots).toHaveLength(cardSpots(c.card));
          expect(c.echoes).toHaveLength(c.card === 'clear' ? 1 : cardSpots(c.card));
          for (const p of c.spots) {
            expect(used.has(p)).toBe(false); // one contact per anchor
            used.add(p);
          }
          for (const e of c.echoes) {
            expect(e.expectation).toBe(c.card === 'take-unaware' ? 'unaware' : c.card === 'clear' ? 'attending' : 'prepared');
          }
          counts[c.card] = (counts[c.card] ?? 0) + 1;
        }
      }
      const cards = planCards(plan);
      for (let k = 2; k < cards.length; k++) expect(cards[k] === cards[k - 1] && cards[k] === cards[k - 2]).toBe(false);
    }
    // Every card is dealt.
    for (const c of ['take-unaware', 'take-expected', 'clear', 'crossfire', 'meet']) expect(counts[c] ?? 0).toBeGreaterThan(20);
  });

  it('drawCard never deals a third card in a row, a crossfire before sector 3, or a card without room', () => {
    const rng = new Rng(5);
    for (let k = 0; k < 500; k++) {
      expect(drawCard(rng, cfg, 3, 2, ['clear', 'clear'])).not.toBe('clear');
      expect(drawCard(rng, cfg, 1, 2, [])).not.toBe('crossfire');
      const one = drawCard(rng, cfg, 3, 1, []);
      expect(one === 'take-unaware' || one === 'take-expected').toBe(true);
    }
  });

  it('no Echo is visible from a sector entry: placements, strafe lanes and peek paths, 200 seeds', () => {
    const eyeH = tunables.movement.standEyeHeight;
    let echoes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const plan = sweepPlan(seed);
      // Both doors of every gate are checked, not only the one the route took: the other sector is planned just as well.
      const sectors = [plan.sectors[0]!, ...plan.gates.flatMap((g) => [g.doors[0].sector, g.doors[1].sector])];
      for (const s of sectors) {
        // A meet sector hides nothing by design (its Echoes start 15 m or more away, in view, and are heard when they run).
        if (s.role === 'meet') continue;
        const eye = { x: s.entry.x, y: s.entry.y + eyeH, z: s.entry.z };
        for (const c of s.contacts) {
          for (const e of c.echoes) {
            echoes++;
            expect(shows(s.mapId, eye, e.feet, e.crouched), `${seed} ${s.sectorId} ${e.spot}`).toBe(false);
            if (e.laneA && e.laneB) for (const p of along(e.laneA, e.laneB)) expect(shows(s.mapId, eye, p, e.crouched), `${seed} lane ${e.spot}`).toBe(false);
            if (e.peek) for (const p of along(e.peek.hold, e.peek.out)) expect(shows(s.mapId, eye, p, e.crouched), `${seed} peek ${e.spot}`).toBe(false);
          }
        }
      }
    }
    expect(echoes).toBeGreaterThan(200 * 4);
  });
});

/** Start a Sweep run headless and hand back what the tests read (`newProfile`: the first run of a profile, which places it). */
function startRun(seed: number, newProfile = false) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  for (const type of ['sectorEntered', 'sectorEnded', 'contactSettled', 'runEnded', 'targetVisible', 'mapLoaded', 'skillTrial', 'beatStarted'] as const) {
    g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  }
  expect(g.modes.start('sweep', { seed, newProfile, pick: g.modes.primary })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  /** Walk straight out: stand the player on the exit and let one tick see it. */
  const toExit = (): void => {
    const sp = state().plan.sectors[state().sector]!;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
  };
  /** In a gate: stand the player through door `door`, then let the other door close and the sector load. */
  const throughGate = (door: 0 | 1 = 0): void => {
    const gc = cfg.gate;
    expect(state().gate, 'in a gate').not.toBeNull();
    g.world.placePlayer(gc.doors[door].x, 0, gc.doors[door].z - gc.commitDepthM - 0.1, 0);
    g.advance(input);
    for (let k = 0; k <= Math.ceil(gc.commitSec * 128) + 1 && state().gate; k++) g.advance(input);
  };
  /** The sector's exit, then through door `door` of the gate behind it. */
  const next = (door: 0 | 1 = 0): void => {
    toExit();
    if (g.run.state !== 'result') throughGate(door);
  };
  return { g, log, input, state, toExit, throughGate, next };
}

describe('Sweep mode (#201)', () => {
  it('in the sim: every Echo is out of sight when the player arrives (200 seeds) and while the player stands at the entry (50 seeds)', () => {
    const eyeH = tunables.movement.standEyeHeight;
    for (let seed = 1; seed <= 200; seed++) {
      const { g, log, input, state, next } = startRun(seed);
      const ready = Math.ceil(tunables.run.readySec * 128) + 1;
      for (let k = 0; k < ready; k++) g.advance(input);
      for (let i = 0; i < 4; i++) {
        const sp = state().plan.sectors[i]!;
        expect(state().sector).toBe(i);
        expect(g.modes.currentMap.id).toBe(sp.mapId);
        if (sp.role === 'meet') {
          // A meet sector is the other kind: nothing hides, but no Echo starts closer than the fairness floor.
          const p = g.world.player.pos;
          for (const t of g.world.targets) if (t.alive) expect(Math.hypot(t.pos.x - p.x, t.pos.z - p.z)).toBeGreaterThan(15);
          next((seed & 1) as 0 | 1);
          continue;
        }
        // Stand still at the entry (1 s for the first 50 seeds, else the arrival tick): no Echo shows, by the fine
        // grid and by the sim's own sight event.
        const from = log.length;
        const stand = seed <= 50 ? 128 : 1;
        for (let k = 0; k < stand; k++) {
          if (k % 32 === 0) {
            const p = g.world.player.pos;
            const eye = { x: p.x, y: p.y + eyeH, z: p.z };
            for (const t of g.world.targets) {
              if (t.alive) expect(shows(sp.mapId, eye, t.pos, t.crouched), `seed ${seed} sector ${sp.sectorId} target ${t.id}`).toBe(false);
            }
          }
          g.advance(input);
        }
        expect(log.slice(from).filter((l) => l.type === 'targetVisible'), `seed ${seed} sector ${sp.sectorId}`).toEqual([]);
        if (g.run.state === 'result') break;
        next((seed & 1) as 0 | 1);
      }
    }
  }, 30_000);

  it('health carries over, the depth multiplier and dial offset follow the sector, and the last exit ends the run as left', () => {
    const { g, log, input, state, toExit, next } = startRun(9);
    for (let k = 0; k < 120; k++) g.advance(input);
    // Take a hit in sector 1: the damage must still be there in sector 2 (unless the door walked through gave a shield back).
    g.world.hitPlayer('kestrel', 'body', 0, 1.2, 0, -1, g.bus);
    const hp = g.world.health.hp, shield = g.world.health.shield;
    expect(hp + shield).toBeLessThan(150);
    toExit();
    expect(state().gate, 'a gate after the opener').not.toBeNull();
    expect(g.modes.currentMap.id).toBe(cfg.gate.mapId);
    expect(g.world.health.hp).toBe(hp);
    expect(g.world.health.shield).toBe(shield);
    const stake = state().gate!.plan.doors[0].facts.stake;
    state().gate!.door = -1;
    // Walk through door 0.
    const gc = cfg.gate;
    g.world.placePlayer(gc.doors[0].x, 0, gc.doors[0].z - gc.commitDepthM - 0.1, 0);
    for (let k = 0; k < Math.ceil(gc.commitSec * 128) + 3 && state().gate; k++) g.advance(input);
    expect(state().sector).toBe(1);
    expect(g.world.health.hp).toBe(hp);
    if (stake !== 'shield') expect(g.world.health.shield).toBe(shield);
    next();
    next();
    toExit();
    expect(g.run.state).toBe('result');
    const entered = log.filter((l) => l.type === 'sectorEntered').map((l) => l.e);
    expect(entered.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(entered.every((e) => e.opener === false && e.of === 4)).toBe(true);
    // One dial per sector, set at its entry and nowhere else (design §9.3.2).
    expect(log.filter((l) => l.type === 'beatStarted').map((l) => l.e.dial)).toEqual(entered.map((e) => e.dial));
    expect(entered.map((e) => e.depth)).toEqual(cfg.depthMultiplier.slice(0, 4));
    expect(entered.map((e) => e.stake)[0]).toBe('plain');
    // The dial moves with the sector's offset (the posterior did not change: no trials resolved).
    const d0 = entered[0]!.dial as number;
    for (let i = 1; i < 4; i++) {
      const want = d0 - cfg.dialOffset[0]! + cfg.dialOffset[i]!;
      expect(Math.abs((entered[i]!.dial as number) - want)).toBeLessThanOrEqual(3 * i + 1e-9);
    }
    const ended = log.filter((l) => l.type === 'sectorEnded').map((l) => l.e);
    expect(ended).toHaveLength(4);
    expect(ended.every((e) => e.reason === 'exit' && e.cleared === false)).toBe(true);
    expect(log.filter((l) => l.type === 'runEnded').map((l) => l.e.reason)).toEqual(['left']);
    expect(g.run.liveStats()).toMatchObject({ endReason: 'left', sectorsReached: 4, sectorsTotal: 4, sectorsCleared: 0 });
    // Leaving every Echo alive: no Echo is left in the world.
    expect(g.world.targets.filter((t) => t.alive)).toEqual([]);
  });

  it('the player dying ends the run as death and settles the open contact as died', () => {
    const { g, log, input } = startRun(4);
    for (let k = 0; k < 120; k++) g.advance(input);
    const echo = g.world.targets.find((t) => t.alive)!;
    // An Echo's shots open its contact; enough of them kill.
    for (let k = 0; k < 20 && g.world.health.alive; k++) g.world.hitPlayer('kestrel', 'head', echo.pos.x, 1.4, echo.pos.z, echo.id, g.bus);
    expect(g.world.health.alive).toBe(false);
    expect(log.filter((l) => l.type === 'runEnded').map((l) => l.e.reason)).toEqual(['death']);
    expect(log.filter((l) => l.type === 'contactSettled').map((l) => l.e.outcome)).toEqual(['died']);
    expect(log.filter((l) => l.type === 'sectorEnded').map((l) => l.e.reason)).toEqual(['death']);
    expect(g.run.liveStats()).toMatchObject({ endReason: 'death', contactsLost: 1, contactsWon: 0 });
  });

  it('moving to a sector on another map loads it in place, mid-run: level, anchors and visuals switch, health and the run do not', () => {
    const { g, log, input } = startRun(3);
    for (let k = 0; k < 120; k++) g.advance(input);
    g.world.hitPlayer('kestrel', 'body', 0, 1.2, 0, -1, g.bus);
    const hp = g.world.health.hp;
    const other = g.modes.currentMap.id === 'lane' ? 'elbow' : 'lane';
    expect(g.modes.runner.loadMap(other)).toBe(true);
    expect(g.modes.currentMap.id).toBe(other);
    expect(g.world.level).toBe(MAPS[other]);
    expect(g.world.health.hp).toBe(hp);
    expect(g.modes.runner.phase).toBe('live');
    expect(log.filter((l) => l.type === 'mapLoaded').at(-1)!.e.mapId).toBe(other);
    expect(g.modes.runner.scheduler.anchorsOfKind('hold').length).toBe(MAPS[other]!.anchors.filter((a) => a.kind === 'hold').length);
    expect(g.modes.runner.loadMap('nowhere')).toBe(false);
  });

  it('bot harness: the same seed plays the same run (sectors, placements, cards, fights, score)', () => {
    const play = (seed: number) => {
      const g = new HeadlessGame({ seed });
      const facts: string[] = [];
      for (const type of ['sectorEntered', 'sectorEnded', 'contactSettled', 'targetSpawned', 'runEnded'] as const) {
        g.bus.on(type, (e) => facts.push(`${type} ${JSON.stringify(e)}`));
      }
      const r = playMode(g, { mode: 'sweep', skill: 50, seed });
      return { r, facts };
    };
    const a = play(11);
    const b = play(11);
    expect(a.r.finished).toBe(true);
    expect(a.facts.length).toBeGreaterThan(8);
    expect(b.facts).toEqual(a.facts);
    expect(b.r.hash).toBe(a.r.hash);
    expect(b.r.modeRun?.score).toBe(a.r.modeRun?.score);
    expect(play(12).facts).not.toEqual(a.facts);
  });
});

describe('skill matching inside the run (#203)', () => {
  it('a placing plan opens with short single-Echo sectors from the gentlest cards, then the run as usual', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const plan = startPlan(seed, tunables, [], true);
      expect(plan.placing).toBe(true);
      const opener = plan.openerStages;
      expect(opener).toHaveLength(cfg.opener.maxSectors);
      expect(plan.sectors).toEqual([opener[0]]);
      for (const s of opener) {
        expect(s.opener && s.index === 0 && s.role === 'take' && s.stake === 'plain').toBe(true);
        expect(s.contacts, `${seed} ${s.sectorId}`).toHaveLength(1);
        expect(s.contacts[0]!.echoes).toHaveLength(1);
        expect(cfg.opener.cards).toContain(s.contacts[0]!.card);
      }
      for (let i = 1; i < opener.length; i++) expect(opener[i]!.sectorId).not.toBe(opener[i - 1]!.sectorId);
    }
    expect(startPlan(5, tunables, [], true)).toEqual(startPlan(5, tunables, [], true));
    expect(startPlan(5, tunables, [], false).placing).toBe(false);
    expect(startPlan(5, tunables, [], false).openerStages).toEqual([]);
  });

  it('a new profile plays the placing Opener on the staircase; without fights it runs to the last Opener sector, then sector 2', () => {
    const { g, log, input, state, toExit, throughGate } = startRun(21, true);
    for (let k = 0; k < 120; k++) g.advance(input);
    expect(state().plan.placing).toBe(true);
    const n = cfg.opener.maxSectors;
    // The Opener's contact sectors follow one another with no gate between them; the gate comes after the last.
    for (let i = 0; i < n; i++) {
      expect(state().gate, `no gate inside the Opener (${i})`).toBeNull();
      expect(state().plan.sectors[0]).toBe(state().plan.openerStages[i]);
      toExit();
    }
    expect(state().gate, 'the gate before sector 2').not.toBeNull();
    throughGate(0);
    const entered = log.filter((l) => l.type === 'sectorEntered').map((l) => l.e);
    expect(entered.map((e) => e.index)).toEqual([...Array(n).fill(0), 1]);
    expect(entered.map((e) => e.opener)).toEqual([...Array(n).fill(true), false]);
    // No contact fought: the staircase never moved, and its dial seeds sector 2 (offset −3, no ±3 move).
    const d0 = entered[0]!.dial as number;
    expect(entered.slice(0, n).every((e) => e.dial === d0)).toBe(true);
    expect(entered[n]!.dial).toBeCloseTo(d0 + cfg.dialOffset[1]!, 9);
    expect(g.run.liveStats()).toMatchObject({ sectorsReached: 2, sectorsTotal: 4 });
  });

  it('Echoes produce no trial of their own: a contact the player loses unseen is a failed angles trial', () => {
    const { g, log, input } = startRun(4);
    for (let k = 0; k < 120; k++) g.advance(input);
    const echo = g.world.targets.find((t) => t.alive)!;
    for (let k = 0; k < 20 && g.world.health.alive; k++) g.world.hitPlayer('kestrel', 'head', echo.pos.x, 1.4, echo.pos.z, echo.id, g.bus);
    const trials = log.filter((l) => l.type === 'skillTrial').map((l) => l.e);
    expect(trials.map((t) => [t.skill, t.success])).toEqual([['angles', false]]);
    const settled = log.filter((l) => l.type === 'contactSettled').map((l) => l.e);
    expect(settled.map((e) => e.trials)).toEqual([1]);
    const card = settled[0]!.card as keyof typeof tunables.trials.cardOffset;
    const dial = log.find((l) => l.type === 'sectorEntered')!.e.dial as number;
    expect(trials[0]!.itemDifficulty).toBeCloseTo(dial + tunables.trials.cardOffset[card], 4);
    expect(trials[0]!.card).toBe(card);
  });

  it('bot sample: every contact that opens yields at least one trial, and the trials reach the posterior', () => {
    let contacts = 0;
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      // Half of them a new profile's first run, with the placing Opener.
      const g = new HeadlessGame({ seed, placesNewProfiles: seed % 2 === 0 });
      let trials = 0;
      g.bus.on('skillTrial', () => trials++);
      g.bus.on('contactSettled', (e) => {
        contacts++;
        expect(e.trials, `seed ${seed} contact ${e.contactId}`).toBeGreaterThanOrEqual(1);
      });
      playMode(g, { mode: 'sweep', skill: 50, seed });
      expect(trials).toBeGreaterThan(0);
      let observed = 0;
      for (const s of ['precision', 'flick', 'track', 'footwork', 'spray', 'switch', 'angles'] as const) observed += g.modes.skills.trialCount(s);
      expect(observed).toBe(trials);
    }
    expect(contacts).toBeGreaterThan(10);
  });
});
