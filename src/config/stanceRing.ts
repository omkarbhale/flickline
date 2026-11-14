/**
 * Stop & Pop's stance ring (design §4.4): a glowing band at the target's feet. It has to read from
 * the far end of the Lane (16-28 m), where a ring lying flat on the floor is nearly edge-on, so it
 * is a short open tube with a flat floor disc under it. Colours: `palette.stanceRingColours`.
 * Metres.
 */
export interface StanceRingTunables {
  /** Radius of the band (a Post's shoulders are about 0.25 m, so the ring clears the body). */
  radiusM: number;
  /** Height of one band. */
  bandHeightM: number;
  /** Gap between the two bands of a crouch ring. */
  bandGapM: number;
  /** The flat floor annulus inside the band. */
  floorInnerM: number;
  /** How far above the floor the ring sits, so it never z-fights the floor. */
  liftM: number;
  /** Opacity of the bands and of the floor disc. */
  bandOpacity: number;
  floorOpacity: number;
  /** Opacity of the see-through pass, as a share of the solid one (it shows the ring through cover). */
  ghostShare: number;
  /** Segments around the ring. */
  segments: number;
}

export const stanceRing: StanceRingTunables = {
  radiusM: 0.8,
  bandHeightM: 0.2,
  bandGapM: 0.14,
  floorInnerM: 0.45,
  liftM: 0.01,
  bandOpacity: 0.9,
  floorOpacity: 0.5,
  ghostShare: 0.4,
  segments: 40,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { stanceRing };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
