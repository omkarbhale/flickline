import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { ProgressStore } from '../progress/store';
import type { RunRecord } from '../progress/runRecords';
import type { RunSummary } from '../progress/save';
import type { StorageLike } from '../settings/settings';
import { addDays, dailyLabel, dailySeed, isDateKey, localDateKey } from './dailyRoute';
import { SWEEP_MODE, sweepPlan, type SweepState } from './sweep';

const tunables = cloneTunables();

describe('the Daily Route seed (#208)', () => {
  it('is pinned: the seed of a date does not change between releases without a version bump', () => {
    // Golden values of seedVersion 1 (also computed by an independent implementation of the documented hash). If this fails the hash or the salt changed: bump `daily.seedVersion` on purpose and update these.
    expect(tunables.daily.seedVersion).toBe(1);
    expect(dailySeed('2026-01-01', tunables.daily)).toBe(GOLDEN['2026-01-01']);
    expect(dailySeed('2026-03-01', tunables.daily)).toBe(GOLDEN['2026-03-01']);
    expect(dailySeed('2026-11-15', tunables.daily)).toBe(GOLDEN['2026-11-15']);
  });

  it('is in the range of a run seed, and the version is part of it', () => {
    for (let i = 0; i < 400; i++) {
      const s = dailySeed(addDays('2026-01-01', i));
      expect(Number.isInteger(s) && s >= 1 && s <= 0x7fffffff).toBe(true);
    }
    expect(dailySeed('2026-03-01', { ...tunables.daily, seedVersion: 2 })).not.toBe(dailySeed('2026-03-01', tunables.daily));
  });

  it('gives every date of two years a different seed', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 731; i++) seen.add(dailySeed(addDays('2026-01-01', i)));
    expect(seen.size).toBe(731);
  });

  it('refuses anything that is not a calendar date', () => {
    for (const bad of ['', '2026-3-1', '2026-02-30', '2026-13-01', 'today', '2026-03-01T00:00']) {
      expect(isDateKey(bad), bad).toBe(false);
      expect(() => dailySeed(bad), bad).toThrow();
    }
    expect(isDateKey('2028-02-29')).toBe(true);
  });

  it('takes the date from the local calendar and counts days without daylight-saving drift', () => {
    expect(localDateKey(new Date(2026, 2, 1, 0, 0, 0))).toBe('2026-03-01');
    expect(localDateKey(new Date(2026, 2, 1, 23, 59, 59, 999))).toBe('2026-03-01');
    expect(localDateKey(new Date(2026, 2, 2, 0, 0, 0))).toBe('2026-03-02');
    expect(localDateKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(dailyLabel('2026-11-15')).toBe('Sun 15 Nov');
  });
});

/** The route of a date as a player plays it: a fresh game (profile) and a dial of its own. */
function playedRoute(dateKey: string, dial: number): unknown {
  const g = new HeadlessGame({ seed: 1 });
  expect(g.modes.start(SWEEP_MODE, { seed: dailySeed(dateKey), pinDial: dial })).toBe(true);
  const state = g.modes.runner.state as SweepState;
  return { seed: state.plan.seed, sectors: state.plan.sectors };
}

describe('the Daily Route is one route per date (#208)', () => {
  it('same date: the same route on two fresh profiles, whatever each one\'s dial', () => {
    const a = playedRoute('2026-03-01', 15);
    const b = playedRoute('2026-03-01', 85);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify({ seed: dailySeed('2026-03-01'), sectors: sweepPlan(dailySeed('2026-03-01'), tunables).sectors }));
  });

  it('next date: a different route', () => {
    for (const day of ['2026-03-01', '2026-03-31', '2026-12-31']) {
      const today = JSON.stringify(sweepPlan(dailySeed(day), tunables).sectors);
      expect(JSON.stringify(sweepPlan(dailySeed(addDays(day, 1)), tunables).sectors), day).not.toBe(today);
    }
  });
});

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } as StorageLike & { map: Map<string, string> };
}
const summary = (score: number): RunSummary => ({ mode: 'sweep', date: '2026-03-01T10:00:00.000Z', score } as unknown as RunSummary);
const record = (score: number, seed: number): RunRecord => ({
  seed, dial: 40, score, depth: 3, cleared: 2, finaleCleared: false, strip: [], pace: [], contacts: [],
} as unknown as RunRecord);

describe('the day best (#208)', () => {
  it('persists across a reload, belongs to its date and is empty on the next one', () => {
    const storage = memoryStorage();
    const first = new ProgressStore(null, storage);
    const seed = dailySeed('2026-03-01');
    expect(first.recordRun(summary(700), record(700, seed), '2026-03-01').newDailyBest).toBe(true);
    expect(first.recordRun(summary(400), record(400, seed), '2026-03-01').newDailyBest).toBe(false);
    first.commit();
    const reloaded = new ProgressStore(null, storage);
    expect(reloaded.dailyBest('2026-03-01')?.score).toBe(700);
    expect(reloaded.dailyBest('2026-03-01')?.seed).toBe(seed);
    // Local midnight: the date key moves on, so the day best of the new date starts empty (and yesterday's stays).
    expect(reloaded.dailyBest(addDays('2026-03-01', 1))).toBeNull();
    expect(reloaded.dailyBest('2026-03-01')?.score).toBe(700);
  });

  it('a run that is not the Daily Route never sets a day best', () => {
    const s = new ProgressStore(null, memoryStorage());
    expect(s.recordRun(summary(900), record(900, 5), null).newDailyBest).toBe(false);
    expect(s.dailyBest('2026-03-01')).toBeNull();
  });
});

const GOLDEN: Record<string, number> = { '2026-01-01': 2121679360, '2026-03-01': 361212186, '2026-11-15': 569833767 };
