/**
 * Echo look tunables (design sections 5 and 11): the silhouette of the humanoid, the Beacon and
 * the Gnat and the shader's look. (The hit flash length is `feedback.targetFlashSec`; the kill
 * shatter is the pooled shard effect in `render/effects.ts`, tinted by the colour preset.) Art numbers only: the hit zones come from
 * `targets.hit` and the mesh is built from them (`render/echoModel.ts`), so the silhouette cannot
 * drift from the hitboxes. Units: metres, seconds.
 */

/** One piece of the humanoid, lofted through rings (`f` = 0..1 up the piece's own zone range). */
export interface EchoRing {
  f: number;
  /** Half width (x) and half depth (z), metres. */
  hw: number;
  hd: number;
}

export interface EchoShape {
  /** Torso, floor of the torso zone (f = 0) to the neck (f = 1). */
  torso: readonly EchoRing[];
  /** One arm (mirrored); `f` runs over the torso zone. `x` = arm centre line. Outer edge = `x + hw`. */
  arm: readonly EchoRing[];
  armX: number;
  /** One leg (mirrored); `f` runs from the floor (0) to the leg top (1). `x` = leg centre line. */
  leg: readonly EchoRing[];
  legX: number;
  /** Head sphere tessellation: segments around, rings pole to pole (even, so the equator is a ring). */
  headSegments: number;
  headRings: number;
}

export interface EchoTunables {
  /** Death dissolve of the body (the shards fly separately). */
  dissolveSec: number;
  shape: EchoShape;
  /** Fresnel rim: exponent and how far the rim lifts towards white. */
  rim: { power: number; strength: number };
  /** Facet shading: the brightest facet lifts the colour this far towards white (never darkens). */
  facetLift: number;
  /** How far the head node / Beacon core is pulled to the head colour (0..1). */
  headGlow: number;
  /** Outline thickness, device-independent screen pixels. */
  outlinePx: number;
  beacon: { segments: number; rings: number };
  /** Gnat: octahedron "radius" (hand-sized), vertical stretch, spin speed and tilt. */
  gnat: { radius: number; stretch: number; spinRadPerSec: number; tiltRad: number };
}

export const echo: EchoTunables = {
  dissolveSec: 0.28,
  shape: {
    // Ranges: torso f=0 is `hit.torsoBottom*`, f=1 is `hit.torsoTop*` (the neck).
    torso: [
      { f: 0, hw: 0.12, hd: 0.085 },
      { f: 0.55, hw: 0.165, hd: 0.105 },
      { f: 0.9, hw: 0.175, hd: 0.11 },
      { f: 1, hw: 0.075, hd: 0.06 },
    ],
    // Arms hang at the sides: with `armX + hw` = 0.25 the body zone is exactly `torsoWidth` wide.
    arm: [
      { f: 0.9, hw: 0.045, hd: 0.05 },
      { f: 0.5, hw: 0.04, hd: 0.045 },
      { f: 0.08, hw: 0.035, hd: 0.04 },
    ],
    armX: 0.205,
    // `legX + hw` = 0.23: both legs together are exactly `legWidth` (0.46 m) wide at the hip.
    leg: [
      { f: 0, hw: 0.075, hd: 0.09 },
      { f: 0.04, hw: 0.06, hd: 0.06 },
      { f: 0.5, hw: 0.08, hd: 0.075 },
      { f: 1, hw: 0.1, hd: 0.09 },
    ],
    legX: 0.13,
    headSegments: 8,
    headRings: 6,
  },
  rim: { power: 2.5, strength: 0.28 },
  facetLift: 0.3,
  headGlow: 0.9,
  outlinePx: 1.6,
  beacon: { segments: 12, rings: 8 },
  gnat: { radius: 0.11, stretch: 1.35, spinRadPerSec: 6, tiltRad: 0.5 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { echo };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
