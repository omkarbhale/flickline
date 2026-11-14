import { describe, expect, it } from 'vitest';
import { dial } from '../config/dial';
import { progress } from '../config/progress';
import { computeStats } from '../feedback/statTracker';
import type { RunLog } from '../feedback/eventLog';
import { bandOf, summariseRun } from './bests';

describe('dial bands (design §8.4)', () => {
  it('are Chalk/Brass, Steel/Cobalt, Neon and Prism/Zenith', () => {
    const at = (name: string): number => dial.tiers.find((t) => t.name === name)!.from;
    expect(progress.bands.map((b) => b.id)).toEqual(['chalkBrass', 'steelCobalt', 'neon', 'prismZenith']);
    expect(progress.bands.map((b) => b.from)).toEqual([at('Chalk'), at('Steel'), at('Neon'), at('Prism')]);
  });

  it('put every dial value in exactly one band, boundaries going up', () => {
    expect(bandOf(0)).toBe('chalkBrass');
    expect(bandOf(27.99)).toBe('chalkBrass');
    expect(bandOf(28)).toBe('steelCobalt');
    expect(bandOf(57.9)).toBe('steelCobalt');
    expect(bandOf(58)).toBe('neon');
    expect(bandOf(71.9)).toBe('neon');
    expect(bandOf(72)).toBe('prismZenith');
    expect(bandOf(100)).toBe('prismZenith');
    expect(bandOf(-5)).toBe('chalkBrass');
    expect(bandOf(140)).toBe('prismZenith');
  });
});

describe('run summary', () => {
  it('keeps the numbers of a finished run and no duration, XP or time played', () => {
    const log: RunLog = { mode: 'orbit', seed: 9, dial: 61.5, events: [], truncated: false };
    const stats = computeStats(log);
    const s = summariseRun({ ...stats, endReason: 'timer' }, 1234.6, '2026-01-01T00:00:00.000Z', ['needle', 'needle', 'flawless']);
    expect(s).toMatchObject({ mode: 'orbit', seed: 9, dial: 61.5, reason: 'timer', score: 1235, medals: ['needle', 'flawless'], date: '2026-01-01T00:00:00.000Z' });
    expect(Object.keys(s).join(' ')).not.toMatch(/xp|time|duration|minutes|seconds/i);
  });
});
