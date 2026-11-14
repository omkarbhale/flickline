import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { dial as cfg } from '../config/dial';
import { DEFAULT_PROFILE, PROFILE_KEY, ProfileStore, sanitizeProfile, skillPrior, type ProfileEvents } from './profile';
import type { StorageLike } from './settings';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

describe('skill prior from the self-report chips', () => {
  it('maps the four chips to 15 / 35 / 55 / 75 and skip to 40', () => {
    expect(skillPrior('new').mean).toBe(15);
    expect(skillPrior('some').mean).toBe(35);
    expect(skillPrior('experienced').mean).toBe(55);
    expect(skillPrior('competitive').mean).toBe(75);
    expect(skillPrior(null).mean).toBe(40);
  });
  it('always carries the configured standard deviation', () => {
    for (const r of [null, 'new', 'competitive'] as const) expect(skillPrior(r).sd).toBe(cfg.priorSd);
    expect(cfg.priorSd).toBe(25);
  });
});

describe('profile store', () => {
  it('starts as a first-time player and persists changes', () => {
    const st = memoryStorage();
    const store = new ProfileStore(new EventBus<ProfileEvents>(), st);
    expect(store.get()).toEqual(DEFAULT_PROFILE);
    store.set({ selfReport: 'experienced', firstRunDone: true });
    expect(JSON.parse(st.data[PROFILE_KEY]!)).toEqual({ selfReport: 'experienced', firstRunDone: true });
    const again = new ProfileStore(new EventBus<ProfileEvents>(), st);
    expect(again.get().firstRunDone).toBe(true);
    expect(again.prior().mean).toBe(55);
  });
  it('emits only when something changed', () => {
    const bus = new EventBus<ProfileEvents>();
    const seen: string[][] = [];
    bus.on('profileChanged', (e) => seen.push([...e.changed]));
    const store = new ProfileStore(bus, memoryStorage());
    store.set({ selfReport: null });
    store.set({ selfReport: 'some' });
    store.set({ selfReport: 'some' });
    expect(seen).toEqual([['selfReport']]);
  });
  it('survives corrupt, hostile or missing storage', () => {
    expect(new ProfileStore(new EventBus<ProfileEvents>(), memoryStorage({ [PROFILE_KEY]: '{nope' })).get()).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile({ selfReport: 'god', firstRunDone: 'yes' })).toEqual(DEFAULT_PROFILE);
    expect(new ProfileStore(new EventBus<ProfileEvents>(), null).get()).toEqual(DEFAULT_PROFILE);
    const throwing: StorageLike = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    const store = new ProfileStore(new EventBus<ProfileEvents>(), throwing);
    expect(() => store.set({ firstRunDone: true })).not.toThrow();
    expect(store.get().firstRunDone).toBe(true);
  });
});
