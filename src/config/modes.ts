/** Mode framework tunables (design §4 intro, §9.3 beats and fairness floors, §10.2 scheduler). */
export interface ModeTunables {
  /** `ready` phase length: crosshair and movement work, targets not live (§2 definitions). */
  readySec: number;
  /** Default beat length for timed modes; the difficulty dial changes only at beat boundaries (§9.3). */
  beatSec: number;
  /** Spawn picker: never place anything closer than this to the player (§9.3 fairness floors). */
  spawnMinDistance: number;
  /** Spawn picker: random candidates tried before the constraints are relaxed. */
  spawnMaxTries: number;
  /** Eye-to-aim-point height used when measuring angles to a standing humanoid anchor (spec `hit.head_centre_stand`). */
  aimHeightStand: number;
  /** Beacon-shell sampling: pitch limits in degrees from the horizon (§4.2). */
  shellPitchMinDeg: number;
  shellPitchMaxDeg: number;
  /** Beacon-shell sampling: the pitch is biased towards this value (head height, roughly level). */
  shellPitchBiasDeg: number;
  /** Fairness floors (§9.3 item 5). The dial module enforces them too; the scheduler never goes below. */
  floors: {
    /** Seconds a timed target stays up, at least. */
    minExposureSec: number;
    /** Enemy tell, at least. */
    minTellSec: number;
    /** Enemy reaction, at least. */
    minReactionSec: number;
    /** Target scale (×real head size) is never below this. */
    minHeadScale: number;
  };
}

export const modes: ModeTunables = {
  readySec: 0.8,
  beatSec: 10,
  spawnMinDistance: 3,
  spawnMaxTries: 24,
  aimHeightStand: 1.66,
  shellPitchMinDeg: -20,
  shellPitchMaxDeg: 25,
  shellPitchBiasDeg: 2,
  floors: { minExposureSec: 0.3, minTellSec: 0.15, minReactionSec: 0.25, minHeadScale: 1 },
};
