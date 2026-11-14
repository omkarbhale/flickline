import type { QualityPreset } from '../config/render';
import type { Override } from './settings';

/** `auto` follows the preset's value; `on` and `off` force it. */
export function applyOverride(auto: boolean, o: Override): boolean {
  return o === 'auto' ? auto : o === 'on';
}

/**
 * The quality preset the renderer actually uses: the chosen preset with the player's own switches
 * laid over it (design §13.3: post effects and the enemy outline are separate settings; the preset
 * sets their starting point). Everything else in the preset is left alone. Returns a new object, so
 * call it when settings change, never per frame.
 */
export function resolveQuality(
  base: Readonly<QualityPreset>,
  s: { postEffects: Override; enemyOutline: Override },
): QualityPreset {
  return {
    ...base,
    postProcessing: applyOverride(base.postProcessing, s.postEffects),
    echoOutline: applyOverride(base.echoOutline, s.enemyOutline),
  };
}

/**
 * Pixel ratio of the drawing buffer: the device's, capped by the preset, times the render scale
 * (design §13.3). Never below 0.25 so a bad scale cannot make a buffer of nothing.
 */
export function effectivePixelRatio(devicePixelRatio: number, preset: Readonly<QualityPreset>, renderScale: number): number {
  const base = Math.min(devicePixelRatio > 0 ? devicePixelRatio : 1, preset.pixelRatioCap);
  return Math.max(0.25, base * renderScale);
}
