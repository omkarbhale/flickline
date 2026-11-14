import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createRepeatGuard, exGaussian, exGaussianTruncated, exponential, lognormal, lognormalSigma,
  lognormalTruncated, normal, normalTruncated, TRUNCATE_TRIES, weightedChoice,
} from './dist';
import { Rng } from './rng';
import {
  EnemyStreams, STREAM_AIM, STREAM_COUNT, STREAM_DECISIONS, STREAM_PERSONALITY, STREAM_REACTION, streamSeed,
} from './rngStreams';

const N = 10_000;

/** Mean, SD and skewness of `N` draws from `f`. */
function stats(f: () => number): { mean: number; sd: number; skew: number; min: number } {
  const xs = new Float64Array(N);
  let sum = 0;
  let min = Infinity;
  for (let i = 0; i < N; i++) {
    const x = (xs[i] = f());
    sum += x;
    if (x < min) min = x;
  }
  const mean = sum / N;
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < N; i++) {
    const d = xs[i]! - mean;
    m2 += d * d;
    m3 += d * d * d;
  }
  const sd = Math.sqrt(m2 / N);
  return { mean, sd, skew: m3 / N / (sd * sd * sd), min };
}

const within = (actual: number, expected: number, rel = 0.02): void => {
  expect(Math.abs(actual - expected) / Math.abs(expected), `${actual} vs ${expected}`).toBeLessThan(rel);
};

describe('enemy RNG streams', () => {
  it('seeds are a pure function of (runSeed, serial, stream)', () => {
    expect(streamSeed(7, 3, STREAM_AIM)).toBe(streamSeed(7, 3, STREAM_AIM));
    const a = new EnemyStreams(7, 3);
    const b = new EnemyStreams(7, 3);
    for (let i = 0; i < 50; i++) expect(a.reaction.next()).toBe(b.reaction.next());
  });

  it('every (run seed, serial, stream) triple gets its own seed', () => {
    const seen = new Set<number>();
    for (let run = 0; run < 8; run++) {
      for (let serial = 0; serial < 64; serial++) {
        for (let s = 0; s < STREAM_COUNT; s++) seen.add(streamSeed(run, serial, s));
      }
    }
    expect(seen.size).toBe(8 * 64 * STREAM_COUNT);
  });

  it('a draw in one stream never changes another stream or another enemy', () => {
    const solo = new EnemyStreams(42, 1);
    const reference: number[] = [];
    for (let i = 0; i < 20; i++) reference.push(solo.reaction.next());

    // Same enemy, but the other three streams are drawn from heavily and interleaved.
    const busy = new EnemyStreams(42, 1);
    const got: number[] = [];
    for (let i = 0; i < 20; i++) {
      for (let k = 0; k < i; k++) {
        busy.personality.next();
        busy.aim.normal();
        busy.decisions.next();
      }
      got.push(busy.reaction.next());
    }
    expect(got).toEqual(reference);

    // Other enemies being created and drawn from does not change enemy 1 either.
    const crowd = [new EnemyStreams(42, 0), new EnemyStreams(42, 2), new EnemyStreams(42, 9)];
    for (const c of crowd) for (let i = 0; i < 30; i++) c.reaction.next();
    const again = new EnemyStreams(42, 1);
    for (let i = 0; i < 20; i++) expect(again.reaction.next()).toBe(reference[i]);
  });

  it('the four streams and neighbouring serials are decorrelated', () => {
    const s = new EnemyStreams(5, 10);
    const t = new EnemyStreams(5, 11);
    const streams = [
      s.personality, s.reaction, s.aim, s.decisions, t.personality, t.reaction, t.aim, t.decisions,
    ];
    const names = [STREAM_PERSONALITY, STREAM_REACTION, STREAM_AIM, STREAM_DECISIONS];
    expect(names).toEqual([0, 1, 2, 3]);
    const firsts = new Set(streams.map((r) => r.next()));
    expect(firsts.size).toBe(8);
    // Pairwise correlation of 2,000 draws stays near 0.
    const n = 2000;
    const cols = streams.map((r) => Float64Array.from({ length: n }, () => r.next()));
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        let c = 0;
        for (let k = 0; k < n; k++) c += (cols[i]![k]! - 0.5) * (cols[j]![k]! - 0.5);
        expect(Math.abs(c / n / (1 / 12))).toBeLessThan(0.1);
      }
    }
  });

  it('reseed restarts the streams exactly', () => {
    const s = new EnemyStreams(1, 1);
    const first = s.aim.normal();
    s.aim.normal();
    s.reseed(1, 1);
    expect(s.aim.normal()).toBe(first);
  });
});

describe('Rng.normal', () => {
  it('uses both Box–Muller outputs: two normals cost two uniforms', () => {
    const a = new Rng(9);
    const b = new Rng(9);
    a.normal();
    a.normal();
    b.next();
    b.next();
    expect(a.getState()).toBe(b.getState());
    a.normal();
    expect(a.getState()).not.toBe(b.getState()); // a third normal starts a new pair
  });

  it('setState discards the cached half so a restored stream is reproducible', () => {
    const a = new Rng(3);
    a.normal();
    a.setState(3);
    const b = new Rng(3);
    expect(a.normal()).toBe(b.normal());
  });
});

describe('distributions (10,000 draws at fixed seeds)', () => {
  it('normal', () => {
    const r = new Rng(1);
    const s = stats(() => normal(r, 300, 40));
    within(s.mean, 300);
    within(s.sd, 40);
    expect(Math.abs(s.skew)).toBeLessThan(0.1);
  });

  it('exponential', () => {
    const r = new Rng(2);
    const s = stats(() => exponential(r, 120));
    within(s.mean, 120);
    within(s.sd, 120);
    expect(s.min).toBeGreaterThanOrEqual(0);
  });

  it('ex-Gaussian: mean mu + tau, SD sqrt(sigma^2 + tau^2), positive skew', () => {
    const r = new Rng(3);
    const mu = 330;
    const sigma = 45;
    const tau = 140;
    const s = stats(() => exGaussian(r, mu, sigma, tau));
    within(s.mean, mu + tau);
    within(s.sd, Math.hypot(sigma, tau));
    expect(s.skew).toBeGreaterThan(0.3);
    // Theory: 2 tau^3 / (sigma^2 + tau^2)^1.5.
    within(s.skew, (2 * tau ** 3) / Math.hypot(sigma, tau) ** 3, 0.25);
  });

  it('lognormal by median and CV: median exp(mu), mean median*sqrt(1+cv^2), SD cv*mean', () => {
    for (const [seed, cv] of [[4, 0.15], [5, 0.3]] as const) {
      const r = new Rng(seed);
      const median = 0.6;
      const s = stats(() => lognormal(r, median, cv));
      const mean = median * Math.sqrt(1 + cv * cv);
      within(s.mean, mean);
      within(s.sd, cv * mean);
      expect(s.skew).toBeGreaterThan(0);
      expect(s.min).toBeGreaterThan(0);
    }
    expect(lognormalSigma(0)).toBe(0);
    expect(lognormal(new Rng(1), 0.7, 0)).toBeCloseTo(0.7, 12);
  });

  it('is deterministic per seed and different across seeds', () => {
    const a = new Rng(11);
    const b = new Rng(11);
    const c = new Rng(12);
    for (let i = 0; i < 100; i++) {
      const x = exGaussian(a, 300, 40, 100);
      expect(exGaussian(b, 300, 40, 100)).toBe(x);
      expect(exGaussian(c, 300, 40, 100)).not.toBe(x);
    }
  });
});

describe('truncation by deterministic rejection', () => {
  it('ex-Gaussian draws never fall below the floor and keep the shape above it', () => {
    const r = new Rng(6);
    const floor = 250;
    const s = stats(() => exGaussianTruncated(r, 270, 30, 85, 0, floor, Infinity));
    expect(s.min).toBeGreaterThanOrEqual(floor);
    // Rejection, not clamping: almost no draws sit exactly on the floor.
    const r2 = new Rng(6);
    let onFloor = 0;
    for (let i = 0; i < N; i++) if (exGaussianTruncated(r2, 270, 30, 85, 0, floor, Infinity) === floor) onFloor++;
    expect(onFloor).toBeLessThan(N * 0.01);
  });

  it('upper bound and the other families respect their bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < N; i++) {
      const a = normalTruncated(r, 0, 1, -0.5, 0.8);
      expect(a).toBeGreaterThanOrEqual(-0.5);
      expect(a).toBeLessThanOrEqual(0.8);
      const b = lognormalTruncated(r, 0.6, 0.45, 0.2, 1.5);
      expect(b).toBeGreaterThanOrEqual(0.2);
      expect(b).toBeLessThanOrEqual(1.5);
    }
  });

  it('after 8 rejected tries the draw is the bound, using exactly 8 draws', () => {
    // A floor far above the distribution: every try is rejected.
    const r = new Rng(8);
    const ref = new Rng(8);
    expect(exGaussianTruncated(r, 100, 1, 1, 0, 1e6, Infinity)).toBe(1e6);
    for (let i = 0; i < TRUNCATE_TRIES; i++) exGaussian(ref, 100, 1, 1);
    expect(r.getState()).toBe(ref.getState());
    // A ceiling far below it clamps down to the upper bound.
    expect(normalTruncated(new Rng(8), 100, 1, -1e6, 5)).toBe(5);
  });

  it('applies the shift before testing the bound', () => {
    const r = new Rng(9);
    for (let i = 0; i < 1000; i++) expect(exGaussianTruncated(r, 330, 45, 140, -60, 150, Infinity)).toBeGreaterThanOrEqual(150);
  });
});

describe('weightedChoice', () => {
  it('follows the weights', () => {
    const r = new Rng(21);
    const g = createRepeatGuard();
    const w = [1, 3, 6];
    const counts = [0, 0, 0];
    // Reset the guard each draw so the no-third-repeat rule does not bias the frequency check.
    for (let i = 0; i < N; i++) {
      g.last = -1;
      g.run = 0;
      counts[weightedChoice(r, w, 3, g)]!++;
    }
    within(counts[0]! / N, 0.1, 0.1);
    within(counts[1]! / N, 0.3, 0.1);
    within(counts[2]! / N, 0.6, 0.05);
  });

  it('never picks the same index a third time in a row, even when one weight dominates', () => {
    const r = new Rng(22);
    const g = createRepeatGuard();
    const w = [0.97, 0.02, 0.01];
    let run = 0;
    let last = -1;
    let maxRun = 0;
    let seenOthers = 0;
    for (let i = 0; i < N; i++) {
      const c = weightedChoice(r, w, 3, g);
      run = c === last ? run + 1 : 1;
      last = c;
      if (run > maxRun) maxRun = run;
      if (c !== 0) seenOthers++;
    }
    expect(maxRun).toBe(2);
    expect(seenOthers).toBeGreaterThan(N * 0.3); // the dominant index is forced out every third pick
  });

  it('allows a repeat when the repeated index is the only one with weight', () => {
    const r = new Rng(23);
    const g = createRepeatGuard();
    for (let i = 0; i < 10; i++) expect(weightedChoice(r, [0, 5, 0], 3, g)).toBe(1);
  });

  it('advances the stream by exactly one draw whether or not the rule bites', () => {
    const a = new Rng(24);
    const b = new Rng(24);
    const g = createRepeatGuard();
    g.last = 0;
    g.run = 2;
    weightedChoice(a, [1, 1], 2, g);
    b.next();
    expect(a.getState()).toBe(b.getState());
  });

  it('returns -1 with nothing to choose and leaves the guard alone', () => {
    const g = createRepeatGuard();
    expect(weightedChoice(new Rng(1), [0, -1], 2, g)).toBe(-1);
    expect(weightedChoice(new Rng(1), [], 0, g)).toBe(-1);
    expect(g).toEqual({ last: -1, run: 0 });
  });

  it('is deterministic per seed', () => {
    const run = (seed: number): number[] => {
      const r = new Rng(seed);
      const g = createRepeatGuard();
      const out: number[] = [];
      for (let i = 0; i < 40; i++) out.push(weightedChoice(r, [2, 1, 1, 4], 4, g));
      return out;
    };
    expect(run(5)).toEqual(run(5));
    expect(run(5)).not.toEqual(run(6));
  });
});

describe('no allocation per draw', () => {
  it('the distribution and stream modules contain no allocating syntax in their draw paths', () => {
    for (const name of ['dist.ts', 'rngStreams.ts']) {
      const src = readFileSync(join(import.meta.dirname, name), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // `new` appears only in the factories and the EnemyStreams constructor fields, never in a draw.
      const news = src.match(/\bnew\s+\w+/g) ?? [];
      expect(news.every((n) => n === 'new Rng')).toBe(true);
      expect(/=>|\bfunction\s*\(|\.map\(|\.slice\(|\.concat\(|\.\.\./.test(src)).toBe(false);
    }
  });

  it('draw functions allocate no heap across 200k draws', () => {
    const r = new Rng(1);
    const g = createRepeatGuard();
    const w = new Float64Array([1, 2, 3]);
    const run = (): number => {
      let acc = 0;
      for (let i = 0; i < 200_000; i++) {
        acc += exGaussian(r, 300, 40, 100) + lognormal(r, 0.6, 0.3) + exponential(r, 1) + normal(r);
        acc += exGaussianTruncated(r, 270, 30, 85, 0, 250, Infinity) + weightedChoice(r, w, 3, g);
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
    // 200k iterations x 6 draws would be tens of MB if each boxed a number or made an object.
    expect(grown).toBeLessThan(8 * 1024 * 1024);
  });
});
