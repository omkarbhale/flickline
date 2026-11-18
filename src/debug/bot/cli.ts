import { HeadlessGame } from './headless';
import { listModes, mapForMode, playMode, type BotReport, type BotRunOptions } from './play';
import { BOT_PARAM_KEYS, type BotParams } from './skill';
import { runSuite } from './suite';
import {
  formatGatePolicyReport, formatLeanAb, formatMeetReport, formatOvertimeReport, formatPaceReport, formatSweepReport, formatTrialReport, gatePolicyReport, leanAb,
  meetReport, overtimeReport, paceRow, sweepReport, trialReport, type PaceRow, type Walker,
} from './sweepReport';
import { aimReport } from './aimCalibration';
import { auditAllocations, formatAudit } from './allocAudit';
import { cloneTunables } from '../../config/tunables';
import { formatHarness, harnessRow, selfReportFor, type HarnessRow } from '../skillHarness';

/** Command line of `npm run bot` (loaded by `scripts/bot.mjs`). Returns the process exit code. */

const HELP = `npm run bot -- [options]

  --mode <id>        mode to play: ${'<modes>'} (default: sweep, the game); ids ignore case and dashes
  --skill <0..100>   bot skill (default 50); see src/debug/bot/README.md
  --seed <n>         world, mode and bot seed (default 1)
  --bot-seed <n>     bot random stream, if it should differ from --seed
  --dial <0..100>    pin the difficulty dial for the run
  --param k=v        override one skill parameter (repeatable): ${BOT_PARAM_KEYS.join(', ')}
  --runs <n>         play n seeds (seed, seed+1, ...) and print each, then the mean
  --json             print the report(s) as JSON
  --suite            run the regression suite (every mode, skill ordering, determinism, parameters)
  --alloc            audit the sim tick for allocations (see README, "Allocation audit")
  --lean-report      The lean's A/B (#210): a bot with a planted moving-shot weakness, lean off vs on, --runs per arm (default 20), --skill (default 50), --players n (default 5), --weakness share (default 0.7), --practice per fight (default 0.04), --engine planted|stub (default planted)
  --gate-report      Gate policy table (#205): policies --policies hot,read,facts,left (default) at skills 30/50/70 over --runs seeds (default 200)
  --overtime-report  Overtime depth (#206): --policies push,bank (default) at skills 30/50/70 (or --skills) over --runs seeds (default 200); push = always push on, bank = leave below 90 health+shield, leave = always leave
  --meet-report      Meet sectors (#212): win rate by who stopped first, skills 30/50/70 (or --skills) over --runs forced meet runs (default 100), --stop-delay S (default 2.5)
  --aim-report       enemy mind calibration (#90): S7 headshot share per anchor, damage per minute aimed vs rolled (--runs seeds, default 6)
  --sweep-report     Sweep balance table (#201) and fight-pace table (#248: fights per live minute, dead air, gates, for the
                     bot and a human-pace walker): skills 30/50/70 (or --skills a,b,c) over --runs seeds (default 50);
                     --walkers bot,human (default both; the balance table is the first walker's)
  --trial-report     Sweep trials from contacts (#203): per-skill trial counts per run and contacts without a trial,
                     skills 30/50/70 (or --skills) over --runs runs (default 50), --profile-runs runs per profile (default 5)
  --skill-harness    the run-level simulated-player harness of design §9.6 (#203): abilities 10..90 (or --skills),
                     each with its likely self-report and with none, over --seeds profiles (default 100)
  --list             list the modes
`;

function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    const key = a.slice(2);
    if (['json', 'suite', 'alloc', 'list', 'help', 'sweep-report', 'aim-report', 'meet-report', 'gate-report', 'overtime-report', 'lean-report', 'trial-report', 'skill-harness'].includes(key)) {
      out[key] = true;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`--${key} needs a value`);
    if (key === 'param') (out.param = (out.param as string[] | undefined) ?? []).push(v);
    else out[key] = v;
  }
  return out;
}

const pct = (n: number | null): string => (n === null ? '--' : `${(n * 100).toFixed(0)}%`);
const num = (n: number | null, d = 0): string => (n === null ? '--' : n.toFixed(d));

function formatReport(r: BotReport): string {
  const s = r.stats;
  const lines = [
    `mode ${r.mode}  skill ${r.skill}  seed ${r.seed}`,
    `  simulated ${r.simSec.toFixed(1)} s (${r.ticks} ticks) in ${r.wallMs.toFixed(0)} ms, ${r.finished ? `ended: ${s.endReason}` : 'NOT FINISHED (time limit)'}, state hash ${r.hash}`,
    `  shots ${s.shots}  hits ${s.hits}  accuracy ${pct(s.accuracy)}  head hits ${s.headHits}  kills ${s.kills} (${s.cleanKills} clean)  headshot rate ${pct(s.headshotRate)}`,
    `  time to shot (median) ${num(s.medianRtMs)} ms  time to kill (median) ${num(s.medianTtkMs)} ms  pre-aim error ${num(s.preAimErrorDeg, 1)} deg  time on target ${pct(s.timeOnTarget)}`,
    `  flick error: bias ${num(s.flickErrorBiasDeg, 2)} deg (+ overshoot), mean |error| ${num(s.flickErrorMeanAbsDeg, 2)} deg over ${s.flickCount} flicks`,
  ];
  if (r.modeRun) {
    const m = r.modeRun;
    lines.push(`  mode: score ${m.score}  trials ${m.trialsWon}/${m.trials}  dial ${m.dial.toFixed(0)}  beats ${m.beats}`);
  }
  lines.push(
    `  bot: ${r.bot.engagements} engagements, ${r.bot.flicks} flicks, ${r.bot.corrections} corrections, ${r.bot.bursts} bursts, ${r.bot.giveUps} gave up`,
  );
  return lines.join('\n');
}

export function main(argv: string[], log: (s: string) => void = console.log): number {
  let args: Record<string, string | boolean | string[]>;
  try {
    args = parseArgs(argv);
  } catch (e) {
    log(`${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const modes = listModes();
  if (args.help) {
    log(HELP.replace('<modes>', modes.join(', ')));
    return 0;
  }
  if (args.list) {
    log(modes.join('\n'));
    return 0;
  }

  if (args.suite) {
    const r = runSuite();
    if (args.json) {
      log(JSON.stringify({ ok: r.ok, wallMs: r.wallMs, checks: r.checks }, null, 2));
    } else {
      for (const c of r.checks) log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
      log(`${r.reports.length} bot runs, ${r.wallMs.toFixed(0)} ms: ${r.ok ? 'all checks pass' : 'FAILED'}`);
    }
    return r.ok ? 0 : 1;
  }

  if (args['aim-report']) {
    const t0 = performance.now();
    const seeds = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 6;
    for (const line of aimReport(seeds)) log(line);
    log(`(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    return 0;
  }

  if (args['lean-report']) {
    const t0 = performance.now();
    const r = leanAb({
      skill: args.skill !== undefined ? Number(args.skill) : 50,
      runs: args.runs !== undefined ? Math.max(2, Math.floor(Number(args.runs))) : 20,
      firstSeed: args.seed !== undefined ? Number(args.seed) : 1,
      players: args.players !== undefined ? Math.max(1, Math.floor(Number(args.players))) : 5,
      startShare: args.weakness !== undefined ? Number(args.weakness) : 0.7,
      practice: args.practice !== undefined ? Number(args.practice) : 0.04,
      engine: args.engine === 'stub' ? 'stub' : 'planted',
      pinDial: args.dial !== undefined ? Number(args.dial) : undefined,
    });
    if (args.json) log(JSON.stringify({ rows: r.rows, off: r.off.players, on: r.on.players }, null, 2));
    else {
      for (const line of formatLeanAb(r.rows)) log(line);
      log(`${(r.off.players.length + r.on.players.length) * (r.off.players[0]?.length ?? 0)} runs, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['gate-report']) {
    const skills = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [30, 50, 70];
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 200;
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const policies = typeof args.policies === 'string' ? args.policies.split(',') : undefined;
    const t0 = performance.now();
    const rows = gatePolicyReport(skills, runs, seed, policies, args.dial !== undefined ? Number(args.dial) : undefined);
    if (args.json) log(JSON.stringify(rows, null, 2));
    else {
      for (const line of formatGatePolicyReport(rows)) log(line);
      log(`${rows.length * runs} runs, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['overtime-report']) {
    const skills = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [30, 50, 70];
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 200;
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const policies = typeof args.policies === 'string' ? args.policies.split(',') : undefined;
    const t0 = performance.now();
    const r = overtimeReport(skills, runs, seed, policies, args.dial !== undefined ? Number(args.dial) : undefined);
    if (args.json) log(JSON.stringify(r.rows, null, 2));
    else {
      for (const line of formatOvertimeReport(r.rows)) log(line);
      log(`${r.runs.length} runs, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['meet-report']) {
    const skills = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [30, 50, 70];
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 100;
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const delay = args['stop-delay'] !== undefined ? Number(args['stop-delay']) : 2.5;
    const t0 = performance.now();
    const r = meetReport(skills, runs, seed, delay);
    if (args.json) log(JSON.stringify(r.rows, null, 2));
    else {
      for (const line of formatMeetReport(r.rows)) log(line);
      log(`${r.contacts.length} meet contacts, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['sweep-report']) {
    const skills = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [30, 50, 70];
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 50;
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const walkers = (typeof args.walkers === 'string' ? args.walkers.split(',') : ['bot', 'human']) as Walker[];
    const bad = walkers.find((w) => w !== 'bot' && w !== 'human');
    if (bad !== undefined || walkers.length === 0) {
      log(`--walkers wants bot, human or both (got '${String(args.walkers)}')`);
      return 2;
    }
    const pinDial = args.dial !== undefined ? Number(args.dial) : undefined;
    const t0 = performance.now();
    const target = cloneTunables().fightPace;
    const balance: ReturnType<typeof sweepReport>[] = [];
    const pace: PaceRow[] = [];
    let total = 0;
    for (const walker of walkers) {
      const r = sweepReport(skills, runs, seed, pinDial, undefined, walker);
      balance.push(r);
      total += r.runs.length;
      for (const skill of skills) pace.push(paceRow(walker, skill, r.runs.filter((_, i) => skills[Math.floor(i / runs)] === skill), target.maxDeadAirSec));
    }
    if (args.json) log(JSON.stringify({ balance: balance[0]!.rows, pace }, null, 2));
    else {
      for (const line of formatSweepReport(balance[0]!.rows)) log(line);
      log('');
      for (const line of formatPaceReport(pace, target)) log(line);
      log(`${total} runs, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['skill-harness']) {
    const abilities = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [10, 30, 50, 70, 90];
    const seeds = args.seeds !== undefined ? Math.max(1, Math.floor(Number(args.seeds))) : 100;
    const t = cloneTunables();
    const t0 = performance.now();
    const rows: HarnessRow[] = [];
    for (const a of abilities) rows.push(harnessRow(a, selfReportFor(a, t), seeds, t), harnessRow(a, 'skip', seeds, t));
    if (args.json) log(JSON.stringify(rows, null, 2));
    else {
      for (const line of formatHarness(rows)) log(line);
      log(`${rows.length} populations x ${seeds} profiles, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args['trial-report']) {
    const skills = typeof args.skills === 'string' ? args.skills.split(',').map(Number) : [30, 50, 70];
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 50;
    const profileRuns = args['profile-runs'] !== undefined ? Math.max(1, Math.floor(Number(args['profile-runs']))) : 5;
    const t0 = performance.now();
    const r = trialReport(skills, runs, profileRuns, args.seed !== undefined ? Number(args.seed) : 1);
    if (args.json) log(JSON.stringify(r, null, 2));
    else {
      for (const line of formatTrialReport(r)) log(line);
      log(`${r.length} runs, ${(performance.now() - t0).toFixed(0)} ms`);
    }
    return 0;
  }

  if (args.alloc) {
    const audit = auditAllocations();
    log(args.json ? JSON.stringify(audit, null, 2) : formatAudit(audit));
    return audit.ok ? 0 : 1;
  }

  try {
    const params: Partial<BotParams> = {};
    for (const kv of (args.param as string[] | undefined) ?? []) {
      const [k, v] = kv.split('=');
      if (!k || v === undefined || !(BOT_PARAM_KEYS as string[]).includes(k)) throw new Error(`--param wants key=value with a key from: ${BOT_PARAM_KEYS.join(', ')}`);
      (params as Record<string, number>)[k] = Number(v);
    }
    const seed = args.seed !== undefined ? Number(args.seed) : 1;
    const opts: BotRunOptions = {
      mode: typeof args.mode === 'string' ? args.mode : 'sweep',
      skill: args.skill !== undefined ? Number(args.skill) : 50,
      seed,
      botSeed: args['bot-seed'] !== undefined ? Number(args['bot-seed']) : undefined,
      pinDial: args.dial !== undefined ? Number(args.dial) : undefined,
      params,
    };
    const runs = args.runs !== undefined ? Math.max(1, Math.floor(Number(args.runs))) : 1;
    const reports: BotReport[] = [];
    for (let i = 0; i < runs; i++) {
      const o = { ...opts, seed: seed + i, botSeed: opts.botSeed === undefined ? undefined : opts.botSeed + i };
      reports.push(playMode(new HeadlessGame({ seed: o.seed, map: mapForMode(o.mode) }), o));
    }
    if (args.json) log(JSON.stringify(runs === 1 ? reports[0] : reports, null, 2));
    else {
      for (const r of reports) log(formatReport(r));
      if (runs > 1) {
        const m = (pick: (r: BotReport) => number): number => reports.reduce((a, r) => a + pick(r), 0) / runs;
        log(`mean of ${runs}: kills ${m((r) => r.stats.kills).toFixed(1)}, accuracy ${(m((r) => r.stats.accuracy ?? 0) * 100).toFixed(0)}%, score ${m((r) => r.modeRun?.score ?? 0).toFixed(0)}`);
      }
    }
    return reports.every((r) => r.finished) ? 0 : 1;
  } catch (e) {
    log((e as Error).message);
    return 2;
  }
}
