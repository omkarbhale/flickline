/**
 * Damage-taken visuals (design §7.1 "Taking damage"), all in milliseconds / degrees so none of
 * it is frame-count based. With Reduce flashing on, only the arc and the HP bar remain, and the
 * arc fades slowly instead of snapping.
 */
export interface DamageFxTunables {
  /** Arcs that can be on screen at once (a ring of pooled elements; the oldest is recycled). */
  arcCapacity: number;
  /** How long a directional arc stays, ms (it fades out over the whole time). */
  arcMs: number;
  /** Fade time of an arc with Reduce flashing on, ms. */
  arcReducedMs: number;
  /** Angular width of an arc, degrees. */
  arcWidthDeg: number;
  /** A hit from within this many degrees of a showing arc refreshes it instead of adding another (a burst is one arc). */
  arcMergeDeg: number;
  /** The screen vignette narrows in and back out over this long, ms. */
  vignetteMs: number;
  /** Desaturation of the frame, ms (design: 150). */
  desaturateMs: number;
  /** Saturation at the peak of the desaturation (1 = none). */
  desaturateTo: number;
  /** The HP bar flashes for this long when it drops, ms. */
  hpFlashMs: number;
}

export const damageFx: DamageFxTunables = {
  arcCapacity: 4,
  arcMs: 700,
  arcReducedMs: 1100,
  arcWidthDeg: 38,
  arcMergeDeg: 10,
  vignetteMs: 320,
  desaturateMs: 150,
  desaturateTo: 0.35,
  hpFlashMs: 260,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { damageFx };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
