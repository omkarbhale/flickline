import { coldOpener as coldCfg, type ColdOpenerTunables } from '../config/coldOpener';
import type { DialTunables } from '../config/dial';
import { tunables } from '../config/tunables';
import { DIAL_MAX, DIAL_MIN, displayRating } from './dial';

/**
 * The cold opener's number (design §8.5, `docs/research/transfer.md` §5.5): for each skill, an
 * estimate from the cold opener's own trials alone, a grid posterior with a **flat prior** and the
 * symmetric logistic scale `s` (`p = σ((θ − d)/s)`, design §9.1). It never reads or writes the
 * matched posterior, so the cold opener is an independent measurement. The **cold score** is the mean
 * of the skills' estimates, on the rating scale. Pure.
 */

/** One trial as the estimate needs it (a `skillTrial` payload satisfies it). */
export interface ColdTrialLike {
  readonly skill: string;
  readonly itemDifficulty: number;
  readonly success: boolean;
}

/** One skill's flat-prior estimate: posterior mean and s.d. on the dial scale, and its trial count. */
export interface SkillEstimate {
  mean: number;
  sd: number;
  n: number;
}

export interface ColdScore {
  /** Skill -> its estimate, for every skill with at least one trial. */
  skills: Record<string, SkillEstimate>;
  /** Mean of the skills' estimates, dial scale (NaN without trials). */
  dial: number;
  /** The same on the rating scale (the cold score, design §8.5). */
  score: number;
  trials: number;
}

/** Scratch grid of log-likelihoods, reused (estimates run once per cold opener, never per frame). */
let logLik = new Float64Array(0);

/**
 * Flat-prior grid posterior over θ ∈ [0, 100] from `trials` (only those of `skill` when given):
 * the posterior mean and s.d. on the dial scale. No trial: the flat prior itself (mean 50).
 */
export function flatPriorEstimate(trials: readonly ColdTrialLike[], skill: string | null, cfg: Pick<ColdOpenerTunables, 'scale' | 'gridPoints'> = coldCfg): SkillEstimate {
  const n = Math.max(2, Math.floor(cfg.gridPoints));
  if (logLik.length !== n) logLik = new Float64Array(n);
  const h = (DIAL_MAX - DIAL_MIN) / (n - 1);
  logLik.fill(0);
  let count = 0;
  for (const tr of trials) {
    if (skill !== null && tr.skill !== skill) continue;
    if (!Number.isFinite(tr.itemDifficulty)) continue;
    count++;
    for (let i = 0; i < n; i++) {
      const z = (DIAL_MIN + i * h - tr.itemDifficulty) / cfg.scale;
      // log σ(z) and log σ(−z), stable for large |z|.
      const lp = z >= 0 ? -Math.log1p(Math.exp(-z)) : z - Math.log1p(Math.exp(z));
      logLik[i]! += tr.success ? lp : lp - z;
    }
  }
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (logLik[i]! > max) max = logLik[i]!;
  let w = 0, m1 = 0, m2 = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.exp(logLik[i]! - max);
    const th = DIAL_MIN + i * h;
    w += p;
    m1 += p * th;
    m2 += p * th * th;
  }
  const mean = m1 / w;
  return { mean, sd: Math.sqrt(Math.max(0, m2 / w - mean * mean)), n: count };
}

/** The cold opener's per-skill estimates and its cold score (design §8.5). */
export function coldScore(trials: readonly ColdTrialLike[], cfg: Pick<ColdOpenerTunables, 'scale' | 'gridPoints' | 'aggregate'> = coldCfg, dial: DialTunables = tunables.dial): ColdScore {
  const skills: Record<string, SkillEstimate> = {};
  const names: string[] = [];
  for (const t of trials) if (!names.includes(t.skill) && Number.isFinite(t.itemDifficulty)) names.push(t.skill);
  names.sort();
  let sum = 0;
  let count = 0;
  for (const s of names) {
    const e = flatPriorEstimate(trials, s, cfg);
    skills[s] = e;
    sum += e.mean;
    count += e.n;
  }
  const mean = names.length === 0 ? Number.NaN : cfg.aggregate === 'pooled' ? flatPriorEstimate(trials, null, cfg).mean : sum / names.length;
  return { skills, dial: mean, score: Number.isFinite(mean) ? displayRating(mean, dial) : Number.NaN, trials: count };
}
