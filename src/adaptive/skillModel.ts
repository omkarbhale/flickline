/**
 * # Skill model (design §9)
 *
 * **Scale.** Ability θ and difficulty share one 0–100 *dial* scale (shown rating = dial × 30).
 * Every target engagement is a *trial* on an item of difficulty d (the dial in force when the
 * item spawned) and either succeeds or fails. Modes report trials (the `skillTrial` event of
 * design §14.3, or `MatchedDifficulty.recordOutcome` in `difficulty.ts`).
 *
 * **Posterior.** Per skill we keep a grid posterior over θ ∈ {0, 0.5, …, 100} (201 points, one
 * Float64Array for all seven skills). A trial multiplies it by a logistic likelihood
 * p(success | θ) = σ((θ − d)/s) with an asymmetric scale: s = 8 for successes, 10 for failures, so
 * the estimate climbs faster than it falls (§9.3.3). After each update the grid gets a small
 * random-walk blur (`driftPerTrial`, our addition) so a long history never freezes the rating.
 * `rating` = posterior mean, `confidence` = posterior s.d. (shown as a band).
 *
 * **Priors and correlation.** The prior is a Gaussian (self-report mean 15/35/55/75, skip 40,
 * s.d. 25; §9.2). A skill that has not been played yet keeps that s.d. but its mean moves
 * `correlation` (40 %) of the way from the prior to the mean rating of the played skills, so the
 * placement run initialises all seven and each skill sharpens on its own once it is first played.
 *
 * **Placement.** `Staircase` (staircase.ts) picks the dial of each placement item: 2-up/1-down,
 * step 16 → 8 → 4 → 2. The trials feed the posterior as usual; `finishPlacement` then keeps the
 * posterior mean within ±`sanityBound` of the staircase's own estimate.
 *
 * **Steady state.** `dialFor(mode, beatIndex, wave)` is called once per beat (10 s in drills, a
 * contact in Sweep). It aims the *matched dial* at the mode's target success rate
 * (θ − s·logit(p): 70 % for every mode, `config/dial.ts`), moves it by at most ±3 per beat, resets it to the target
 * at beat 0 (a new run), and adds the wave-curve offset for that beat (warm-up −8 … peak +6,
 * breather −6). It reads only the posterior and the beat index, never the last few shots.
 *
 * **Elsewhere.** Axis mapping, fairness floors and tiers: `dial.ts`. Numbers: `config/dial.ts`.
 * Persistence and rank state (#38), applying axes to modes and enemies (#22) and balance (#53)
 * are not here.
 * `serialize()` is a compact JSON-safe snapshot (8-bit log-probability grids, base64), < 4 kB.
 */
import { SKILL_IDS, type DialTunables, type SelfReport, type SkillId } from '../config/dial';
import { tunables } from '../config/tunables';
import { clamp } from '../core/math';
import { DIAL_MAX, DIAL_MIN, successOffset } from './dial';
import type { Staircase } from './staircase';

export interface SkillPrior {
  mean: number;
  sd: number;
}

/** One resolved item. `itemDifficulty` is the dial in force when the item spawned. */
export interface SkillTrial {
  itemDifficulty: number;
  success: boolean;
}

/** The fields of the `skillTrial` event (design §14.3) the model reads; extra fields are ignored. */
export interface SkillTrialEvent extends SkillTrial {
  skill: string;
}

/**
 * Serialised form (JSON-safe). `prior` is [mean, s.d.]; only played skills are stored (`n` trials,
 * `p` = base64 of one byte per grid point); unplayed ones are rebuilt from the prior.
 */
export interface SkillSnapshot {
  v: 1;
  grid: number;
  prior: [number, number];
  skills: Partial<Record<SkillId, { n: number; p: string }>>;
}

const SNAPSHOT_VERSION = 1;
/** Quantisation of ln(p / p_max): one byte covers e^0 … e^-40. */
const LOG_RANGE = 40;
const Q = 255 / LOG_RANGE;

interface ModeSchedule {
  beat: number;
  matched: number;
}

export function skillIndex(skill: string): number {
  return (SKILL_IDS as readonly string[]).indexOf(skill);
}

/** Wave offset for a beat: index 0 is the warm-up; later beats cycle through indices 1.. . */
export function waveOffset(curve: readonly number[], beatIndex: number): number {
  const n = curve.length;
  if (n === 0) return 0;
  const i = beatIndex < 0 ? 0 : Math.floor(beatIndex);
  if (i < n) return curve[i];
  if (n === 1) return curve[0];
  return curve[1 + ((i - 1) % (n - 1))];
}

export class SkillState {
  private readonly n: number;
  /** Dial units per grid cell. */
  private readonly h: number;
  /** SKILL_IDS.length grids of `n` points, normalised to sum 1. */
  private readonly grid: Float64Array;
  private readonly counts = new Uint32Array(SKILL_IDS.length);
  private readonly schedule = new Map<string, ModeSchedule>();
  private readonly priorMean: number;
  private readonly priorSd: number;
  /** Unplayed skills' grids are rebuilt lazily, on the first read after a trial. */
  private unplayedStale = false;

  constructor(
    prior: SkillPrior | SelfReport = 'skip',
    private readonly cfg: DialTunables = tunables.dial,
  ) {
    this.n = Math.max(2, Math.floor(cfg.gridPoints));
    this.h = (DIAL_MAX - DIAL_MIN) / (this.n - 1);
    this.grid = new Float64Array(SKILL_IDS.length * this.n);
    const p = typeof prior === 'string' ? { mean: cfg.priorMean[prior], sd: cfg.priorSd } : prior;
    this.priorMean = clamp(p.mean, DIAL_MIN, DIAL_MAX);
    this.priorSd = Math.max(p.sd, this.h);
    for (let k = 0; k < SKILL_IDS.length; k++) this.setGaussian(k, this.priorMean, this.priorSd);
  }

  /** Update `skill`'s posterior with one trial; unplayed skills follow (see the header). */
  observe(skill: SkillId, trial: SkillTrial): void {
    const k = skillIndex(skill);
    if (k < 0) return;
    const d = trial.itemDifficulty;
    if (!Number.isFinite(d)) return;
    if (this.counts[k] === 0) this.syncUnplayed();
    this.update(k, d, trial.success);
    this.counts[k]++;
    this.unplayedStale = true;
  }

  /** Feed a `skillTrial` event payload; returns false (and ignores it) for an unknown skill. */
  observeTrial(e: SkillTrialEvent): boolean {
    if (skillIndex(e.skill) < 0) return false;
    this.observe(e.skill as SkillId, e);
    return true;
  }

  /** Posterior mean on the dial scale; 'line' = mean of the seven (Line Rating, design §8.4). */
  rating(skill: SkillId | 'line'): number {
    this.syncUnplayed();
    if (skill === 'line') {
      let sum = 0;
      for (let k = 0; k < SKILL_IDS.length; k++) sum += this.mean(k);
      return sum / SKILL_IDS.length;
    }
    const k = skillIndex(skill);
    return k < 0 ? NaN : this.mean(k);
  }

  /** Posterior s.d. in dial points (smaller = more certain); 'line' = s.d. of the mean. */
  confidence(skill: SkillId | 'line'): number {
    this.syncUnplayed();
    if (skill === 'line') {
      let v = 0;
      for (let k = 0; k < SKILL_IDS.length; k++) v += this.variance(k);
      return Math.sqrt(v) / SKILL_IDS.length;
    }
    const k = skillIndex(skill);
    return k < 0 ? NaN : Math.sqrt(this.variance(k));
  }

  /** Trials observed directly on `skill` (0 = never played). */
  trialCount(skill: SkillId): number {
    const k = skillIndex(skill);
    return k < 0 ? 0 : this.counts[k];
  }

  /** Dial at which the expected success rate is `targetSuccess` for the current estimate. */
  targetDial(skill: SkillId | 'line', targetSuccess: number): number {
    return clamp(this.rating(skill) - successOffset(targetSuccess, this.cfg.scale), DIAL_MIN, DIAL_MAX);
  }

  /**
   * The dial for `beatIndex` of the current run of `mode` (design §9.3.2). Call it once at each beat
   * boundary and keep the value for the beat. Beat 0 (or any index lower than the last) starts a
   * new run aimed straight at the target (so call beat 0 once per run); later beats move at most
   * `beat.maxStep` per beat, and repeating a later index returns the same value.
   */
  dialFor(mode: string, beatIndex: number, waveCurve: readonly number[] = this.cfg.waves.drill): number {
    const def = this.cfg.modes[mode];
    if (!def) throw new Error(`skill model: unknown mode "${mode}"`);
    const beat = Math.floor(beatIndex);
    let s = this.schedule.get(mode);
    if (!s) {
      s = { beat: -1, matched: 0 };
      this.schedule.set(mode, s);
    }
    if (s.beat < 0 || beat <= 0 || beat < s.beat) {
      s.matched = this.targetDial(def.skill, def.targetSuccess);
      s.beat = beat;
    } else if (beat > s.beat) {
      const max = this.cfg.beat.maxStep * (beat - s.beat);
      const target = this.targetDial(def.skill, def.targetSuccess);
      s.matched = clamp(s.matched + clamp(target - s.matched, -max, max), DIAL_MIN, DIAL_MAX);
      s.beat = beat;
    }
    return clamp(s.matched + waveOffset(waveCurve, beat), DIAL_MIN, DIAL_MAX);
  }

  /** The matched dial of `mode`'s current run before the wave offset (NaN before the first beat). */
  matchedDial(mode: string): number {
    const s = this.schedule.get(mode);
    return s ? s.matched : NaN;
  }

  /**
   * End of the placement run: if the staircase has enough reversals and the posterior mean lies
   * more than `sanityBound` from the staircase's estimate, shift the posterior to that bound.
   * Returns the resulting rating.
   */
  finishPlacement(skill: SkillId, staircase: Staircase): number {
    const k = skillIndex(skill);
    if (k < 0) return NaN;
    this.syncUnplayed();
    const est = staircase.abilityEstimate();
    if (Number.isFinite(est)) {
      const b = this.cfg.staircase.sanityBound;
      const m = this.mean(k);
      const goal = clamp(m, est - b, est + b);
      if (goal !== m) this.shift(k, Math.round((goal - m) / this.h));
    }
    return this.mean(k);
  }

  serialize(): SkillSnapshot {
    const skills: SkillSnapshot['skills'] = {};
    for (let k = 0; k < SKILL_IDS.length; k++) {
      if (this.counts[k] > 0) skills[SKILL_IDS[k]] = { n: this.counts[k], p: this.encode(k) };
    }
    return { v: SNAPSHOT_VERSION, grid: this.n, prior: [this.priorMean, this.priorSd], skills };
  }

  /**
   * Rebuild from `serialize()` output. Returns null for anything malformed or from another grid
   * size (the persistence layer then starts a fresh profile).
   */
  static deserialize(data: unknown, cfg: DialTunables = tunables.dial): SkillState | null {
    if (typeof data !== 'object' || data === null) return null;
    const snap = data as Partial<SkillSnapshot>;
    if (snap.v !== SNAPSHOT_VERSION || typeof snap.skills !== 'object' || snap.skills === null) return null;
    const pr = snap.prior;
    if (!Array.isArray(pr) || pr.length !== 2 || !Number.isFinite(pr[0]) || !(pr[1] > 0)) return null;
    const state = new SkillState({ mean: pr[0], sd: pr[1] }, cfg);
    if (snap.grid !== state.n) return null;
    for (let k = 0; k < SKILL_IDS.length; k++) {
      const entry = (snap.skills as Record<string, unknown>)[SKILL_IDS[k]];
      if (entry === undefined) continue;
      if (typeof entry !== 'object' || entry === null) return null;
      const { n, p } = entry as { n?: unknown; p?: unknown };
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || typeof p !== 'string') return null;
      if (!state.decode(k, p)) return null;
      state.counts[k] = n;
    }
    state.unplayedStale = true;
    return state;
  }

  // --- internals ---------------------------------------------------------------------------

  /**
   * Gaussian prior of s.d. `sd` cut to the 0–100 grid, with its centre solved (Newton steps on the
   * truncated mean, d mean / d centre = variance / sd²) so the grid's mean is exactly `mean`:
   * a "new" player's prior must average 15, not the 25 a naive cut would give.
   */
  private setGaussian(k: number, mean: number, sd: number): void {
    const s = Math.max(sd, this.h);
    const want = clamp(mean, DIAL_MIN + this.h, DIAL_MAX - this.h);
    let centre = want;
    for (let it = 0; it < 12; it++) {
      this.fillGaussian(k, centre, s);
      const err = want - this.mean(k);
      if (Math.abs(err) < 1e-4) break;
      const slope = Math.max(0.05, this.variance(k) / (s * s));
      centre += err / slope;
    }
  }

  private fillGaussian(k: number, centre: number, sd: number): void {
    const o = k * this.n;
    for (let i = 0; i < this.n; i++) {
      const z = (i * this.h - centre) / sd;
      this.grid[o + i] = Math.exp(-0.5 * z * z);
    }
    this.normalise(k);
  }

  /**
   * Unplayed skills: Gaussian(prior mean + correlation × (mean played rating − prior mean), prior
   * s.d.). Built once and copied to each unplayed skill, and only when one is read.
   */
  private syncUnplayed(): void {
    if (!this.unplayedStale) return;
    this.unplayedStale = false;
    let played = 0;
    let sum = 0;
    let first = -1;
    for (let k = 0; k < SKILL_IDS.length; k++) {
      if (this.counts[k] > 0) {
        played++;
        sum += this.mean(k);
      } else if (first < 0) first = k;
    }
    if (played === 0 || first < 0) return;
    const mean = this.priorMean + this.cfg.correlation * (sum / played - this.priorMean);
    this.setGaussian(first, mean, this.priorSd);
    const g = this.grid;
    const n = this.n;
    for (let k = first + 1; k < SKILL_IDS.length; k++) {
      if (this.counts[k] === 0) g.copyWithin(k * n, first * n, first * n + n);
    }
  }

  private update(k: number, d: number, success: boolean): void {
    const g = this.grid;
    const o = k * this.n;
    const s = success ? this.cfg.scaleSuccess : this.cfg.scaleFailure;
    const sign = success ? -1 : 1;
    for (let i = 0; i < this.n; i++) {
      // success: σ((θ−d)/s) = 1/(1+e^{−(θ−d)/s}); failure: 1/(1+e^{(θ−d)/s})
      const like = 1 / (1 + Math.exp((sign * (i * this.h - d)) / s));
      g[o + i] *= like;
    }
    this.normalise(k);
    this.drift(k);
  }

  /** Random-walk blur with variance driftPerTrial² (reflecting edges, mass-preserving, in place). */
  private drift(k: number): void {
    const sd = this.cfg.driftPerTrial;
    if (!(sd > 0)) return;
    const total = (sd * sd) / (2 * this.h * this.h);
    const passes = Math.ceil(total / 0.25);
    const a = total / passes;
    const g = this.grid;
    const o = k * this.n;
    const last = this.n - 1;
    for (let p = 0; p < passes; p++) {
      let prev = g[o];
      for (let i = 0; i <= last; i++) {
        const cur = g[o + i];
        const next = i < last ? g[o + i + 1] : cur;
        g[o + i] = a * prev + (1 - 2 * a) * cur + a * next;
        prev = cur;
      }
    }
  }

  private normalise(k: number): void {
    const g = this.grid;
    const o = k * this.n;
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += g[o + i];
    if (!(sum > 0) || !Number.isFinite(sum)) {
      // Cannot happen with finite inputs; recover to a flat prior rather than poison the grid.
      for (let i = 0; i < this.n; i++) g[o + i] = 1 / this.n;
      return;
    }
    const inv = 1 / sum;
    for (let i = 0; i < this.n; i++) g[o + i] *= inv;
  }

  private mean(k: number): number {
    const g = this.grid;
    const o = k * this.n;
    let m = 0;
    for (let i = 0; i < this.n; i++) m += g[o + i] * i * this.h;
    return m;
  }

  private variance(k: number): number {
    const g = this.grid;
    const o = k * this.n;
    const m = this.mean(k);
    let v = 0;
    for (let i = 0; i < this.n; i++) {
      const x = i * this.h - m;
      v += g[o + i] * x * x;
    }
    return v;
  }

  /** Move skill `k`'s posterior by `cells` grid cells (mass pushed past an edge piles up there). */
  private shift(k: number, cells: number): void {
    if (cells === 0) return;
    const g = this.grid;
    const o = k * this.n;
    const n = this.n;
    if (cells > 0) {
      for (let i = n - 1; i >= 0; i--) {
        const src = i - cells;
        if (i === n - 1) {
          let acc = 0;
          for (let j = Math.max(0, src); j < n; j++) acc += g[o + j];
          g[o + i] = acc;
        } else g[o + i] = src >= 0 ? g[o + src] : 0;
      }
    } else {
      const c = -cells;
      for (let i = 0; i < n; i++) {
        const src = i + c;
        if (i === 0) {
          let acc = 0;
          for (let j = 0; j <= Math.min(n - 1, src); j++) acc += g[o + j];
          g[o + i] = acc;
        } else g[o + i] = src < n ? g[o + src] : 0;
      }
    }
    this.normalise(k);
  }

  private encode(k: number): string {
    const g = this.grid;
    const o = k * this.n;
    let max = 0;
    for (let i = 0; i < this.n; i++) if (g[o + i] > max) max = g[o + i];
    let bin = '';
    for (let i = 0; i < this.n; i++) {
      const p = g[o + i];
      const q = p > 0 ? Math.min(255, Math.round(-Math.log(p / max) * Q)) : 255;
      bin += String.fromCharCode(q);
    }
    return btoa(bin);
  }

  private decode(k: number, b64: string): boolean {
    let bin: string;
    try {
      bin = atob(b64);
    } catch {
      return false;
    }
    if (bin.length !== this.n) return false;
    const o = k * this.n;
    for (let i = 0; i < this.n; i++) this.grid[o + i] = Math.exp(-bin.charCodeAt(i) / Q);
    this.normalise(k);
    return true;
  }
}
