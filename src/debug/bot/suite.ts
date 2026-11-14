import { HeadlessGame } from './headless';
import { listModes, mapForMode, playMode, FREEPLAY, type BotReport, type BotRunOptions } from './play';
import type { BotParams } from './skill';

/**
 * The bot regression suite: cheap, deterministic checks that the sim, the mode framework and the
 * bot still work together. It runs every mode at a weak and a strong skill and checks that
 *  - every run ends on its own, inside the wall-clock budget (acceptance: < 5 s per run);
 *  - a seed gives the same run twice (the sim and the bot are deterministic);
 *  - a stronger bot does better than a weaker one, in every mode;
 *  - each skill parameter moves the number it is meant to (reaction -> time to shot, aim error ->
 *    accuracy, overshoot -> signed flick error, spray control -> spray accuracy).
 * `npm run bot -- --suite` prints it; `bot.test.ts` runs it under `npm test` (so CI does).
 */

export interface SuiteCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SuiteResult {
  checks: SuiteCheck[];
  reports: BotReport[];
  wallMs: number;
  ok: boolean;
}

export const SUITE_SEEDS = [1, 2, 3];
/** Wall-clock budget of one bot run, ms (acceptance criterion of #28). */
export const RUN_BUDGET_MS = 5000;

function play(opts: BotRunOptions, reports?: BotReport[]): BotReport {
  const r = playMode(new HeadlessGame({ seed: opts.seed ?? 1, map: mapForMode(opts.mode) }), opts);
  reports?.push(r);
  return r;
}

interface Totals {
  shots: number;
  hits: number;
  kills: number;
  score: number;
  rt: number;
  flickBias: number;
  runs: number;
}

/** Sum a mode over the suite seeds. */
function total(mode: string, skill: number, params: Partial<BotParams> | undefined, reports?: BotReport[]): Totals {
  const t: Totals = { shots: 0, hits: 0, kills: 0, score: 0, rt: 0, flickBias: 0, runs: 0 };
  let rts = 0;
  let biases = 0;
  for (const seed of SUITE_SEEDS) {
    const r = play({ mode, skill, seed, params, pinDial: 50 }, reports);
    t.shots += r.stats.shots;
    t.hits += r.stats.hits;
    t.kills += r.stats.kills;
    t.score += r.modeRun?.score ?? r.stats.kills;
    if (r.stats.medianRtMs !== null) { t.rt += r.stats.medianRtMs; rts++; }
    if (r.stats.flickErrorBiasDeg !== null) { t.flickBias += r.stats.flickErrorBiasDeg; biases++; }
    t.runs++;
  }
  t.rt = rts ? t.rt / rts : NaN;
  t.flickBias = biases ? t.flickBias / biases : NaN;
  return t;
}

const acc = (t: Totals): number => (t.shots ? t.hits / t.shots : 0);
const f = (n: number, d = 2): string => n.toFixed(d);

export function runSuite(): SuiteResult {
  const t0 = performance.now();
  const checks: SuiteCheck[] = [];
  const reports: BotReport[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  const modes = listModes();
  for (const mode of modes) {
    const weak = total(mode, 20, undefined, reports);
    const strong = total(mode, 90, undefined, reports);
    const slowest = Math.max(...reports.filter((r) => r.mode === mode).map((r) => r.wallMs));
    const unfinished = reports.filter((r) => r.mode === mode && !r.finished).length;
    add(`${mode}: runs end by themselves within ${RUN_BUDGET_MS} ms`, unfinished === 0 && slowest < RUN_BUDGET_MS, `slowest ${f(slowest, 0)} ms, ${unfinished} unfinished`);
    add(
      `${mode}: skill 90 beats skill 20`,
      (strong.kills > weak.kills || strong.score > weak.score) && acc(strong) >= acc(weak) - 0.05,
      `kills ${weak.kills} -> ${strong.kills}, score ${weak.score} -> ${strong.score}, accuracy ${f(acc(weak))} -> ${f(acc(strong))}`,
    );
    const a = play({ mode, skill: 50, seed: 7 });
    const b = play({ mode, skill: 50, seed: 7 });
    add(
      `${mode}: same seed, same run`,
      a.hash === b.hash && JSON.stringify(a.stats) === JSON.stringify(b.stats) && a.ticks === b.ticks,
      `hash ${a.hash} / ${b.hash}`,
    );
  }

  // One parameter at a time on free play (targets all round the Range, so flicks are long enough to measure).
  const base: Partial<BotParams> = { aimSigmaDeg: 0.03, overshootBias: 0, overshootSpread: 0.01, reactionSdSec: 0 };
  const slow = total(FREEPLAY, 70, { ...base, reactionMeanSec: 0.9 });
  const quick = total(FREEPLAY, 70, { ...base, reactionMeanSec: 0.15 });
  add('reaction delay raises time to shot', slow.rt > quick.rt + 300, `median RT ${f(quick.rt, 0)} ms (0.15 s) vs ${f(slow.rt, 0)} ms (0.9 s)`);
  const sharp = total(FREEPLAY, 70, { aimSigmaDeg: 0.02 });
  const shaky = total(FREEPLAY, 70, { aimSigmaDeg: 0.8 });
  add('aim error lowers accuracy', acc(sharp) > acc(shaky) + 0.15, `accuracy ${f(acc(shaky))} (0.8 deg) vs ${f(acc(sharp))} (0.02 deg)`);
  const over = total(FREEPLAY, 70, { ...base, overshootBias: 0.4, overshootSpread: 0.02 });
  const under = total(FREEPLAY, 70, { ...base, overshootBias: -0.4, overshootSpread: 0.02 });
  add('overshoot bias shows as signed flick error', over.flickBias > under.flickBias + 0.1, `flick bias ${f(under.flickBias)} deg (-0.4) vs ${f(over.flickBias)} deg (+0.4)`);
  const control = total(FREEPLAY, 70, { aimSigmaDeg: 0.05, burstBullets: 14, sprayControl: 1 });
  const none = total(FREEPLAY, 70, { aimSigmaDeg: 0.05, burstBullets: 14, sprayControl: 0 });
  add('spray control raises spray accuracy', acc(control) >= acc(none), `accuracy ${f(acc(none))} (control 0) vs ${f(acc(control))} (control 1)`);

  const wallMs = performance.now() - t0;
  return { checks, reports, wallMs, ok: checks.every((c) => c.ok) };
}
