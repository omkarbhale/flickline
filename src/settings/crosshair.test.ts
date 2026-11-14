import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import {
  CROSSHAIR_LIMITS as L,
  CROSSHAIR_PRESETS,
  DEFAULT_CROSSHAIR,
  colorToHex,
  crosshairEquals,
  decodeCrosshair,
  encodeCrosshair,
  hexToColor,
  sanitizeCrosshair,
  type CrosshairLines,
  type CrosshairParams,
} from './crosshair';
import { SETTINGS_KEY, SettingsStore, sanitizeSettings, type SettingsEvents, type StorageLike } from './settings';

function randomParams(rng: Rng): CrosshairParams {
  const int = (lo: number, hi: number): number => lo + rng.int(hi - lo + 1);
  const lines = (): CrosshairLines => ({
    show: rng.next() < 0.5,
    length: int(L.length.min, L.length.max),
    thickness: int(L.thickness.min, L.thickness.max),
    gap: int(L.gap.min, L.gap.max),
    opacity: rng.int(101) / 100,
  });
  return {
    color: rng.int(0x1000000),
    outline: { show: rng.next() < 0.5, thickness: int(L.outlineThickness.min, L.outlineThickness.max), opacity: rng.int(101) / 100 },
    inner: lines(),
    outer: lines(),
    dot: { show: rng.next() < 0.5, size: int(L.dotSize.min, L.dotSize.max), opacity: rng.int(101) / 100 },
    firingError: { show: rng.next() < 0.5, amount: int(L.errorAmount.min, L.errorAmount.max) },
    hitMarkerColor: rng.int(0x1000000),
  };
}

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

describe('crosshair share code', () => {
  it('round-trips 100 random parameter vectors exactly', () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 100; i++) {
      const p = randomParams(rng);
      const code = encodeCrosshair(p);
      expect(code).toMatch(/^[A-Za-z0-9_-]{23}$/);
      const res = decodeCrosshair(code);
      expect(res.ok, code).toBe(true);
      if (res.ok) expect(res.params).toEqual(p);
    }
  });

  it('round-trips the defaults and every preset', () => {
    for (const p of [DEFAULT_CROSSHAIR, ...CROSSHAIR_PRESETS.map((x) => x.params)]) {
      const res = decodeCrosshair(encodeCrosshair(p));
      expect(res.ok && crosshairEquals(res.params, p)).toBe(true);
    }
  });

  it('tolerates whitespace and standard-base64 look-alikes', () => {
    const code = encodeCrosshair(CROSSHAIR_PRESETS[3]!.params);
    expect(decodeCrosshair(`  ${code.slice(0, 10)}\n${code.slice(10)} \n`).ok).toBe(true);
  });

  it('rejects invalid codes with a message instead of throwing', () => {
    const good = encodeCrosshair(DEFAULT_CROSSHAIR);
    const flipped = (good[5] === 'A' ? 'B' : 'A');
    const bad = ['', '   ', 'hello', good.slice(1), `${good}A`, `${good.slice(0, 5)}${flipped}${good.slice(6)}`, '!'.repeat(23), 'A'.repeat(23)];
    for (const b of bad) {
      const res = decodeCrosshair(b);
      expect(res.ok, JSON.stringify(b)).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(5);
    }
  });

  it('rejects well-formed codes whose values are out of range', () => {
    // Hand-build a code with a valid checksum but inner length 31 (> 30): flip bits then fix checksum.
    const good = encodeCrosshair(DEFAULT_CROSSHAIR);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bytes = new Uint8Array(18);
    let acc = 0, bits = 0, n = 0;
    for (const ch of good) {
      acc = (acc << 6) | alphabet.indexOf(ch); bits += 6;
      if (bits >= 8) { bits -= 8; bytes[n++] = (acc >> bits) & 255; acc &= (1 << bits) - 1; }
    }
    // inner.show is bit 40 (4+24+12), inner.length bits 41..45: set it to 11111 (31).
    for (let b = 41; b < 46; b++) bytes[b >> 3]! |= 0x80 >> (b & 7);
    let c = 0xa5;
    for (let i = 0; i < 16; i++) c = (((c << 1) | (c >> 7)) & 255) ^ bytes[i]!;
    bytes[16] = c;
    let out = '';
    for (let i = 0; i < 17; i += 3) {
      const v = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      out += alphabet[(v >> 18) & 63]! + alphabet[(v >> 12) & 63]! + alphabet[(v >> 6) & 63]! + alphabet[v & 63]!;
    }
    const res = decodeCrosshair(out.slice(0, 23));
    expect(res.ok).toBe(false);
  });
});

describe('crosshair params', () => {
  it('sanitises garbage into a valid vector', () => {
    expect(sanitizeCrosshair(null)).toEqual(DEFAULT_CROSSHAIR);
    const p = sanitizeCrosshair({
      color: -5, inner: { length: 999, thickness: 'x', gap: -3, opacity: 7 },
      outline: { thickness: 0.4 }, dot: { size: Infinity }, firingError: { amount: 1e9, show: 'yes' },
    });
    expect(p.color).toBe(0);
    expect(p.inner.length).toBe(L.length.max);
    expect(p.inner.thickness).toBe(DEFAULT_CROSSHAIR.inner.thickness);
    expect(p.inner.gap).toBe(L.gap.min);
    expect(p.inner.opacity).toBe(1);
    expect(p.outline.thickness).toBe(L.outlineThickness.min);
    expect(p.dot.size).toBe(DEFAULT_CROSSHAIR.dot.size);
    expect(p.firingError.amount).toBe(L.errorAmount.max);
    expect(p.firingError.show).toBe(false);
  });

  it('has firing error off by default and in the reference-like presets', () => {
    expect(DEFAULT_CROSSHAIR.firingError.show).toBe(false);
    expect(CROSSHAIR_PRESETS).toHaveLength(4);
    expect(new Set(CROSSHAIR_PRESETS.map((p) => p.id)).size).toBe(4);
  });

  it('converts colours to and from hex', () => {
    expect(colorToHex(0x00ff7a)).toBe('#00ff7a');
    expect(colorToHex(0x0000ff)).toBe('#0000ff');
    expect(hexToColor('#00FF7a')).toBe(0x00ff7a);
    expect(hexToColor('00ff7a')).toBe(0x00ff7a);
    expect(hexToColor('#fff')).toBeNull();
    expect(hexToColor('zzzzzz')).toBeNull();
  });
});

describe('crosshair in the settings store', () => {
  it('persists, reloads and emits only when the crosshair really changed', () => {
    const st = memoryStorage();
    const bus = new EventBus<SettingsEvents>();
    const seen: string[][] = [];
    bus.on('settingsChanged', (e) => seen.push([...e.changed]));
    const store = new SettingsStore(bus, st);
    store.set({ crosshair: { ...DEFAULT_CROSSHAIR } }); // identical -> no event
    const next = sanitizeCrosshair({ ...DEFAULT_CROSSHAIR, color: 0x123456 });
    store.set({ crosshair: next });
    store.set({ crosshair: sanitizeCrosshair(next) }); // equal again -> no event
    expect(seen).toEqual([['crosshair']]);
    expect(JSON.parse(st.data[SETTINGS_KEY]!).crosshair.color).toBe(0x123456);
    expect(new SettingsStore(new EventBus<SettingsEvents>(), st).get().crosshair.color).toBe(0x123456);
  });

  it('falls back to the default crosshair for corrupt saved data', () => {
    expect(sanitizeSettings({ crosshair: 'nope' }).crosshair).toEqual(DEFAULT_CROSSHAIR);
    expect(sanitizeSettings({ crosshair: { inner: { length: 12 } } }).crosshair.inner.length).toBe(12);
  });
});
