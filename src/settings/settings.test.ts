import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { DEFAULT_SETTINGS, SETTINGS_KEY, SettingsStore, sanitizeSettings, type SettingsEvents, type StorageLike } from './settings';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('settings', () => {
  it('starts from defaults and persists changes', () => {
    const st = memoryStorage();
    const store = new SettingsStore(new EventBus<SettingsEvents>(), st);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    store.set({ sensitivity: 0.55, quality: 'high' });
    expect(JSON.parse(st.data[SETTINGS_KEY]!)).toMatchObject({ sensitivity: 0.55, quality: 'high' });
    const again = new SettingsStore(new EventBus<SettingsEvents>(), st);
    expect(again.get().sensitivity).toBe(0.55);
  });
  it('emits only when something changed, naming the keys', () => {
    const bus = new EventBus<SettingsEvents>();
    const seen: string[][] = [];
    bus.on('settingsChanged', (e) => seen.push([...e.changed]));
    const store = new SettingsStore(bus, memoryStorage());
    store.set({ volume: DEFAULT_SETTINGS.volume });
    store.set({ volume: 0.2 });
    expect(seen).toEqual([['volume']]);
  });
  it('clamps and rejects garbage', () => {
    const s = sanitizeSettings({ sensitivity: -3, dpi: 'x', volume: 9, quality: 'ultra' });
    expect(s.sensitivity).toBe(0.01);
    expect(s.dpi).toBe(DEFAULT_SETTINGS.dpi);
    expect(s.volume).toBe(1);
    expect(s.quality).toBe(DEFAULT_SETTINGS.quality);
  });
  it('clamps the per-bus audio volumes and defaults them to full', () => {
    const s = sanitizeSettings({ weaponsVolume: -1, hitsVolume: 5, uiVolume: 'loud' });
    expect(s.weaponsVolume).toBe(0);
    expect(s.hitsVolume).toBe(1);
    expect(s.uiVolume).toBe(1);
    expect(s.enemiesVolume).toBe(1);
  });
  it('survives corrupt storage and a null storage', () => {
    const bad = memoryStorage({ [SETTINGS_KEY]: '{not json' });
    expect(new SettingsStore(new EventBus<SettingsEvents>(), bad).get()).toEqual(DEFAULT_SETTINGS);
    const store = new SettingsStore(new EventBus<SettingsEvents>(), null);
    store.set({ volume: 0.1 });
    expect(store.get().volume).toBe(0.1);
  });
});

describe('hud settings', () => {
  it('default every element on at scale 1, and a stored partial object is completed', () => {
    const s = sanitizeSettings({ hud: { scale: 1.2, show: { ghost: false, bogus: false } } });
    expect(s.hud.scale).toBe(1.2);
    expect(s.hud.show.ghost).toBe(false);
    expect(s.hud.show.timer).toBe(true);
    expect(Object.keys(s.hud.show)).not.toContain('bogus');
    expect(sanitizeSettings(null).hud.show.edge).toBe(true);
  });
  it('clamps the scale and ignores non-boolean toggles', () => {
    expect(sanitizeSettings({ hud: { scale: 99 } }).hud.scale).toBe(1.6);
    expect(sanitizeSettings({ hud: { scale: -1 } }).hud.scale).toBe(0.6);
    expect(sanitizeSettings({ hud: { scale: 'x', show: { acc: 'no' } } }).hud).toEqual(sanitizeSettings(null).hud);
  });
  it('a toggle persists, emits `hud` and does not mutate the defaults', () => {
    const bus = new EventBus<SettingsEvents>();
    const seen: string[][] = [];
    bus.on('settingsChanged', (e) => seen.push([...e.changed]));
    const st = memoryStorage();
    const store = new SettingsStore(bus, st);
    const h = structuredClone(store.get().hud);
    h.show.rt = false;
    store.set({ hud: h });
    expect(seen).toEqual([['hud']]);
    store.set({ hud: structuredClone(h) });
    expect(seen.length).toBe(1);
    expect(new SettingsStore(new EventBus<SettingsEvents>(), st).get().hud.show.rt).toBe(false);
    expect(DEFAULT_SETTINGS.hud.show.rt).toBe(true);
  });
});
