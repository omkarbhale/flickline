import { describe, expect, it } from 'vitest';
import { callout as cfg } from '../config/callout';
import { SCENARIO_CARDS_DATA } from '../config/scenario';
import { Rng } from '../core/rng';
import { RAD2DEG } from '../core/math';
import { CalloutTimer, planCallout, type CalloutInput } from './callout';

const base = (over: Partial<CalloutInput> = {}): CalloutInput => ({
  card: 'take-expected', echoes: [{ x: 10, z: -10 }], anyRunning: false, player: { x: 0, z: 0 }, sectorIndex: 3, lastIssuedIndex: -Infinity, ...over,
});

/** Plans for `n` seeds of the same sector (chance forced to 1 so every qualifying sector draws). */
function plans(n: number, over: Partial<CalloutInput> = {}) {
  const sure = { ...cfg, chance: 1.1 };
  const out = [];
  for (let seed = 1; seed <= n; seed++) out.push(planCallout(new Rng(seed), sure, base(over)));
  return out;
}

const bearingDeg = (dirX: number, dirZ: number): number => Math.atan2(dirX, -dirZ) * RAD2DEG;

describe('the callout stand-in (engagement-information §4.2, #99)', () => {
  it('is delayed 0.6-1.2 s and its direction is off the true bearing by at most 45 degrees, on both sides', () => {
    const ps = plans(400)!;
    const truth = bearingDeg(10, -10); // an Echo to the right and ahead of a player at the origin: +45 deg
    let left = 0, right = 0;
    for (const p of ps) {
      expect(p).not.toBeNull();
      expect(p!.delaySec).toBeGreaterThanOrEqual(0.6);
      expect(p!.delaySec).toBeLessThanOrEqual(1.2);
      expect(Math.hypot(p!.dirX, p!.dirZ)).toBeCloseTo(1, 9);
      expect(Math.abs(p!.errorDeg)).toBeLessThanOrEqual(45);
      const off = Math.abs(((bearingDeg(p!.dirX, p!.dirZ) - truth + 540) % 360) - 180);
      expect(off).toBeLessThanOrEqual(45 + 1e-6);
      expect(off).toBeCloseTo(Math.abs(p!.errorDeg), 6);
      if (p!.errorDeg < 0) left++; else right++;
    }
    expect(Math.min(left, right)).toBeGreaterThan(120); // an error either way, not a bias
    // The error actually is coarse: a real spread, not a near-exact bearing.
    expect(ps.filter((p) => Math.abs(p!.errorDeg) > 20).length).toBeGreaterThan(150);
  });

  it('is only a direction: no position, distance or count in what it plans or emits', () => {
    const p = plans(1)[0]!;
    expect(Object.keys(p).sort()).toEqual(['delaySec', 'dirX', 'dirZ', 'errorDeg']);
  });

  it('is rare: about the configured share of qualifying sectors, never two sectors in a row', () => {
    let n = 0;
    for (let seed = 1; seed <= 2000; seed++) if (planCallout(new Rng(seed), cfg, base())) n++;
    expect(n / 2000).toBeGreaterThan(cfg.chance - 0.05);
    expect(n / 2000).toBeLessThan(cfg.chance + 0.05);
    expect(cfg.chance).toBeLessThanOrEqual(0.5);
    expect(plans(50, { lastIssuedIndex: 2 }).every((p) => p === null)).toBe(true); // the sector before
    expect(plans(50, { lastIssuedIndex: 1 }).every((p) => p !== null)).toBe(true); // one sector between
  });

  it('is only for area cards with no sound to carry it', () => {
    for (const card of ['take-unaware', 'hold', 'trade', 'flank', 'meet', 'known-duel']) {
      expect(plans(30, { card }).every((p) => p === null), card).toBe(true);
    }
    for (const card of cfg.cards) expect(plans(5, { card }).every((p) => p !== null), card).toBe(true);
    expect(plans(30, { anyRunning: true }).every((p) => p === null)).toBe(true);
    expect(plans(30, { echoes: [] }).every((p) => p === null)).toBe(true);
  });

  it('is deterministic for a seed and draws the same numbers whether or not it fires', () => {
    const a = new Rng(5), b = new Rng(5);
    planCallout(a, cfg, base());
    planCallout(b, cfg, base({ card: 'meet' }));
    expect(a.next()).toBe(b.next());
    expect(planCallout(new Rng(9), cfg, base())).toEqual(planCallout(new Rng(9), cfg, base()));
  });

  it('points at the middle of several Echoes', () => {
    const p = planCallout(new Rng(1), { ...cfg, chance: 2, maxErrorDeg: 0 }, base({ echoes: [{ x: -10, z: -10 }, { x: 10, z: -10 }] }))!;
    expect(p.dirX).toBeCloseTo(0, 9);
    expect(p.dirZ).toBeCloseTo(-1, 9);
  });
});

describe('which cards (engagement-information §3: playerInfo area)', () => {
  it('every card that gets a callout is one the player knows only by area, and the player takes it', () => {
    for (const id of cfg.cards) {
      const card = SCENARIO_CARDS_DATA.find((c) => c.id === id)!;
      expect(card.playerInfo, id).toBe('area');
      expect(card.role, id).toBe('take');
    }
    // The area take cards are all covered: nothing that qualifies is left out by accident.
    const areaTakes = SCENARIO_CARDS_DATA.filter((c) => c.playerInfo === 'area' && c.role === 'take').map((c) => c.id).sort();
    expect([...cfg.cards].sort()).toEqual(areaTakes);
  });
});

describe('CalloutTimer', () => {
  it('fires once, after the delay, and can be cancelled', () => {
    const t = new CalloutTimer();
    const fired: number[] = [];
    t.schedule({ delaySec: 0.8, dirX: 0, dirZ: -1, errorDeg: 0 }, 100, 128, 4);
    expect(t.pending).toBe(true);
    for (let tick = 100; tick < 100 + Math.round(0.8 * 128); tick++) t.step(tick, (_p, i) => fired.push(i));
    expect(fired).toEqual([]);
    t.step(100 + Math.round(0.8 * 128), (_p, i) => fired.push(i));
    t.step(100 + 300, (_p, i) => fired.push(i));
    expect(fired).toEqual([4]);
    t.schedule({ delaySec: 1, dirX: 0, dirZ: -1, errorDeg: 0 }, 0, 128, 5);
    t.cancel();
    t.step(1000, () => fired.push(99));
    expect(fired).toEqual([4]);
  });
});
