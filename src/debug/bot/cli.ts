import { HeadlessGame } from './headless';
import { listModes, playMode, type BotReport, type BotRunOptions } from './play';
import { BOT_PARAM_KEYS, type BotParams } from './skill';
import { runSuite } from './suite';
import { auditAllocations, formatAudit } from './allocAudit';

/** Command line of `npm run bot` (loaded by `scripts/bot.mjs`). Returns the process exit code. */

const HELP = `npm run bot -- [options]

  --mode <id>        mode to play: ${'<modes>'} (default: ${'<first>'}); "cold-start" and "coldStart" are the same
  --skill <0..100>   bot skill (default 50); see src/debug/bot/README.md
  --seed <n>         world, mode and bot seed (default 1)
  --bot-seed <n>     bot random stream, if it should differ from --seed
  --dial <0..100>    pin the difficulty dial for the run
  --param k=v        override one skill parameter (repeatable): ${BOT_PARAM_KEYS.join(', ')}
  --runs <n>         play n seeds (seed, seed+1, ...) and print each, then the mean
  --json             print the report(s) as JSON
  --suite            run the regression suite (every mode, skill ordering, determinism, parameters)
  --alloc            audit the sim tick for allocations (see README, "Allocation audit")
  --list             list the modes
`;

function parseArgs(argv: string[]): Record<string, string | boolean | string[]> {
  const out: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    const key = a.slice(2);
    if (['json', 'suite', 'alloc', 'list', 'help'].includes(key)) {
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
    log(HELP.replace('<modes>', modes.join(', ')).replace('<first>', modes[1] ?? modes[0]!));
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
      mode: typeof args.mode === 'string' ? args.mode : (modes[1] ?? modes[0]!),
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
      reports.push(playMode(new HeadlessGame({ seed: o.seed }), o));
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
