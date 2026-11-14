/**
 * Player movement tunables: `docs/mechanics-spec.md` §2 (keys `move.*` and `body.*` of §7.1).
 * The run speed is not here: it is the equipped weapon's `runSpeedMps` (spec §2.1, `config/weapon.ts`),
 * which `sim/movement.ts` receives as the player's max speed. Units: metres, seconds, m/s, m/s^2.
 */
export interface MovementTunables {
  /** `body.radius`: player hull half-width in X and Z (the hull is a square prism). */
  hullHalfWidth: number;
  /** `body.height_stand` / `body.height_crouch`. */
  standHeight: number;
  crouchHeight: number;
  /** `body.eye_height_stand` / `body.eye_height_crouch`. */
  standEyeHeight: number;
  crouchEyeHeight: number;
  /** `body.crouch_transition`: seconds for the eye to move between the two heights. */
  crouchTransitionSec: number;
  /**
   * `move.walk_fraction` / `move.crouch_walk_fraction` (spec §2.2): walk and crouch-walk speed as
   * fractions of the equipped run speed. The weapon's movement-error ramp (spec §3.4) reads the same two.
   */
  walkFraction: number;
  crouchWalkFraction: number;
  /** `move.accel_time_to_max` (spec §2.3): seconds from rest to the equipped run speed (linear ramp). */
  accelTimeToMax: number;
  /**
   * `move.brake_decel_high` / `move.brake_decel_low` (spec §2.3): constant braking, m/s^2, above and
   * at or below `brakeBandFraction` of the max speed, for a max speed of `brakeRefSpeed`; both scale
   * by max / `brakeRefSpeed`, so a full stop takes the same 0.16 s with every weapon.
   */
  brakeDecelHigh: number;
  brakeDecelLow: number;
  brakeRefSpeed: number;
  /** `move.brake_band_split_fraction`: where the two braking bands meet, as a fraction of max speed. */
  brakeBandFraction: number;
  /**
   * Counter-strafe bonus (spec §2.3, "none (default); tunable"): braking multiplier while the opposite
   * key is held. 1 = a counter-strafe stops exactly as fast as a release, then accelerates the other way.
   */
  counterStrafeBrakeMult: number;
  /** `move.air_accel_fraction` (spec §2.6): air acceleration as a fraction of ground acceleration. */
  airAccelFraction: number;
  /** `move.gravity`, m/s^2. */
  gravity: number;
  /** `move.jump_apex`: jump height on flat ground, metres (takeoff speed = sqrt(2 * gravity * apex)). */
  jumpApex: number;
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
  hullHalfWidth: 0.3, // spec §7.1 `body.radius`
  standHeight: 1.8, // `body.height_stand`
  crouchHeight: 1.3, // `body.height_crouch`
  standEyeHeight: 1.62, // `body.eye_height_stand`
  crouchEyeHeight: 1.17, // `body.eye_height_crouch`
  crouchTransitionSec: 0.15, // `body.crouch_transition`
  walkFraction: 0.5, // `move.walk_fraction`
  crouchWalkFraction: 0.34, // `move.crouch_walk_fraction`
  accelTimeToMax: 0.2, // `move.accel_time_to_max`
  brakeDecelHigh: 39, // `move.brake_decel_high`
  brakeDecelLow: 24, // `move.brake_decel_low`
  brakeRefSpeed: 5.4, // the rifle run speed the braking numbers were measured at
  brakeBandFraction: 0.25, // `move.brake_band_split_fraction`
  counterStrafeBrakeMult: 1, // spec §2.3: no counter-strafe bonus by default
  airAccelFraction: 0.25, // `move.air_accel_fraction`
  gravity: 20, // `move.gravity`
  jumpApex: 1.0, // `move.jump_apex`
  maxPitchDeg: 89, // `input.pitch_limit_deg`
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
