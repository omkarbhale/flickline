import { addDays, isDateKey, localDateKey } from '../modes/dailyRoute';
import type { JournalTunables } from '../config/progress';
import type { RunEndReason } from '../sim/runEvents';

/**
 * # The play journal (design §14.5, #251)
 *
 * A local record of *when* and *how* Flickline was played: per session, per run and per day. It exists so repeat
 * enjoyment (vision principle 10) can be measured from real play instead of recall or agents. It lives in the save,
 * is exported with it and goes nowhere else (no telemetry, design §8.4). It is a **record, not a counter to fill**:
 * nothing in it is a reward, a streak, a goal or a nudge (design §2.5), and nothing reads it to change how the game
 * plays. A test walks it to keep it so.
 *
 * - A **session** is a stretch of play; a gap of `sessionGapSec` (30 minutes) or more between run events starts a new
 *   one. It keeps its start, its length, the runs started (gone live) and finished (not quit), and how it ended: from
 *   a results card (`results`), after a death (`death`), or with a run unfinished (`midrun`). The end is the state at
 *   the last run event, so the record is right even if the tab is closed without a goodbye.
 * - A **run** keeps its start, seconds live, depth (the deepest sector entered), how it ended and `pulled`: whether the
 *   next run was readied within `pulledWithinSec` of its results card ("pulled back in", the voluntary restart). It also
 *   keeps its fight pace (#248, design §2.2): the fights it had and its longest dead air, so the playtest records the fight
 *   rate of real runs (runs saved before #248 have neither).
 * - A **day** is a local calendar date with play on it, and `since`: the days since the previous played day (null on
 *   the first), which is "the player came back". `firstDay` is kept apart so day-3 and day-7 return stay measurable after
 *   the window (`keepDays`) has moved on.
 *
 * Times are epoch **seconds** (whole numbers). Pure: no DOM, no clock; the caller passes `nowMs`.
 */

export type SessionEnd = 'results' | 'midrun' | 'death';
export const SESSION_ENDS: readonly SessionEnd[] = ['results', 'midrun', 'death'];
const RUN_ENDS: readonly RunEndReason[] = ['timer', 'death', 'complete', 'quit', 'left'];

export interface JournalSession {
  /** Epoch seconds of the first run event. */
  at: number;
  /** Seconds from `at` to the last run event. */
  sec: number;
  /** Runs that went live, and runs that ended without a quit. */
  started: number;
  finished: number;
  end: SessionEnd;
}

export interface JournalRun {
  /** Epoch seconds the run went live. */
  at: number;
  /** Seconds the run was live. */
  sec: number;
  /** The deepest sector entered (1-based), 0 when none was. */
  depth: number;
  end: RunEndReason;
  /** The next run was readied within `pulledWithinSec` of this run's results card. */
  pulled: boolean;
  /** Contacts fought (cleared, died, disengaged) and the longest dead air inside a sector, whole seconds (#248); absent on runs saved before them. */
  fights?: number;
  deadAir?: number;
}

/** A finished run's fight pace, as the journal keeps it (`feedback/fightPace.ts` measures it). */
export interface RunPace {
  fights: number;
  deadAirSec: number;
}

export interface JournalDay {
  /** Local date `YYYY-MM-DD`. */
  day: string;
  /** Whole days since the previous played day, or null for the first day ever. */
  since: number | null;
}

export interface PlayJournal {
  /** The first local day ever played; kept when the window moves on. */
  firstDay: string | null;
  /** Oldest first. */
  sessions: JournalSession[];
  runs: JournalRun[];
  days: JournalDay[];
}

export function emptyJournal(): PlayJournal {
  return { firstDay: null, sessions: [], runs: [], days: [] };
}

// ---------------------------------------------------------------- sanitising

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(Math.min(hi, Math.max(lo, v))) : fallback;
}

const MAX_EPOCH = 4_102_444_800; // 2100-01-01: nothing the clock can read is later

/** An epoch-seconds time, or -1 when `v` is not a time after 1970 (the entry is then dropped). */
function epoch(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(Math.min(MAX_EPOCH, v)) : -1;
}
const MAX_SEC = 86_400;
const MAX_FIGHTS = 10_000;

/**
 * Validate and clamp a journal (an older save has none: the empty one). A part with the wrong shape is dropped, not
 * refused: the journal is a record, and losing it must never cost the player their save. Capped by count here; the
 * age window is applied by `trimJournal` (the sanitiser has no clock).
 */
export function sanitizeJournal(raw: unknown, cfg: JournalTunables): PlayJournal {
  const out = emptyJournal();
  if (!isRec(raw)) return out;
  if (typeof raw.firstDay === 'string' && isDateKey(raw.firstDay)) out.firstDay = raw.firstDay;

  if (Array.isArray(raw.sessions)) {
    for (const s of raw.sessions.slice(-cfg.maxSessions)) {
      if (!isRec(s)) continue;
      const at = epoch(s.at);
      if (at < 0) continue;
      const started = int(s.started, 0, 10_000, 0);
      out.sessions.push({
        at, sec: int(s.sec, 0, MAX_SEC * 2, 0), started, finished: Math.min(started, int(s.finished, 0, 10_000, 0)),
        end: SESSION_ENDS.find((e) => e === s.end) ?? 'midrun',
      });
    }
  }

  if (Array.isArray(raw.runs)) {
    for (const r of raw.runs.slice(-cfg.maxRuns)) {
      if (!isRec(r)) continue;
      const at = epoch(r.at);
      if (at < 0) continue;
      const run: JournalRun = {
        at, sec: int(r.sec, 0, MAX_SEC, 0), depth: int(r.depth, 0, cfg.maxDepth, 0),
        end: RUN_ENDS.find((e) => e === r.end) ?? 'quit', pulled: r.pulled === true,
      };
      if (typeof r.fights === 'number' && Number.isFinite(r.fights)) run.fights = int(r.fights, 0, MAX_FIGHTS, 0);
      if (typeof r.deadAir === 'number' && Number.isFinite(r.deadAir)) run.deadAir = int(r.deadAir, 0, MAX_SEC, 0);
      out.runs.push(run);
    }
  }

  if (Array.isArray(raw.days)) {
    for (const d of raw.days.slice(-cfg.maxDays)) {
      if (!isRec(d) || typeof d.day !== 'string' || !isDateKey(d.day)) continue;
      out.days.push({ day: d.day, since: d.since === null ? null : int(d.since, 1, 100_000, 1) });
    }
  }
  if (out.firstDay === null && out.days.length > 0) out.firstDay = out.days[0]!.day;
  return out;
}

// ---------------------------------------------------------------- dates

/** Whole calendar days from `a` to `b` (both `YYYY-MM-DD`); calendar arithmetic, immune to daylight-saving changes. */
export function daysBetween(a: string, b: string): number {
  const t = (k: string): number => Date.UTC(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** The local calendar day of an epoch-seconds time. */
export function dayOf(epochSec: number): string {
  return localDateKey(new Date(epochSec * 1000));
}

// ---------------------------------------------------------------- writing

/**
 * Drop what is older than `keepDays` before `nowSec`'s local day (the newest played day is always kept, so "came back
 * after how long" survives a long absence), and enforce the count caps.
 */
export function trimJournal(j: PlayJournal, nowSec: number, cfg: JournalTunables): void {
  const cutoffDay = addDays(dayOf(nowSec), -cfg.keepDays);
  const cutoffSec = nowSec - cfg.keepDays * 86_400;
  j.sessions = j.sessions.filter((s) => s.at + s.sec >= cutoffSec).slice(-cfg.maxSessions);
  j.runs = j.runs.filter((r) => r.at >= cutoffSec).slice(-cfg.maxRuns);
  const last = j.days[j.days.length - 1];
  j.days = j.days.filter((d) => d.day >= cutoffDay || d === last).slice(-cfg.maxDays);
}

/**
 * Writes run events into a journal in place. It keeps three small facts the journal itself does not (is a run live,
 * the deepest sector of it, the results card the next run may follow); everything else is read from the journal, so a
 * page reload in the middle of a session carries on in the same session.
 */
export class JournalWriter {
  private live = false;
  private liveAtMs = 0;
  private depth = 0;
  /** The run whose results card is up, and when it came up (ms): the next run readied within the window pulls it. */
  private card: JournalRun | null = null;
  private cardMs = 0;

  constructor(private readonly journal: PlayJournal, private readonly cfg: JournalTunables) {}

  /** A run is readied (the player pressed play, play again, replay or new run). */
  ready(nowMs: number): void {
    // A run is now in progress, even before it goes live: leaving here is leaving mid-run, not after the results card.
    this.touch(nowMs).end = 'midrun';
    const c = this.card;
    if (c !== null && nowMs - this.cardMs <= this.cfg.pulledWithinSec * 1000) c.pulled = true;
    this.card = null;
    this.live = false;
    this.depth = 0; // the first sector may be entered while the run is still `ready`: count from here, not from `started`
  }

  /** The run went live. */
  started(nowMs: number): void {
    const s = this.touch(nowMs);
    s.started++;
    s.end = 'midrun';
    this.live = true;
    this.liveAtMs = nowMs;
  }

  /** A sector was entered (`index` is 0-based). */
  sector(index: number): void {
    this.depth = Math.max(this.depth, Math.min(this.cfg.maxDepth, index + 1));
  }

  /**
   * The run ended after `liveSec` seconds live, with this fight pace (when measured). A run that ended before it went live
   * (a quit in `ready`) was never a run and is not recorded.
   */
  ended(nowMs: number, liveSec: number, reason: RunEndReason, pace?: RunPace): void {
    const s = this.touch(nowMs);
    this.card = null;
    if (!this.live) return;
    this.live = false;
    const run: JournalRun = {
      at: Math.floor(this.liveAtMs / 1000), sec: int(Math.round(liveSec), 0, MAX_SEC, 0), depth: this.depth, end: reason, pulled: false,
    };
    if (pace) {
      run.fights = int(pace.fights, 0, MAX_FIGHTS, 0);
      run.deadAir = int(Math.round(pace.deadAirSec), 0, MAX_SEC, 0);
    }
    this.journal.runs.push(run);
    if (this.journal.runs.length > this.cfg.maxRuns) this.journal.runs.splice(0, this.journal.runs.length - this.cfg.maxRuns);
    if (reason === 'quit') {
      s.end = 'midrun';
      return;
    }
    s.finished++;
    s.end = reason === 'death' ? 'death' : 'results';
    this.card = run;
    this.cardMs = nowMs;
  }

  /** The session `nowMs` belongs to: the last one, extended, or a new one after the gap (which also opens the day). */
  private touch(nowMs: number): JournalSession {
    const now = Math.floor(nowMs / 1000);
    const j = this.journal;
    let s = j.sessions[j.sessions.length - 1];
    if (s === undefined || now < s.at || now - (s.at + s.sec) >= this.cfg.sessionGapSec) {
      s = { at: now, sec: 0, started: 0, finished: 0, end: 'midrun' };
      j.sessions.push(s);
      this.openDay(now);
      trimJournal(j, now, this.cfg);
    } else {
      s.sec = Math.max(s.sec, now - s.at);
    }
    return s;
  }

  private openDay(nowSec: number): void {
    const j = this.journal;
    const day = dayOf(nowSec);
    const last = j.days[j.days.length - 1];
    if (last !== undefined && last.day >= day) return; // the same day (or a clock set back: not a new day)
    j.days.push({ day, since: last === undefined ? (j.firstDay === null ? null : daysBetween(j.firstDay, day)) : daysBetween(last.day, day) });
    j.firstDay ??= day;
  }
}
