import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import type { Vec3 } from '../core/vec3';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { bodyTop, lineClear } from '../sim/exposure';
import { MAPS } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { planCards, sweepCatalog, sweepPlan, type SweepState } from './sweep';
import { cardSpots, drawCard, drawHoldCard, perSector, planFollowers, planRoles, rolesValid, entryEye } from './sweepDirector';
import type { SectorRole } from '../config/sweep';
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
  it('the catalog has the take sectors of Elbow and Lane and the hold sectors of Elbow, each hold sector with approach lanes', () => {
    const cat = sweepCatalog(tunables);
    const takes = cat.filter((s) => s.roles.includes('take')).map((s) => `${s.mapId}/${s.id}`).sort();
    expect(takes).toEqual(['elbow/elbow-take-door', 'elbow/elbow-take-hub', 'elbow/elbow-take-west', 'lane/lane-take-far']);
    const holds = cat.filter((s) => s.roles.includes('hold'));
    expect(holds.map((s) => s.id).sort()).toEqual(['elbow-hold-corner', 'elbow-take-door', 'elbow-take-hub']);
    for (const h of holds) expect(h.approaches.length, h.id).toBeGreaterThanOrEqual(2);
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

  it('same seed, same plan; different seeds, different runs', () => {
    expect(sweepPlan(42, tunables)).toEqual(sweepPlan(42, tunables));
    const shapes = new Set<string>();
    for (let s = 1; s <= 30; s++) shapes.add(JSON.stringify(sweepPlan(s, tunables).sectors.map((x) => [x.sectorId, x.contacts.map((c) => [c.card, c.spots])])));
    expect(shapes.size).toBeGreaterThan(20);
  });

  it('a plan is six sectors: the Opener a take, the Finale a hold, four drawn; never three of a role in a row; 150 seeds', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const plan = sweepPlan(seed, tunables);
      expect(plan.sectors).toHaveLength(6);
      const roles = plan.sectors.map((x) => x.role);
      expect(roles[0], `seed ${seed}`).toBe('take');
      expect(roles[5], `seed ${seed}`).toBe('hold');
      expect(plan.sectors[5]!.finale).toBe(true);
      const mid = roles.slice(1, 5);
      expect(mid.includes('take'), `seed ${seed} ${roles}`).toBe(true);
      expect(mid.includes('hold'), `seed ${seed} ${roles}`).toBe(true);
      for (let k = 2; k < roles.length; k++) expect(roles[k] === roles[k - 1] && roles[k] === roles[k - 2], `seed ${seed} ${roles}`).toBe(false);
      for (let k = 1; k < plan.sectors.length; k++) {
        const a = plan.sectors[k]!, b = plan.sectors[k - 1]!;
        expect(`${a.mapId}/${a.sectorId}`).not.toBe(`${b.mapId}/${b.sectorId}`);
      }
      // The sector plays a role it can serve.
      for (const x of plan.sectors) {
        const src = sweepCatalog(tunables).find((c) => c.id === x.sectorId)!;
        expect(src.roles, `${x.sectorId}`).toContain(x.role);
      }
    }
  });

  it('the role rules: planRoles always satisfies them, rolesValid rejects what they forbid, and the drawn mix follows takes 50 / holds 35 / meets 15', () => {
    const pool = { take: 3, hold: 3, meet: 1 };
    const R = (...r: SectorRole[]): SectorRole[] => r;
    expect(rolesValid(R('take', 'take', 'take', 'hold', 'take', 'hold'), 5, pool)).toBe(false);
    expect(rolesValid(R('take', 'hold', 'hold', 'hold', 'take', 'hold'), 5, pool)).toBe(false);
    expect(rolesValid(R('take', 'take', 'take', 'take', 'take', 'hold'), 5, pool)).toBe(false);
    expect(rolesValid(R('take', 'take', 'hold', 'take', 'hold', 'hold'), 5, pool)).toBe(true);
    // One meet sector cannot be dealt twice in a row.
    expect(rolesValid(R('take', 'meet', 'meet', 'hold', 'take', 'hold'), 5, pool)).toBe(false);
    expect(rolesValid(R('take', 'meet', 'meet', 'hold', 'take', 'hold'), 5, { ...pool, meet: 2 })).toBe(true);
    const counts: Record<SectorRole, number> = { take: 0, hold: 0, meet: 0 };
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const roles = planRoles(new Rng(i + 1), cfg, pool);
      expect(roles).toHaveLength(6);
      expect(roles[0]).toBe('take');
      expect(roles[5]).toBe('hold');
      expect(rolesValid(roles, 5, pool)).toBe(true);
      for (const r of roles.slice(1, 5)) counts[r]++;
    }
    const total = counts.take + counts.hold + counts.meet;
    // Drawn at 50 / 35 / 15; the rules (a take and a hold in every run, never three) push them a little.
    expect(counts.take / total).toBeGreaterThan(0.38);
    expect(counts.hold / total).toBeGreaterThan(0.3);
    expect(counts.hold / total).toBeLessThan(0.5);
    expect(counts.meet / total).toBeGreaterThan(0.08);
    expect(counts.meet / total).toBeLessThan(0.2);
  });

  it('take sectors keep the card rules of design §4.4; hold sectors deal hold, trade and flank', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 300; seed++) {
      const plan = sweepPlan(seed, tunables);
      for (let i = 0; i < plan.sectors.length; i++) {
        const s = plan.sectors[i]!;
        expect(s.contacts.length).toBeGreaterThanOrEqual(1);
        if (s.role === 'meet') {
          expect(s.contacts).toHaveLength(1);
          expect(s.contacts[0]!.card).toBe('meet');
          counts.meet = (counts.meet ?? 0) + 1;
        } else if (s.role === 'take') {
          expect(s.contacts.length).toBeLessThanOrEqual(perSector(cfg.contactsMax, i));
          const used = new Set<string>();
          for (const c of s.contacts) {
            if (c.card === 'crossfire') {
              expect(i).toBeGreaterThanOrEqual(cfg.crossfireFromSector);
              expect(cfg.noCrossfireSectors).not.toContain(i); // the breather in sector 5
            }
            expect(c.spots).toHaveLength(cardSpots(c.card));
            expect(c.echoes).toHaveLength(c.card === 'clear' ? 1 : cardSpots(c.card));
            for (const p of c.spots) {
              expect(used.has(p)).toBe(false); // one contact per anchor
              used.add(p);
            }
            for (const e of c.echoes) {
              expect(e.arrive).toBeUndefined();
              expect(e.expectation).toBe(c.card === 'take-unaware' ? 'unaware' : c.card === 'clear' ? 'attending' : 'prepared');
            }
            counts[c.card] = (counts[c.card] ?? 0) + 1;
          }
        } else {
          expect(s.contacts.length).toBeGreaterThanOrEqual(perSector(cfg.hold.contactsMin, i));
          expect(s.contacts.length).toBeLessThanOrEqual(perSector(cfg.hold.contactsMax, i));
          for (const c of s.contacts) {
            expect(['hold', 'trade', 'flank']).toContain(c.card);
            expect(c.echoes).toHaveLength(c.card === 'trade' ? 2 : 1);
            for (const e of c.echoes) expect(e.arrive).toBeDefined();
            counts[c.card] = (counts[c.card] ?? 0) + 1;
          }
        }
      }
      const cards = planCards(plan);
      for (let k = 2; k < cards.length; k++) expect(cards[k] === cards[k - 1] && cards[k] === cards[k - 2]).toBe(false);
    }
    // Every card is dealt.
    for (const c of ['take-unaware', 'take-expected', 'clear', 'crossfire', 'meet', 'hold', 'trade', 'flank']) expect(counts[c] ?? 0, c).toBeGreaterThan(20);
  });

  it('the Finale has the run\'s largest contact count; a hold sector\'s arrivals are spread over its window in order, along its own lanes, out of the sector', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const plan = sweepPlan(seed, tunables);
      const counts = plan.sectors.map((x) => x.contacts.length);
      const finale = counts[5]!;
      expect(finale, `seed ${seed}`).toBeGreaterThanOrEqual(cfg.hold.contactsMin[5]!);
      expect(finale, `seed ${seed} ${counts}`).toBeGreaterThan(Math.max(...counts.slice(0, 5)));
      for (const x of plan.sectors) {
        if (x.role !== 'hold') continue;
        const src = sweepCatalog(tunables).find((c) => c.id === x.sectorId)!;
        const map = MAPS[x.mapId]!;
        const region = map.sectors.find((m) => m.id === x.sectorId)!.region;
        const laneIds = new Set(src.approaches.map((a) => a.id));
        const win = x.finale ? cfg.hold.finaleWindowSec : cfg.hold.windowSec;
        let lastAt = -1;
        for (const c of x.contacts) {
          for (const e of c.echoes) {
            const a = e.arrive!;
            expect(laneIds.has(a.lane), `${x.sectorId} ${a.lane}`).toBe(true);
            const first = a.route[0]!;
            const inside = first.x >= region.min.x && first.x <= region.max.x && first.z >= region.min.z && first.z <= region.max.z;
            expect(inside, `seed ${seed} ${x.sectorId}: arrival starts outside the sector`).toBe(false);
            expect(a.route.length).toBeGreaterThanOrEqual(2);
            expect(a.route.length).toBeLessThanOrEqual(8);
            expect(a.speed).toBe(a.running ? cfg.hold.runMps : cfg.hold.walkMps);
            if (c.card === 'flank') expect(a.running, 'a flank is audible: it runs').toBe(true);
            else {
              expect(a.atSec).toBeLessThanOrEqual(win[1] + cfg.hold.tradeGapSec[1] + 1e-9);
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

  it('a flank is only ever dealt after a contact (the one it names) and never after another flank, from a lane other than that contact\'s', () => {
    let flanks = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const x of sweepPlan(seed, tunables).sectors) {
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
      for (const x of sweepPlan(seed, tunables).sectors) {
        if (x.role !== 'hold') continue;
        const src = sweepCatalog(tunables).find((c) => c.id === x.sectorId)!;
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

  it('walking is silent and running is not: the walk speed is at or under the footstep audio\'s silent speed, the run above it', () => {
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

  it('drawCard never deals a third card in a row, a crossfire before sector 3, or a card without room', () => {
    const rng = new Rng(5);
    for (let k = 0; k < 500; k++) {
      expect(drawCard(rng, cfg, 3, 2, ['clear', 'clear'])).not.toBe('clear');
      expect(drawCard(rng, cfg, 1, 2, [])).not.toBe('crossfire');
      const one = drawCard(rng, cfg, 3, 1, []);
      expect(one === 'take-unaware' || one === 'take-expected').toBe(true);
    }
  });

  it('drawHoldCard never deals a third card in a row or a flank that is not allowed', () => {
    const rng = new Rng(9);
    for (let k = 0; k < 500; k++) {
      expect(drawHoldCard(rng, cfg, true, ['hold', 'hold'])).not.toBe('hold');
      expect(drawHoldCard(rng, cfg, false, [])).not.toBe('flank');
    }
  });

  it('no take-sector Echo is visible from the sector entry: placements, strafe lanes and peek paths, 200 seeds', () => {
    const eyeH = tunables.movement.standEyeHeight;
    let echoes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const s of sweepPlan(seed, tunables).sectors) {
        if (s.role !== 'take') continue;
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
    expect(echoes).toBeGreaterThan(200 * 2);
  });
});

/** Start a Sweep run headless and hand back what the tests read. */
function startRun(seed: number) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  for (const type of ['sectorEntered', 'sectorEnded', 'sectorExitOpened', 'contactSettled', 'runEnded', 'targetVisible', 'mapLoaded'] as const) {
    g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  }
  expect(g.modes.start('sweep', { seed, pick: g.modes.primary })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  /** Walk straight out: stand the player on the exit and let one tick see it (a hold sector's exit is opened first: the Echoes are not played here). */
  const toExit = (): void => {
    const st = state();
    const sp = st.plan.sectors[st.sector]!;
    if (st.role === 'hold') st.exitOpen = true;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
  };
  const ready = Math.ceil(tunables.run.readySec * 128) + 1;
  const begin = (): void => {
    for (let k = 0; k < ready; k++) g.advance(input);
  };
  return { g, log, input, state, toExit, begin };
}

describe('Sweep mode (#201, #204)', () => {
  it('in the sim: a take sector\'s Echoes are out of sight when the player arrives (200 seeds) and while the player stands at the entry (50 seeds); a hold sector starts empty', () => {
    const eyeH = tunables.movement.standEyeHeight;
    let holdsSeen = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { g, log, input, state, toExit, begin } = startRun(seed);
      begin();
      for (let i = 0; i < 6; i++) {
        const sp = state().plan.sectors[i]!;
        expect(state().sector).toBe(i);
        expect(state().role).toBe(sp.role);
        expect(g.modes.currentMap.id).toBe(sp.mapId);
        if (sp.role === 'meet') {
          // A meet sector is the other kind: nothing hides, but no Echo starts closer than the fairness floor.
          const p = g.world.player.pos;
          for (const t of g.world.targets) if (t.alive) expect(Math.hypot(t.pos.x - p.x, t.pos.z - p.z)).toBeGreaterThan(15);
          toExit();
          continue;
        }
        if (sp.role === 'hold') {
          // Nothing is in a hold sector when the player arrives: the Echoes are on their way.
          holdsSeen++;
          expect(g.world.targets.filter((t) => t.alive), `seed ${seed} sector ${sp.sectorId}`).toEqual([]);
          expect(state().exitOpen).toBe(false);
          toExit();
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
        toExit();
      }
    }
    expect(holdsSeen).toBeGreaterThan(200);
  }, 60_000);

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
    for (let i = 0; i < 5; i++) toExit();
    // The Finale's exit ends the run.
    expect(g.run.state).toBe('result');
    const entered = log.filter((l) => l.type === 'sectorEntered').map((l) => l.e);
    expect(entered.map((e) => e.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(entered.map((e) => e.role)).toEqual(state().plan.sectors.map((x) => x.role));
    expect(entered.map((e) => e.depth)).toEqual(cfg.depthMultiplier);
    // The dial moves with the sector's offset (the posterior did not change: no trials resolved).
    const d0 = entered[0]!.dial as number;
    for (let i = 1; i < 6; i++) {
      const want = d0 - cfg.dialOffset[0]! + cfg.dialOffset[i]!;
      expect(Math.abs((entered[i]!.dial as number) - want)).toBeLessThanOrEqual(3 * i + 1e-9);
    }
    const ended = log.filter((l) => l.type === 'sectorEnded').map((l) => l.e);
    expect(ended).toHaveLength(6);
    expect(ended.every((e) => e.reason === 'exit' && e.cleared === false)).toBe(true);
    expect(log.filter((l) => l.type === 'runEnded').map((l) => l.e.reason)).toEqual(['left']);
    expect(g.run.liveStats()).toMatchObject({ endReason: 'left', sectorsReached: 6, sectorsTotal: 6, sectorsCleared: 0 });
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
      for (const type of ['sectorEntered', 'sectorEnded', 'sectorExitOpened', 'contactSettled', 'targetSpawned', 'runEnded'] as const) {
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
  }, 30_000);
});

/** One hold sector played by a player who stands at its entry and shoots nothing: what the Echoes do, tick by tick. */
function camp(seed: number, maxSec: number) {
  const { g, input, state, toExit, begin } = startRun(seed);
  begin();
  // Walk out of the takes until the first hold sector.
  while (state().role !== 'hold' && g.run.state !== 'result') toExit();
  const floors = tunables.dial.floors;
  const sp = state().plan.sectors[state().sector]!;
  const region = MAPS[sp.mapId]!.sectors.find((x) => x.id === sp.sectorId)!.region;
  const out = { spawns: 0, startsInside: 0, minDist: Infinity, floorBreaks: 0, firedUninformed: 0, fired: 0, arrived: 0, died: false, ticks: 0 };
  const seen = new Set<number>();
  const off1 = g.bus.on('enemyFired', (e) => {
    const t = g.world.targetField.byId(e.id);
    out.fired++;
    if (t && t.visibleTick < 0 && t.ai.audibleTick < 0) out.firedUninformed++;
  });
  const p = g.world.player;
  const maxTicks = Math.round(maxSec * 128);
  for (let k = 0; k < maxTicks && g.world.health.alive && !state().exitOpen; k++) {
    g.advance(input);
    out.ticks++;
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
      const inCone = d > 1e-6 && (((t.pos.x - p.pos.x) * fx + (t.pos.z - p.pos.z) * fz) / d) > Math.cos((floors.spawnViewAngleDeg * Math.PI) / 180);
      if (d < floors.spawnMinDistance - 1e-6 || (inCone && d < floors.spawnViewConeDistance - 1e-6)) out.floorBreaks++;
    }
  }
  off1();
  out.died = !g.world.health.alive;
  return { out, sp, g };
}

describe('Sweep hold sectors in the sim (#204)', () => {
  it('arrivals spawn outside the sector, never come inside the fairness floors, and never fire before the player has seen or heard them (40 seeds, a player who stands at the entry)', () => {
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
    const { g, input, state, toExit, begin, log } = startRun(1);
    begin();
    while (state().role !== 'hold') toExit();
    const st = state();
    const sector = st.sector;
    const sp = st.plan.sectors[sector]!;
    const field = g.world.targetField;
    // Walking onto the exit does nothing while it is closed.
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    for (let k = 0; k < 10; k++) g.advance(input);
    expect(state().sector).toBe(sector);
    expect(state().exitOpen).toBe(false);
    g.world.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, 0);
    // A perfect player: every Echo is shot dead the tick it appears. The contacts come in order, a flank after the contact it follows.
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
    expect(spawned.length).toBe(sp.contacts.reduce((n, c) => n + c.echoes.length, 0));
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
    expect(log.filter((l) => l.type === 'contactSettled' && l.e.outcome === 'cleared')).toHaveLength(sp.contacts.length);
    expect(log.filter((l) => l.type === 'sectorExitOpened' && l.e.index === sector)).toHaveLength(1);
    // And it leads on, with the sector cleared.
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    expect(state().sector === sector + 1 || g.run.state === 'result').toBe(true);
    expect(log.filter((l) => l.type === 'sectorEnded' && l.e.index === sector).map((l) => l.e.cleared)).toEqual([true]);
  });

  it('a hold sector\'s exit opens by itself after the fallback when an Echo is stuck, so one Echo never holds the run', () => {
    const { g, input, state, toExit, begin } = startRun(1);
    begin();
    while (state().role !== 'hold') toExit();
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
      const { g, state, begin } = startRun(7);
      begin();
      const st = state();
      expect(st.role).toBe('take');
      const alive = st.contacts.filter((c) => c.alive > 0);
      expect(alive.length).toBeGreaterThan(0);
      for (const c of alive) c.engaged = engaged;
      st.wonSector = won ? 1 : 0;
      const sp = st.plan.sectors[0]!;
      // Nothing opens a contact on the way out: nobody shoots and the player looks at the ceiling.
      g.world.enemiesFire = false;
      g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
      const up = createTickInput();
      up.pitch = 1.5;
      g.advance(up);
      return { st, planned: st.plan.sectors[1]!.contacts.length };
    };
    const flank = lead(true, true);
    expect(flank.st.sector).toBe(1);
    expect(flank.st.contacts).toHaveLength(flank.planned + 1);
    const f = flank.st.contacts[flank.planned]!;
    expect(f.plan.card).toBe('flank');
    expect(f.pending).toBe(f.plan.echoes.length);
    expect(f.plan.echoes.every((e) => e.arrive && e.arrive.running)).toBe(true);
    const trade = lead(false, true);
    expect(trade.st.contacts[trade.planned]!.plan.card).toBe('trade');
    const none = lead(true, false);
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
      g.bus.on('sectorEnded', () => {
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
      g.bus.on('sectorEnded', (e) => {
        if (e.reason === 'exit' && st().plan.sectors[e.index]!.role === 'hold') holdsEnded++;
      });
      playMode(g, { mode: 'sweep', skill: 50, seed });
      for (const i of opened) expect(st().plan.sectors[i]!.role).toBe('hold');
    }
    expect(holdsEnded).toBeGreaterThan(25);
    expect(flanksSeen).toBeGreaterThan(0);
  }, 120_000);
});
