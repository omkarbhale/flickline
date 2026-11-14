import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import type { Vec3 } from '../core/vec3';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { bodyTop, lineClear } from '../sim/exposure';
import { MAPS } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { planCards, sweepCatalog, sweepPlan, type SweepState } from './sweep';
import { cardSpots, drawCard, perSector } from './sweepDirector';
import { Rng } from '../core/rng';

const tunables = cloneTunables();
const cfg = tunables.sweep;

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
    expect(sweepPlan(42, tunables)).toEqual(sweepPlan(42, tunables));
    const shapes = new Set<string>();
    for (let s = 1; s <= 30; s++) shapes.add(JSON.stringify(sweepPlan(s, tunables).sectors.map((x) => [x.sectorId, x.contacts.map((c) => [c.card, c.spots])])));
    expect(shapes.size).toBeGreaterThan(20);
  });

  it('a plan is four take sectors, none twice in a row, with the card rules of design §4.4', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const plan = sweepPlan(seed, tunables);
      expect(plan.sectors).toHaveLength(cfg.sectors);
      for (let i = 0; i < plan.sectors.length; i++) {
        const s = plan.sectors[i]!;
        if (i > 0) expect(s.sectorId).not.toBe(plan.sectors[i - 1]!.sectorId);
        expect(s.contacts.length).toBeGreaterThanOrEqual(1);
        expect(s.contacts.length).toBeLessThanOrEqual(perSector(cfg.contactsMax, i));
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
    for (const c of ['take-unaware', 'take-expected', 'clear', 'crossfire']) expect(counts[c] ?? 0).toBeGreaterThan(20);
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
      for (const s of sweepPlan(seed, tunables).sectors) {
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

/** Start a Sweep run headless and hand back what the tests read. */
function startRun(seed: number) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  for (const type of ['sectorEntered', 'sectorEnded', 'contactSettled', 'runEnded', 'targetVisible', 'mapLoaded'] as const) {
    g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  }
  expect(g.modes.start('sweep', { seed })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  /** Walk straight out: stand the player on the exit and let one tick see it. */
  const toExit = (): void => {
    const sp = state().plan.sectors[state().sector]!;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
  };
  return { g, log, input, state, toExit };
}

describe('Sweep mode (#201)', () => {
  it('in the sim: every Echo is out of sight when the player arrives (200 seeds) and while the player stands at the entry (50 seeds)', () => {
    const eyeH = tunables.movement.standEyeHeight;
    for (let seed = 1; seed <= 200; seed++) {
      const { g, log, input, state, toExit } = startRun(seed);
      const ready = Math.ceil(tunables.run.readySec * 128) + 1;
      for (let k = 0; k < ready; k++) g.advance(input);
      for (let i = 0; i < 4; i++) {
        const sp = state().plan.sectors[i]!;
        expect(state().sector).toBe(i);
        expect(g.modes.currentMap.id).toBe(sp.mapId);
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
        toExit();
      }
    }
  }, 30_000);

  it('health carries over, the depth multiplier and dial offset follow the sector, and the last exit ends the run as left', () => {
    const { g, log, input, state, toExit } = startRun(9);
    for (let k = 0; k < 120; k++) g.advance(input);
    // Take a hit in sector 1: the damage must still be there in sector 2.
    g.world.hitPlayer('kestrel', 'body', 0, 1.2, 0, -1, g.bus);
    const hp = g.world.health.hp, shield = g.world.health.shield;
    expect(hp + shield).toBeLessThan(150);
    toExit();
    expect(state().sector).toBe(1);
    expect(g.world.health.hp).toBe(hp);
    expect(g.world.health.shield).toBe(shield);
    toExit();
    toExit();
    toExit();
    expect(g.run.state).toBe('result');
    const entered = log.filter((l) => l.type === 'sectorEntered').map((l) => l.e);
    expect(entered.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(entered.map((e) => e.depth)).toEqual(cfg.depthMultiplier.slice(0, 4));
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
