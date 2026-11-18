import { describe, expect, it } from 'vitest';
import { progress as cfg } from '../config/progress';
import type { StorageLike } from '../settings/settings';
import { migrateSave, readProgress, SAVE_VERSION } from './save';
import { ProgressStore } from './store';

/** A version-2 save as #199 wrote it: drill bests per mode and band with a ghost curve, the Baseline slots. */
function v2(): Record<string, unknown> {
  const stats = { shots: 40, hits: 30, headHits: 12, kills: 28, movingShots: 1, accuracy: 0.75, headshotRate: 0.4, medianRtMs: 480, medianTtkMs: 120, maxChain: 5, cleanKills: 20 };
  return {
    version: 2,
    ratings: null,
    ranks: { line: { at: 6, peak: 8, up: 0, down: 1, to: 5 } },
    bests: {
      modeA: { neon: { score: 1200, seed: 7, date: '2026-01-01T00:00:00.000Z', dial: 61, stats, curve: [0, 100, 250, 1200] } },
      modeB: { chalkBrass: { score: 800, seed: 3, date: '2026-01-02T00:00:00.000Z', dial: 12, stats, curve: [0, 800] } },
    },
    medals: { needle: { count: 2, last: '2026-01-01T00:00:00.000Z' }, metronome: { count: 1, last: '2026-01-01T00:00:00.000Z' } },
    history: [{ mode: 'modeA', seed: 7, dial: 61, date: '2026-01-01T00:00:00.000Z', reason: 'timer', score: 1200, medals: ['needle'], ...stats }],
    plays: { modeA: 5, modeB: 2 },
    flaggedSkill: 'flick',
    baselines: [{ day: '2026-01-01', cold: 41 }],
    baselineLevels: { precision: 30 },
    checkins: [{ day: '2026-01-03' }],
  };
}

describe('save v2 -> v4 (#217, #251)', () => {
  it('is the current version and has a migration step from v2', () => {
    expect(SAVE_VERSION).toBe(4);
    expect(typeof migrateSave(v2())).toBe('object');
  });

  it('loads without crashing: drill bests kept read-only, run bests and situations start empty', () => {
    const r = readProgress(JSON.stringify(v2()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.from).toBe(2);
    const d = r.data;
    expect(d.runBests).toEqual({});
    expect(d.dailyBests).toEqual({});
    expect(d.situations).toEqual({});
    expect(d.drillBests.modeA!.neon).toEqual({
      score: 1200, seed: 7, date: '2026-01-01T00:00:00.000Z', dial: 61,
      stats: expect.objectContaining({ shots: 40, accuracy: 0.75 }),
    });
    expect(d.drillBests.modeB!.chalkBrass!.score).toBe(800);
    // the ghost's score curve is gone: the pace bar compares by sector now
    expect(JSON.stringify(d.drillBests)).not.toContain('curve');
  });

  it('renames the empty Baseline slots to the cold-opener slots and keeps what they hold', () => {
    const r = readProgress(JSON.stringify(v2()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.coldOpeners).toEqual([{ day: '2026-01-01', cold: 41 }]);
    expect(r.data.coldOpenerLevels).toEqual({ precision: 30 });
    expect(r.data.checkins).toEqual([{ day: '2026-01-03' }]);
    expect('baselines' in r.data).toBe(false);
    expect('baselineLevels' in r.data).toBe(false);
    expect('bests' in r.data).toBe(false);
  });

  it('keeps everything else: ranks, medals (Metronome included, as history), history, plays, flagged skill', () => {
    const r = readProgress(JSON.stringify(v2()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ranks.line).toMatchObject({ at: 6, peak: 8 });
    expect(r.data.medals.needle!.count).toBe(2);
    expect(r.data.medals.metronome!.count).toBe(1);
    expect(r.data.history).toHaveLength(1);
    expect(r.data.plays).toEqual({ modeA: 5, modeB: 2 });
    expect(r.data.flaggedSkill).toBe('flick');
  });

  it('does not touch the input and tolerates a v2 save with nothing in the moved slots', () => {
    const input = v2();
    const copy = JSON.stringify(input);
    migrateSave(input);
    expect(JSON.stringify(input)).toBe(copy);
    const bare = readProgress(JSON.stringify({ version: 2 }));
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.data.runBests).toEqual({});
  });

  it('the store loads it, shows the drill bests to the menu, writes it back as v4 and records a first run best next to them', () => {
    const data: Record<string, string> = { [cfg.storageKey]: JSON.stringify(v2()) };
    const storage: StorageLike = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
    const s = new ProgressStore(null, storage);
    expect(s.best('modeA')).toBe(1200); // a drill: its read-only best
    expect(s.best('sweep')).toBeNull(); // a run mode: nothing yet
    expect(s.bestRun(50)).toBeNull();
    s.setFlaggedSkill('track'); // any write persists the migrated save
    const stored = JSON.parse(data[cfg.storageKey]!);
    expect(stored.version).toBe(4);
    expect(stored.journal).toEqual({ firstDay: null, sessions: [], runs: [], days: [] });
    expect(stored.drillBests.modeA.neon.score).toBe(1200);
    expect(stored.bests).toBeUndefined();
    // a drill run after the migration does not write a drill best
    s.recordRun({ mode: 'modeA', seed: 1, dial: 61, date: 'd', reason: 'timer', score: 5000, medals: [], shots: 0, hits: 0, headHits: 0, kills: 0, movingShots: 0, accuracy: null, headshotRate: null, medianRtMs: null, medianTtkMs: null, maxChain: 0, cleanKills: 0 }, null);
    expect(s.best('modeA')).toBe(1200);
  });

  it('a v1 file still walks all the way to v4', () => {
    const r = readProgress(JSON.stringify({ version: 1, playLog: { bests: { modeA: 5 }, plays: { modeA: 4 }, flaggedSkill: 'flick' } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe(1);
      expect(r.data.plays.modeA).toBe(4);
      expect(r.data.drillBests).toEqual({});
    }
  });

  it('sanitises hand-edited run records: clamps, drops what cannot be read, caps the strip', () => {
    const r = readProgress(JSON.stringify({
      version: 4,
      runBests: {
        neon: { best: { score: 1e12, depth: -4, cleared: 'x', seed: 5, date: 'd', dial: 500, strip: Array.from({ length: 80 }, () => ({ index: 1, role: 'take', won: 1e9 })), pace: [1, 'a', 3] }, deepest: 'nope', finalesCleared: -3 },
        notABand: { best: { score: 5 } },
      },
      dailyBests: { 'not-a-date': { score: 5 }, '2026-04-01': { score: 9, depth: 2 } },
      situations: { clear: [{ won: true, kept: 7 }, 'junk', { won: 'yes', kept: 0.5 }] },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.data.runBests.neon!;
    expect(Object.keys(r.data.runBests)).toEqual(['neon']);
    expect(b.best).toMatchObject({ score: 1e9, depth: 1, cleared: 0, dial: 100 });
    expect(b.best!.strip).toHaveLength(cfg.maxStrip);
    expect(b.best!.strip[0]!.won).toBe(99);
    expect(b.best!.pace).toEqual([1, 0, 3]);
    expect(b.deepest).toBeNull();
    expect(b.finalesCleared).toBe(0);
    expect(Object.keys(r.data.dailyBests)).toEqual(['2026-04-01']);
    expect(r.data.situations.clear).toEqual([{ won: true, kept: 1 }, { won: false, kept: 0.5 }]);
  });

  it('refuses run records of the wrong top-level shape (the whole save, nothing half-imported)', () => {
    for (const k of ['runBests', 'dailyBests', 'situations', 'drillBests']) {
      expect(readProgress(JSON.stringify({ version: 4, [k]: [] })).ok, k).toBe(false);
    }
  });
});
