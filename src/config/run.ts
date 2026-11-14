/**
 * Run lifecycle and stat-definition tunables (design §2, §3). The aim cones for "shot at" and reaction time live with the targets (`targets.shotAtDeg`, `targets.reactionAimDeg`). All durations in seconds, angles in
 * degrees (names end `Deg`), distances in metres. Values quoted from the design draft; the
 * balance pass may retune them without a code change.
 */
export interface RunTunables {
  /** `ready` state length: crosshair and movement work, targets are not live yet. */
  readySec: number;
  /** Default `live` length when a mode does not pass its own (drills are 60 s). */
  defaultDurationSec: number;
  /** Restart budget (key press to the next `ready` frame), shown against the measured ms. */
  restartBudgetMs: number;
  /** Flick error is only defined for flicks at least this large (smaller = pre-aimed, no flick). */
  flickMinDeg: number;
  /** Time on target: the hit volume is padded by this angle (design §3). */
  timeOnTargetPadDeg: number;
  /**
   * Lead error (Strafe Track, design §3/§4.3): while a Strafer cruises (lane speed at or above
   * `leadMinSpeedMps`) and the view is within `leadMaxOffDeg` of it, the signed horizontal offset
   * of the aim from the target's centre of mass is sampled this often. Only a Strafer the aim was
   * on (inside the padded hit volume) within the last `leadEngageSec` counts: the lead error is a
   * tracking measure, so the flick that brings the crosshair to a new Strafer (which always
   * arrives ahead of it) is not part of it.
   */
  leadSampleSec: number;
  leadEngageSec: number;
  leadMinSpeedMps: number;
  leadMaxOffDeg: number;
  /** Head-height discipline: sample period while moving with no enemy visible. */
  headHeightSampleSec: number;
  /**
   * Distance at which the head-centre height is turned into a pitch angle when no enemy anchor is
   * ahead (the expected enemy then stands on the floor this far in front of the player).
   */
  headHeightRefDistance: number;
  /** Enemy anchors count as "ahead" inside this cone around the view direction, degrees (half-angle). */
  headHeightConeDeg: number;
  /** ... and between these horizontal distances, metres. */
  headHeightMinDistance: number;
  headHeightMaxDistance: number;
  /** Event log capacity; recording stops (and `truncated` is set) beyond it. */
  logMaxEvents: number;
}

export const run: RunTunables = {
  readySec: 0.8,
  defaultDurationSec: 60,
  restartBudgetMs: 250,
  timeOnTargetPadDeg: 0.5,
  flickMinDeg: 1,
  leadSampleSec: 0.1,
  leadEngageSec: 0.6,
  leadMinSpeedMps: 1,
  leadMaxOffDeg: 10,
  headHeightSampleSec: 0.125,
  headHeightRefDistance: 10,
  headHeightConeDeg: 30,
  headHeightMinDistance: 3,
  headHeightMaxDistance: 45,
  logMaxEvents: 20000,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { run };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
