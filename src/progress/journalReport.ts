import { fightPace } from '../config/fightPace';
import { emptyJournal, type PlayJournal } from './journal';
import { journalMeasures, type JournalMeasures, type ReturnMeasure, type Share } from './journalMeasures';

/**
 * The repeat-enjoyment table of the playtest report (#214, `docs/research/replay-not-drills.md` §7), computed from testers'
 * journal exports instead of recalled: one row per tester and a pooled row. `npm run journal -- <file>...` prints it. Pure.
 */
export interface ReportEntry {
  name: string;
  journal: PlayJournal;
  /** The local day the export was written down (decides what is "not yet testable"). */
  asOfDay: string | null;
}

const pct = (s: Share): string => (s.of === 0 ? '–' : `${s.n}/${s.of} (${Math.round((100 * s.n) / s.of)}%)`);
const num = (v: number | null, digits = 1): string => (v === null ? '–' : String(Math.round(v * 10 ** digits) / 10 ** digits));

/** `yes`: played exactly that many days after the first day; `later`: only later; `no`; `n/a`: that day has not come yet in the export. */
export function returnCell(r: ReturnMeasure): string {
  if (r.exact) return 'yes';
  if (r.atOrAfter) return 'later';
  return r.observable ? 'no' : 'n/a';
}

/** Every tester's sessions and runs in one journal, for the pooled row (the days stay per tester: return is theirs). */
export function pooledJournal(entries: readonly ReportEntry[]): PlayJournal {
  const out = emptyJournal();
  for (const e of entries) {
    out.sessions.push(...e.journal.sessions);
    out.runs.push(...e.journal.runs);
  }
  return out;
}

function row(name: string, m: JournalMeasures, day3: string, day7: string): string {
  return `| ${name} | ${m.sessions} | ${m.runs} | ${num(m.runsPerSession.median)} / ${num(m.runsPerSession.mean)} | ${pct(m.oneRunSessions)} | ${pct(m.quitMidRun)} | ${pct(m.restarted)} | ${pct(m.restartedAfterDeath)} | ${pct(m.endedAfterDeath)} | ${num(m.medianRunSec, 0)} | ${num(m.fightsPerMin.median)} / ${num(m.fightsPerMin.pooled)} | ${num(m.deadAir.median, 0)} (${pct(m.deadAir.over)}) | ${num(m.finaleClear.median, 0)} (${m.finaleClear.runs}) | ${m.daysPlayed} | ${day3} | ${day7} |`;
}

/** "k of n returned", over the testers whose export reaches that day. */
function tally(cells: readonly string[]): string {
  const seen = cells.filter((c) => c !== 'n/a');
  return seen.length === 0 ? 'n/a' : `${seen.filter((c) => c !== 'no').length}/${seen.length}`;
}

export function reportMarkdown(entries: readonly ReportEntry[]): string {
  const ms = entries.map((e) => journalMeasures(e.journal, e.asOfDay ?? undefined));
  const d3 = ms.map((m) => returnCell(m.day3));
  const d7 = ms.map((m) => returnCell(m.day7));
  const lines = [
    `| tester | sessions | runs | runs per session (median / mean) | one-run sessions | quit mid-run | restarted straight after (R1) | restarted after a death (R6) | left after a death (R6) | median run s | fights / live min, median run / pooled (#248) | longest dead air s, median run (runs over 15 s) | live s to the Finale's exit, median (runs that cleared it) | days played | day 3 (R7) | day 7 (R7) |`,
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...entries.map((e, i) => row(e.name, ms[i]!, d3[i]!, d7[i]!)),
  ];
  if (entries.length > 1) lines.push(row('**pooled**', journalMeasures(pooledJournal(entries)), `${tally(d3)} returned`, `${tally(d7)} returned`));
  lines.push(
    '',
    'Fights per live minute and dead air (design §2.2, #248) come from the runs saved since #248; the target is at least 4 fights a minute at the median run and no dead air over 15 s inside a sector. ' +
      `A full run (design §4.1, #274) is timed from going live to walking out of the Finale, Overtime not counted, over the runs saved since #274 that cleared it; the target is ${fightPace.finaleClearSec[0]}–${fightPace.finaleClearSec[1]} s, and the bot's time in \`npm run bot -- --repeat-report\` is a floor for a person's. ` +
      'Restarted straight after: a finished run whose next run was readied within 10 s of its results card. Day 3 and day 7: `yes` = played exactly that many days after the first day, `later` = only after it, `no` = not by the export, `n/a` = that day had not come yet. The pooled return counts testers who played on or after that day.',
  );
  return lines.join('\n');
}
