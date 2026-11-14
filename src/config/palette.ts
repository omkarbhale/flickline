import { relativeLuminance, scaleLinear, toCss } from '../core/color';

/**
 * The Lightline palette: the single place colours are defined (design section 11). Everything
 * that draws (render, hud, ui, audio-visual cues) reads these; nothing else holds a hex literal
 * for a themed colour. Plain 0xRRGGBB numbers; `css` gives the same tokens as `#rrggbb` strings
 * for the DOM layers.
 *
 * DEVIATION FROM THE DESIGN: `ember` is #FF7A4D here, not #FF5A36. Echo-vs-surface >= 7:1 is
 * impossible for #FF5A36 (against pure black it only reaches 6.77:1, against `ink` 6.26:1), so
 * the token was brightened along the same hue until it clears 7:1 against every rendered
 * environment surface below. Recorded on issue #19. That also meets research #52 R13 (body >= 4.5:1
 * and head node >= 7:1 against every surface in all four colour-vision simulations; `palette.test.ts`).
 *
 * `warn` is violet #B58CFF (#52 R15, adopted in #130), not amber #FFB020: amber and `gold` (headshot)
 * were nearly identical under deuteranopia (delta E 7.9). The moving shot keeps its `⇆` glyph,
 * dashed tracer and dull tock, so it never relies on hue alone.
 */
export const palette = {
  /** Background / void. */
  ink: 0x0b0d14,
  /** Panels. */
  slate: 0x151a26,
  /** Cover (the token; rendered cover is darker, see `env`). */
  steel: 0x26304a,
  /** Accent and UI; trim lines of light. */
  trim: 0x38e8ff,
  /** Default Echo colour. */
  ember: 0xff7a4d,
  /** Head node. */
  core: 0xfff1d6,
  /** Headshot. */
  gold: 0xffd23f,
  ok: 0x5bf2a5,
  /** Moving shot (violet, so it never reads as `gold` under any colour-vision deficiency). */
  warn: 0xb58cff,
  /** Damage. */
  alert: 0xff3d5a,
} as const;

export type PaletteToken = keyof typeof palette;

/** Palette tokens as CSS `#rrggbb` strings. */
export const css: Readonly<Record<PaletteToken, string>> = {
  ink: toCss(palette.ink),
  slate: toCss(palette.slate),
  steel: toCss(palette.steel),
  trim: toCss(palette.trim),
  ember: toCss(palette.ember),
  core: toCss(palette.core),
  gold: toCss(palette.gold),
  ok: toCss(palette.ok),
  warn: toCss(palette.warn),
  alert: toCss(palette.alert),
};

/**
 * Text/HUD foreground tokens and the backgrounds they are drawn on. The contrast table in
 * `palette.test.ts` checks every pair is >= 4.5:1. (`steel` is a cover/border colour, never a
 * text background: `alert` on `steel` is only 3.8:1.)
 */
export const UI_FOREGROUNDS: readonly PaletteToken[] = ['trim', 'ember', 'core', 'gold', 'ok', 'warn', 'alert'];
export const UI_BACKGROUNDS: readonly PaletteToken[] = ['ink', 'slate'];

/**
 * Environment surfaces as rendered at their BRIGHTEST (fully lit, top of the vertical gradient).
 * The shader only ever darkens these (shade factor <= 1, see `render.light`), so they bound the
 * luminance of any environment surface the player sees; that bound is what lets an Echo reach
 * >= 7:1 against all of them. Derived from the tokens by a linear-light scale.
 */
export const env = {
  /** Sky zenith and clear colour. */
  void: palette.ink,
  floor: scaleLinear(palette.slate, 0.45),
  wall: scaleLinear(palette.slate, 0.6),
  cover: scaleLinear(palette.steel, 0.24),
  platform: scaleLinear(palette.steel, 0.2),
} as const;

/** Enemy colour presets (design section 11): accessibility and personal visibility. */
export const ECHO_PRESET_IDS = ['ember', 'magenta', 'lime', 'amber', 'contrast'] as const;
export type EchoPresetId = (typeof ECHO_PRESET_IDS)[number];

export interface EchoPreset {
  /** Body colour: flat fill, the colour the 7:1 guarantee is measured on. */
  color: number;
  /** Head node colour (always at least as bright as the body, so the head stays the brightest part). */
  head: number;
  /** Inverted-hull outline colour. */
  outline: number;
  /** Draw the outline even where the quality preset has it off (Contrast is defined by it). */
  outlineAlways: boolean;
}

/**
 * Every body and head colour reaches >= 7:1 against all rendered environment surfaces in `env`
 * (`palette.test.ts` checks the table). The Echo shader only ever lifts colour towards white
 * (facets, rim, flash), never darkens it, so these are also the minimum rendered colours.
 * `ember` is the design default. `contrast` is near-white (so its head node can still be a
 * brighter white) with a black outline.
 */
export const echoPresets: Readonly<Record<EchoPresetId, EchoPreset>> = {
  ember: { color: palette.ember, head: palette.core, outline: palette.ink, outlineAlways: false },
  magenta: { color: 0xff6ee6, head: 0xffe3fa, outline: palette.ink, outlineAlways: false },
  lime: { color: 0x9cff3d, head: 0xf4ffe0, outline: palette.ink, outlineAlways: false },
  amber: { color: 0xffc21a, head: 0xfff4cc, outline: palette.ink, outlineAlways: false },
  contrast: { color: 0xdcdcdc, head: 0xffffff, outline: 0x000000, outlineAlways: true },
};

/**
 * Stop & Pop stance rings (design §4.4): white = stand still, blue = crouched and still. The verdict
 * after the first bullet reuses `ok` and `alert`. The two stances also differ by shape (one band
 * against two), so they never rely on hue alone.
 */
export const stanceRingColours = { stand: 0xffffff, crouch: 0x4d7cff } as const;

/** Brightness (linear-light weight of `trim`) added to the sky at the horizon by the glow. */
export const HORIZON_GLOW = 0.004;

/** Luminance of the sky at its brightest (the horizon glow peak); also the fog colour at Medium/High. */
export function horizonLuminance(): number {
  return relativeLuminance(palette.ink) + HORIZON_GLOW * relativeLuminance(palette.trim);
}
