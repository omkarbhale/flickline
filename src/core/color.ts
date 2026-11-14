/**
 * Colour maths on 0xRRGGBB integers. Pure: used by the palette contrast tests and by the render
 * layer to derive shader constants. sRGB <-> linear per IEC 61966-2-1, luminance and contrast per
 * WCAG 2.x.
 */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** WCAG relative luminance of a 0xRRGGBB colour, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: number): number {
  const r = srgbToLinear(((hex >> 16) & 255) / 255);
  const g = srgbToLinear(((hex >> 8) & 255) / 255);
  const b = srgbToLinear((hex & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two luminances, always >= 1. */
export function contrastFromLuminance(a: number, b: number): number {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG contrast ratio between two 0xRRGGBB colours, 1 .. 21. */
export function contrastRatio(a: number, b: number): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** Scale a colour's brightness by `k` in linear light (so luminance scales by exactly `k`). */
export function scaleLinear(hex: number, k: number): number {
  const f = (shift: number): number => {
    const v = Math.round(linearToSrgb(srgbToLinear(((hex >> shift) & 255) / 255) * k) * 255);
    return Math.min(255, Math.max(0, v));
  };
  return (f(16) << 16) | (f(8) << 8) | f(0);
}

/** `#rrggbb` for CSS. */
export function toCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
