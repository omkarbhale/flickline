import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { MAPS } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { sweepEnv, type SweepState } from './sweep';
import { perSector, planRun, type DoorPlan, type GatePlan, type RunPlan, type SectorSource } from './sweepDirector';
import { doorFacts, heardBucket, heardCount, pickSector, planGate, planRoute } from './sweepGate';
import { Rng } from '../core/rng';

const tunables = cloneTunables();
const cfg = tunables.sweep;
const env = sweepEnv(tunables);

/** A mix of both doors, by seed and depth. */
const mixed = (seed: number) => (_g: GatePlan, plan: RunPlan): 0 | 1 => ((seed + plan.sectors.length) & 1) as 0 | 1;
const echoesOf = (d: DoorPlan): number => d.sector.contacts.reduce((n, c) => n + c.echoes.length, 0);
/**
 * Echoes the door can claim to hear: every one but a meet group or a hold arrival that walks (walking is silent, design 4.4), and
 * only those whose spot (an arrival's: where its run ends) is within the footstep radius of the sector's map from its entry.
 */
const audibleOf = (d: DoorPlan): number => {
  const radius = env.hearM(d.sector.mapId);
  let n = 0;
  for (const c of d.sector.contacts) {
    for (const e of c.echoes) {
      if (e.gait === 'walk' || (e.arrive !== undefined && !e.arrive.running)) continue;
      const at = e.arrive ? e.arrive.route[e.arrive.route.length - 1]! : e.feet;
      if (Math.hypot(at.x - d.sector.entry.x, at.z - d.sector.entry.z) <= radius) n++;
    }
  }
  return n;
};
/** The bucket by the design's words (§4.5), written out here so the test does not lean on the code it checks. */
const bucketOf = (n: number): 'quiet' | 'few' | 'several' => (n === 0 ? 'quiet' : n <= 2 ? 'few' : 'several');

describe('gate doors (#205)', () => {
  it('door facts are true: over 500 seeds the heard bucket matches the sector\'s Echo count, the role the sector, the stake the sector\'s', () => {
    let doors = 0;
    const buckets = new Set<string>();
    const roles = new Set<string>();
    for (let seed = 1; seed <= 500; seed++) {
      const plan = planRoute(seed, env, mixed(seed));
      expect(plan.gates).toHaveLength(cfg.sectors - 1);
      for (const gate of plan.gates) {
        for (const d of gate.doors) {
          doors++;
          const n = audibleOf(d);
          expect(d.facts.heard, `seed ${seed} gate ${gate.index} door ${d.door}: ${n} audible Echoes`).toBe(bucketOf(n));
          // A take sector holds no walkers: its bucket counts the Echoes within the footstep radius (long anchors lie beyond a small map's radius, #249).
          if (d.sector.role === 'take') expect(n).toBeLessThanOrEqual(echoesOf(d));
          expect(d.facts.role).toBe(d.sector.role);
          expect(d.facts.stake).toBe(d.sector.stake);
          expect(d.facts.arms).toBe(d.sector.arms);
          expect(d.facts.sightline).toBe(d.sector.sightlineM >= cfg.gate.longSightlineM ? 'long' : 'close');
          // "From the same audio radii the fights use": every audible Echo of the sector is inside the footstep radius of its entry
          // (a hold arrival counts where its run ends).
          expect(heardCount(d.sector, env.hearM(d.sector.mapId))).toBe(n);
          roles.add(d.sector.role);
          buckets.add(d.facts.heard);
        }
      }
      // The sector walked into is the one the door showed.
      plan.sectors.slice(1).forEach((s, i) => expect(s).toBe(plan.gates[i]!.doors[plan.doors[i]!].sector));
    }
    expect(doors).toBe(500 * 2 * (cfg.sectors - 1));
    // Every bucket the design names is seen: the facts are not a constant.
    expect([...buckets].sort()).toEqual(['few', 'quiet', 'several']);
    expect([...roles].sort()).toEqual(['hold', 'meet', 'take']);
  }, 30_000);

  it('in the sim, over 60 seeds: the sector a door leads to is entered as shown (role, stake, Echoes placed in the world, heard bucket)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const g = new HeadlessGame({ seed });
      const entered: { index: number; role: string; stake: string; arms: string; echoes: number }[] = [];
      const chosen: { index: number; door: number; stake: string; role: string; heard: string }[] = [];
      g.bus.on('sectorEntered', (e) => entered.push({ index: e.index, role: e.role, stake: e.stake, arms: e.arms, echoes: e.echoes }));
      g.bus.on('gateChosen', (e) => chosen.push({ index: e.index, door: e.door, stake: e.stake, role: e.role, heard: e.heard }));
      expect(g.modes.start('sweep', { seed, pick: g.modes.primary })).toBe(true);
      const input = createTickInput();
      const st = (): SweepState => g.modes.runner.state as SweepState;
      for (let k = 0; k < 140; k++) g.advance(input);
      for (let depth = 1; depth < cfg.sectors && g.run.state !== 'result'; depth++) {
        const sp = st().plan.sectors[st().sector]!;
        if (sp.role === 'hold') st().exitOpen = true; // a hold's exit opens when its Echoes are dead (#204)
        g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
        g.advance(input);
        const gate = st().gate!;
        expect(gate.plan.index).toBe(depth);
        expect(g.modes.currentMap.id).toBe(cfg.gate.mapId);
        const door = ((seed + depth) & 1) as 0 | 1;
        const shown = gate.plan.doors[door];
        const d = cfg.gate.doors[door];
        g.world.placePlayer(d.x, 0, d.z - cfg.gate.commitDepthM - 0.1, 0);
        g.advance(input);
        expect(chosen.at(-1), `seed ${seed}`).toEqual({ index: depth, door, stake: shown.facts.stake, role: shown.facts.role, heard: shown.facts.heard });
        for (let k = 0; k < Math.ceil(cfg.gate.commitSec * 128) + 2 && st().gate; k++) g.advance(input);
        expect(st().gate).toBeNull();
        const e = entered.at(-1)!;
        expect(e.index).toBe(depth);
        expect(e.role).toBe(shown.facts.role);
        expect(e.stake).toBe(shown.facts.stake);
        expect(e.arms).toBe(shown.facts.arms ?? '');
        // What the door showed, plus the survivors of the sector just left that followed (up to `follow.max`, arriving later).
        expect(e.echoes).toBeGreaterThanOrEqual(echoesOf(shown));
        expect(e.echoes).toBeLessThanOrEqual(echoesOf(shown) + cfg.follow.max);
        // A hold's Echoes (and any follower's) are not in the world yet: they arrive.
        expect(g.world.targets.filter((t) => t.alive)).toHaveLength(shown.facts.role === 'hold' ? 0 : echoesOf(shown));
        expect(heardBucket(audibleOf(shown), cfg)).toBe(shown.facts.heard);
        expect(g.modes.currentMap.id).toBe(shown.sector.mapId);
      }
    }
  }, 30_000);

  it('same seed and same choices give the same run; a different choice gives a different route; earlier choices never shift later draws', () => {
    const key = (p: RunPlan) => JSON.stringify(p.sectors.map((s) => [s.sectorId, s.stake, s.arms, s.contacts.map((c) => [c.card, c.spots])]));
    expect(key(planRoute(7, env, mixed(7)))).toBe(key(planRoute(7, env, mixed(7))));
    let differs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      if (key(planRoute(seed, env, () => 0)) !== key(planRoute(seed, env, () => 1))) differs++;
    }
    expect(differs).toBeGreaterThan(30);
    // The gate before sector 1 depends only on the opener: it is the same whichever way the run goes after it.
    const a = planGate(planRun(5, env.catalog, cfg, env.body), env);
    const b = planGate(planRun(5, env.catalog, cfg, env.body), env);
    expect(a).toEqual(b);
  });

  it('stakes: the two doors differ; Shield is never offered in two sectors in a row; Arms names a primary the player does not carry; Hot has room for its contact', () => {
    const seen: Record<string, number> = { shield: 0, arms: 0, hot: 0, plain: 0 };
    for (let seed = 1; seed <= 500; seed++) {
      const plan = planRoute(seed, env, mixed(seed));
      let primary: string = env.startPrimary;
      let lastShield = -Infinity;
      for (const gate of plan.gates) {
        const [x, y] = gate.doors;
        // The doors differ in stake, except where a light or eco sector leaves a door nothing to carry (no Shield, no Hot, no Arms in eco).
        if (x.facts.stake === y.facts.stake) {
          expect(x.facts.stake).toBe('plain');
          expect(x.facts.condition).not.toBe('full');
        }
        // The sector's economy is announced on both doors, and it is the one the sector plays with.
        expect(x.facts.condition).toBe(y.facts.condition);
        for (const d of gate.doors) {
          expect(d.facts.condition).toBe(d.sector.condition);
          if (d.facts.condition !== 'full') expect(d.facts.stake).not.toBe('shield');
          if (d.facts.condition === 'eco') expect(d.facts.stake).not.toBe('arms');
        }
        for (const d of gate.doors) {
          seen[d.facts.stake]!++;
          if (d.facts.stake === 'shield') expect(gate.index - lastShield, `seed ${seed}`).toBeGreaterThanOrEqual(cfg.gate.shieldEverySectors);
          if (d.facts.stake === 'arms') {
            expect(cfg.gate.armsPool).toContain(d.facts.arms);
            expect(d.facts.arms).not.toBe(primary);
          } else expect(d.facts.arms).toBeUndefined();
          if (d.facts.stake === 'hot') {
            expect(d.sector.contacts.length).toBeGreaterThanOrEqual(perSector(cfg.contactsMin, gate.index) + cfg.gate.hotExtraContacts);
          }
        }
        const took = plan.sectors[gate.index]!;
        if (took.stake === 'shield') lastShield = took.index;
        if (took.stake === 'arms') primary = took.arms!;
      }
    }
    for (const k of Object.keys(seen)) expect(seen[k], k).toBeGreaterThan(100);
  });

  it('candidates: never the sector just played nor the other door\'s, on another map when the pool has one, else with the other sightline', () => {
    const src = (mapId: string, id: string, role: string, sightlineM: number): SectorSource =>
      ({ mapId, id, roles: [role], entry: { x: 0, y: 0, z: 0 }, entryYaw: 0, exit: { x: 1, y: 0, z: 0 }, sightlineM, spots: [], approaches: [], visible: () => false, walkable: () => true, route: (_f, t) => [t] });
    const a = src('m1', 'a', 'take', 10), b = src('m1', 'b', 'take', 25), c = src('m2', 'c', 'take', 12), d = src('m1', 'd', 'take', 12);
    const cur = { mapId: 'm1', sectorId: 'a' } as RunPlan['sectors'][number];
    const rng = new Rng(1);
    for (let k = 0; k < 100; k++) {
      const x = pickSector(rng, [a, b, c, d], [], cur, cfg);
      expect(x).not.toBe(a);
      const y = pickSector(rng, [a, b, c, d], [x], cur, cfg);
      expect(y).not.toBe(a);
      expect(y).not.toBe(x);
      // Another map when there is one: m2 is in the pool, so one door of the pair is on it.
      expect([x, y].some((z) => z === c)).toBe(true);
    }
    // One map only: the other door has the other sightline class when it can.
    for (let k = 0; k < 50; k++) {
      const x = pickSector(rng, [a, b, d], [], { mapId: 'm9', sectorId: 'z' } as RunPlan['sectors'][number], cfg);
      const y = pickSector(rng, [a, b, d], [x], { mapId: 'm9', sectorId: 'z' } as RunPlan['sectors'][number], cfg);
      expect(y).not.toBe(x);
      expect((x.sightlineM >= cfg.gate.longSightlineM) !== (y.sightlineM >= cfg.gate.longSightlineM)).toBe(true);
    }
    // A pool of one gives it back.
    expect(pickSector(rng, [a], [], cur, cfg)).toBe(a);
  });

  it('heard buckets: quiet, one or two, several', () => {
    expect([0, 1, 2, 3, 6].map((n) => heardBucket(n, cfg))).toEqual(['quiet', 'few', 'few', 'several', 'several']);
    // doorFacts is a pure function of the sector plan.
    const plan = planRun(3, env.catalog, cfg, env.body);
    expect(doorFacts(plan.sectors[0]!, cfg, env.hearM(plan.sectors[0]!.mapId))).toEqual(doorFacts(plan.sectors[0]!, cfg, env.hearM(plan.sectors[0]!.mapId)));
    // A hearing radius that reaches nothing: quiet, whatever is placed.
    expect(doorFacts(plan.sectors[0]!, cfg, 0.01).heard).toBe('quiet');
  });

  it('the gate room is real: a clear walk from the entry to each door, nothing but the doorways in the far wall, the config agrees with the map', () => {
    const gate = MAPS[cfg.gate.mapId]!;
    expect(gate.sectors).toEqual([]);
    expect(gate.spawn.pos).toMatchObject({ x: cfg.gate.entry.x, y: cfg.gate.entry.y, z: cfg.gate.entry.z });
    expect(cfg.gate.shieldRefillTo).toBe(tunables.player.shield.heavy);
    for (const door of cfg.gate.doors) {
      // The doorway: between its jambs nothing stands from the floor to head height, at the plane and past it to the commit line.
      for (const b of gate.boxes) {
        if (b.tag === 'floor' || b.tag === 'ceiling') continue;
        for (let dz = 0; dz <= cfg.gate.commitDepthM + 1; dz += 0.1) {
          for (const x of [door.x - cfg.gate.doorHalfWidthM + 0.1, door.x, door.x + cfg.gate.doorHalfWidthM - 0.1]) {
            const z = door.z - dz;
            const inside = x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.min.y < 1.8;
            expect(inside, `${b.id} at (${x}, ${z})`).toBe(false);
          }
        }
      }
    }
  });
});

describe('gate stakes in the sim (#205)', () => {
  /** A seed whose first gate has a door with `stake`, and which door it is. */
  function seedWith(stake: string): { seed: number; door: 0 | 1 } {
    for (let seed = 1; seed < 500; seed++) {
      const gate = planGate(planRun(seed, env.catalog, cfg, env.body), env);
      const door = gate.doors.findIndex((d) => d.facts.stake === stake);
      if (door >= 0) return { seed, door: door as 0 | 1 };
    }
    throw new Error(`no seed with a ${stake} door at the first gate`);
  }

  function through(seed: number, door: 0 | 1, before?: (g: HeadlessGame) => void) {
    const g = new HeadlessGame({ seed });
    expect(g.modes.start('sweep', { seed, pick: g.modes.primary })).toBe(true);
    const input = createTickInput();
    const st = (): SweepState => g.modes.runner.state as SweepState;
    for (let k = 0; k < 140; k++) g.advance(input);
    before?.(g);
    const sp = st().plan.sectors[0]!;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    const gate = st().gate!;
    const d = cfg.gate.doors[door];
    // Standing in the gate before choosing: nothing is applied yet.
    const inGate = { hp: g.world.health.hp, shield: g.world.health.shield, primary: g.world.loadout[0] };
    g.world.placePlayer(d.x, 0, d.z - cfg.gate.commitDepthM - 0.1, 0);
    for (let k = 0; k < Math.ceil(cfg.gate.commitSec * 128) + 3 && st().gate; k++) g.advance(input);
    return { g, st, gate, inGate, input };
  }

  it('Shield refills the shield to 50 on entry (and the HUD hears it); the doors apply nothing before one is walked through', () => {
    const { seed, door } = seedWith('shield');
    let shielded = 0;
    const r = through(seed, door, (g) => {
      g.bus.on('playerShielded', () => shielded++);
      g.world.damagePlayer(30, 'body', 0, 1.2, -8, -1, g.bus);
      expect(g.world.health.shield).toBeLessThan(50);
    });
    expect(r.inGate.shield).toBeLessThan(50);
    expect(r.g.world.health.shield).toBe(50);
    expect(r.g.world.health.maxShield).toBe(50);
    expect(r.g.world.health.hp).toBe(r.inGate.hp);
    expect(shielded).toBe(1);
  });

  it('Arms swaps the primary for the named weapon and puts it in hand; the sidearm stays', () => {
    const { seed, door } = seedWith('arms');
    const r = through(seed, door);
    const named = r.gate.plan.doors[door].facts.arms!;
    expect(named).not.toBe(r.inGate.primary);
    expect(r.g.world.loadout[0]).toBe(named);
    expect(r.g.world.loadout[1]).toBe('pace');
    expect(r.g.world.weapon.slots[r.g.world.weapon.active]!.id).toBe(named);
  });

  it('Hot adds a contact and multiplies the sector\'s points by 1.5; Plain changes nothing', () => {
    const hot = seedWith('hot');
    const h = through(hot.seed, hot.door);
    expect(h.st().mult).toBeCloseTo(perSector(cfg.depthMultiplier, 1) * cfg.gate.hotMultiplier, 9);
    expect(h.st().contacts.length).toBeGreaterThanOrEqual(perSector(cfg.contactsMin, 1) + cfg.gate.hotExtraContacts);
    const plain = seedWith('plain');
    const p = through(plain.seed, plain.door);
    expect(p.st().mult).toBeCloseTo(perSector(cfg.depthMultiplier, 1), 9);
    expect(p.g.world.health.shield).toBe(p.inGate.shield);
    expect(p.g.world.loadout[0]).toBe(p.inGate.primary);
  });

  it('walking through commits: the other door is closed (the gate is left, the choice cannot be taken back), and the run goes on', () => {
    const r = through(3, 0);
    expect(r.st().gate).toBeNull();
    expect(r.st().sector).toBe(1);
    // Back in the gate room's coordinates nothing re-opens it: the sector's own map is loaded.
    expect(r.g.modes.currentMap.id).toBe(r.gate.plan.doors[0].sector.mapId);
    expect(r.st().plan.doors).toEqual([0]);
    expect(r.g.run.state).toBe('live');
    // The route holds exactly the committed sector.
    expect(r.st().plan.sectors[1]).toBe(r.gate.plan.doors[0].sector);
  });
});
