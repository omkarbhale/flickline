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
  it('keeps feedback toggles as booleans and defaults them for garbage', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ coachingCues: true, cueFading: true, cleanRun: true, missGhost: true, damageNumbers: true, reduceFlashing: false });
    const s = sanitizeSettings({ coachingCues: 'yes', missGhost: false, reduceFlashing: true, damageNumbers: 1 });
    expect(s.coachingCues).toBe(true);
    expect(sanitizeSettings({ cueFading: false, cleanRun: false })).toMatchObject({ cueFading: false, cleanRun: false });
    expect(sanitizeSettings({ cueFading: 0, cleanRun: 'no' })).toMatchObject({ cueFading: true, cleanRun: true });
    expect(s.missGhost).toBe(false);
    expect(s.reduceFlashing).toBe(true);
    expect(s.damageNumbers).toBe(true);
    const store = new SettingsStore(new EventBus<SettingsEvents>(), memoryStorage());
    store.set({ reduceFlashing: true });
    expect(store.get().reduceFlashing).toBe(true);
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

  it('sanitises Reduce flashing and the flinch strength', () => {
    expect(DEFAULT_SETTINGS.reduceFlashing).toBe(false);
    expect(DEFAULT_SETTINGS.chromaticPulse).toBe(false); // optional: off until the player opts in (design section 11)
    expect(sanitizeSettings({ chromaticPulse: 'yes' }).chromaticPulse).toBe(false);
    expect(sanitizeSettings({ chromaticPulse: true }).chromaticPulse).toBe(true);
    expect(DEFAULT_SETTINGS.flinchStrength).toBe(1);
    const s = sanitizeSettings({ reduceFlashing: 'yes', flinchStrength: 9 });
    expect(s.reduceFlashing).toBe(false);
    expect(s.flinchStrength).toBe(2);
    expect(sanitizeSettings({ reduceFlashing: true, flinchStrength: 0 })).toMatchObject({ reduceFlashing: true, flinchStrength: 0 });
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

describe('settings menu fields (design §13.3)', () => {
  it('defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      invertY: false, rawInput: true, hitSoundStyle: 'standard', monoAudio: false, tellVolume: 1,
      renderScale: 1, fpsCap: 0, showFps: false, postEffects: 'auto', enemyOutline: 'auto', echoPreset: 'ember',
      coachingCues: true, missGhost: true, damageNumbers: true, reduceFlashing: false,
    });
    expect(DEFAULT_SETTINGS.difficultyPin).toEqual({});
  });

  it('keeps FPS cap to the four options', () => {
    for (const c of [0, 60, 144, 240]) expect(sanitizeSettings({ fpsCap: c }).fpsCap).toBe(c);
    for (const bad of [30, 100, -1, '60', null]) expect(sanitizeSettings({ fpsCap: bad }).fpsCap).toBe(DEFAULT_SETTINGS.fpsCap);
  });

  it('clamps render scale and the tell volume, and rejects unknown options', () => {
    expect(sanitizeSettings({ renderScale: 0.1 }).renderScale).toBe(0.5);
    expect(sanitizeSettings({ renderScale: 3 }).renderScale).toBe(1);
    expect(sanitizeSettings({ tellVolume: 2 }).tellVolume).toBe(1);
    const s = sanitizeSettings({ postEffects: 'maybe', enemyOutline: 'on', echoPreset: 'neon', hitSoundStyle: 'loud' });
    expect(s.postEffects).toBe('auto');
    expect(s.enemyOutline).toBe('on');
    expect(s.echoPreset).toBe('ember');
    expect(s.hitSoundStyle).toBe('standard');
  });

  it('has no field of view setting: the sim FOV can not be changed from here', () => {
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => /fov|fieldofview/i.test(k))).toEqual([]);
    const s = sanitizeSettings({ fov: 140, hfov: 140, fieldOfView: 140 }) as unknown as Record<string, unknown>;
    expect(Object.keys(s).filter((k) => /fov|fieldofview/i.test(k))).toEqual([]);
  });

  it('persists and reloads key bindings, rejecting a conflicting save', () => {
    const st = memoryStorage();
    const store = new SettingsStore(new EventBus<SettingsEvents>(), st);
    store.set({ keys: { ...store.get().keys, jump: ['KeyF'] } });
    expect(new SettingsStore(new EventBus<SettingsEvents>(), st).get().keys.jump).toEqual(['KeyF']);
    const dup = memoryStorage({ [SETTINGS_KEY]: JSON.stringify({ keys: { jump: ['KeyW'] } }) });
    const keys = new SettingsStore(new EventBus<SettingsEvents>(), dup).get().keys;
    expect(keys.forward).toContain('KeyW');
    expect(keys.jump).not.toContain('KeyW');
  });

  it('names changed keys, including the nested ones, and ignores no-op sets', () => {
    const bus = new EventBus<SettingsEvents>();
    const seen: string[][] = [];
    bus.on('settingsChanged', (e) => seen.push([...e.changed]));
    const store = new SettingsStore(bus, memoryStorage());
    store.set({ keys: { ...store.get().keys } }); // same value
    store.set({ keys: { ...store.get().keys, reload: ['KeyT'] } });
    store.set({ difficultyPin: { orbit: 40 } });
    store.set({ difficultyPin: { orbit: 40 } });
    store.set({ fpsCap: 144, showFps: true });
    expect(seen).toEqual([['keys'], ['difficultyPin'], ['fpsCap', 'showFps']]);
  });

  it('sanitises difficulty pins: dial range, mode id shape, count', () => {
    const p = sanitizeSettings({ difficultyPin: { orbit: 150, coldStart: -5, 'bad id!': 3, strafeTrack: 'x', ok_1: 40.6 } }).difficultyPin;
    expect(p).toEqual({ orbit: 100, coldStart: 0, ok_1: 41 });
  });
});
