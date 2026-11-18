import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { SkillState } from './skillModel';
import { Staircase, STAIRCASE_TARGET } from './staircase';

/**
 * Simulated-player harness (design §9.6). A simulated player of known ability θ succeeds on an
 * item of difficulty d with probability σ((θ + ε − d)/9), where ε ~ N(0, 4) is moment-to-moment
 * noise (a bad flick, a good one). The model never sees θ. Everything is seeded, so results are
 * reproducible; while tuning, the same checks were run on 200 seeds per ability.
 */
const ABILITIES = [10, 30, 50, 70, 90];
const NOISE_SD = 4;
const TRUE_SCALE = 9;
const PLACEMENT_TRIALS = 30;

function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

function simulatedPlayer(ability: number, rng: Rng): (difficulty: number) => boolean {
  return (d) => rng.next() < 1 / (1 + Math.exp(-(ability + NOISE_SD * gauss(rng) - d) / TRUE_SCALE));
}

function placement(state: SkillState, play: (d: number) => boolean): number {
  const sc = new Staircase(state.targetDial('precision', STAIRCASE_TARGET));
  for (let t = 0; t < PLACEMENT_TRIALS; t++) {
    const d = sc.dial;
    const ok = play(d);
    state.observe('precision', { itemDifficulty: d, success: ok });
    sc.record(ok);
  }
  return state.finishPlacement('precision', sc);
}

describe('simulated players: placement (design §9.2)', () => {
  const SEEDS = 100;
  for (const ability of ABILITIES) {
    it(`ability ${ability} converges to ±6 within ${PLACEMENT_TRIALS} trials`, () => {
      const errors: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = new Rng(seed * 7919 + ability);
        const state = new SkillState('skip');
        errors.push(placement(state, simulatedPlayer(ability, rng)) - ability);
      }
      const abs = errors.map(Math.abs).sort((a, b) => a - b);
      const within6 = abs.filter((e) => e <= 6).length / SEEDS;
      const bias = errors.reduce((a, b) => a + b, 0) / SEEDS;
      // 30 binary trials at s = 9 carry ~4 dial points of s.d. even for a perfect estimator, so ±6
      // is a ~1.6 s.d. band: ~86 % of single runs land inside it, the median error is ~2.7.
      expect(within6, `within ±6: ${within6}`).toBeGreaterThanOrEqual(0.8);
      expect(abs[SEEDS >> 1], 'median |error|').toBeLessThanOrEqual(3.5);
      expect(Math.abs(bias), 'bias').toBeLessThanOrEqual(2.5);
    });
  }
});

describe('simulated players: a 10-minute session (design §9.3)', () => {
  const SEEDS = 4;
  const RUNS = 10; // 60 s runs
  const BEATS = 60 / tunables.dial.beat.drillSec;
  const TRIALS_PER_BEAT = 7; // ~45 targets per 60 s run
  const SETTLE_RUNS = 4; // placement error is worked off first; oscillation is judged after it

  for (const ability of ABILITIES) {
    it(`ability ${ability}: success 60–80 %, ≤ 3 per beat, no oscillation beyond ±4`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = new Rng(seed * 104729 + ability);
        const play = simulatedPlayer(ability, rng);
        const state = new SkillState('skip');
        placement(state, play);
        let hits = 0;
        let trials = 0;
        const matched: number[] = [];
        for (let run = 0; run < RUNS; run++) {
          let prev = Number.NaN;
          for (let beat = 0; beat < BEATS; beat++) {
            const dial = state.dialFor('test', beat);
            const m = state.matchedDial('test');
            if (beat > 0) expect(Math.abs(m - prev)).toBeLessThanOrEqual(3 + 1e-9);
            expect(dial).toBeCloseTo(Math.min(100, Math.max(0, m + tunables.dial.waves.drill[beat])), 9);
            prev = m;
            matched.push(m);
            for (let t = 0; t < TRIALS_PER_BEAT; t++) {
              const ok = play(dial);
              hits += ok ? 1 : 0;
              trials++;
              state.observe('precision', { itemDifficulty: dial, success: ok });
            }
          }
        }
        const rate = hits / trials;
        expect(rate, `seed ${seed} success`).toBeGreaterThanOrEqual(0.6);
        expect(rate, `seed ${seed} success`).toBeLessThanOrEqual(0.8);
        const late = matched.slice(SETTLE_RUNS * BEATS);
        const mean = late.reduce((a, b) => a + b, 0) / late.length;
        for (const m of late) expect(Math.abs(m - mean), `seed ${seed} oscillation`).toBeLessThanOrEqual(4);
      }
    });
  }
});
