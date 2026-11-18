import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { cloneTunables } from '../config/tunables';
import { sweepCatalog, sweepEnv } from './sweep';
import { pickLane, pickSpot, placeAtDial, spotWeight, type ApproachLane, type SectorSpot } from './sweepDirector';
import { planRoute } from './sweepGate';

const tunables = cloneTunables();
const cfg = tunables.sweep;

const spotAt = (id: string, distM: number | null | undefined): SectorSpot => ({
  id, feet: { x: 0, y: 0, z: 0 }, crouched: false,
  sight: distM === undefined ? undefined : distM === null ? null : { distM, dy: 0, walkedM: 0, exposure: 1 },
});

describe('placement by distance (#249)', () => {
  it('weighs a spot by a bell on the log of its first-sight distance around the distance the plan asks for', () => {
    const at = (d: number): number => spotWeight(cfg, spotAt('s', d));
    const target = cfg.place.targetM;
    expect(at(target)).toBeCloseTo(1, 6);
    // symmetric on the log scale: a factor of 1.5 either way weighs the same
    expect(at(target * 1.5)).toBeCloseTo(at(target / 1.5), 6);
    expect(at(target * 1.5)).toBeLessThan(at(target));
    expect(at(target * 3)).toBeLessThan(at(target * 1.5));
    // never impossible, and a spot the walk never shows or has no data for are told apart
    expect(at(1000)).toBe(cfg.place.weightFloor);
    expect(spotWeight(cfg, spotAt('s', null))).toBe(Math.max(cfg.place.weightFloor, cfg.place.offRouteWeight));
    expect(spotWeight(cfg, spotAt('s', undefined))).toBe(1);
  });

  it('draws one value per pick, always, and favours the spot nearest the distance asked for', () => {
    const near = spotAt('near', 6), mid = spotAt('mid', 13), far = spotAt('far', 25);
    const rng = new Rng(7);
    const counts: Record<string, number> = { near: 0, mid: 0, far: 0 };
    for (let i = 0; i < 4000; i++) counts[[near, mid, far][pickSpot(rng, cfg, [near, mid, far])]!.id]!++;
    expect(counts.mid!).toBeGreaterThan(counts.near!);
    expect(counts.mid!).toBeGreaterThan(counts.far!);
    expect(counts.near! + counts.far!).toBeGreaterThan(0);
    // one draw: the stream afterwards is where a single next() leaves it
    const a = new Rng(3), b = new Rng(3);
    pickSpot(a, cfg, [near, mid, far]);
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('a lane is drawn the same way by where its arrivals are first seen from the entry', () => {
    const lane = (id: string, distM: number | null): ApproachLane => ({
      id, start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, width: 2, sight: distM === null ? null : { distM, dy: 0 },
    });
    const lanes = [lane('close', 4), lane('mid', 13), lane('long', 24)];
    const rng = new Rng(11);
    const counts: Record<string, number> = { close: 0, mid: 0, long: 0 };
    for (let i = 0; i < 4000; i++) counts[lanes[pickLane(rng, cfg, lanes)]!.id]!++;
    expect(counts.mid!).toBeGreaterThan(counts.close!);
    expect(counts.mid!).toBeGreaterThan(counts.long!);
  });

  it('the dial asks for its distance and its spread: 5 m at dial 0, 35 m at dial 100, a wider spread higher up', () => {
    const axis = tunables.dial.axes.distance;
    const lo = placeAtDial(cfg, axis, 0).place, hi = placeAtDial(cfg, axis, 100).place, mid = placeAtDial(cfg, axis, 50).place;
    expect(lo.targetM).toBeCloseTo(5, 6);
    expect(hi.targetM).toBeCloseTo(35, 6);
    expect(mid.targetM).toBeCloseTo(Math.sqrt(5 * 35), 6);
    expect(lo.distanceSigma).toBeCloseTo(cfg.place.distanceSigmaAt0, 6);
    expect(hi.distanceSigma).toBeCloseTo(cfg.place.distanceSigmaAt100, 6);
    expect(mid.distanceSigma).toBeGreaterThan(lo.distanceSigma);
    expect(mid.distanceSigma).toBeLessThan(hi.distanceSigma);
    // nothing else changes
    expect({ ...mid, targetM: 0, distanceSigma: 0 }).toEqual({ ...cfg.place, targetM: 0, distanceSigma: 0 });
  });

  it('every hold anchor and approach lane of the shipped sectors has a first sight to draw by', () => {
    for (const s of sweepCatalog(tunables)) {
      if (s.roles.includes('take')) expect(s.spots.every((p) => p.sight !== undefined), s.id).toBe(true);
      if (s.roles.includes('hold')) expect(s.approaches.every((l) => l.sight !== undefined), s.id).toBe(true);
    }
  });

  it('the same seed at a high dial stands its Echoes further off than at a low one; the cards and Echo counts are the same', () => {
    const mean = (dial: number): number => {
      const env = sweepEnv(tunables, [], dial);
      let sum = 0, n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const plan = planRoute(seed, env, () => 0);
        for (const s of plan.sectors) {
          if (s.role !== 'take') continue;
          const src = env.catalog.find((c) => c.mapId === s.mapId && c.id === s.sectorId)!;
          for (const c of s.contacts) for (const e of c.echoes) {
            const sp = src.spots.find((x) => x.id === e.spot);
            if (sp?.sight) { sum += sp.sight.distM; n++; }
          }
        }
      }
      return sum / n;
    };
    const low = mean(10), high = mean(90);
    expect(high).toBeGreaterThan(low + 4);
    // same plan facts at both dials
    const a = planRoute(5, sweepEnv(tunables, [], 10), () => 0), b = planRoute(5, sweepEnv(tunables, [], 90), () => 0);
    expect(a.sectors.map((s) => [s.sectorId, s.contacts.map((c) => [c.card, c.echoes.length])])).toEqual(b.sectors.map((s) => [s.sectorId, s.contacts.map((c) => [c.card, c.echoes.length])]));
  });

  it('is deterministic: the same seed at the same dial gives the same plan', () => {
    const env = sweepEnv(tunables, [], 42);
    expect(JSON.stringify(planRoute(9, env, () => 1))).toBe(JSON.stringify(planRoute(9, env, () => 1)));
  });
});
