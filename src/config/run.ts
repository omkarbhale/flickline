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
  /** Chain: a kill within this many seconds of the previous kill extends the chain. */
  chainWindowSec: number;
  /** Streak multiplier = 1 + streakMultPerKill * min(cleanStreak, streakMultCap) (design §8.1). */
  streakMultPerKill: number;
  streakMultCap: number;
  /** Head-height discipline: sample period while moving with no enemy visible. */
  headHeightSampleSec: number;
  /** Distance at which the head-centre height is turned into a pitch angle. */
  headHeightRefDistance: number;
  /** Event log capacity; recording stops (and `truncated` is set) beyond it. */
  logMaxEvents: number;
}

export const run: RunTunables = {
  readySec: 0.8,
  defaultDurationSec: 60,
  restartBudgetMs: 250,
  timeOnTargetPadDeg: 0.5,
  flickMinDeg: 1,
  chainWindowSec: 1.5,
  streakMultPerKill: 0.1,
  streakMultCap: 20,
  headHeightSampleSec: 0.125,
  headHeightRefDistance: 10,
  logMaxEvents: 20000,
};
