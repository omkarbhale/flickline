import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { PLAY_LOG_KEY, PlayLog, sanitizePlayLog, type PlayLogEvents } from './playLog';
import type { StorageLike } from './settings';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

describe('play log', () => {
  it('starts empty', () => {
    const log = new PlayLog(new EventBus<PlayLogEvents>(), memoryStorage());
    expect(log.best('orbit')).toBeNull();
    expect(log.plays('orbit')).toBe(0);
    expect(log.flaggedSkill).toBeNull();
  });

  it('keeps the best score and counts every finished run', () => {
    const log = new PlayLog(new EventBus<PlayLogEvents>(), memoryStorage());
    expect(log.recordRun('orbit', 1200)).toBe(true);
    expect(log.recordRun('orbit', 900)).toBe(false);
    expect(log.recordRun('orbit', 1500.4)).toBe(true);
    expect(log.best('orbit')).toBe(1500);
    expect(log.plays('orbit')).toBe(3);
    expect(log.plays('coldStart')).toBe(0);
  });

  it('a zero score counts as a play but is never a best', () => {
    const log = new PlayLog(new EventBus<PlayLogEvents>(), memoryStorage());
    expect(log.recordRun('orbit', 0)).toBe(false);
    expect(log.best('orbit')).toBeNull();
    expect(log.plays('orbit')).toBe(1);
  });

  it('persists and reloads, and announces changes', () => {
    const st = memoryStorage();
    const bus = new EventBus<PlayLogEvents>();
    const seen: (string | null)[] = [];
    bus.on('playLogChanged', (e) => seen.push(e.modeId));
    const a = new PlayLog(bus, st);
    a.recordRun('coldStart', 300);
    a.setFlaggedSkill('track');
    const b = new PlayLog(new EventBus<PlayLogEvents>(), st);
    expect(b.best('coldStart')).toBe(300);
    expect(b.flaggedSkill).toBe('track');
    expect(seen).toEqual(['coldStart', null]);
  });

  it('survives blocked or corrupt storage', () => {
    const throwing: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const log = new PlayLog(new EventBus<PlayLogEvents>(), throwing);
    expect(() => log.recordRun('orbit', 5)).not.toThrow();
    expect(log.best('orbit')).toBe(5);
    const bad = new PlayLog(new EventBus<PlayLogEvents>(), memoryStorage({ [PLAY_LOG_KEY]: '{nope' }));
    expect(bad.best('orbit')).toBeNull();
  });

  it('sanitises anything it reads', () => {
    const clean = sanitizePlayLog({ bests: { a: 5, b: -1, c: 'x', d: NaN }, plays: { a: 2.5, b: 3 }, flaggedSkill: 'nope' });
    expect(clean).toEqual({ bests: { a: 5 }, plays: { b: 3 }, flaggedSkill: null });
    expect(sanitizePlayLog(null)).toEqual({ bests: {}, plays: {}, flaggedSkill: null });
    expect(sanitizePlayLog({ flaggedSkill: 'flick' }).flaggedSkill).toBe('flick');
  });
});
