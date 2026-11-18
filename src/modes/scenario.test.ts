import { describe, expect, it } from 'vitest';
import { lean as leanDefaults } from '../config/lean';
import { SCENARIO_CARDS_DATA, SCENARIO_CARD_IDS, scenario as scenarioDefaults, type ScenarioTunables } from '../config/scenario';
import { SWEEP_CARDS } from '../config/sweep';
import { cloneTunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { ALL_CARDS, CARD_COUNT, NO_CARD, ScenarioSampler, cardData, cardIndex, cardMask, poolMask } from './scenario';
import { sweepEnv } from './sweep';
import { routeCards } from './sweepDirector';
import { planRoute } from './sweepGate';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';

/**
 * The scenario cards and the seeded sampler (#97; research `engagement-information.md` §3, §4.5): the ten cards as data, the
 * mix, coverage, no-streak and cap rules, weakness weighting, and the dial never being an input.
 */

const idx = (id: string): number => cardIndex(id);
const FLANK = idx('flank');
const DUEL = idx('known-duel');

/** Deal `n` contacts of one run from a sampler: every card allowed, the player wins each contact with probability `winRate` (seeded). */
function deal(s: ScenarioSampler, n: number, winRate: number, seed: number, contactsLeft = (_i: number): number => Infinity): { cards: number[]; won: boolean[] } {
  const outcome = new Rng(seed ^ 0x5bd1e995);
  const cards: number[] = [];
  const won: boolean[] = [];
  let wonLast = false;
  for (let i = 0; i < n; i++) {
    const c = s.draw(ALL_CARDS, wonLast, contactsLeft(i));
    if (c === NO_CARD) throw new Error('no card');
    const w = outcome.next() < winRate;
    s.record(c, w);
    cards.push(c);
    won.push(w);
    wonLast = w;
  }
  return { cards, won };
}

const sampler = (seed: number, cfg: ScenarioTunables = scenarioDefaults): ScenarioSampler => new ScenarioSampler(cfg, leanDefaults, seed);

describe('the ten cards as data (research §3, §4.1)', () => {
  it('there are ten, one per id, in the id order, each a complete card', () => {
    expect(SCENARIO_CARD_IDS).toHaveLength(10);
    expect(SCENARIO_CARDS_DATA.map((c) => c.id)).toEqual([...SCENARIO_CARD_IDS]);
    for (let i = 0; i < CARD_COUNT; i++) {
      const c = cardData(i);
      expect(['none', 'area', 'spot']).toContain(c.playerInfo);
      expect(['unaware', 'area', 'spot']).toContain(c.enemyInfo);
      expect(['window', 'rough', 'unknown']).toContain(c.timing);
      expect(['take', 'hold', 'both', 'breach', 'none']).toContain(c.role);
      expect([1, 2, 3, 4]).toContain(c.count);
      expect(['single', 'sequential', 'crossfire']).toContain(c.arrangement);
    }
  });

  it('the arrangement agrees with the count, and the cards the research names keep their shape', () => {
    for (const c of SCENARIO_CARDS_DATA) expect(c.count === 1).toBe(c.arrangement === 'single');
    const by = (id: string) => cardData(idx(id));
    expect(by('trade')).toMatchObject({ count: 2, arrangement: 'sequential', role: 'both' });
    expect(by('crossfire')).toMatchObject({ count: 2, arrangement: 'crossfire', role: 'take' });
    expect(by('take-unaware').enemyInfo).toBe('unaware');
    expect(by('take-expected').enemyInfo).toBe('spot');
    expect(by('flank')).toMatchObject({ playerInfo: 'none', enemyInfo: 'spot', role: 'hold' });
    expect(by('known-duel')).toMatchObject({ playerInfo: 'spot', enemyInfo: 'spot', role: 'none' });
    expect(by('breach').role).toBe('breach');
    expect(by('hold').timing).toBe('unknown');
  });

  it('the mix is the research §4.5 table and sums to 1; the role pools cover every card once', () => {
    const m = scenarioDefaults.mix;
    expect(Object.values(m).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(m).toMatchObject({ hold: 0.22, 'take-expected': 0.16, clear: 0.13, trade: 0.12, 'take-unaware': 0.08, meet: 0.08, breach: 0.06, crossfire: 0.06, flank: 0.04, 'known-duel': 0.05 });
    const pooled = [...scenarioDefaults.pools.take, ...scenarioDefaults.pools.hold, ...scenarioDefaults.pools.meet];
    expect([...pooled].sort()).toEqual([...SCENARIO_CARD_IDS].sort());
    expect(poolMask(scenarioDefaults, 'take') | poolMask(scenarioDefaults, 'hold') | poolMask(scenarioDefaults, 'meet')).toBe(ALL_CARDS);
  });

  it('every card the Sweep director can deal today is one of the ten', () => {
    for (const c of SWEEP_CARDS) expect(SCENARIO_CARD_IDS).toContain(c);
  });
});

describe('the sampler: the mix (research §4.5)', () => {
  it('over 1,000 seeded contacts the mix is within ±2 points of the Sweep target, whatever the seed (nothing to lean on)', () => {
    // Independent draws would miss ±2 points on about half the seeds (the SD of a 22% share over 1,000 draws is 1.3 points): the drift correction keeps it well inside.
    for (const winRate of [1]) {
      for (let seed = 1; seed <= 40; seed++) {
        const s = sampler(seed);
        const { cards } = deal(s, 1000, winRate, seed);
        for (let i = 0; i < CARD_COUNT; i++) {
          const share = cards.filter((c) => c === i).length / cards.length;
          const target = scenarioDefaults.mix[SCENARIO_CARD_IDS[i]!];
          expect(Math.abs(share - target), `seed ${seed}, win ${winRate}, ${SCENARIO_CARD_IDS[i]}: ${share} vs ${target}`).toBeLessThanOrEqual(0.02);
        }
      }
    }
  });

  it('a player who loses some situations is dealt more of them (the weakness weighting is meant to move the mix) but never above twice a card\'s base share', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { cards } = deal(sampler(seed), 1000, 0.45, seed);
      for (let i = 0; i < CARD_COUNT; i++) {
        const share = cards.filter((c) => c === i).length / cards.length;
        expect(share, `seed ${seed}, ${SCENARIO_CARD_IDS[i]}`).toBeLessThanOrEqual(2 * scenarioDefaults.mix[SCENARIO_CARD_IDS[i]!]);
      }
    }
  });

  it('pooled over many runs of ten contacts with coverage forcing on, the mix stays within ±2 points', () => {
    const counts = new Array<number>(CARD_COUNT).fill(0);
    let total = 0;
    for (let run = 0; run < 400; run++) {
      const s = sampler(1000 + run);
      const { cards } = deal(s, 10, 0.7, run, (i) => 10 - i);
      for (const c of cards) counts[c]!++;
      total += cards.length;
    }
    for (let i = 0; i < CARD_COUNT; i++) {
      expect(Math.abs(counts[i]! / total - scenarioDefaults.mix[SCENARIO_CARD_IDS[i]!]), SCENARIO_CARD_IDS[i]).toBeLessThanOrEqual(0.02);
    }
  });

  it('is deterministic: a seed gives one sequence; another seed another', () => {
    const a = deal(sampler(42), 200, 0.7, 9).cards;
    const b = deal(sampler(42), 200, 0.7, 9).cards;
    const c = deal(sampler(43), 200, 0.7, 9).cards;
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('reset restarts a run: the same seed again gives the same cards', () => {
    const s = sampler(5);
    const first = deal(s, 50, 0.7, 3).cards;
    s.reset(5);
    // The outcome windows kept from the first run feed the weakness weighting, so replay from a fresh sampler for the identity check.
    const fresh = deal(sampler(5), 50, 0.7, 3).cards;
    expect(first).toEqual(fresh);
    expect(s.dealt).toBe(0);
    expect(s.distinct).toBe(0);
  });

  it('only draws from the allowed cards (a sector role\'s pool), in that pool\'s proportions', () => {
    const hold = poolMask(scenarioDefaults, 'hold');
    const s = sampler(11);
    const counts = new Map<number, number>();
    let wonLast = true;
    for (let i = 0; i < 3000; i++) {
      const c = s.draw(hold, wonLast);
      expect(c === NO_CARD || (hold & (1 << c)) !== 0).toBe(true);
      if (c === NO_CARD) continue;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      wonLast = (i * 7919) % 10 < 7;
      s.record(c, wonLast);
    }
    expect(counts.get(idx('hold'))!).toBeGreaterThan(counts.get(idx('trade'))!);
    expect(counts.get(idx('trade'))!).toBeGreaterThan(counts.get(FLANK) ?? 0);
  });
});

describe('the sampler: coverage, streaks and caps (research §4.5 rules 1-3)', () => {
  it('a run of eight contacts or more presents at least six distinct cards when the caller says how many are left', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const n = 8 + (seed % 5);
      const s = sampler(seed);
      deal(s, n, 0.7, seed, (i) => n - i);
      expect(s.distinct, `seed ${seed}, ${n} contacts`).toBeGreaterThanOrEqual(scenarioDefaults.coverage.minCards);
    }
  });

  it('coverage forcing only picks from the cards the sector pools allow, and does what it can when there are too few', () => {
    const s = sampler(3);
    const take = poolMask(scenarioDefaults, 'take');
    let wonLast = false;
    for (let i = 0; i < 5; i++) {
      const c = s.draw(take, wonLast, 5 - i);
      expect(c).not.toBe(NO_CARD);
      expect((take & (1 << c)) !== 0).toBe(true);
      wonLast = true;
    }
    expect(s.distinct).toBe(5); // five contacts, five take cards: every contact was a new card
  });

  it('no card is dealt three times in a row, and a flank never follows a flank, over 40 seeds of 1,000 contacts', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { cards } = deal(sampler(seed), 1000, 0.8, seed);
      let triples = 0;
      let flankPairs = 0;
      for (let i = 2; i < cards.length; i++) if (cards[i] === cards[i - 1] && cards[i] === cards[i - 2]) triples++;
      for (let i = 1; i < cards.length; i++) if (cards[i] === FLANK && cards[i - 1] === FLANK) flankPairs++;
      expect(triples, `seed ${seed}`).toBe(0);
      expect(flankPairs, `seed ${seed}`).toBe(0);
    }
  });

  it('with a one-card pool the streak rule leaves nothing to deal rather than breaking it', () => {
    const s = sampler(1);
    const only = cardMask(['hold']);
    expect(s.draw(only, true)).toBe(idx('hold'));
    expect(s.draw(only, true)).toBe(idx('hold'));
    expect(s.draw(only, true)).toBe(NO_CARD);
    // The caller widens the pool and the draw is another card; commit() counts a card the caller chose itself.
    expect(s.draw(ALL_CARDS, true)).not.toBe(idx('hold'));
  });

  it('the known duel stays within 5% of the contacts so far (rounded up to one contact) and the flank within 5%, at every prefix', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = sampler(seed);
      const { cards } = deal(s, 1000, 0.9, seed);
      let duels = 0;
      let flanks = 0;
      let over = 0;
      cards.forEach((c, i) => {
        if (c === DUEL) duels++;
        if (c === FLANK) flanks++;
        const cap = Math.ceil(0.05 * (i + 1));
        if (duels > cap || flanks > cap) over++;
      });
      expect(over, `seed ${seed}: prefixes over the cap`).toBe(0);
      expect(duels / cards.length).toBeLessThanOrEqual(0.05);
      expect(flanks / cards.length).toBeLessThanOrEqual(0.05);
    }
  });

  it('a flank is only ever dealt right after a contact the player won', () => {
    let flanks = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { cards, won } = deal(sampler(seed), 600, 0.6, seed);
      let afterLoss = 0;
      cards.forEach((c, i) => {
        if (c !== FLANK) return;
        flanks++;
        if (!(i > 0 && won[i - 1])) afterLoss++;
      });
      expect(afterLoss, `seed ${seed}: flanks not after a won contact`).toBe(0);
    }
    expect(flanks).toBeGreaterThan(100); // the rule is exercised, not vacuous
    // And never after a loss, nor as the first contact of a run.
    const s = sampler(9);
    for (let i = 0; i < 200; i++) expect(s.draw(cardMask(['flank', 'hold']), false)).not.toBe(FLANK);
  });

  it('commit counts a card the caller chose (a tempo override) toward the streak and the caps', () => {
    const s = sampler(2);
    s.commit(idx('meet'));
    s.commit(idx('meet'));
    expect(s.dealtOf(idx('meet'))).toBe(2);
    expect(s.dealt).toBe(2);
    expect(s.distinct).toBe(1);
    for (let i = 0; i < 50; i++) {
      const t = sampler(100 + i);
      t.commit(idx('meet'));
      t.commit(idx('meet'));
      expect(t.draw(ALL_CARDS, true)).not.toBe(idx('meet'));
    }
  });
});

describe('the sampler: weakness weighting (research §4.5 rule 5)', () => {
  /** A config with no streak, cap or repeat rules, so the weights are the only thing that shapes the draws. */
  const bare: ScenarioTunables = { ...scenarioDefaults, maxRun: 1000, neverRepeat: [], caps: {} };

  /** Preload a history: `fights` contacts of the card with `won` wins. */
  function history(s: ScenarioSampler, id: string, fights: number, won: number): void {
    for (let i = 0; i < fights; i++) s.preload(idx(id), i < won);
  }

  function shares(s: ScenarioSampler, n: number): number[] {
    const counts = new Array<number>(CARD_COUNT).fill(0);
    for (let i = 0; i < n; i++) counts[s.draw(ALL_CARDS, true)]!++;
    return counts.map((c) => c / n);
  }

  it('the two lowest win rates over each card\'s last 20 contacts are the weakest (at least 4 fights, under the lean\'s rate); ties go to the earlier card', () => {
    const s = sampler(1, bare);
    history(s, 'clear', 12, 3); // 25%
    history(s, 'trade', 10, 5); // 50%
    history(s, 'hold', 20, 18); // 90%: wins enough
    history(s, 'breach', 3, 0); // 0% but only 3 fights: one lost fight is not a weakness
    history(s, 'meet', 8, 4); // 50%, ties with trade: the earlier card (trade, index 4) wins the tie
    expect(s.boosted()).toBe(cardMask(['clear', 'trade']));
  });

  it('only the last 20 contacts of a card count: old losses fall out of its window', () => {
    const s = sampler(1, bare);
    history(s, 'clear', 20, 0);
    expect(s.boosted()).toBe(cardMask(['clear']));
    for (let i = 0; i < 20; i++) s.record(idx('clear'), true);
    expect(s.winRate(idx('clear'))).toBe(1);
    expect(s.fights(idx('clear'))).toBe(20);
    expect(s.boosted()).toBe(0);
  });

  it('the two weakest cards gain +50% weight each: their shares rise by the closed form, within sampling error', () => {
    const N = 60_000;
    const plain = shares(sampler(7, bare), N);
    const s = sampler(7, bare);
    history(s, 'clear', 10, 2);
    history(s, 'hold', 10, 3);
    const weighted = shares(s, N);
    const t = 1;
    const l = scenarioDefaults.mix.clear + scenarioDefaults.mix.hold;
    const m = 1.5;
    for (const id of ['clear', 'hold'] as const) {
      const expected = (scenarioDefaults.mix[id] * m) / (t + (m - 1) * l);
      expect(weighted[idx(id)]).toBeCloseTo(expected, 2);
      expect(weighted[idx(id)]! / plain[idx(id)]!).toBeGreaterThan(1.2);
      expect(weighted[idx(id)]! / scenarioDefaults.mix[id]).toBeLessThan(2); // never above twice its base share
    }
    // Everything else gives way a little.
    expect(weighted[idx('take-expected')]!).toBeLessThan(plain[idx('take-expected')]!);
  });

  it('never above twice the base share: a lean config that would exceed the cap is held at it (closed form)', () => {
    // A heavy mix (hold 0.5) with boost +150% would give hold 0.5*2.5/(1+0.75) = 71% = 1.43x; cap it at 1.2x: m = 1.2*(1-0.5)/(1-0.6) = 1.5.
    const tight = { boost: 1.5, maxShareFactor: 1.2, weakest: leanDefaults.weakest };
    const s = new ScenarioSampler(bare, tight, 3);
    history(s, 'hold', 10, 0);
    const N = 60_000;
    const out = shares(s, N);
    const base = scenarioDefaults.mix.hold;
    expect(out[idx('hold')]! / base).toBeLessThanOrEqual(1.2 + 0.01);
    expect(out[idx('hold')]! / base).toBeGreaterThan(1.12);
  });

  it('with the lean\'s own numbers no weakest card ever passes twice its base share, even boosted against a thin pool', () => {
    // A pool of just three cards, two of them the weakest: their base share is large, so the cap matters most here.
    const pool = cardMask(['hold', 'trade', 'clear']);
    const s = sampler(4, bare);
    history(s, 'hold', 10, 1);
    history(s, 'trade', 10, 2);
    const counts = new Array<number>(CARD_COUNT).fill(0);
    const N = 40_000;
    for (let i = 0; i < N; i++) counts[s.draw(pool, true)]!++;
    const m = scenarioDefaults.mix;
    const total = m.hold + m.trade + m.clear;
    for (const id of ['hold', 'trade'] as const) expect(counts[idx(id)]! / N / (m[id] / total)).toBeLessThanOrEqual(2);
  });

  it('the results card\'s lean (#210) is boosted the same way, and reset clears it', () => {
    const s = sampler(1, bare);
    s.lean(cardMask(['crossfire']));
    expect(s.boosted()).toBe(cardMask(['crossfire']));
    const N = 60_000;
    const out = shares(s, N);
    const m = scenarioDefaults.mix.crossfire;
    expect(out[idx('crossfire')]!).toBeCloseTo((m * 1.5) / (1 + 0.5 * m), 2);
    s.reset(2);
    expect(s.boosted()).toBe(0);
  });

  it('a lean never turns on a card the caller cannot deal', () => {
    const s = sampler(1, bare);
    history(s, 'flank', 10, 0);
    for (let i = 0; i < 200; i++) expect(s.draw(cardMask(['hold', 'trade']), true)).not.toBe(FLANK);
  });
});

describe('the dial never changes the card mix (research §4.5 rule 6)', () => {
  it('the sampler reads only the scenario and lean numbers: wild dial, sweep and scoring tunables give the identical sequence', () => {
    const t = cloneTunables();
    const wild = cloneTunables();
    for (const k of Object.keys(wild.dial) as (keyof typeof wild.dial)[]) {
      const v = wild.dial[k] as unknown;
      if (typeof v === 'number') (wild.dial as unknown as Record<string, number>)[k as string] = v * 3 + 1;
    }
    wild.sweep.dialOffset = wild.sweep.dialOffset.map((d) => d + 40);
    wild.sweep.depthMultiplier = wild.sweep.depthMultiplier.map((d) => d * 2);
    const a = deal(new ScenarioSampler(t.scenario, t.lean, 21), 500, 0.7, 4).cards;
    const b = deal(new ScenarioSampler(wild.scenario, wild.lean, 21), 500, 0.7, 4).cards;
    expect(b).toEqual(a);
  });

  it('the Sweep director\'s routes deal the same cards whatever the dial tunables say, over 25 seeds', () => {
    const base = cloneTunables();
    const wild = cloneTunables();
    for (const k of Object.keys(wild.dial) as (keyof typeof wild.dial)[]) {
      const v = wild.dial[k] as unknown;
      if (typeof v === 'number') (wild.dial as unknown as Record<string, number>)[k as string] = v * 2 + 3;
    }
    wild.sweep.dialOffset = wild.sweep.dialOffset.map((d) => d - 30);
    wild.sweep.depthMultiplier = wild.sweep.depthMultiplier.map((d) => d * 3);
    const envA = sweepEnv(base);
    const envB = sweepEnv(wild);
    for (let seed = 1; seed <= 25; seed++) {
      const a = routeCards(planRoute(seed, envA, () => 0).sectors);
      const b = routeCards(planRoute(seed, envB, () => 0).sectors);
      expect(b, `seed ${seed}`).toEqual(a);
    }
  });
});

describe('every trial and contact records its card (research §4.1, §4.6)', () => {
  it('in bot-played Sweep runs every skillTrial and every contactSettled carries one of the ten cards, and a trial\'s card is its contact\'s', () => {
    const ids: readonly string[] = SCENARIO_CARD_IDS;
    let trials = 0;
    let contacts = 0;
    const missing: string[] = [];
    for (const seed of [41, 42, 43]) {
      const g = new HeadlessGame({ seed, placesNewProfiles: seed % 2 === 0 });
      g.bus.on('skillTrial', (e) => {
        trials++;
        if (e.card === undefined || !ids.includes(e.card)) missing.push(`trial ${seed}: ${String(e.card)}`);
      });
      g.bus.on('contactSettled', (e) => {
        contacts++;
        if (e.card === undefined || !ids.includes(e.card)) missing.push(`contact ${seed}: ${String(e.card)}`);
      });
      playMode(g, { mode: 'sweep', skill: 50, seed });
    }
    expect(missing).toEqual([]);
    expect(trials).toBeGreaterThan(5);
    expect(contacts).toBeGreaterThan(5);
  });
});

describe('allocation', () => {
  it('draws, commits and records allocate nothing per contact (the heap does not grow over 100k draws)', () => {
    const s = sampler(1);
    const run = (): number => {
      let acc = 0;
      let wonLast = true;
      for (let i = 0; i < 100_000; i++) {
        if (i % 200 === 0) s.reset(i);
        const c = s.draw(ALL_CARDS, wonLast, 12 - (i % 12));
        if (c === NO_CARD) continue;
        wonLast = (i & 3) !== 0;
        s.record(c, wonLast);
        acc += c + s.boosted() + s.distinct;
      }
      return acc;
    };
    run(); // warm up
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    const out = run();
    const grown = process.memoryUsage().heapUsed - before;
    expect(Number.isFinite(out)).toBe(true);
    // 100k draws that each made an object or an array would be tens of MB.
    expect(grown).toBeLessThan(4 * 1024 * 1024);
  });
});
