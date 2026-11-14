import type { EventSink } from '../core/eventBus';
import { ECHO_PRESET_IDS, type EchoPresetId } from '../config/palette';
import { QUALITY_LEVELS, type QualityLevel } from '../config/render';
import { DEFAULT_VIEWMODEL_MODE, VIEWMODEL_MODES, type ViewmodelMode } from '../config/viewmodel';
import { clamp } from '../core/math';
import { cloneHud, DEFAULT_HUD, hudEquals, sanitizeHud, type HudSettings } from './hud';
import { cloneCrosshair, crosshairEquals, DEFAULT_CROSSHAIR, sanitizeCrosshair, type CrosshairParams } from './crosshair';
import { cloneKeys, DEFAULT_KEYS, keysEqual, sanitizeKeys, type KeyBindings } from './keys';

/** A graphics switch that follows the quality preset (`auto`) or is forced on or off. */
export type Override = 'auto' | 'on' | 'off';
export const OVERRIDES: readonly Override[] = ['auto', 'on', 'off'];

/** Frame-rate cap options (design §13.3); 0 = uncapped. */
export const FPS_CAPS = [0, 60, 144, 240] as const;
export type FpsCap = (typeof FPS_CAPS)[number];

export const HIT_SOUND_STYLES = ['standard', 'soft'] as const;
export type HitSoundStyle = (typeof HIT_SOUND_STYLES)[number];

/** Render scale limits: the drawing buffer is this fraction of the preset's pixel ratio. */
export const RENDER_SCALE_MIN = 0.5;
export const RENDER_SCALE_MAX = 1;

export interface Settings {
  /** Mouse sensitivity in the reference game's scale (0.07 deg per count at 1.0). */
  sensitivity: number;
  /** Mouse DPI, used only to display / enter centimetres per 360. */
  dpi: number;
  /** Moving the mouse up looks down (design §13.3 "Invert Y", off by default). */
  invertY: boolean;
  /** Ask for raw (unadjusted) mouse input when taking the pointer lock (design §13.3, on by default). */
  rawInput: boolean;
  /** Key bindings by `KeyboardEvent.code` (design §13.3 "Keys"). Replaced as a whole by `set`. */
  keys: KeyBindings;
  /** Master volume 0..1. */
  volume: number;
  /** Per-bus volumes 0..1, multiplied with the master volume (audio buses, design 12). */
  weaponsVolume: number;
  hitsVolume: number;
  enemiesVolume: number;
  uiVolume: number;
  /** Enemy tell loudness 0..1, on top of the enemies bus (design §13.3 "enemy tell volume"). */
  tellVolume: number;
  /** Hit sound style: the standard thock, or a softer, rounder one. */
  hitSoundStyle: HitSoundStyle;
  /** Play the mix in mono (one ear, or a speaker): sounds lose their direction. */
  monoAudio: boolean;
  quality: QualityLevel;
  /** Fraction of the preset's pixel ratio the world is drawn at (0.5 to 1). */
  renderScale: number;
  /** Frame-rate cap in frames per second; 0 = uncapped (the loop follows the display). */
  fpsCap: FpsCap;
  /** Show the frame rate and the 1% lows in a corner of the screen. */
  showFps: boolean;
  /** Post effects: follow the preset, or force them on or off. */
  postEffects: Override;
  /** Inverted-hull enemy outline: follow the preset, or force it on or off. */
  enemyOutline: Override;
  /** Enemy colour preset (design §11); `contrast` is white with a black outline. */
  echoPreset: EchoPresetId;
  /** First-person weapon: held in the right hand, the left hand, or not drawn (design §13.3). */
  viewmodel: ViewmodelMode;
  /** Amber moving-shot tracer, `⇆` glyph (design §13.3 "Coaching cues"). */
  coachingCues: boolean;
  /** Fade the coaching cues and enemy tells as the skill rating improves (design §7.4); off keeps them at full forever. */
  cueFading: boolean;
  /** One cue-free run per session, the cold-open benchmark (design §7.4). */
  cleanRun: boolean;
  /** Ghost ring where the nearest target's head was, after a miss. */
  missGhost: boolean;
  /** Floating damage numbers on hits. */
  damageNumbers: boolean;
  /** Disables screen pulses and chromatic effects (design §13.3). */
  reduceFlashing: boolean;
  /** A 50 ms red/blue split on kills (design section 11 "optional chromatic"). Needs the High preset; Reduce flashing overrides it. */
  chromaticPulse: boolean;
  /** Aim punch when hit, multiplier of the spec's kick (spec §4.4: 1 = default, 0 disables). */
  flinchStrength: number;
  /** Crosshair appearance (design 13.2). Replaced as a whole by `set`. */
  crosshair: CrosshairParams;
  /** Live HUD element visibility and scale (design 13.1). Replaced as a whole by `set`. */
  hud: HudSettings;
  /**
   * Difficulty pin per mode id (design §13.3): a dial value 0..100 that replaces the matched dial for
   * that mode. A mode with no entry is matched to the player as usual. Replaced as a whole by `set`.
   */
  difficultyPin: Readonly<Record<string, number>>;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.4,
  dpi: 800,
  invertY: false,
  rawInput: true,
  keys: DEFAULT_KEYS as KeyBindings,
  volume: 0.7,
  weaponsVolume: 1,
  hitsVolume: 1,
  enemiesVolume: 1,
  uiVolume: 1,
  tellVolume: 1,
  hitSoundStyle: 'standard',
  monoAudio: false,
  quality: 'medium',
  renderScale: 1,
  fpsCap: 0,
  showFps: false,
  postEffects: 'auto',
  enemyOutline: 'auto',
  echoPreset: 'ember',
  viewmodel: DEFAULT_VIEWMODEL_MODE,
  coachingCues: true,
  cueFading: true,
  cleanRun: true,
  missGhost: true,
  damageNumbers: true,
  reduceFlashing: false,
  chromaticPulse: false,
  flinchStrength: 1,
  crosshair: DEFAULT_CROSSHAIR,
  hud: DEFAULT_HUD,
  difficultyPin: {},
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

const MAX_PINS = 32;
const MODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** Validate a difficulty-pin table: known-shaped mode ids, dial values clamped to 0..100 and rounded. */
export function sanitizePins(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r).slice(0, MAX_PINS)) {
    const v = r[k];
    if (MODE_ID_RE.test(k) && typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(clamp(v, 0, 100));
  }
  return out;
}

function pinsEqual(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/** Validate + clamp arbitrary input into a full, safe Settings object. */
export function sanitizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, crosshair: cloneCrosshair(DEFAULT_CROSSHAIR), hud: cloneHud(DEFAULT_HUD), keys: cloneKeys(DEFAULT_KEYS), difficultyPin: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  out.sensitivity = num(r.sensitivity, 0.01, 20, out.sensitivity);
  out.dpi = num(r.dpi, 100, 32000, out.dpi);
  out.volume = num(r.volume, 0, 1, out.volume);
  out.tellVolume = num(r.tellVolume, 0, 1, out.tellVolume);
  out.renderScale = num(r.renderScale, RENDER_SCALE_MIN, RENDER_SCALE_MAX, out.renderScale);
  out.weaponsVolume = num(r.weaponsVolume, 0, 1, out.weaponsVolume);
  out.hitsVolume = num(r.hitsVolume, 0, 1, out.hitsVolume);
  out.enemiesVolume = num(r.enemiesVolume, 0, 1, out.enemiesVolume);
  out.uiVolume = num(r.uiVolume, 0, 1, out.uiVolume);
  if (typeof r.quality === 'string' && (QUALITY_LEVELS as readonly string[]).includes(r.quality)) {
    out.quality = r.quality as QualityLevel;
  }
  if (typeof r.viewmodel === 'string' && (VIEWMODEL_MODES as readonly string[]).includes(r.viewmodel)) {
    out.viewmodel = r.viewmodel as ViewmodelMode;
  }
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
    typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
  out.invertY = bool(r.invertY, out.invertY);
  out.rawInput = bool(r.rawInput, out.rawInput);
  out.monoAudio = bool(r.monoAudio, out.monoAudio);
  out.showFps = bool(r.showFps, out.showFps);
  out.hitSoundStyle = pick(r.hitSoundStyle, HIT_SOUND_STYLES, out.hitSoundStyle);
  out.postEffects = pick(r.postEffects, OVERRIDES, out.postEffects);
  out.enemyOutline = pick(r.enemyOutline, OVERRIDES, out.enemyOutline);
  out.echoPreset = pick(r.echoPreset, ECHO_PRESET_IDS, out.echoPreset);
  out.fpsCap = typeof r.fpsCap === 'number' && (FPS_CAPS as readonly number[]).includes(r.fpsCap) ? (r.fpsCap as FpsCap) : out.fpsCap;
  out.coachingCues = bool(r.coachingCues, out.coachingCues);
  out.cueFading = bool(r.cueFading, out.cueFading);
  out.cleanRun = bool(r.cleanRun, out.cleanRun);
  out.missGhost = bool(r.missGhost, out.missGhost);
  out.damageNumbers = bool(r.damageNumbers, out.damageNumbers);
  out.reduceFlashing = bool(r.reduceFlashing, out.reduceFlashing);
  out.chromaticPulse = bool(r.chromaticPulse, out.chromaticPulse);
  out.flinchStrength = num(r.flinchStrength, 0, 2, out.flinchStrength);
  out.crosshair = sanitizeCrosshair(r.crosshair);
  out.hud = sanitizeHud(r.hud);
  out.keys = sanitizeKeys(r.keys);
  out.difficultyPin = sanitizePins(r.difficultyPin);
  return out;
}

function settingEquals<K extends keyof Settings>(key: K, a: Settings[K], b: Settings[K]): boolean {
  if (key === 'crosshair') return crosshairEquals(a as CrosshairParams, b as CrosshairParams);
  if (key === 'hud') return hudEquals(a as HudSettings, b as HudSettings);
  if (key === 'keys') return keysEqual(a as KeyBindings, b as KeyBindings);
  if (key === 'difficultyPin') return pinsEqual(a as Record<string, number>, b as Record<string, number>);
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
    const changed = (Object.keys(next) as (keyof Settings)[]).filter((k) => !settingEquals(k, next[k], this.current[k]));
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
