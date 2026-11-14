import type { QualityLevel } from './render';

/**
 * Post-processing numbers (design section 11 "Post", section 14.1 budget). Which effects run is
 * the quality preset's `post` flags in `config/render.ts`; this file holds how they look.
 *
 * Readability comes first (vision principle 8): the bloom halo can lift a pixel by at most
 * `bloom.maxAdd` (linear light) and the vignette never darkens below `1 - vignette.strength`, so an
 * Echo keeps >= 4.5:1 against every environment surface with both applied (`post.test.ts`).
 */
export interface PostTunables {
  bloom: {
    /** Brightness (peak channel, linear light) below which nothing blooms. */
    threshold: number;
    /** Soft-knee width below the threshold (0 = hard cut). */
    knee: number;
    /** Multiplier on the blurred bright pass added to the frame. */
    strength: number;
    /** Largest value the halo may add to a pixel, linear light (the readability guard). */
    maxAdd: number;
    /** Brightness cap per tap before averaging, so one hot pixel (a muzzle flash) cannot flicker the glow. */
    tapCap: number;
    /** Separable blur step in quarter-res texels (the 5-tap kernel's spread). */
    blurSpread: number;
  };
  vignette: {
    /** Darkening at the very corner (0..1). */
    strength: number;
    /** Squared radius (0 centre, 1 corner) where the darkening starts and where it reaches full. */
    inner: number;
    outer: number;
  };
  damage: {
    /** Extra darkening at the screen edge at the peak of a hit. */
    darken: number;
    /** Alert-red added at the edge at the peak of a hit (linear light). */
    tint: number;
    /** Fraction of `damageFx.vignetteMs` the vignette takes to close in (the rest is the fade out). */
    attack: number;
  };
  chromatic: {
    /** Length of the kill pulse, ms (design: 3 frames at 60 Hz; never frame-counted). */
    ms: number;
    /** Red/blue split as a fraction of the screen width at the corner, at the peak. */
    shift: number;
    /** At most this many pulses in any 1000 ms (research R10, the screen-pulse budget). */
    maxPerSecond: number;
  };
  /** Full-screen passes allowed per preset (design section 14.1): the pipeline stays inside this. */
  passBudget: Record<QualityLevel, number>;
}

export const post: PostTunables = {
  bloom: { threshold: 0.32, knee: 0.22, strength: 0.7, maxAdd: 0.018, tapCap: 4, blurSpread: 1.25 },
  vignette: { strength: 0.14, inner: 0.3, outer: 1 },
  damage: { darken: 0.55, tint: 0.2, attack: 0.25 },
  chromatic: { ms: 50, shift: 0.006, maxPerSecond: 3 },
  passBudget: { low: 0, medium: 1, high: 3 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { post };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
