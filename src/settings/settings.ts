import type { EventSink } from '../core/eventBus';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import { clamp } from '../core/math';

export interface Settings {
  /** Mouse sensitivity in the reference game's scale (0.07 deg per count at 1.0). */
  sensitivity: number;
  /** Mouse DPI, used only to display / enter centimetres per 360. */
  dpi: number;
  /** Master volume 0..1. */
  volume: number;
  quality: QualityLevel;
  /** Amber moving-shot tracer, `⇆` glyph (design §13.3 "Coaching cues"). */
  coachingCues: boolean;
  /** Ghost ring where the nearest target's head was, after a miss. */
  missGhost: boolean;
  /** Floating damage numbers on hits. */
  damageNumbers: boolean;
  /** Disables screen pulses and chromatic effects (design §13.3). */
  reduceFlashing: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.4,
  dpi: 800,
  volume: 0.7,
  quality: 'medium',
  coachingCues: true,
  missGhost: true,
  damageNumbers: true,
  reduceFlashing: false,
};

export interface SettingsEvents {
  settingsChanged: { settings: Readonly<Settings>; changed: readonly (keyof Settings)[] };
}

/** Minimal Storage subset so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'flickline.settings.v1';

/** Validate + clamp arbitrary input into a full, safe Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  out.sensitivity = num(r.sensitivity, 0.01, 20, out.sensitivity);
  out.dpi = num(r.dpi, 100, 32000, out.dpi);
  out.volume = num(r.volume, 0, 1, out.volume);
  if (typeof r.quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(r.quality)) {
    out.quality = r.quality as QualityLevel;
  }
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  out.coachingCues = bool(r.coachingCues, out.coachingCues);
  out.missGhost = bool(r.missGhost, out.missGhost);
  out.damageNumbers = bool(r.damageNumbers, out.damageNumbers);
  out.reduceFlashing = bool(r.reduceFlashing, out.reduceFlashing);
  return out;
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
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => next[k] !== this.current[k]);
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
