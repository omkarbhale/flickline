/**
 * Events produced by the feedback layer (streaks, chains, medals), read by presentation (audio,
 * HUD). Declared here so consumers can code against the contract before the producer lands
 * (design 14.3). Payloads are read-only and valid only during the callback.
 */
export interface FeedbackEvents {
  /**
   * The clean streak changed. `streak` is the count of consecutive clean kills after the change
   * (0 = broken), `mult` the score multiplier (1.0 to 3.0). Producers must emit it before
   * presentation handles the `targetKilled` that caused it, so the kill chime reads the new streak
   * (subscribe the producer on the bus before `attachSfx`).
   */
  streakUpdated: { streak: number; mult: number };
}
