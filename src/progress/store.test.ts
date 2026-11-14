import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { progress as cfg } from '../config/progress';
import { SkillState } from '../adaptive/skillModel';
import type { StorageLike } from '../settings/settings';
import { summariseRun } from './bests';
import { defaultProgress, MIGRATIONS, readProgress, SAVE_VERSION, toSave, type RunSummary } from './save';
import type { RunRecord } from './runRecords';
import { ProgressStore, type ProgressEvents } from './store';
import { computeStats } from '../feedback/statTracker';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const blocked: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

function run(mode: string, score: number, o: Partial<RunSummary> = {}): RunSummary {
  const stats = computeStats({ mode, seed: o.seed ?? 1, dial: o.dial ?? 50, events: [], truncated: false });
  return { ...summariseRun({ ...stats, endReason: 'timer' }, score, o.date ?? '2026-01-01T00:00:00.000Z', []), ...o };
}

/** A finished run's record: `sectors` sectors cleared (the last entered one too), each worth `score / sectors`. */
function record(score: number, o: Partial<RunRecord> & { sectors?: number } = {}): RunRecord {
  const sectors = o.sectors ?? 3;
  const strip = Array.from({ length: sectors }, (_, i) => ({
    index: i + 1, role: 'take', condition: 'full', stake: 'plain', won: 1, lost: 0, hpIn: 100, hpOut: 90, cleared: true, flawless: false,
  }));
  const pace = Array.from({ length: sectors }, (_, i) => Math.round((score * (i + 1)) / sectors));
  return { seed: 1, dial: 50, score, depth: sectors, cleared: sectors, finaleCleared: false, strip, pace, contacts: [], ...o };
}

describe('the last primary pick (#207, design §4.1)', () => {
  const key = cfg.storageKey;

  it('is empty before the first pick, kept across a reload, and an older save without it reads as empty', () => {
    const storage = memoryStorage();
    const a = new ProgressStore(null, storage);
    expect(a.lastPrimary).toBe('');
    a.setLastPrimary('rill');
    expect(a.lastPrimary).toBe('rill');
    expect(new ProgressStore(null, storage).lastPrimary).toBe('rill');
    const old = { ...toSave(defaultProgress()) } as Record<string, unknown>;
    delete old.lastPrimary;
    expect(new ProgressStore(null, memoryStorage({ [key]: JSON.stringify(old) })).lastPrimary).toBe('');
  });

  it('a hand-edited value that is not a plain id is dropped', () => {
    const bad = { ...toSave(defaultProgress()), lastPrimary: '<script>' };
    expect(new ProgressStore(null, memoryStorage({ [key]: JSON.stringify(bad) })).lastPrimary).toBe('');
  });
});

describe('progress store: bests, plays and history', () => {
  it('starts empty and answers the menu\'s three reads', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.best('sweep')).toBeNull();
    expect(s.plays('sweep')).toBe(0);
    expect(s.flaggedSkill).toBeNull();
    expect(s.snapshot.ratings).toBeNull();
  });

  it('keeps one best run per dial band with seed, date, score, route and pace', () => {
    const s = new ProgressStore(null, memoryStorage());
    const first = s.recordRun(run('sweep', 1200, { dial: 30, seed: 7 }), record(1200, { dial: 30, seed: 7 }));
    expect(first).toMatchObject({ newBest: true, previousBest: null, newDeepest: true, finaleCleared: false });
    expect(s.recordRun(run('sweep', 900, { dial: 30 }), record(900, { dial: 30 }))).toMatchObject({ newBest: false, previousBest: 1200 });
    // a lower score at a harder band is its own best
    expect(s.recordRun(run('sweep', 500, { dial: 80, seed: 8, date: '2026-02-02T00:00:00.000Z' }), record(500, { dial: 80, seed: 8 })).newBest).toBe(true);
    const easy = s.bestRun(30)!;
    expect(easy).toMatchObject({ score: 1200, seed: 7, dial: 30, depth: 3, cleared: 3, pace: [400, 800, 1200] });
    expect(easy.strip).toHaveLength(3);
    expect(easy.date).toBe('2026-01-01T00:00:00.000Z');
    expect(s.bestRun(80)).toMatchObject({ score: 500, seed: 8, date: '2026-02-02T00:00:00.000Z' });
    expect(s.bestRun(60)).toBeNull(); // Neon: nothing yet
    expect(s.best('sweep')).toBe(1200);
    expect(s.plays('sweep')).toBe(3);
  });

  it('keeps the deepest run and the Finales cleared per band, apart from the best score', () => {
    const s = new ProgressStore(null, memoryStorage());
    s.recordRun(run('sweep', 3000), record(3000, { sectors: 3 }));
    const deep = s.recordRun(run('sweep', 1000), record(1000, { sectors: 7, finaleCleared: true }));
    expect(deep).toMatchObject({ newBest: false, newDeepest: true, finaleCleared: true });
    const r = s.bandRecords(50)!;
    expect(r.best!.score).toBe(3000);
    expect(r.deepest).toMatchObject({ score: 1000, depth: 7 }); // Overtime 1
    expect(r.finalesCleared).toBe(1);
    // the same depth with fewer sectors cleared, or a lower score, is not deeper
    expect(s.recordRun(run('sweep', 900), record(900, { sectors: 7, cleared: 6 })).newDeepest).toBe(false);
    expect(s.recordRun(run('sweep', 1100), record(1100, { sectors: 7, finaleCleared: true })).newDeepest).toBe(true);
    expect(s.bandRecords(50)!.finalesCleared).toBe(2);
  });

  it('keeps the Daily Route best per date and only the newest dates', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.recordRun(run('sweep', 500), record(500), '2026-03-01').newDailyBest).toBe(true);
    expect(s.recordRun(run('sweep', 400), record(400), '2026-03-01').newDailyBest).toBe(false);
    expect(s.recordRun(run('sweep', 600), record(600), '2026-03-01').newDailyBest).toBe(true);
    expect(s.dailyBest('2026-03-01')!.score).toBe(600);
    expect(s.dailyBest('2026-03-02')).toBeNull();
    const small = new ProgressStore(null, memoryStorage(), { ...cfg, maxDailyBests: 2 });
    for (const d of ['2026-03-01', '2026-03-03', '2026-03-02']) small.recordRun(run('sweep', 100), record(100), d);
    expect(Object.keys(small.snapshot.dailyBests).sort()).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('a zero score is a play, never a best; a drill keeps no best, a quit keeps only its contacts', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.recordRun(run('sweep', 0), record(0)).newBest).toBe(false);
    expect(s.recordRun(run('orbit', 900), null)).toMatchObject({ newBest: false, newDeepest: false });
    expect(s.best('sweep')).toBeNull();
    expect(s.best('orbit')).toBeNull(); // drill bests are read-only history now: nothing writes them
    expect(s.plays('orbit')).toBe(1);
    s.recordContactsOnly(record(300, { contacts: [{ card: 'clear', won: true, kept: 0.5 }] }));
    expect(s.situation('clear')).toMatchObject({ contacts: 1, wins: 1 });
    expect(s.plays('sweep')).toBe(1);
  });

  it('records the situations of a run: the last 50 contacts per card', () => {
    const s = new ProgressStore(null, memoryStorage());
    const contacts = Array.from({ length: 60 }, (_, i) => ({ card: 'take-expected', won: i % 2 === 0, kept: i < 55 ? 0.5 : 1 }));
    s.recordRun(run('sweep', 100), record(100, { contacts }));
    const st = s.situation('take-expected');
    expect(st.contacts).toBe(50);
    expect(st.wins).toBe(25);
    expect(st.winRate).toBe(0.5);
    expect(st.keptMean).toBeCloseTo((45 * 0.5 + 5 * 1) / 50, 5);
    expect(s.situation('take-expected', 20).contacts).toBe(20);
    expect(s.situation('nothing')).toEqual({ contacts: 0, wins: 0, winRate: null, keptMean: null });
    expect(s.situationCards).toEqual(['take-expected']);
  });

  it('keeps the last 200 runs, newest last, summaries only', () => {
    const st = memoryStorage();
    const s = new ProgressStore(null, st);
    s.batch(() => {
      for (let i = 0; i < 230; i++) s.recordRun(run('orbit', i + 1, { seed: i }), null);
    });
    expect(s.snapshot.history.length).toBe(cfg.historyMax);
    expect(s.snapshot.history[0]!.seed).toBe(30);
    expect(s.snapshot.history[199]!.seed).toBe(229);
    expect(s.plays('orbit')).toBe(230); // the count is not capped with the history
    const reloaded = new ProgressStore(null, st);
    expect(reloaded.snapshot.history.length).toBe(200);
    expect(JSON.stringify(s.snapshot.history[0])).not.toContain('events');
  });

  it('counts medals (written at the next commit) and the flagged skill', () => {
    const st = memoryStorage();
    const s = new ProgressStore(null, st);
    s.addMedal('needle', 'd1');
    s.addMedal('needle', 'd2');
    expect(s.medalCount('needle')).toBe(2);
    expect(st.data[cfg.storageKey]).toBeUndefined(); // deferred: nothing written mid-run
    s.setFlaggedSkill('track'); // any real change writes everything
    const r = new ProgressStore(null, st);
    expect(r.medalCount('needle')).toBe(2);
    expect(r.snapshot.medals.needle!.last).toBe('d2');
    expect(r.flaggedSkill).toBe('track');
  });

  it('announces what changed', () => {
    const bus = new EventBus<ProgressEvents>();
    const seen: (string | null)[] = [];
    bus.on('progressChanged', (e) => seen.push(e.modeId));
    const s = new ProgressStore(bus, memoryStorage());
    s.recordRun(run('orbit', 5), null);
    s.setFlaggedSkill('flick');
    expect(seen).toEqual(['orbit', null]);
  });
});

describe('progress store: persistence', () => {
  it('writes under flickline.save.v1 with a version, and reloads everything', () => {
    const st = memoryStorage();
    const s = new ProgressStore(null, st);
    const skills = new SkillState('some');
    skills.observe('flick', { itemDifficulty: 50, success: true });
    s.batch(() => {
      s.setRatings(skills.serialize());
      s.recordRun(run('sweep', 1200), record(1200));
      s.updateRanks([{ key: 'flick', sub: 7 }]);
    });
    expect(cfg.storageKey).toBe('flickline.save.v1');
    expect(JSON.parse(st.data[cfg.storageKey]!).version).toBe(SAVE_VERSION);
    const r = new ProgressStore(null, st);
    expect(r.snapshot).toEqual(s.snapshot);
    expect(SkillState.deserialize(r.snapshot.ratings)!.rating('flick')).toBeCloseTo(skills.rating('flick'), 0); // the grid is stored in 8 bits: well inside 0.1 dial points
    expect(r.snapshot.ranks.flick).toMatchObject({ at: 7, peak: 7 });
  });

  it('works from memory when storage is missing or blocked, and says so', () => {
    for (const storage of [null, blocked]) {
      const s = new ProgressStore(null, storage);
      expect(() => s.recordRun(run('orbit', 5), null)).not.toThrow();
      expect(s.plays('orbit')).toBe(1);
      expect(['memory', 'failed']).toContain(s.persistence);
    }
    expect(new ProgressStore(null, null).persistence).toBe('memory');
    const s = new ProgressStore(null, blocked);
    s.recordRun(run('orbit', 5), null);
    expect(s.persistence).toBe('failed');
  });

  it('a quota error on write keeps the data in memory', () => {
    const st = memoryStorage();
    const full: StorageLike = { getItem: (k) => st.getItem(k), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const s = new ProgressStore(null, full);
    s.recordRun(run('orbit', 7), null);
    expect(s.plays('orbit')).toBe(1);
    expect(s.persistence).toBe('failed');
  });

  it('keeps a corrupt stored save aside before replacing it', () => {
    const st = memoryStorage({ [cfg.storageKey]: '{"version":2,"history":"nope"' });
    const s = new ProgressStore(null, st);
    expect(s.snapshot).toEqual(defaultProgress());
    expect(st.data[`${cfg.storageKey}.bak`]).toBe('{"version":2,"history":"nope"');
    s.recordRun(run('orbit', 5), null);
    expect(JSON.parse(st.data[cfg.storageKey]!).plays.orbit).toBe(1);
    expect(st.data[`${cfg.storageKey}.bak`]).toBe('{"version":2,"history":"nope"'); // the bad one is still there
  });

  it('never overwrites a save from a newer build', () => {
    const newer = JSON.stringify({ version: SAVE_VERSION + 1, plays: { orbit: 99 } });
    const st = memoryStorage({ [cfg.storageKey]: newer });
    const s = new ProgressStore(null, st);
    expect(s.persistence).toBe('newer');
    s.recordRun(run('orbit', 5), null);
    expect(s.plays('orbit')).toBe(1); // it still plays
    expect(st.data[cfg.storageKey]).toBe(newer);
  });

  it('trims the oldest runs when the save would be too big', () => {
    const st = memoryStorage();
    const small = { ...cfg, maxSaveBytes: 6000 };
    const s = new ProgressStore(null, st, small);
    s.batch(() => {
      for (let i = 0; i < 100; i++) s.recordRun(run('orbit', i + 1, { seed: i }), null);
    });
    expect(st.data[cfg.storageKey]!.length).toBeLessThanOrEqual(6000);
    expect(s.snapshot.history[s.snapshot.history.length - 1]!.seed).toBe(99);
    expect(s.snapshot.history.length).toBeLessThan(100);
  });

  it('migrates a stored version 1 object and writes it back in the current version', () => {
    const v1 = JSON.stringify({ version: 1, playLog: { bests: { orbit: 5 }, plays: { orbit: 4 }, flaggedSkill: 'flick' } });
    const st = memoryStorage({ [cfg.storageKey]: v1 });
    const s = new ProgressStore(null, st);
    expect(s.plays('orbit')).toBe(4);
    expect(s.flaggedSkill).toBe('flick');
    s.setFlaggedSkill('track');
    expect(JSON.parse(st.data[cfg.storageKey]!).version).toBe(SAVE_VERSION);
  });

  it('replaces and resets, persisting both', () => {
    const st = memoryStorage();
    const s = new ProgressStore(null, st);
    s.recordRun(run('orbit', 5), null);
    const d = s.exportData();
    s.reset();
    expect(s.plays('orbit')).toBe(0);
    expect(JSON.parse(st.data[cfg.storageKey]!).plays).toEqual({});
    s.replace(d);
    expect(s.plays('orbit')).toBe(1);
  });
});

describe('save versions', () => {
  it('has a migration for every version below the current one', () => {
    for (let v = 1; v < SAVE_VERSION; v++) expect(typeof MIGRATIONS[v], `v${v}`).toBe('function');
  });

  it('refuses a newer, missing or non-integer version without touching anything', () => {
    for (const v of [SAVE_VERSION + 1, 0, -1, 1.5, '2', null, undefined]) {
      const r = readProgress(JSON.stringify({ version: v }));
      expect(r.ok, String(v)).toBe(false);
    }
  });

  it('a populated save round-trips through JSON unchanged', () => {
    const s = new ProgressStore(null, null);
    s.recordRun(run('sweep', 1200, { dial: 61 }), record(1200, { dial: 61, contacts: [{ card: 'clear', won: true, kept: 0.8 }] }));
    s.addMedal('hairline', 'd');
    s.updateRanks([{ key: 'line', sub: 4 }]);
    const r = readProgress(JSON.stringify(toSave(s.snapshot as never)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(s.snapshot);
  });
});

describe('no time-played XP', () => {
  it('appears nowhere in a populated save', () => {
    const s = new ProgressStore(null, null);
    for (let i = 0; i < 3; i++) s.recordRun(run('sweep', 100 + i, { dial: 61 }), record(100 + i, { dial: 61 }));
    s.addMedal('flawless', 'd');
    s.updateRanks([{ key: 'flick', sub: 3 }]);
    s.setRatings(new SkillState('some').serialize());
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        for (const k of Object.keys(v)) {
          keys.push(k);
          walk((v as Record<string, unknown>)[k]);
        }
      }
    };
    walk(toSave(s.snapshot as never));
    expect(keys.length).toBeGreaterThan(20);
    for (const k of keys) expect(k, k).not.toMatch(/xp|experience|time.?played|play.?time|playtime|minutes|hours|seconds.?played|duration|login|streakdays/i);
  });
});

describe('progress store: cold openers (#209)', () => {
  const rec = {
    v: 2, date: '2026-03-01', at: '2026-03-01T08:00:00.000Z', gapH: 12, seed: 3, level: 45, legs: 6, of: 6, score: 1500, dial: 50,
    skills: { angles: [50, 9, 4] as [number, number, number] }, trials: 6, contacts: 6, won: 4, headRate: 0.5, ttsMs: 600, movingShare: 0.1,
    kept: 0.8, warm: false, sens: 0.4, end: 'exit' as const,
  };
  it('keeps a record and the level in memory until commit, then in the save; the warm answer is changed on the newest', () => {
    const storage = memoryStorage();
    const store = new ProgressStore(null, storage);
    store.addColdOpener(rec, { v: 2, level: 45, moves: [] });
    expect(storage.data[cfg.storageKey]).toBeUndefined(); // not written mid-run
    store.commit();
    const back = new ProgressStore(null, storage);
    expect(back.snapshot.coldOpeners).toEqual([rec]);
    expect(back.snapshot.coldOpenerLevels).toEqual({ v: 2, level: 45, moves: [] });
    expect(back.setColdOpenerWarm(true)).toBe(true);
    expect(new ProgressStore(null, storage).snapshot.coldOpeners[0]!.warm).toBe(true);
    expect(new ProgressStore(null, memoryStorage()).setColdOpenerWarm(true)).toBe(false);
  });
});
