import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { progress as cfg } from '../config/progress';
import { SkillState } from '../adaptive/skillModel';
import type { StorageLike } from '../settings/settings';
import { summariseRun } from './bests';
import { defaultProgress, MIGRATIONS, readProgress, SAVE_VERSION, toSave, type RunSummary } from './save';
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

const curve = [0, 100, 250];

describe('progress store: bests, plays and history', () => {
  it('starts empty and answers the menu\'s three reads', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.best('orbit')).toBeNull();
    expect(s.plays('orbit')).toBe(0);
    expect(s.flaggedSkill).toBeNull();
    expect(s.snapshot.ratings).toBeNull();
  });

  it('keeps one best per (mode, band) with seed, date, score, stats and curve', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.recordRun(run('orbit', 1200, { dial: 30, seed: 7 }), curve)).toEqual({ newBest: true, previousBest: null });
    expect(s.recordRun(run('orbit', 900, { dial: 30 }), curve)).toEqual({ newBest: false, previousBest: 1200 });
    // a lower score at a harder band is its own best
    expect(s.recordRun(run('orbit', 500, { dial: 80, seed: 8, date: '2026-02-02T00:00:00.000Z' }), curve).newBest).toBe(true);
    const easy = s.bestAt('orbit', 30)!;
    expect(easy).toMatchObject({ score: 1200, seed: 7, dial: 30, curve });
    expect(easy.stats).toMatchObject({ shots: 0, accuracy: null });
    expect(easy.date).toBe('2026-01-01T00:00:00.000Z');
    expect(s.bestAt('orbit', 80)).toMatchObject({ score: 500, seed: 8, date: '2026-02-02T00:00:00.000Z' });
    expect(s.bestAt('orbit', 60)).toBeNull(); // Neon: nothing yet
    expect(s.best('orbit')).toBe(1200);
    expect(s.plays('orbit')).toBe(3);
  });

  it('a zero score is a play, never a best; the placement run keeps no best', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.recordRun(run('orbit', 0), null).newBest).toBe(false);
    expect(s.recordRun(run('placement', 900), null).newBest).toBe(false);
    expect(s.best('orbit')).toBeNull();
    expect(s.best('placement')).toBeNull();
    expect(s.plays('placement')).toBe(1);
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
      s.recordRun(run('orbit', 1200), curve);
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
      expect(s.best('orbit')).toBe(5);
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
    expect(s.best('orbit')).toBe(7);
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
    expect(s.best('orbit')).toBe(5); // it still plays
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
    s.recordRun(run('orbit', 1200, { dial: 61 }), curve);
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
    for (let i = 0; i < 3; i++) s.recordRun(run('orbit', 100 + i, { dial: 61 }), curve);
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
