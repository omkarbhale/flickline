/**
 * Adaptive difficulty seam. The scaffold ships only the interface and a constant model so other
 * systems (target spawning, speeds, sizes) can already ask for a difficulty level in 0..1.
 * A later task implements a real skill estimator that listens to sim events.
 */
export interface DifficultyModel {
  /** 0 = easiest, 1 = hardest. */
  readonly level: number;
  /** Feed an outcome (e.g. from targetHit / targetKilled / missed shot events). */
  recordOutcome(hit: boolean, distance: number): void;
}

export class ConstantDifficulty implements DifficultyModel {
  constructor(readonly level = 0.5) {}
  recordOutcome(): void {
    /* constant model ignores outcomes */
  }
}
