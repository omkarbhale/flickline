import { describe, expect, it } from 'vitest';
import { progress } from '../config/progress';
import { dayOf, daysBetween, emptyJournal, JournalWriter, sanitizeJournal, trimJournal, type PlayJournal } from './journal';

const cfg = progress.journal;
/** A fixed local noon on a given day, in epoch ms (noon: no daylight-saving edge). */
const at = (day: string, h = 12, m = 0, s = 0): number => new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`).getTime();
const MIN = 60_000;

function writer(j: PlayJournal = emptyJournal()): { j: PlayJournal; w: JournalWriter } {
  return { j, w: new JournalWriter(j, cfg) };
}

/** One whole run: readied at `t`, live 3 s later, ended `liveSec` after that. Returns the end time. */
function play(w: JournalWriter, t: number, liveSec: number, reason: 'death' | 'timer' | 'complete' | 'quit' | 'left', depth = 3): number {
  w.ready(t);
  w.started(t + 3000);
  for (let i = 0; i < depth; i++) w.sector(i);
  const end = t + 3000 + liveSec * 1000;
  w.ended(end, liveSec, reason);
  return end;
}

describe('sessions', () => {
  it('start at the first run event, grow with every later one, and count runs started and finished', () => {
    const { j, w } = writer();
    const t0 = at('2026-03-02');
    const e1 = play(w, t0, 120, 'death');
    play(w, e1 + 4000, 60, 'quit');
    expect(j.sessions).toHaveLength(1);
    expect(j.sessions[0]).toMatchObject({ at: Math.floor(t0 / 1000), started: 2, finished: 1 });
    expect(j.sessions[0]!.sec).toBe(Math.round((e1 + 4000 + 3000 + 60_000 - t0) / 1000));
  });

  it('a gap of 30 minutes starts a new session; 29 minutes does not', () => {
    const { j, w } = writer();
    const t0 = at('2026-03-02');
    const e1 = play(w, t0, 60, 'timer');
    play(w, e1 + 29 * MIN, 60, 'timer');
    expect(j.sessions).toHaveLength(1);
    const e3 = j.sessions[0]!.at * 1000 + j.sessions[0]!.sec * 1000;
    play(w, e3 + 30 * MIN, 60, 'timer');
    expect(j.sessions).toHaveLength(2);
    expect(j.sessions.map((s) => s.started)).toEqual([2, 1]);
  });

  it('records how it ended: after a death, from a results card, or with a run unfinished', () => {
    const ends = (reason: 'death' | 'timer' | 'complete' | 'left' | 'quit'): string => {
      const { j, w } = writer();
      play(w, at('2026-03-02'), 60, reason);
      return j.sessions[0]!.end;
    };
    expect(ends('death')).toBe('death');
    expect(ends('timer')).toBe('results');
    expect(ends('complete')).toBe('results');
    expect(ends('left')).toBe('results');
    expect(ends('quit')).toBe('midrun');
  });

  it('is midrun while a run is readied or live, and goes back to the results state when that run ends', () => {
    const { j, w } = writer();
    const t0 = at('2026-03-02');
    const e1 = play(w, t0, 60, 'death');
    expect(j.sessions[0]!.end).toBe('death');
    w.ready(e1 + 4000); // played again, then left in the ready screen
    expect(j.sessions[0]!.end).toBe('midrun');
  });

  it('a session whose only run was readied and abandoned has no run in it', () => {
    const { j, w } = writer();
    w.ready(at('2026-03-02'));
    w.ended(at('2026-03-02') + 2000, 0, 'quit'); // a quit in `ready`: never live
    expect(j.runs).toHaveLength(0);
    expect(j.sessions[0]).toMatchObject({ started: 0, finished: 0, end: 'midrun' });
  });

  it('a page reload in the middle of a session carries on in the same session', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02'), 60, 'timer');
    const reloaded = new JournalWriter(JSON.parse(JSON.stringify(j)) as PlayJournal, cfg);
    play(reloaded, e1 + 2 * MIN, 60, 'timer');
    expect(reloaded['journal'].sessions).toHaveLength(1);
    expect(reloaded['journal'].sessions[0]!.started).toBe(2);
  });

  it('a clock set back starts a new session instead of a negative length', () => {
    const { j, w } = writer();
    play(w, at('2026-03-02'), 60, 'timer');
    play(w, at('2026-03-01'), 60, 'timer');
    expect(j.sessions).toHaveLength(2);
    expect(j.sessions.every((s) => s.sec >= 0)).toBe(true);
  });
});

describe('runs', () => {
  it('keep start, seconds live, depth and how they ended', () => {
    const { j, w } = writer();
    const t0 = at('2026-03-02');
    play(w, t0, 187.4, 'death', 4);
    expect(j.runs).toEqual([{ at: Math.floor((t0 + 3000) / 1000), sec: 187, depth: 4, end: 'death', pulled: false }]);
  });

  it('depth is the deepest sector entered, counted from the ready screen, and starts again at zero each run', () => {
    const { j, w } = writer();
    const t0 = at('2026-03-02');
    w.ready(t0);
    w.sector(0); // the first sector is entered while the run is still `ready`
    w.started(t0 + 3000);
    w.sector(1);
    w.sector(1);
    w.ended(t0 + 60_000, 57, 'death');
    play(w, t0 + 70_000, 10, 'quit', 0);
    expect(j.runs.map((r) => r.depth)).toEqual([2, 0]);
  });

  it('are marked pulled when the next run is readied within 10 s of the results card, and not after 10.001 s', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02'), 60, 'death');
    const e2 = play(w, e1 + 10_000, 60, 'timer'); // exactly 10 s: pulled
    play(w, e2 + 10_001, 60, 'quit');
    expect(j.runs.map((r) => r.pulled)).toEqual([true, false, false]);
  });

  it('a quit run has no results card, so the next run does not mark it pulled', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02'), 30, 'quit');
    play(w, e1 + 1000, 30, 'timer');
    expect(j.runs[0]!.pulled).toBe(false);
  });

  it('a second ready without a card in between does not mark anything', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02'), 60, 'timer');
    w.ready(e1 + 2000); // pulled
    w.ready(e1 + 3000); // restarted in the ready screen: nothing more to mark
    expect(j.runs.map((r) => r.pulled)).toEqual([true]);
  });

  it('a card left up for a long time does not count as pulled even in a new session', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02'), 60, 'death');
    play(w, e1 + 2 * 60 * MIN, 60, 'timer');
    expect(j.runs[0]!.pulled).toBe(false);
    expect(j.sessions).toHaveLength(2);
  });
});

describe('days', () => {
  it('open the first day with since null, then record the days since the previous played day', () => {
    const { j, w } = writer();
    play(w, at('2026-03-02'), 60, 'timer');
    play(w, at('2026-03-02', 20), 60, 'timer'); // a second session the same day: one day entry
    play(w, at('2026-03-05'), 60, 'timer');
    play(w, at('2026-03-06'), 60, 'timer');
    expect(j.days).toEqual([
      { day: '2026-03-02', since: null },
      { day: '2026-03-05', since: 3 },
      { day: '2026-03-06', since: 1 },
    ]);
    expect(j.firstDay).toBe('2026-03-02');
  });

  it('a session that crosses midnight counts as the day it started', () => {
    const { j, w } = writer();
    const e1 = play(w, at('2026-03-02', 23, 50), 120, 'timer');
    play(w, e1 + 5 * MIN, 60, 'timer');
    expect(j.sessions).toHaveLength(1);
    expect(j.days.map((d) => d.day)).toEqual(['2026-03-02']);
  });

  it('daysBetween is calendar arithmetic over month ends, leap days and clock changes', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-03-08', '2026-03-09')).toBe(1);
    expect(dayOf(Math.floor(at('2026-03-02') / 1000))).toBe('2026-03-02');
  });
});

describe('the 90-day window', () => {
  it('drops sessions, runs and days older than 90 days, keeps the first day and the newest played day', () => {
    const { j, w } = writer();
    play(w, at('2025-10-01'), 60, 'timer');
    play(w, at('2025-12-30'), 60, 'timer'); // 90 days later than the first
    expect(j.sessions).toHaveLength(2);
    play(w, at('2026-03-31'), 60, 'timer'); // 91+ days after the first, 91 after the second
    expect(j.sessions).toHaveLength(1);
    expect(j.runs).toHaveLength(1);
    expect(j.days.map((d) => d.day)).toEqual(['2026-03-31']);
    expect(j.days[0]!.since).toBe(91); // survived the long absence: the gap was measured against the previous played day
    expect(j.firstDay).toBe('2025-10-01');
  });

  it('trimJournal keeps the newest played day however old it is', () => {
    const j = emptyJournal();
    j.firstDay = '2025-01-01';
    j.days = [{ day: '2025-01-01', since: null }, { day: '2025-01-02', since: 1 }];
    trimJournal(j, Math.floor(at('2026-03-02') / 1000), cfg);
    expect(j.days.map((d) => d.day)).toEqual(['2025-01-02']);
  });

  it('caps runs and sessions by count however recent they are', () => {
    const { j, w } = writer();
    let t = at('2026-03-02');
    for (let i = 0; i < cfg.maxRuns + 50; i++) t = play(w, t + 2000, 1, 'timer', 1);
    expect(j.runs).toHaveLength(cfg.maxRuns);
    const s = sanitizeJournal({ sessions: Array.from({ length: cfg.maxSessions + 20 }, (_, i) => ({ at: 1000 + i, sec: 1, started: 1, finished: 1, end: 'results' })) }, cfg);
    expect(s.sessions).toHaveLength(cfg.maxSessions);
    expect(s.sessions[s.sessions.length - 1]!.at).toBe(1000 + cfg.maxSessions + 19); // the newest survive
  });

  it('a heavy player stays far under the save size cap', () => {
    const { j, w } = writer();
    let t = at('2026-01-02');
    for (let i = 0; i < cfg.maxRuns; i++) t = play(w, t + 2000, 300, i % 3 === 0 ? 'death' : 'timer', 6);
    expect(JSON.stringify(j).length).toBeLessThan(progress.maxSaveBytes / 4);
  });
});

describe('sanitising a hand-edited journal', () => {
  it('reads a missing or wrongly shaped journal as empty', () => {
    expect(sanitizeJournal(undefined, cfg)).toEqual(emptyJournal());
    expect(sanitizeJournal([], cfg)).toEqual(emptyJournal());
    expect(sanitizeJournal({ sessions: 'x', runs: 4, days: {} }, cfg)).toEqual(emptyJournal());
  });

  it('clamps numbers, drops entries that cannot be read and fills the first day from the days', () => {
    const j = sanitizeJournal({
      sessions: [{ at: 1_700_000_000, sec: -5, started: 2, finished: 9, end: 'bogus' }, 'junk', { at: 'x' }],
      runs: [{ at: 1_700_000_000, sec: 1e9, depth: 99, end: 'weird', pulled: 'yes' }, { at: -1 }],
      days: [{ day: '2026-02-30', since: 1 }, { day: '2026-03-02', since: 'many' }, { day: 'nope' }],
    }, cfg);
    expect(j.sessions).toEqual([{ at: 1_700_000_000, sec: 0, started: 2, finished: 2, end: 'midrun' }]);
    expect(j.runs).toEqual([{ at: 1_700_000_000, sec: 86_400, depth: cfg.maxDepth, end: 'quit', pulled: false }]);
    expect(j.days).toEqual([{ day: '2026-03-02', since: 1 }]);
    expect(j.firstDay).toBe('2026-03-02');
  });

  it('keeps only plain data: no extra keys survive', () => {
    const j = sanitizeJournal({ evil: 1, sessions: [{ at: 5, sec: 1, started: 1, finished: 1, end: 'results', extra: 'x' }] }, cfg);
    expect(JSON.stringify(j)).not.toMatch(/evil|extra/);
  });
});

describe('a record, not a reward (design §2.5)', () => {
  it('holds only the fields of the record, none of them a counter, streak, goal or reward', () => {
    const { j, w } = writer();
    let t = at('2026-03-02');
    for (let d = 0; d < 5; d++) {
      t = play(w, at(`2026-03-0${2 + d}`), 90, 'death');
      t = play(w, t + 3000, 90, 'timer');
    }
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        for (const k of Object.keys(v)) {
          keys.add(k);
          walk((v as Record<string, unknown>)[k]);
        }
      }
    };
    walk(j);
    expect([...keys].sort()).toEqual(['at', 'day', 'days', 'depth', 'end', 'finished', 'firstDay', 'pulled', 'runs', 'sec', 'sessions', 'since', 'started']);
    expect(JSON.stringify(j)).not.toMatch(/streak|reward|xp|goal|bonus|score|level|points|login/i);
  });
});
