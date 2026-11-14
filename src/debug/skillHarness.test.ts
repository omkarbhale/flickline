import { describe, expect, it } from 'vitest';
import { SectorDial } from '../adaptive/sectorDial';
import { SkillState } from '../adaptive/skillModel';
import { cloneTunables } from '../config/tunables';
import { harnessRow, selfReportFor, simulateProfile, type HarnessRow } from './skillHarness';

/**
 * The run-level simulated-player harness (design §9.6, #203): bots of known ability play whole
 * Sweep runs through the real plan, sector dial and posterior. `npm run bot -- --skill-harness`
 * prints the same checks for 100 profiles per population (the table on #203); here 60 keep CI fast.
 */
const T = cloneTunables();
const SEEDS = 60;
const ABILITIES = [10, 30, 50, 70, 90];

const rows = new Map<string, HarnessRow>();
function row(ability: number, prior: 'self' | 'skip'): HarnessRow {
  const key = `${ability}|${prior}`;
  let r = rows.get(key);
  if (!r) {
    r = harnessRow(ability, prior === 'self' ? selfReportFor(ability, T) : 'skip', SEEDS, T);
    rows.set(key, r);
  }
  return r;
}

describe('placement inside the first Opener (design §9.2)', { timeout: 20_000 }, () => {
  for (const ability of ABILITIES) {
    it(`ability ${ability} with its self-report is within ±8 by the end of the first Opener`, () => {
      const r = row(ability, 'self');
      expect(r.openerMedianAbs, 'median |error|').toBeLessThanOrEqual(6);
      expect(r.openerWithin8, 'share within ±8').toBeGreaterThanOrEqual(0.65);
    });
  }

  it('without a self-report, abilities near the prior are placed within ±8', () => {
    for (const ability of [30, 50]) {
      const r = row(ability, 'skip');
      expect(r.openerMedianAbs, `${ability}: median |error|`).toBeLessThanOrEqual(6);
      expect(r.openerWithin8, `${ability}: share within ±8`).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('a player far above a skipped self-report is placed low, never high, and caught up by run 3', () => {
    // A 2-up/1-down staircase over four to six contacts climbs at most 16 points per two wins: a
    // skill-90 player from the 40 prior ends the Opener well short (reported on #203), never above.
    for (const ability of [70, 90]) {
      const r = row(ability, 'skip');
      expect(r.openerBias, `${ability}: bias after the Opener`).toBeLessThan(0);
      expect(r.run3MedianAbs, `${ability}: median |error| after 3 runs`).toBeLessThanOrEqual(4);
    }
  });
});

describe('three runs in (design §9.6)', { timeout: 20_000 }, () => {
  for (const ability of ABILITIES) {
    it(`ability ${ability}: the estimate is within ±4 after three runs (median), with or without a self-report`, () => {
      for (const prior of ['self', 'skip'] as const) {
        const r = row(ability, prior);
        expect(r.run3MedianAbs, `${prior}: median |error|`).toBeLessThanOrEqual(4);
        expect(Math.abs(r.run3Bias), `${prior}: bias`).toBeLessThanOrEqual(4.5);
      }
    });
  }
});

describe('a 30-minute session at stable ability (design §9.3, §9.6)', { timeout: 20_000 }, () => {
  for (const ability of ABILITIES) {
    it(`ability ${ability}: contacts won 60–80 %, the dial moves ≤ 3 per sector and stays within ±4`, () => {
      for (const prior of ['self', 'skip'] as const) {
        const r = row(ability, prior);
        expect(r.sessionWinMean, `${prior}: expected win rate`).toBeGreaterThanOrEqual(0.62);
        expect(r.sessionWinMean, `${prior}: expected win rate`).toBeLessThanOrEqual(0.78);
        expect(r.sessionWinRealised, `${prior}: realised win rate`).toBeGreaterThanOrEqual(0.6);
        expect(r.sessionWinRealised, `${prior}: realised win rate`).toBeLessThanOrEqual(0.8);
        expect(r.sessionWinInBand, `${prior}: sessions inside 60–80 %`).toBeGreaterThanOrEqual(0.85);
        expect(r.sessionSteady, `${prior}: sessions whose dial stays within ±4`).toBeGreaterThanOrEqual(0.8);
        expect(r.maxSectorStep, `${prior}: largest step between two sectors`).toBeLessThanOrEqual(3 + 1e-9);
      }
    });
  }
});

describe('no overshoot between runs (#171)', { timeout: 20_000 }, () => {
  it('after an easy first run (self-report "new", a better player), run 2 starts at or below where the dial settles', () => {
    for (const ability of [40, 55, 70, 85]) {
      const r = harnessRow(ability, 'new', SEEDS, T, 1);
      expect(r.run2OvershootMedian, `${ability}: run-2 start − settled, median`).toBeLessThanOrEqual(0);
      // #171: a drill's run 2 jumped 7 points past where it settled. Here a run starts on the posterior target and the
      // posterior after an easy run is still low (the prior pulls), so run 2 starts below, then the ±3 per sector closes it.
      expect(r.run2OvershootP90, `${ability}: run-2 start − settled, p90`).toBeLessThanOrEqual(4);
    }
  });

  it("each run starts on the posterior's target, carrying no lag from the last run", () => {
    const runs = simulateProfile(60, { prior: 'new', runs: 3, seed: 9 }, T);
    for (const r of runs.slice(1)) expect(r.matched[0]).toBeCloseTo(r.startTarget, 9);
  });
});

describe('SectorDial (design §9.3.2)', () => {
  it('aims run start at the target, moves ≤ 3 a sector, adds the depth offset, and never moves inside a sector', () => {
    const d = new SectorDial(T.dial);
    expect(d.enterSector(0, false, 50, -8, false)).toBe(42);
    expect(d.matched).toBe(50);
    expect(d.enterSector(1, false, 60, -3, false)).toBe(50); // matched 53
    expect(d.enterSector(2, false, 60, 0, false)).toBe(56); // matched 56
    expect(d.enterSector(3, false, 40, 3, false)).toBe(56); // matched 53
    expect(d.enterSector(0, false, 70, -8, false)).toBe(62); // a new run: straight to the target
  });

  it('runs the placing Opener on the staircase and seeds the next sector with its final dial', () => {
    const d = new SectorDial(T.dial);
    expect(d.enterSector(0, true, 32, -8, true)).toBe(32); // the staircase starts on the prior's target
    expect(d.placing).toBe(true);
    d.recordOpener('win');
    expect(d.enterSector(1, true, NaN, -8, true)).toBe(32);
    d.recordOpener('win'); // two clean wins: up 16
    expect(d.enterSector(2, true, NaN, -8, true)).toBe(48);
    d.recordOpener('neutral'); // cleared but hurt: no step, the run of wins is broken
    d.recordOpener('win');
    expect(d.enterSector(3, true, NaN, -8, true)).toBe(48);
    d.recordOpener('loss'); // a reversal: down 8
    expect(d.openerDone(4, 4, 6)).toBe(true);
    expect(d.openerDone(3, 4, 6)).toBe(false);
    // Sector 2 (depth 1) is seeded with the staircase's final dial, not moved towards the target.
    expect(d.enterSector(4, false, 70, -3, true)).toBe(37);
    expect(d.placing).toBe(false);
    expect(d.matched).toBe(40);
    expect(d.enterSector(5, false, 70, 0, true)).toBe(43); // then ±3 a sector
  });

  it('keeps a placing Opener going to the most contacts until the staircase has turned', () => {
    const d = new SectorDial(T.dial);
    d.startRun(30, -8, true);
    for (let i = 0; i < 4; i++) d.recordOpener('win');
    expect(d.openerDone(4, 4, 6)).toBe(false);
    expect(d.openerDone(6, 4, 6)).toBe(true);
  });
});

describe('the fight track the run dial follows (#203)', () => {
  it("aims the 'line' dial at contacts won: decided contacts move it, the shown Line Rating does not", () => {
    const s = new SkillState('skip', T.dial);
    const line = s.rating('line');
    for (let i = 0; i < 20; i++) s.observeFight(60, i % 5 !== 0);
    expect(s.fightRating()).toBeGreaterThan(55);
    expect(s.rating('line')).toBeCloseTo(line, 9);
    expect(s.targetDial('line', 0.7)).toBeCloseTo(s.fightRating() - T.dial.scale * Math.log(0.7 / 0.3), 6);
  });

  it('skill trials count at their weight, so fights won keep a lopsided player off the floor', () => {
    // Wins every fight, fails every angles bar (the Sweep bot): the fight track stays well above the angles skill.
    const s = new SkillState('skip', T.dial);
    for (let i = 0; i < 40; i++) {
      s.observeFight(50, true);
      for (let k = 0; k < 3; k++) s.observe('angles', { itemDifficulty: 50, success: false });
    }
    expect(s.rating('angles')).toBeLessThan(25);
    expect(s.fightRating()).toBeGreaterThan(45);
  });

  it('survives a save, and a save from before it starts it from the skills', () => {
    const s = new SkillState('some', T.dial);
    for (let i = 0; i < 10; i++) {
      s.observe('flick', { itemDifficulty: 50, success: i % 3 !== 0 });
      s.observeFight(50, i % 4 !== 0);
    }
    const snap = s.serialize();
    expect(snap.fight?.n).toBe(s.fightCount());
    const back = SkillState.deserialize(JSON.parse(JSON.stringify(snap)), T.dial)!;
    expect(back.fightRating()).toBeCloseTo(s.fightRating(), 0);
    const old = { ...snap };
    delete old.fight;
    const fromOld = SkillState.deserialize(JSON.parse(JSON.stringify(old)), T.dial)!;
    expect(fromOld.fightRating()).toBeCloseTo(fromOld.matchRating(), 0);
    expect(SkillState.deserialize({ ...snap, fight: { n: 0, p: 'x' } }, T.dial)).toBeNull();
  });

  it('matchRating weights the seven skills by their evidence, and is the plain line when they are equal', () => {
    const s = new SkillState('skip', T.dial);
    expect(s.matchRating()).toBeCloseTo(s.rating('line'), 6);
    for (let i = 0; i < 12; i++) {
      for (const k of ['precision', 'flick', 'angles', 'footwork', 'track'] as const) s.observe(k, { itemDifficulty: 70, success: i % 4 !== 0 });
    }
    // Spray and switch were never played: near their correlated prior with a 25-point band, they barely count.
    expect(s.rating('line')).toBeLessThan(s.matchRating() - 3);
  });
});
