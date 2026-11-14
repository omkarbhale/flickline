/**
 * Crosshair parameters (design 13.2): the data model, validation, presets and the share code.
 * Pure: no DOM. Drawing lives in `hud/`, the editor in `ui/`.
 *
 * Every field is an integer except the opacities, which are quantised to hundredths, so a
 * parameter vector survives the share code round trip exactly.
 */

export interface CrosshairLines {
  show: boolean;
  /** Length of each of the four arms, CSS px. */
  length: number;
  /** Arm thickness, CSS px. */
  thickness: number;
  /** Distance from the centre to the inner end of each arm, CSS px. */
  gap: number;
  /** 0..1 in steps of 0.01. */
  opacity: number;
}

export interface CrosshairParams {
  /** 0xRRGGBB. */
  color: number;
  outline: { show: boolean; thickness: number; opacity: number };
  inner: CrosshairLines;
  outer: CrosshairLines;
  dot: { show: boolean; size: number; opacity: number };
  /**
   * Firing error: the lines spread when a shot is fired while moving too fast. Off by default
   * because the reference reticle does not show spread (spec 9 Q15).
   */
  firingError: { show: boolean; /** Extra gap at full spread, CSS px. */ amount: number };
  /** 0xRRGGBB, the colour of the hit marker. */
  hitMarkerColor: number;
}

/** Inclusive integer ranges of every numeric field (also the editor slider limits). */
export const CROSSHAIR_LIMITS = {
  outlineThickness: { min: 1, max: 6 },
  length: { min: 1, max: 30 },
  thickness: { min: 1, max: 10 },
  gap: { min: 0, max: 30 },
  dotSize: { min: 1, max: 10 },
  errorAmount: { min: 0, max: 20 },
} as const;

const lines = (show: boolean, length: number, thickness: number, gap: number, opacity: number): CrosshairLines => ({
  show, length, thickness, gap, opacity,
});

export const DEFAULT_CROSSHAIR: CrosshairParams = {
  color: 0x7dff9c,
  outline: { show: true, thickness: 1, opacity: 0.6 },
  inner: lines(true, 6, 2, 4, 1),
  outer: lines(false, 4, 2, 12, 0.5),
  dot: { show: false, size: 2, opacity: 1 },
  firingError: { show: false, amount: 6 },
  hitMarkerColor: 0xffffff,
};

export interface CrosshairPreset {
  id: string;
  name: string;
  params: CrosshairParams;
}

export const CROSSHAIR_PRESETS: readonly CrosshairPreset[] = [
  { id: 'standard', name: 'Standard', params: DEFAULT_CROSSHAIR },
  {
    id: 'dot', name: 'Dot',
    params: {
      color: 0xffffff,
      outline: { show: true, thickness: 1, opacity: 0.8 },
      inner: lines(false, 6, 2, 4, 1),
      outer: lines(false, 4, 2, 12, 0.5),
      dot: { show: true, size: 3, opacity: 1 },
      firingError: { show: false, amount: 6 },
      hitMarkerColor: 0xff4d4d,
    },
  },
  {
    id: 'pinpoint', name: 'Pinpoint',
    params: {
      color: 0x00e5ff,
      outline: { show: true, thickness: 1, opacity: 0.5 },
      inner: lines(true, 4, 1, 3, 1),
      outer: lines(false, 4, 2, 12, 0.5),
      dot: { show: true, size: 1, opacity: 1 },
      firingError: { show: false, amount: 6 },
      hitMarkerColor: 0xffd23f,
    },
  },
  {
    id: 'wide', name: 'Wide',
    params: {
      color: 0xffe94d,
      outline: { show: true, thickness: 1, opacity: 0.7 },
      inner: lines(true, 7, 2, 6, 1),
      outer: lines(true, 5, 2, 16, 0.6),
      dot: { show: false, size: 2, opacity: 1 },
      firingError: { show: true, amount: 8 },
      hitMarkerColor: 0xffffff,
    },
  },
];

export function cloneCrosshair(p: CrosshairParams): CrosshairParams {
  return {
    color: p.color,
    outline: { ...p.outline },
    inner: { ...p.inner },
    outer: { ...p.outer },
    dot: { ...p.dot },
    firingError: { ...p.firingError },
    hitMarkerColor: p.hitMarkerColor,
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

function int(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
function opacity(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
}
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const rgb = (v: unknown, fallback: number): number => int(v, 0, 0xffffff, fallback);

function sanitizeLines(raw: unknown, d: CrosshairLines): CrosshairLines {
  const r = isObj(raw) ? raw : {};
  const L = CROSSHAIR_LIMITS;
  return {
    show: bool(r.show, d.show),
    length: int(r.length, L.length.min, L.length.max, d.length),
    thickness: int(r.thickness, L.thickness.min, L.thickness.max, d.thickness),
    gap: int(r.gap, L.gap.min, L.gap.max, d.gap),
    opacity: opacity(r.opacity, d.opacity),
  };
}

/** Validate and clamp arbitrary input into a complete, safe parameter set (always a fresh object). */
export function sanitizeCrosshair(raw: unknown): CrosshairParams {
  const d = DEFAULT_CROSSHAIR;
  const r = isObj(raw) ? raw : {};
  const L = CROSSHAIR_LIMITS;
  const o = isObj(r.outline) ? r.outline : {};
  const dot = isObj(r.dot) ? r.dot : {};
  const fe = isObj(r.firingError) ? r.firingError : {};
  return {
    color: rgb(r.color, d.color),
    outline: {
      show: bool(o.show, d.outline.show),
      thickness: int(o.thickness, L.outlineThickness.min, L.outlineThickness.max, d.outline.thickness),
      opacity: opacity(o.opacity, d.outline.opacity),
    },
    inner: sanitizeLines(r.inner, d.inner),
    outer: sanitizeLines(r.outer, d.outer),
    dot: {
      show: bool(dot.show, d.dot.show),
      size: int(dot.size, L.dotSize.min, L.dotSize.max, d.dot.size),
      opacity: opacity(dot.opacity, d.dot.opacity),
    },
    firingError: {
      show: bool(fe.show, d.firingError.show),
      amount: int(fe.amount, L.errorAmount.min, L.errorAmount.max, d.firingError.amount),
    },
    hitMarkerColor: rgb(r.hitMarkerColor, d.hitMarkerColor),
  };
}

/** Structural equality of two parameter sets. */
export function crosshairEquals(a: CrosshairParams, b: CrosshairParams): boolean {
  const eqL = (x: CrosshairLines, y: CrosshairLines): boolean =>
    x.show === y.show && x.length === y.length && x.thickness === y.thickness && x.gap === y.gap && x.opacity === y.opacity;
  return (
    a.color === b.color &&
    a.hitMarkerColor === b.hitMarkerColor &&
    a.outline.show === b.outline.show && a.outline.thickness === b.outline.thickness && a.outline.opacity === b.outline.opacity &&
    eqL(a.inner, b.inner) && eqL(a.outer, b.outer) &&
    a.dot.show === b.dot.show && a.dot.size === b.dot.size && a.dot.opacity === b.dot.opacity &&
    a.firingError.show === b.firingError.show && a.firingError.amount === b.firingError.amount
  );
}

/** `#rrggbb` for CSS and `<input type="color">`. */
export function colorToHex(c: number): string {
  return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Parse `#rrggbb` (or `rrggbb`); returns null when it is not a six digit hex colour. */
export function hexToColor(s: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

// ---------------------------------------------------------------------------------------------
// Share code: a fixed 17-byte vector, base64url (23 characters). Layout:
//   bytes 0..15  data bits, MSB first, zero padded: version(4) colour(24) outline(1,4,7)
//                inner(1,5,4,5,7) outer(1,5,4,5,7) dot(1,4,7) firingError(1,5) hitColour(24)
//   byte  16     checksum of bytes 0..15
// Opacities travel as integer percent.
// ---------------------------------------------------------------------------------------------

const CODE_VERSION = 1;
const DATA_BYTES = 16;
const CODE_BYTES = DATA_BYTES + 1;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function checksum(bytes: Uint8Array): number {
  let c = 0xa5;
  for (let i = 0; i < DATA_BYTES; i++) c = (((c << 1) | (c >> 7)) & 0xff) ^ bytes[i]!;
  return c;
}

class BitWriter {
  readonly bytes = new Uint8Array(CODE_BYTES);
  private pos = 0;
  put(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      if ((value >> i) & 1) this.bytes[this.pos >> 3]! |= 0x80 >> (this.pos & 7);
      this.pos++;
    }
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      v = (v << 1) | ((this.bytes[this.pos >> 3]! >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v;
  }
  flag(): boolean {
    return this.get(1) === 1;
  }
}

/** Encode (after sanitising) into the share code. */
export function encodeCrosshair(params: CrosshairParams): string {
  const p = sanitizeCrosshair(params);
  const w = new BitWriter();
  const pct = (o: number): number => Math.round(o * 100);
  const putLines = (l: CrosshairLines): void => {
    w.put(l.show ? 1 : 0, 1); w.put(l.length, 5); w.put(l.thickness, 4); w.put(l.gap, 5); w.put(pct(l.opacity), 7);
  };
  w.put(CODE_VERSION, 4);
  w.put(p.color, 24);
  w.put(p.outline.show ? 1 : 0, 1); w.put(p.outline.thickness, 4); w.put(pct(p.outline.opacity), 7);
  putLines(p.inner);
  putLines(p.outer);
  w.put(p.dot.show ? 1 : 0, 1); w.put(p.dot.size, 4); w.put(pct(p.dot.opacity), 7);
  w.put(p.firingError.show ? 1 : 0, 1); w.put(p.firingError.amount, 5);
  w.put(p.hitMarkerColor, 24);
  w.bytes[DATA_BYTES] = checksum(w.bytes);

  let out = '';
  for (let i = 0; i < CODE_BYTES; i += 3) {
    const n = (w.bytes[i]! << 16) | ((w.bytes[i + 1] ?? 0) << 8) | (w.bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  return out.slice(0, Math.ceil((CODE_BYTES * 8) / 6));
}

export type DecodeResult = { ok: true; params: CrosshairParams } | { ok: false; error: string };

const fail = (error: string): DecodeResult => ({ ok: false, error });

/** Decode a share code. Never throws; any malformed code returns `{ ok: false, error }`. */
export function decodeCrosshair(code: string): DecodeResult {
  const text = code.replace(/\s+/g, '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (text.length === 0) return fail('Paste a crosshair code first.');
  if (text.length !== Math.ceil((CODE_BYTES * 8) / 6)) return fail('That is not a Flickline crosshair code (wrong length).');
  const bytes = new Uint8Array(Math.ceil((text.length * 6) / 8));
  let acc = 0;
  let accBits = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64.indexOf(text[i]!);
    if (v < 0) return fail('That code contains characters a crosshair code never has.');
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      bytes[n++] = (acc >> accBits) & 0xff;
      acc &= (1 << accBits) - 1;
    }
  }
  if (bytes[DATA_BYTES] !== checksum(bytes)) return fail('That code is damaged (checksum mismatch). Check it was copied fully.');
  const r = new BitReader(bytes);
  if (r.get(4) !== CODE_VERSION) return fail('That code is from a different version of Flickline.');
  const pctOf = (): number => r.get(7) / 100;
  const getLines = (): CrosshairLines => ({
    show: r.flag(), length: r.get(5), thickness: r.get(4), gap: r.get(5), opacity: pctOf(),
  });
  const decoded: CrosshairParams = {
    color: r.get(24),
    outline: { show: r.flag(), thickness: r.get(4), opacity: pctOf() },
    inner: getLines(),
    outer: getLines(),
    dot: { show: r.flag(), size: r.get(4), opacity: pctOf() },
    firingError: { show: r.flag(), amount: r.get(5) },
    hitMarkerColor: r.get(24),
  };
  // Reject codes whose values the editor could never produce, rather than silently clamping.
  if (!crosshairEquals(decoded, sanitizeCrosshair(decoded))) return fail('That code has values outside the allowed ranges.');
  return { ok: true, params: decoded };
}
