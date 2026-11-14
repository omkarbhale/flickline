import type { EventSink } from '../core/eventBus';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import { clamp } from '../core/math';
import { cloneCrosshair, crosshairEquals, DEFAULT_CROSSHAIR, sanitizeCrosshair, type CrosshairParams } from './crosshair';

export interface Settings {
  /** Mouse sensitivity in the reference game's scale (0.07 deg per count at 1.0). */
  sensitivity: number;
  /** Mouse DPI, used only to display / enter centimetres per 360. */
  dpi: number;
  /** Master volume 0..1. */
  volume: number;
  /** Per-bus volumes 0..1, multiplied with the master volume (audio buses, design 12). */
  weaponsVolume: number;
  hitsVolume: number;
  enemiesVolume: number;
  uiVolume: number;
  quality: QualityLevel;
  /** Crosshair appearance (design 13.2). Replaced as a whole by `set`. */
  crosshair: CrosshairParams;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.4,
  dpi: 800,
  volume: 0.7,
  weaponsVolume: 1,
  hitsVolume: 1,
  enemiesVolume: 1,
  uiVolume: 1,
  quality: 'medium',
  crosshair: DEFAULT_CROSSHAIR,
};

export interface SettingsEvents {
  settingsChanged: { settings: Readonly<Settings>; changed: readonly (keyof Settings)[] };
}

declare module '../core/gameEvents' {
  interface GameEvents extends SettingsEvents {}
}

/** Minimal Storage subset so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'flickline.settings.v1';

/** Validate + clamp arbitrary input into a full, safe Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, crosshair: cloneCrosshair(DEFAULT_CROSSHAIR) };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  out.sensitivity = num(r.sensitivity, 0.01, 20, out.sensitivity);
  out.dpi = num(r.dpi, 100, 32000, out.dpi);
  out.volume = num(r.volume, 0, 1, out.volume);
  out.weaponsVolume = num(r.weaponsVolume, 0, 1, out.weaponsVolume);
  out.hitsVolume = num(r.hitsVolume, 0, 1, out.hitsVolume);
  out.enemiesVolume = num(r.enemiesVolume, 0, 1, out.enemiesVolume);
  out.uiVolume = num(r.uiVolume, 0, 1, out.uiVolume);
  if (typeof r.quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(r.quality)) {
    out.quality = r.quality as QualityLevel;
  }
  out.crosshair = sanitizeCrosshair(r.crosshair);
  return out;
}

function settingEquals(a: Settings[keyof Settings], b: Settings[keyof Settings]): boolean {
  if (typeof a === 'object' && typeof b === 'object') return crosshairEquals(a, b);
  return a === b;
}

/** Tiny persisted settings store. Storage failures (private mode, quota) are ignored. */
export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly events: EventSink<SettingsEvents>,
    private readonly storage: StorageLike | null,
  ) {
    let raw: unknown = null;
    try {
      const s = storage?.getItem(SETTINGS_KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.current = sanitizeSettings(raw);
  }

  get(): Readonly<Settings> {
    return this.current;
  }

  set(patch: Partial<Settings>): void {
    const next = sanitizeSettings({ ...this.current, ...patch });
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => !settingEquals(next[k], this.current[k]));
    if (changed.length === 0) return;
    this.current = next;
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    this.events.emit('settingsChanged', { settings: next, changed });
  }
}
