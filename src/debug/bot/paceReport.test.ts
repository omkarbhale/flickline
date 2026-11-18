import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../../config/tunables';
import { paceRow, paceVerdict, quantile, sweepRun, type SweepRunFacts } from './sweepReport';

const T = cloneTunables().fightPace;
// Twelve seeds: since Echoes aim for real (#90) runs end sooner, and over six the walkers' pace was lost in how long each survived.
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe('fight pace in the Sweep report (#248)', () => {
  it('quantiles interpolate and a row reads medians and the share over the dead-air target', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 9);
    const run = (fightsPerMin: number, deadAirMaxSec: number, gateMaxSec: number): SweepRunFacts =>
      ({ pace: { liveSec: 60, fights: fightsPerMin, fightsPerMin, duelsPerMin: fightsPerMin, deadAirMaxSec, gates: 1, gateSec: gateMaxSec, gateMaxSec } }) as unknown as SweepRunFacts;
    const row = paceRow('human', 50, [run(3, 10, 2), run(5, 20, 4), run(6, 12, 3)], 15);
    expect(row.fightsPerMin).toBe(5);
    expect(row.deadAirSec).toBe(12);
    expect(row.deadAirWorstSec).toBe(20);
    expect(row.deadAirOverShare).toBeCloseTo(1 / 3, 9);
    expect(row.gateSec).toBe(3);
    expect(paceVerdict(row, T)).toEqual({ fights: true, deadAir: true, gates: true });
  });

  // The fun criteria's automated check (design §2.2, §14.7): the scripted human pace meets the fight-pace targets on a
  // handful of seeds. The full table (`npm run bot -- --sweep-report`) is what a balance change is judged by.
  it('the human-pace walker is slower than the bot and still meets the targets; fights are the contacts fought', () => {
    const bot = SEEDS.map((s) => sweepRun(50, s, undefined, undefined, undefined, 'bot'));
    const human = SEEDS.map((s) => sweepRun(50, s, undefined, undefined, undefined, 'human'));
    for (const f of [...bot, ...human]) {
      expect(f.pace.fights).toBe(f.contacts.cleared + f.contacts.died + f.contacts.disengaged);
      expect(f.pace.liveSec).toBeCloseTo(f.liveSec, 1);
      expect(f.pace.deadAirMaxSec, `seed ${f.seed}: dead air inside a sector`).toBeLessThanOrEqual(T.maxDeadAirSec);
      if (f.pace.gates > 0) expect(f.pace.gateMaxSec).toBeLessThanOrEqual(T.maxGateSec);
    }
    const perMin = (fs: SweepRunFacts[]): number => fs.reduce((a, f) => a + f.pace.fights, 0) / (fs.reduce((a, f) => a + f.pace.liveSec, 0) / 60);
    expect(perMin(human)).toBeLessThan(perMin(bot));
    expect(perMin(human)).toBeGreaterThanOrEqual(T.targetFightsPerMin);
  }, 30_000);
});
