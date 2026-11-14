/**
 * Mode framework tunables (design §4 intro, §9.3 beats, §10.2 scheduler). The fairness floors
 * (spawn distance, exposure, scale) and the beat length (`beat.drillSec`) are not duplicated
 * here: they live in `config/dial.ts`.
 */
export interface ModeTunables {
  /** `ready` phase length: crosshair and movement work, targets not live (§2 definitions). */
  readySec: number;
  /** Spawn picker: random candidates tried before the constraints are relaxed. */
  spawnMaxTries: number;
  /** Beacon-shell sampling: pitch limits in degrees from the horizon (§4.2). */
  shellPitchMinDeg: number;
  shellPitchMaxDeg: number;
  /** Beacon-shell sampling: the pitch is biased towards this value (head height, roughly level). */
  shellPitchBiasDeg: number;
}

export const modes: ModeTunables = {
  readySec: 0.8,
  spawnMaxTries: 24,
  shellPitchMinDeg: -20,
  shellPitchMaxDeg: 25,
  shellPitchBiasDeg: 2,
};
