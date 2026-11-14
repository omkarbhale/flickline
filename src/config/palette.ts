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
 * environment surface below. Recorded on issue #19.
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
  /** Moving shot. */
  warn: 0xffb020,
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

/** Brightness (linear-light weight of `trim`) added to the sky at the horizon by the glow. */
export const HORIZON_GLOW = 0.004;

/** Luminance of the sky at its brightest (the horizon glow peak); also the fog colour at Medium/High. */
export function horizonLuminance(): number {
  return relativeLuminance(palette.ink) + HORIZON_GLOW * relativeLuminance(palette.trim);
}
