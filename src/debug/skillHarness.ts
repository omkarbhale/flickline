import { SectorDial } from '../adaptive/sectorDial';
import { SkillState } from '../adaptive/skillModel';
import { SKILL_IDS, type SelfReport, type SkillId } from '../config/dial';
import type { Tunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { sweepPlan } from '../modes/sweep';
import { perSector, type RunPlan } from '../modes/sweepDirector';

/**
 * The run-level simulated-player harness of design §9.6 (#203). A simulated player of known ability
 * plays whole Sweep runs: the real plan of each seed (sectors, the placing Opener, contacts, cards,
 * Echo counts), the real sector dial (`SectorDial`, the same `enterSector` decision the mode makes)
 * and the real posterior (`SkillState`). Only the fights are abstract: each contact's outcome and
 * trials are drawn from the player's ability against the item difficulty, so the harness checks the
 * control loop (placement, the ±3 per sector, the depth curve, the run-to-run reset), not the
 * game's balance (that is the bot report and #53).
 *
 * The player: in a contact of difficulty d (the sector dial plus the card's offset) it performs at
 * θ + ε, ε ~ N(0, `noiseSd`) shared by the contact (a good fight is good all through); it wins with
 * probability σ((θ + ε − d)/9), and wins *clean* (the staircase's "without losing half the shield")
 * with σ((θ + ε − d − cleanMargin)/9) given the same draw. Each trial the contact yields succeeds with
 * σ((θ_skill + ε − d)/9). A lost contact ends the run with probability `deathOnLoss`.
 */

/** Trials a contact yields, by skill (expected counts; drawn per contact). Shaped on the bot sample, with a human's pre-aim. */
export interface TrialMix {
  /** Per Echo: share of first shots that are precision items (the rest are flicks). */
  precisionShare: number;
  /** Per strafing Echo, per Echo: a track item, a footwork item. */
  trackPerStrafer: number;
  footworkPerEcho: number;
  /** Per contact: a spray item. Per extra Echo in the contact: a switch item. */
  sprayPerContact: number;
  switchPerExtraEcho: number;
}

export interface HarnessOptions {
  /** The self-report that set the new profile's prior. */
  prior: SelfReport;
  runs: number;
  seed: number;
  /** Ability per skill, offsets from `ability` (default 0 for every skill). */
  skillOffsets?: Partial<Record<SkillId, number>>;
  /** Per-contact performance noise, dial points (default 4, as the drill harness). */
  noiseSd?: number;
  /** A lost contact ends the run with this probability (default 0.3; a lost fight is often a retreat, design §8.1). */
  deathOnLoss?: number;
  /** Share of planned contacts that open at all (default 0.85: some Echoes are walked past unseen). */
  openShare?: number;
  /** Dial points a win must clear the item by to keep half the shield (default 4). */
  cleanMargin?: number;
  /** Trials per contact (default: shaped on the bot sample). */
  mix?: Partial<TrialMix>;
  /** Run plans come from seeds 1..planPool, cycled (default 24). */
  planPool?: number;
  /** A change of ability after this many runs (a player who improves or declines). */
  abilityAfter?: { runs: number; ability: number };
}

const TRUE_SCALE = 9;
const DEFAULT_MIX: TrialMix = { precisionShare: 0.5, trackPerStrafer: 0.6, footworkPerEcho: 0.7, sprayPerContact: 0.3, switchPerExtraEcho: 0.6 };

/** One contact as the harness played it. */
export interface HarnessContact {
  sector: number;
  opener: boolean;
  difficulty: number;
  /** The player's chance of winning it (before the contact's noise): σ((θ − d)/9). */
  pWin: number;
  won: boolean;
  trials: number;
}

/** One run. */
export interface HarnessRun {
  placing: boolean;
  /** Dial of each sector entered and the matched dial behind it (NaN in the staircase's sectors). */
  dials: number[];
  matched: number[];
  /** The skill model's matched target (θ_est − s·logit 0.7) when the run started, and the estimate it came from. */
  startTarget: number;
  startEstimate: number;
  /** The estimate when the placing Opener ended (NaN if the run did not place, or died in it). */
  estimateAfterOpener: number;
  estimateEnd: number;
  contacts: HarnessContact[];
  died: boolean;
}

/**
 * Plans by (seed, placing), built once: a plan is the run's structure (which sectors, contacts, cards,
 * Echoes), and building one walks the maps' sight lines. `planPool` seeds are cycled, so the harness's
 * variety comes from its own stream while the structures stay the game's.
 */
const plans = new Map<string, RunPlan>();
function planOf(seed: number, placing: boolean, tunables: Tunables): RunPlan {
  const key = `${seed}|${placing ? 1 : 0}`;
  let p = plans.get(key);
  if (!p) {
    p = sweepPlan(seed, tunables, placing);
    plans.set(key, p);
  }
  return p;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

/** Draw an integer count with expectation `mean` (floor plus a Bernoulli on the fraction). */
function countOf(r: Rng, mean: number): number {
  const f = Math.floor(mean);
  return f + (r.next() < mean - f ? 1 : 0);
}

/**
 * One profile, `runs` runs in a row on seeds `seed`, `seed + 1`, ...: the first places it. The
 * estimate is `SkillState.fightRating()`, the one the dial follows.
 */
export function simulateProfile(ability: number, opts: HarnessOptions, tunables: Tunables): HarnessRun[] {
  const rng = new Rng((opts.seed * 2654435761) >>> 0);
  const skills = new SkillState(opts.prior, tunables.dial);
  const mix = { ...DEFAULT_MIX, ...opts.mix };
  const noiseSd = opts.noiseSd ?? 4;
  const deathOnLoss = opts.deathOnLoss ?? 0.3;
  const openShare = opts.openShare ?? 0.85;
  const cleanMargin = opts.cleanMargin ?? 4;
  const dialCfg = tunables.dial;
  const sweepDef = dialCfg.modes.sweep!;
  const out: HarnessRun[] = [];
  let theta = ability;
  for (let run = 0; run < opts.runs; run++) {
    if (opts.abilityAfter && run === opts.abilityAfter.runs) theta = opts.abilityAfter.ability;
    const thetaOf = (s: SkillId): number => theta + (opts.skillOffsets?.[s] ?? 0);
    let placing = true;
    for (const s of SKILL_IDS) if (skills.trialCount(s) > 0) placing = false;
    const plan = planOf(1 + ((opts.seed + run) % (opts.planPool ?? 24)), placing, tunables);
    const sd = new SectorDial(dialCfg);
    const target = (): number => skills.targetDial(sweepDef.skill, sweepDef.targetSuccess);
    const r: HarnessRun = {
      placing, dials: [], matched: [], startTarget: target(), startEstimate: skills.fightRating(), estimateAfterOpener: NaN, estimateEnd: NaN,
      contacts: [], died: false,
    };
    let fought = 0;
    let sector = 0;
    while (sector < plan.sectors.length && !r.died) {
      const sp = plan.sectors[sector]!;
      if (!sp.opener && sd.placing) r.estimateAfterOpener = skills.fightRating();
      const offset = perSector(tunables.sweep.dialOffset, sp.depth);
      const dial = sd.enterSector(sector, sp.opener, sp.opener && sd.placing ? NaN : target(), offset, placing);
      r.dials.push(dial);
      r.matched.push(sd.placing ? NaN : sd.matched);
      for (const cp of sp.contacts) {
        if (rng.next() >= openShare) continue;
        const d = dial + tunables.trials.cardOffset[cp.card];
        const eps = noiseSd * gauss(rng);
        const z = (theta + eps - d) / TRUE_SCALE;
        // One draw decides the fight: won if it clears the item, clean if it clears it by the margin.
        const u = rng.next();
        const won = u < sigmoid(z);
        const clean = u < sigmoid(z - cleanMargin / TRUE_SCALE);
        let trials = 0;
        const trial = (s: SkillId): void => {
          skills.observe(s, { itemDifficulty: d, success: rng.next() < sigmoid((thetaOf(s) + eps - d) / TRUE_SCALE) });
          trials++;
        };
        trial('angles');
        const echoes = cp.echoes.length;
        for (const e of cp.echoes) {
          trial(rng.next() < mix.precisionShare ? 'precision' : 'flick');
          const strafing = e.kind === 'strafer' && !!e.laneA && !!e.laneB && (e.laneA.x !== e.laneB.x || e.laneA.z !== e.laneB.z);
          if (strafing) for (let k = countOf(rng, mix.trackPerStrafer); k > 0; k--) trial('track');
          for (let k = countOf(rng, mix.footworkPerEcho); k > 0; k--) trial('footwork');
        }
        for (let k = countOf(rng, mix.sprayPerContact); k > 0; k--) trial('spray');
        for (let k = countOf(rng, mix.switchPerExtraEcho * Math.max(0, echoes - 1)); k > 0; k--) trial('switch');
        skills.observeFight(d, won);
        r.contacts.push({ sector, opener: sp.opener, difficulty: d, pWin: sigmoid((theta - d) / TRUE_SCALE), won, trials });
        if (sp.opener && sd.placing) {
          fought++;
          sd.recordOpener(!won ? 'loss' : clean ? 'win' : 'neutral');
        }
        if (!won && rng.next() < deathOnLoss) {
          r.died = true;
          break;
        }
      }
      // The next sector: a placing Opener that fought enough skips its remaining contact sectors (as `sweep.ts`).
      let next = sector + 1;
      const op = tunables.sweep.opener;
      if (sp.opener && sd.openerDone(fought, op.contactsMin, op.contactsMax)) while (next < plan.sectors.length && plan.sectors[next]!.opener) next++;
      sector = next;
    }
    if (placing && Number.isNaN(r.estimateAfterOpener) && !r.died) r.estimateAfterOpener = skills.fightRating();
    r.estimateEnd = skills.fightRating();
    out.push(r);
  }
  return out;
}

/** The matched target for a true ability: where a perfect estimate would aim the dial. */
export function trueTarget(ability: number, tunables: Tunables): number {
  const p = tunables.dial.modes.sweep!.targetSuccess;
  return Math.min(100, Math.max(0, ability - tunables.dial.scale * Math.log(p / (1 - p))));
}

/** The checks of design §9.6 for one simulated population: one ability, one self-report, many seeds. */
export interface HarnessRow {
  ability: number;
  prior: SelfReport;
  seeds: number;
  /** Estimate error (estimate − ability) at the end of the first Opener: median of |error|, share within ±8, mean. */
  openerMedianAbs: number;
  openerWithin8: number;
  openerBias: number;
  /** The same after three runs (share within ±4). */
  run3MedianAbs: number;
  run3Within4: number;
  run3Bias: number;
  /** Run 2's starting matched dial minus where the dial settles (mean matched dial of the session): the #171 overshoot. p90 and median. */
  run2OvershootP90: number;
  run2OvershootMedian: number;
  /** A 30-minute session after three runs: expected contact win rate (mean of σ((θ − d)/9)), pooled and per-session share inside 60–80 %. */
  sessionWinMean: number;
  sessionWinInBand: number;
  /** Realised contact win rate, pooled over every session. */
  sessionWinRealised: number;
  /** Share of sessions whose matched dial stays within ±4 of the session's mean, and the largest step between two sectors of a run. */
  sessionSteady: number;
  maxSectorStep: number;
}

/** Runs before the session (placement and settling), and runs in a 30-minute session (v0: four sectors, ~7 contacts, ~3.5 min a run). */
export const SETTLE_RUNS = 3;
export const SESSION_RUNS = 8;

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length === 0 ? NaN : s[(s.length - 1) >> 1]!;
}
function quantile(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length === 0 ? NaN : s[Math.floor(p * (s.length - 1))]!;
}
function mean(a: number[]): number {
  return a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length;
}

/** Simulate `seeds` profiles of `ability` with self-report `prior` and measure the §9.6 checks. */
export function harnessRow(ability: number, prior: SelfReport, seeds: number, tunables: Tunables, firstSeed = 1): HarnessRow {
  const opener: number[] = [], run3: number[] = [], over: number[] = [], winExp: number[] = [];
  let won = 0, fought = 0, steady = 0, maxStep = 0;
  for (let i = 0; i < seeds; i++) {
    const runs = simulateProfile(ability, { prior, runs: SETTLE_RUNS + SESSION_RUNS, seed: (firstSeed + i) * 7919 + ability }, tunables);
    const r0 = runs[0]!;
    if (!Number.isNaN(r0.estimateAfterOpener)) opener.push(r0.estimateAfterOpener - ability);
    run3.push(runs[SETTLE_RUNS - 1]!.estimateEnd - ability);
    const session = runs.slice(SETTLE_RUNS);
    const matched = session.flatMap((r) => r.matched.filter((m) => !Number.isNaN(m)));
    const settled = mean(matched);
    over.push(runs[1]!.startTarget - settled);
    if (matched.every((m) => Math.abs(m - settled) <= 4)) steady++;
    let p = 0, n = 0;
    for (const r of session) {
      for (const c of r.contacts) {
        p += c.pWin;
        n++;
        fought++;
        if (c.won) won++;
      }
    }
    winExp.push(n ? p / n : NaN);
    for (const r of runs) {
      for (let k = 1; k < r.matched.length; k++) {
        const a = r.matched[k - 1]!, b = r.matched[k]!;
        if (!Number.isNaN(a) && !Number.isNaN(b)) maxStep = Math.max(maxStep, Math.abs(b - a));
      }
    }
  }
  const abs = (a: number[]): number[] => a.map(Math.abs);
  const share = (a: number[], f: (x: number) => boolean): number => (a.length ? a.filter(f).length / a.length : NaN);
  return {
    ability, prior, seeds,
    openerMedianAbs: median(abs(opener)), openerWithin8: share(opener, (e) => Math.abs(e) <= 8), openerBias: mean(opener),
    run3MedianAbs: median(abs(run3)), run3Within4: share(run3, (e) => Math.abs(e) <= 4), run3Bias: mean(run3),
    run2OvershootP90: quantile(over, 0.9), run2OvershootMedian: median(over),
    sessionWinMean: mean(winExp), sessionWinInBand: share(winExp, (w) => w >= 0.6 && w <= 0.8), sessionWinRealised: fought ? won / fought : NaN,
    sessionSteady: steady / seeds, maxSectorStep: maxStep,
  };
}

/** The self-report a player of `ability` would most likely give (the prior mean nearest to it). */
export function selfReportFor(ability: number, tunables: Tunables): SelfReport {
  const m = tunables.dial.priorMean;
  let best: SelfReport = 'new';
  for (const k of ['new', 'some', 'experienced', 'competitive'] as const) if (Math.abs(m[k] - ability) < Math.abs(m[best] - ability)) best = k;
  return best;
}

/** The harness table posted on #203: one row per population. */
export function formatHarness(rows: readonly HarnessRow[]): string[] {
  const pct = (x: number): string => `${Math.round(x * 100)} %`;
  const f1 = (x: number): string => (Number.isNaN(x) ? '—' : x.toFixed(1));
  const out = [
    '| Ability | Self-report | After first Opener: median abs error · within ±8 · bias | After 3 runs: median abs error · within ±4 · bias | Run-2 start − settled dial: median · p90 | Session win rate: expected · sessions in 60–80 % · realised | Sessions within ±4 | Max step / sector |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.ability} | ${r.prior} | ${f1(r.openerMedianAbs)} · ${pct(r.openerWithin8)} · ${f1(r.openerBias)} | ${f1(r.run3MedianAbs)} · ${pct(r.run3Within4)} · ${f1(r.run3Bias)} | ${f1(r.run2OvershootMedian)} · ${f1(r.run2OvershootP90)} | ${pct(r.sessionWinMean)} · ${pct(r.sessionWinInBand)} · ${pct(r.sessionWinRealised)} | ${pct(r.sessionSteady)} | ${f1(r.maxSectorStep)} |`,
    );
  }
  return out;
}
