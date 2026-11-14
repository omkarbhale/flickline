/**
 * Player movement tunables. PLACEHOLDER VALUES: `docs/mechanics-spec.md` holds the researched
 * numbers and a later task applies them here (a data-only change; the movement code reads only
 * these fields). Units: metres, seconds, m/s, m/s^2.
 */
export interface MovementTunables {
  /** Player hull half-width in X and Z (hull is a square prism). */
  hullHalfWidth: number;
  standHeight: number;
  crouchHeight: number;
  standEyeHeight: number;
  crouchEyeHeight: number;
  /** How fast the eye moves between stand/crouch heights, m/s. */
  eyeHeightSpeed: number;
  runSpeed: number;
  walkSpeed: number;
  crouchSpeed: number;
  /** Ground acceleration towards the wish velocity, m/s^2 (very high = snappy). */
  groundAccel: number;
  /** Air acceleration towards the wish velocity, m/s^2. */
  airAccel: number;
  gravity: number;
  /** Initial upward speed of a jump, m/s. */
  jumpSpeed: number;
  /** Look pitch limit, degrees either side of horizontal. */
  maxPitchDeg: number;
  /** Distance walked between footstep events, metres. */
  footstepStride: number;
  /**
   * Tallest ledge a grounded player walks up without jumping, and the longest drop they walk
   * down without becoming airborne, metres (spec 2.7; at least 0.3 m, issue #133). Authored stair
   * risers should stay at or below 0.3 m so they never depend on the margin.
   */
  stepHeight: number;
  /**
   * Steepest ramp a map may author, degrees. The map lint rejects a steeper `ramp` box; the sim
   * itself keeps horizontal speed unchanged on any slope (ESTIMATE, spec 2.7).
   */
  maxWalkableSlopeDeg: number;
}

export const movement: MovementTunables = {
  hullHalfWidth: 0.3,
  standHeight: 1.8,
  crouchHeight: 1.4,
  standEyeHeight: 1.62,
  crouchEyeHeight: 1.22,
  eyeHeightSpeed: 4,
  runSpeed: 5.4,
  walkSpeed: 2.7,
  crouchSpeed: 2.2,
  groundAccel: 70,
  airAccel: 12,
  gravity: 22,
  jumpSpeed: 6,
  maxPitchDeg: 89,
  footstepStride: 2.2,
  stepHeight: 0.35,
  maxWalkableSlopeDeg: 45,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { movement };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
