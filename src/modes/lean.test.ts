import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_IDS, SCENARIO_CARDS } from '../config/lean';
import { SWEEP_CARDS } from '../config/sweep';
import { cloneTunables } from '../config/tunables';
import { boostShares, dealableCards, joinWords, LeanKeeper, leanView, mergeLean, NO_LEAN, weakestCards } from './lean';
import { planCards, sweepPlan } from './sweep';

const tunables = cloneTunables();
const cfg = tunables.sweep;
const leanCfg = tunables.lean;

const total = (w: Record<string, number>): number => Object.values(w).reduce((a, b) => a + b, 0);
const share = (w: Record<string, number>, k: string): number => w[k]! / total(w);

describe('boostShares: the sampler rule (design §4.4)', () => {
  const base = { a: 0.3, b: 0.35, c: 0.2, d: 0.25 };

  it('raises a leaned card by the boost and leaves the others', () => {
    const w = boostShares(base, ['b'], 0.5, 2);
    expect(w.b).toBeCloseTo(0.525);
    expect(w.a).toBe(0.3);
    expect(w.c).toBe(0.2);
    expect(share(w, 'b')).toBeGreaterThan(share(base, 'b'));
    expect(share(w, 'a')).toBeLessThan(share(base, 'a'));
  });

  it('is the same object when nothing leans, or the leaned card has no weight', () => {
    expect(boostShares(base, [], 0.5, 2)).toBe(base);
    expect(boostShares({ ...base, e: 0 }, ['e'], 0.5, 2)).toEqual({ ...base, e: 0 });
    expect(boostShares(base, ['zzz'], 0.5, 2)).toBe(base);
    expect(boostShares(base, ['a'], 0, 2)).toBe(base);
  });

  it('never lets a leaned card pass twice its base share, however large the boost', () => {
    for (const boost of [0.5, 1, 3, 10, 1000]) {
      for (const leaned of [['a'], ['a', 'b'], ['b', 'c', 'd'], ['a', 'b', 'c']]) {
        const w = boostShares(base, leaned, boost, 2);
        for (const k of leaned) expect(share(w, k)).toBeLessThanOrEqual(2 * share(base, k) + 1e-12);
      }
    }
  });

  it('the cap is exact: a big boost lands every leaned card on twice its base share', () => {
    const w = boostShares(base, ['a', 'c'], 100, 2);
    expect(share(w, 'a')).toBeCloseTo(2 * share(base, 'a'), 10);
    expect(share(w, 'c')).toBeCloseTo(2 * share(base, 'c'), 10);
  });

  it('the shipped +50% is under the cap for one or two leaned cards, so it applies in full', () => {
    expect(leanCfg.boost).toBe(0.5);
    const w = boostShares(cfg.cardWeight, ['take-expected', 'clear'], leanCfg.boost, leanCfg.maxShareFactor);
    expect(w['take-expected']).toBeCloseTo(cfg.cardWeight['take-expected'] * 1.5);
    expect(w.clear).toBeCloseTo(cfg.cardWeight.clear * 1.5);
  });

  it('when every card is leaned nothing changes in share', () => {
    const w = boostShares(base, ['a', 'b', 'c', 'd'], 0.5, 2);
    for (const k of Object.keys(base)) expect(share(w, k)).toBeCloseTo(share(base, k), 12);
  });
});

describe('the table: diagnostics to cards (design §8.3, #210)', () => {
  it('has an entry for each of the twelve diagnostics, with known cards, and a clause for every one that leans', () => {
    expect(DIAGNOSTIC_IDS).toHaveLength(12);
    for (const id of DIAGNOSTIC_IDS) {
      const e = leanCfg.table[id];
      expect(e, id).toBeDefined();
      for (const c of e.cards) expect(SCENARIO_CARDS).toContain(c);
      expect(new Set(e.cards).size).toBe(e.cards.length);
      expect(e.why.length > 0, id).toBe(e.cards.length > 0);
    }
    expect(Object.keys(leanCfg.table).sort()).toEqual([...DIAGNOSTIC_IDS].sort());
  });

  it('has a plain phrase for every card, and the sweep cards are scenario cards', () => {
    for (const c of SCENARIO_CARDS) expect(leanCfg.phrases[c].length).toBeGreaterThan(3);
    for (const c of SWEEP_CARDS) expect(SCENARIO_CARDS).toContain(c);
  });

  it('keeps the issue\'s examples: moving shots, switch hesitation, head height', () => {
    expect(leanCfg.table.movingShots.cards).toEqual(expect.arrayContaining(['meet', 'take-expected']));
    expect(leanCfg.table.switchHesitation.cards).toEqual(expect.arrayContaining(['trade', 'crossfire']));
    expect(leanCfg.table.headHeight.cards).toEqual(expect.arrayContaining(['clear', 'take-unaware']));
  });

  it('a run can deal five cards today (the four take cards and the meet), and the lean skips the rest', () => {
    expect(dealableCards(cfg).sort()).toEqual(['clear', 'crossfire', 'meet', 'take-expected', 'take-unaware']);
    const v = leanView('switchHesitation', leanCfg, cfg)!;
    expect(v.cards).toEqual(['crossfire']); // `trade` is not dealt yet
    expect(v.line).not.toMatch(/trade/);
  });
});

describe('leanView: the line the results card says', () => {
  it('moving shots: meets and takes against expecting enemies, in plain words', () => {
    const v = leanView('movingShots', leanCfg, cfg)!;
    expect(v.cards).toEqual(['meet', 'take-expected']);
    expect(v.line).toBe('Next run leans: meets in a corridor and takes against enemies who expect you, where the stop decides the fight.');
  });

  it('is null for a finding with no card to lean on, an unknown id, or the placeholder', () => {
    expect(leanView('tilt', leanCfg, cfg)).toBeNull();
    expect(leanView('placeholder', leanCfg, cfg)).toBeNull();
    expect(leanView('nonsense', leanCfg, cfg)).toBeNull();
  });

  it('never names a card the run cannot deal, for any diagnostic', () => {
    const can = dealableCards(cfg);
    for (const id of DIAGNOSTIC_IDS) {
      const v = leanView(id, leanCfg, cfg);
      if (!v) continue;
      expect(v.cards.length).toBeGreaterThan(0);
      for (const c of v.cards) expect(can).toContain(c);
      expect(v.line).toMatch(/^Next run leans: .+\.$/);
    }
  });

  it('joins in plain words', () => {
    const j = leanCfg.listJoin;
    expect(joinWords([], j)).toBe('');
    expect(joinWords(['a'], j)).toBe('a');
    expect(joinWords(['a', 'b'], j)).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'], j)).toBe('a, b and c');
  });
});

describe('weakestCards (design §4.4)', () => {
  const rec = (m: Record<string, { won: number; played: number }>) => (card: string) => m[card] ?? null;

  it('the two lowest win rates, lowest first, among cards the run can deal', () => {
    const w = weakestCards(rec({ clear: { won: 3, played: 10 }, 'take-expected': { won: 5, played: 10 }, crossfire: { won: 2, played: 10 }, 'take-unaware': { won: 6, played: 10 } }), leanCfg, cfg);
    expect(w).toEqual(['crossfire', 'clear']);
  });

  it('needs enough fights, a win rate under the matching target, and a card the run deals', () => {
    expect(weakestCards(rec({ clear: { won: 0, played: 2 } }), leanCfg, cfg)).toEqual([]); // two fights say nothing
    expect(weakestCards(rec({ clear: { won: 9, played: 10 } }), leanCfg, cfg)).toEqual([]); // won at the target or better
    expect(weakestCards(rec({ trade: { won: 0, played: 10 } }), leanCfg, cfg)).toEqual([]); // not dealt yet
    expect(weakestCards(rec({}), leanCfg, cfg)).toEqual([]); // the first run: no history
  });

  it('asks for the configured window', () => {
    const asked: number[] = [];
    weakestCards((_c, window) => { asked.push(window); return null; }, leanCfg, cfg);
    expect(new Set(asked)).toEqual(new Set([20]));
  });
});

describe('LeanKeeper: one run, then spent', () => {
  it('a fresh run takes the pending lean once; the next run has none', () => {
    const k = new LeanKeeper();
    expect(k.fresh([])).toEqual([]);
    k.setNext(['meet', 'take-expected']);
    expect(k.next).toEqual(['meet', 'take-expected']);
    expect(k.fresh([])).toEqual(['meet', 'take-expected']);
    expect(k.next).toEqual([]);
    expect(k.fresh([])).toEqual([]); // decayed after one run
  });

  it('adds the weakest cards, once each', () => {
    const k = new LeanKeeper();
    k.setNext(['meet', 'clear']);
    expect(k.fresh(['clear', 'crossfire'])).toEqual(['meet', 'clear', 'crossfire']);
    expect(mergeLean(NO_LEAN, [])).toBe(NO_LEAN);
  });

  it('a replay keeps the lean the run had and leaves the pending one for the next fresh run', () => {
    const k = new LeanKeeper();
    k.setNext(['meet']);
    k.fresh([]);
    k.setNext(['clear']); // the results card of that run
    expect(k.replay()).toEqual(['meet']);
    expect(k.replay()).toEqual(['meet']);
    expect(k.fresh([])).toEqual(['clear']);
  });

  it('a run that never leans (the Daily Route) leaves the pending lean alone and replays as none', () => {
    const k = new LeanKeeper();
    k.setNext(['meet']);
    expect(k.none()).toEqual([]);
    expect(k.replay()).toEqual([]);
    expect(k.next).toEqual(['meet']);
  });
});

describe('the sampler with a lean (seeded plans)', () => {
  const N = 500;
  /** Cards dealt by `N` seeded plans: take contacts by card, and the meet sectors among sectors 2 and later. */
  function tally(lean: readonly string[], tun = tunables): { cards: Record<string, number>; takeContacts: number; meetSectors: number; sectors: number } {
    const cards: Record<string, number> = {};
    let takeContacts = 0, meetSectors = 0, sectors = 0;
    for (let seed = 1; seed <= N; seed++) {
      const plan = sweepPlan(seed, tun, lean);
      for (const s of plan.sectors) {
        if (s.index === 0) continue;
        sectors++;
        if (s.role === 'meet') meetSectors++;
        for (const c of s.contacts) {
          cards[c.card] = (cards[c.card] ?? 0) + 1;
          if (c.card !== 'meet') takeContacts++;
        }
      }
    }
    return { cards, takeContacts, meetSectors, sectors };
  }

  it('without a lean the plan is exactly what it was', () => {
    for (const seed of [1, 7, 42, 999]) expect(sweepPlan(seed, tunables, [])).toEqual(sweepPlan(seed, tunables));
  });

  it('a lean raises the leaned cards\' share and not above twice the base share', () => {
    const off = tally([]);
    const on = tally(['take-expected', 'meet']);
    const teOff = off.cards['take-expected']! / off.takeContacts;
    const teOn = on.cards['take-expected']! / on.takeContacts;
    expect(teOn / teOff).toBeGreaterThan(1.12);
    expect(teOn / teOff).toBeLessThan(2);
    const mOff = off.meetSectors / off.sectors;
    const mOn = on.meetSectors / on.sectors;
    expect(mOn / mOff).toBeGreaterThan(1.12);
    expect(mOn / mOff).toBeLessThan(2);
    // The cards that were not leaned fall a little, as the leaned ones rise.
    expect(on.cards['take-unaware']! / on.takeContacts).toBeLessThan(off.cards['take-unaware']! / off.takeContacts);
  });

  it('a boost far past the cap still holds a leaned card under twice its share', () => {
    const wild = cloneTunables();
    wild.lean.boost = 50;
    const off = tally([]);
    const on = tally(['clear'], wild);
    const ratio = on.cards.clear! / on.takeContacts / (off.cards.clear! / off.takeContacts);
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.2); // 2 plus the noise of a few hundred draws
  });

  it('coverage and the card rules of design §4.4 still hold with a lean', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const plan = sweepPlan(seed, tunables, ['take-expected', 'clear', 'meet']);
      expect(plan.sectors[0]!.role).toBe('take');
      const cards = planCards(plan);
      for (let k = 2; k < cards.length; k++) expect(cards[k] === cards[k - 1] && cards[k] === cards[k - 2]).toBe(false);
      for (const s of plan.sectors) for (const c of s.contacts) if (c.card === 'crossfire') expect(s.index).toBeGreaterThanOrEqual(cfg.crossfireFromSector);
      for (let i = 1; i < plan.sectors.length; i++) expect(plan.sectors[i]!.sectorId).not.toBe(plan.sectors[i - 1]!.sectorId);
    }
    // Every card is still dealt (nothing is leaned out of existence).
    const on = tally(['take-expected', 'clear', 'meet']);
    for (const c of ['take-unaware', 'take-expected', 'clear', 'crossfire', 'meet']) expect(on.cards[c] ?? 0, c).toBeGreaterThan(20);
  });

  it('a lean toward a card the run cannot deal changes nothing', () => {
    for (const seed of [3, 11, 200]) expect(sweepPlan(seed, tunables, ['trade', 'flank'])).toEqual(sweepPlan(seed, tunables));
  });

  it('is deterministic: the same seed and lean, the same plan', () => {
    expect(sweepPlan(31, tunables, ['meet', 'clear'])).toEqual(sweepPlan(31, tunables, ['meet', 'clear']));
  });
});
