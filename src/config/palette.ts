/**
 * Shared colour tokens (design §11). Numbers are 0xRRGGBB. The renderer reads them as three.js
 * colours; the HUD turns them into CSS custom properties at start-up (hud/hud.ts), so there is
 * one place to change a colour. Contrast notes and colour-vision checks: docs/research/cues.md.
 */
export const palette = {
  ink: 0x0b0d14,
  slate: 0x151a26,
  steel: 0x26304a,
  /** Accent and UI. */
  trim: 0x38e8ff,
  /** Default Echo body. */
  ember: 0xff5a36,
  /** Head node. */
  core: 0xfff1d6,
  /** Headshot. */
  gold: 0xffd23f,
  ok: 0x5bf2a5,
  /** Moving shot (amber). Research R15 proposes violet 0xb58cff; change here only. */
  warn: 0xffb020,
  alert: 0xff3d5a,
} as const;

export type PaletteKey = keyof typeof palette;

/** '#rrggbb' for CSS. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
