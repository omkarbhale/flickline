import { describe, expect, it } from 'vitest';
import { progress } from '../config/progress';
import { emptyJournal, JournalWriter, type PlayJournal } from './journal';
import { buildJournalExport, readJournalExport } from './journalExport';
import { journalLine, journalMeasures, summariseJournal } from './journalMeasures';
import { pooledJournal, reportMarkdown, returnCell } from './journalReport';
import { buildSave } from '../settings/saveData';
import { defaultProgress } from './save';
import { DEFAULT_PROFILE } from '../settings/profile';
import { DEFAULT_SETTINGS } from '../settings/settings';

const cfg = progress.journal;
const at = (day: string, h = 12): number => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).getTime();

function play(w: JournalWriter, t: number, sec: number, reason: 'death' | 'timer' | 'quit'): number {
  w.ready(t);
  w.started(t + 3000);
  w.sector(0);
  w.ended(t + 3000 + sec * 1000, sec, reason);
  return t + 3000 + sec * 1000;
}

/**
 * A tester: day 1: a session of three runs (death, then straight back, death, then straight back, timer; left at the
 * card); day 4: one run quit; day 8: a session of two runs ending after a death.
 */
function tester(): PlayJournal {
  const j = emptyJournal();
  const w = new JournalWriter(j, cfg);
  let t = play(w, at('2026-03-02'), 120, 'death');
  t = play(w, t + 4000, 100, 'death');
  play(w, t + 5000, 300, 'timer');
  play(w, at('2026-03-05'), 20, 'quit');
  t = play(w, at('2026-03-10'), 200, 'timer');
  play(w, t + 60_000, 80, 'death'); // a minute at the card: not pulled
  return j;
}

describe('journalMeasures', () => {
  const m = journalMeasures(tester());

  it('counts sessions, runs and runs per session (R1)', () => {
    expect(m.sessions).toBe(3);
    expect(m.runs).toBe(6);
    expect(m.finished).toBe(5);
    expect(m.runsPerSession).toEqual({ median: 2, mean: 2 });
    expect(m.oneRunSessions).toEqual({ n: 1, of: 3 });
    expect(m.quitMidRun).toEqual({ n: 1, of: 6 });
    expect(m.medianRunSec).toBe(110);
  });

  it('counts the voluntary restarts and, apart, those after a death (R1, R6)', () => {
    expect(m.restarted).toEqual({ n: 2, of: 5 });
    expect(m.restartedAfterDeath).toEqual({ n: 2, of: 3 });
    expect(m.endedAfterDeath).toEqual({ n: 1, of: 3 });
  });

  it('reads return on day 3 and day 7 from the first day (R7), exact and later, and says when a day has not come', () => {
    expect(m.firstDay).toBe('2026-03-02');
    expect(m.lastDay).toBe('2026-03-10');
    expect(m.daysPlayed).toBe(3);
    expect(m.day3).toEqual({ exact: true, atOrAfter: true, observable: true }); // 2026-03-05
    expect(m.day7).toEqual({ exact: false, atOrAfter: true, observable: true }); // played day 8, not day 7
    expect(returnCell(m.day3)).toBe('yes');
    expect(returnCell(m.day7)).toBe('later');
    const early = journalMeasures(tester(), '2026-03-04');
    expect(early.day7.observable).toBe(false);
    const none = journalMeasures({ ...tester(), days: [{ day: '2026-03-02', since: null }] }, '2026-03-06');
    expect(returnCell(none.day3)).toBe('no');
    expect(returnCell(journalMeasures({ ...tester(), days: [{ day: '2026-03-02', since: null }] }, '2026-03-04').day3)).toBe('n/a');
  });

  it('an empty journal gives empty measures, not NaN', () => {
    const e = journalMeasures(emptyJournal());
    expect(e.runsPerSession).toEqual({ median: null, mean: null });
    expect(e.restarted).toEqual({ n: 0, of: 0 });
    expect(e.day3.observable).toBe(false);
    expect(JSON.stringify(e)).not.toMatch(/NaN|null.*Infinity/);
  });

  it('sessions that only readied a run are not played sessions', () => {
    const j = emptyJournal();
    new JournalWriter(j, cfg).ready(at('2026-03-02'));
    expect(journalMeasures(j).sessions).toBe(0);
  });
});

describe('the one line', () => {
  it('says sessions this week, runs and those started straight after the last', () => {
    const j = tester();
    const s = summariseJournal(j, at('2026-03-10', 13), cfg);
    expect(s).toEqual({ sessions: 2, runs: 3, pulled: 0 });
    const week1 = summariseJournal({ ...j, sessions: j.sessions.slice(0, 1), runs: j.runs.slice(0, 3) }, at('2026-03-04'), cfg);
    expect(journalLine(week1)).toBe('1 session this week, 3 runs, 2 started straight after the last');
    expect(journalLine({ sessions: 4, runs: 11, pulled: 7 })).toBe('4 sessions this week, 11 runs, 7 started straight after the last');
  });

  it('leaves out the part with nothing in it, and says so when there is no run', () => {
    expect(journalLine({ sessions: 1, runs: 1, pulled: 0 })).toBe('1 session this week, 1 run');
    expect(journalLine({ sessions: 0, runs: 0, pulled: 0 })).toBe('No runs this week.');
  });

  it('holds no streak, goal or praise in the words', () => {
    for (const s of [{ sessions: 9, runs: 40, pulled: 30 }, { sessions: 0, runs: 0, pulled: 0 }]) {
      expect(journalLine(s)).not.toMatch(/streak|keep it up|great|goal|reward|bonus|missed|come back|don't break/i);
    }
  });
});

describe('the export (#214)', () => {
  it('a journal-only paste and a whole save export both read back, with the day it was written down', () => {
    const j = tester();
    const paste = readJournalExport(buildJournalExport(j, at('2026-03-12')));
    expect(paste.ok && paste.journal).toEqual(j);
    expect(paste.ok && paste.asOfDay).toBe('2026-03-12');
    const full = readJournalExport(buildSave({ settings: DEFAULT_SETTINGS, profile: { ...DEFAULT_PROFILE }, progress: { ...defaultProgress(), journal: j } }, new Date(at('2026-03-12')).toISOString()));
    expect(full.ok && full.journal).toEqual(j);
    expect(full.ok && full.asOfDay).toBe('2026-03-12');
  });

  it('says why a file is not a journal', () => {
    expect(readJournalExport('{').ok).toBe(false);
    expect(readJournalExport('{"format":"other"}').ok).toBe(false);
    expect(readJournalExport('{"format":"flickline-save","version":3}')).toEqual({ ok: false, error: 'has no play journal (a save from before v4)' });
    expect(readJournalExport('{"format":"flickline-save","version":99,"journal":{}}').ok).toBe(false);
  });

  it('is small enough to paste into an issue comment after a couple of weeks of play', () => {
    const j = emptyJournal();
    const w = new JournalWriter(j, cfg);
    let t = at('2026-03-02');
    for (let i = 0; i < 400; i++) t = play(w, t + (i % 7 === 0 ? 3 * 3600_000 : 5000), 200, i % 3 === 0 ? 'death' : 'timer');
    expect(buildJournalExport(j, t).length).toBeLessThan(60_000);
  });
});

describe('the report table', () => {
  it('has a row per tester and a pooled row with the return counted over testers', () => {
    const a = tester();
    const b = emptyJournal();
    play(new JournalWriter(b, cfg), at('2026-03-02'), 90, 'death');
    const md = reportMarkdown([
      { name: 'ann', journal: a, asOfDay: '2026-03-12' },
      { name: 'ben', journal: b, asOfDay: '2026-03-12' },
    ]);
    const rows = md.split('\n').filter((l) => l.startsWith('|'));
    expect(rows).toHaveLength(2 + 2 + 1);
    expect(rows[2]).toMatch(/^\| ann \| 3 \| 6 \|/);
    expect(rows[3]).toMatch(/^\| ben \| 1 \| 1 \|/);
    expect(rows[4]).toContain('**pooled**');
    expect(rows[4]).toContain('1/2 returned'); // day 3: ann yes, ben no
    expect(pooledJournal([{ name: 'a', journal: a, asOfDay: null }, { name: 'b', journal: b, asOfDay: null }]).runs).toHaveLength(7);
  });

  it('one tester has no pooled row', () => {
    expect(reportMarkdown([{ name: 'ann', journal: tester(), asOfDay: null }])).not.toContain('**pooled**');
  });
});
