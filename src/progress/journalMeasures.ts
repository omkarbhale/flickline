import type { JournalTunables } from '../config/progress';
import { daysBetween, type PlayJournal } from './journal';

/**
 * What the play journal says (design §14.5, #251), as plain numbers: the repeat-enjoyment measures of the playtest
 * (#214: R1 runs per session and restarts, R6 quits against restarts after a death, R7 return on day 3 and day 7) and the
 * one-line summary the settings' Data group shows. Pure functions of the journal: nothing here is stored, rewarded or
 * fed back into play.
 */

export interface Share {
  n: number;
  of: number;
}

export interface ReturnMeasure {
  /** The player played exactly `day` calendar days after the first day. */
  exact: boolean;
  /** The player played on that day or later. */
  atOrAfter: boolean;
  /** The journal covers that many days after the first day, so a "no" is a real no (else: not yet testable). */
  observable: boolean;
}

export interface JournalMeasures {
  /** Sessions with at least one run that went live. */
  sessions: number;
  runs: number;
  /** Runs not quit. */
  finished: number;
  /** R1: runs started per session that played, median and mean (null with none). */
  runsPerSession: { median: number | null; mean: number | null };
  /** R1: sessions that played one run and did not start another. */
  oneRunSessions: Share;
  /** R1: runs the player quit before their end (stopping mid-run). */
  quitMidRun: Share;
  /** R1: finished runs the next of which was readied within the "pulled back in" window (voluntary restarts). */
  restarted: Share;
  /** R6: deaths, and how many of them were followed by a run within the window. */
  restartedAfterDeath: Share;
  /** R6: sessions that ended with the player leaving after a death. */
  endedAfterDeath: Share;
  /** R1: the median seconds a run was live (null with none). */
  medianRunSec: number | null;
  /**
   * Fight pace (#248, design §2.2), over the runs that carry it (saved since #248, at least a live second): the median run's
   * fights per live minute, the pooled rate (all their fights over all their minutes), the median run's longest dead air in
   * seconds, and how many runs had dead air over `overSec` (the target, 15 s). Null with no such run.
   */
  fightsPerMin: { median: number | null; pooled: number | null; runs: number };
  deadAir: { median: number | null; over: Share };
  /** R7: first and latest played day, days played, and the return on day 3 and day 7. */
  firstDay: string | null;
  lastDay: string | null;
  daysPlayed: number;
  day3: ReturnMeasure;
  day7: ReturnMeasure;
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The measures of a journal. `asOfDay` is the day the journal was written down (the export's date; default: the latest
 * played day), which decides whether day 3 and day 7 had come yet.
 */
export function journalMeasures(j: PlayJournal, asOfDay?: string, overSec = 15): JournalMeasures {
  const played = j.sessions.filter((s) => s.started > 0);
  const perSession = played.map((s) => s.started);
  const finishedRuns = j.runs.filter((r) => r.end !== 'quit');
  const deaths = j.runs.filter((r) => r.end === 'death');
  const lastDay = j.days.length > 0 ? j.days[j.days.length - 1]!.day : null;
  const asOf = asOfDay ?? lastDay;
  const ret = (n: number): ReturnMeasure => {
    if (j.firstDay === null) return { exact: false, atOrAfter: false, observable: false };
    const offsets = j.days.map((d) => daysBetween(j.firstDay!, d.day));
    return {
      exact: offsets.includes(n),
      atOrAfter: offsets.some((o) => o >= n),
      observable: asOf !== null && daysBetween(j.firstDay, asOf) >= n,
    };
  };
  const paced = j.runs.filter((r) => r.fights !== undefined && r.sec >= 1);
  const paceSec = paced.reduce((a, r) => a + r.sec, 0);
  const aired = paced.filter((r) => r.deadAir !== undefined);
  return {
    sessions: played.length,
    runs: j.runs.length,
    finished: finishedRuns.length,
    runsPerSession: { median: median(perSession), mean: perSession.length === 0 ? null : perSession.reduce((a, b) => a + b, 0) / perSession.length },
    oneRunSessions: { n: perSession.filter((n) => n === 1).length, of: played.length },
    quitMidRun: { n: j.runs.length - finishedRuns.length, of: j.runs.length },
    restarted: { n: finishedRuns.filter((r) => r.pulled).length, of: finishedRuns.length },
    restartedAfterDeath: { n: deaths.filter((r) => r.pulled).length, of: deaths.length },
    endedAfterDeath: { n: played.filter((s) => s.end === 'death').length, of: played.length },
    medianRunSec: median(j.runs.map((r) => r.sec)),
    fightsPerMin: {
      median: median(paced.map((r) => (r.fights! * 60) / r.sec)),
      pooled: paced.length === 0 ? null : (paced.reduce((a, r) => a + r.fights!, 0) * 60) / paceSec,
      runs: paced.length,
    },
    deadAir: { median: median(aired.map((r) => r.deadAir!)), over: { n: aired.filter((r) => r.deadAir! > overSec).length, of: aired.length } },
    firstDay: j.firstDay,
    lastDay,
    daysPlayed: j.days.length,
    day3: ret(3),
    day7: ret(7),
  };
}

/** The journal's sessions and runs in the last `summaryDays` days up to `nowMs` ("this week"). */
export interface JournalSummary {
  sessions: number;
  runs: number;
  /** Runs started straight after the last (the previous run's results card had them back within the window). */
  pulled: number;
}

export function summariseJournal(j: PlayJournal, nowMs: number, cfg: JournalTunables): JournalSummary {
  const since = Math.floor(nowMs / 1000) - cfg.summaryDays * 86_400;
  const inWeek = (at: number): boolean => at >= since;
  return {
    sessions: j.sessions.filter((s) => s.started > 0 && inWeek(s.at)).length,
    runs: j.runs.filter((r) => inWeek(r.at)).length,
    pulled: j.runs.filter((r) => r.pulled && inWeek(r.at)).length,
  };
}

const plural = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The one line of the Data group: a record of the week, no goal in it ("4 sessions this week, 11 runs, 7 started straight after the last"). */
export function journalLine(s: JournalSummary): string {
  if (s.runs === 0) return 'No runs this week.';
  const parts = [`${plural(s.sessions, 'session')} this week`, plural(s.runs, 'run')];
  if (s.pulled > 0) parts.push(`${s.pulled} started straight after the last`);
  return parts.join(', ');
}
