/**
 * Target / enemy tunables: humanoid hit zones, health, the roster (as data), and how targets
 * come and go. Spec keys (`docs/mechanics-spec.md` §7.1) are noted per field. Units: metres,
 * seconds.
 */

/** Humanoid hit zones. Spec §5.1: PLACEHOLDER dimensions (ESTIMATE, 30%) to be measured later. */
export interface HitTunables {
  /** `hit.head_radius` */
  headRadius: number;
  /** `hit.head_centre_stand` */
  headCentreStand: number;
  /** `hit.head_centre_crouch` */
  headCentreCrouch: number;
  /** Torso (arms count as body): `hit.torso_range_stand` = bottom..top. */
  torsoBottomStand: number;
  torsoTopStand: number;
  /** `hit.torso_range_crouch` */
  torsoBottomCrouch: number;
  torsoTopCrouch: number;
  /** Legs run from the floor up to this height: `hit.leg_top_stand` / `hit.leg_top_crouch`. */
  legTopStand: number;
  legTopCrouch: number;
  /** Torso width (spec §5.1 table: 0.50 m). The zone is a vertical cylinder of this diameter. */
  torsoWidth: number;
  /** Leg width (spec §5.1 table: 0.46 m). */
  legWidth: number;
}

/** What shape a kind of target presents to bullets. */
export type TargetShape = 'humanoid' | 'orb';

/** Which behaviour (FSM) drives a kind. The functions live in `sim/enemies.ts`. */
export type BehaviourId = 'post' | 'beacon';

/** One roster entry. Adding an enemy kind = adding an entry here (+ a behaviour in the sim). */
export interface TargetKindDef {
  shape: TargetShape;
  behaviour: BehaviourId;
  /** Orb radius in metres (orb shape only). */
  orbRadius: number;
  /** Free-form labels forwarded in `targetSpawned.tags` (modes and presentation read these). */
  tags: readonly string[];
}

/** Idle sway of a Post: purely presentational, the hit zones never move. */
export interface SwayTunables {
  /** Maximum sideways lean of the upper body, metres. */
  amplitude: number;
  /** Seconds the lean takes to reach its target. */
  smoothSec: number;
  /** Rest between sways, seconds (seeded uniform range). */
  idleMinSec: number;
  idleMaxSec: number;
  /** Duration of one sway, seconds (seeded uniform range). */
  swayMinSec: number;
  swayMaxSec: number;
}

export interface TargetTunables {
  /** Fixed capacity of the target registry (slots are preallocated; spawn fails when full). */
  maxTargets: number;
  /** `hit.*` */
  hit: HitTunables;
  /** `health.max`. Echoes and the player share it. No armour in the first release. */
  maxHp: number;
  /** The roster as data. */
  kinds: { post: TargetKindDef; beacon: TargetKindDef };
  sway: SwayTunables;
  /** Seconds a level-placed target stays down before it comes back. */
  respawnSec: number;
  /** Respawn position jitter (metres, seeded RNG) so the RNG path is exercised and deterministic. */
  respawnJitter: number;
  /** A shot counts as "at" a target when it lands within this angle of it (design §3, TTK). */
  shotAtDeg: number;
  /** Reaction time counts the first shot aimed within this angle of the target (design §3, RT). */
  reactionAimDeg: number;
  /**
   * Horizontal/vertical field of view used for the sim-side "target became visible" test.
   * Horizontal = `view.hfovDeg` at this aspect. The sim never sees the window, so this is a
   * fixed reference aspect (16:9) rather than the player's.
   */
  visibilityAspect: number;
  /**
   * A shot is a "moving shot" (breaks a clean kill) when horizontal speed exceeds this fraction
   * of run speed, or the player is airborne. `move.deadzone_fraction` (spec §2.4). The weapon
   * task (#14) supplies the per-weapon flag later; this is the stand-in until then.
   */
  movingShotSpeedFraction: number;
}

export const targets: TargetTunables = {
  maxTargets: 64,
  hit: {
    headRadius: 0.14,
    headCentreStand: 1.66,
    headCentreCrouch: 1.16,
    torsoBottomStand: 0.8,
    torsoTopStand: 1.52,
    torsoBottomCrouch: 0.55,
    torsoTopCrouch: 1.02,
    legTopStand: 0.8,
    legTopCrouch: 0.55,
    torsoWidth: 0.5,
    legWidth: 0.46,
  },
  maxHp: 100,
  kinds: {
    // Design §5.2: standing Echo, idle sway only, stationary, no threat.
    post: { shape: 'humanoid', behaviour: 'post', orbRadius: 0, tags: ['echo', 'static'] },
    // Design §5.2: head-sized glowing orb on nothing. Radius = the head radius (0.14 m).
    beacon: { shape: 'orb', behaviour: 'beacon', orbRadius: 0.14, tags: ['orb', 'static'] },
  },
  sway: {
    amplitude: 0.02,
    smoothSec: 0.6,
    idleMinSec: 1.5,
    idleMaxSec: 3.5,
    swayMinSec: 0.8,
    swayMaxSec: 1.6,
  },
  respawnSec: 1.2,
  respawnJitter: 0.4,
  shotAtDeg: 1,
  reactionAimDeg: 5,
  visibilityAspect: 16 / 9,
  movingShotSpeedFraction: 0.275,
};
