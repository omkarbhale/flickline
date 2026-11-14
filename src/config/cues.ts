/**
 * Fading coaching cues (design §7.4, issue #129). Pure data: the rules live in `adaptive/cueFade.ts`
 * and `feedback/cueGate.ts`, so the settling experiment (do faded cues retain as well as constant
 * ones?) moves numbers here, not code.
 *
 * Why cues fade: feedback on every trial teaches the learner to lean on it instead of on their own
 * intrinsic feedback; reduced feedback frequency hurts practice a little and helps retention
 * (guidance hypothesis, Winstein and Schmidt 1990). The reference game gives none of these cues, so
 * a habit that waits for one fails there (vision principle 1).
 *
 * All thresholds below are starting values (HYPOTHESIS): nobody has measured them for aim training.
 */

/**
 * How often the per-event coaching cues speak (design §7.4):
 *  - `every`: every trial, as in §7.1 (new players, wide confidence band);
 *  - `bandwidth`: only when the error is large;
 *  - `summary`: never during play; the results card carries the pattern.
 */
export type CuePhase = 'every' | 'bandwidth' | 'summary';
export const CUE_PHASES: readonly CuePhase[] = ['every', 'bandwidth', 'summary'];

/** The per-event cues that fade. */
export type CueKind = 'movingShot' | 'missGhost' | 'damageNumbers' | 'readout';

/** What a cue does in a phase: speak on every event, only on a large error, or not at all. */
export type CueRule = 'all' | 'large' | 'none';

export interface PhaseGate {
  /** The skill rating (0-100 dial) at or above which the phase may begin. */
  minRating: number;
  /** The posterior s.d. (dial points) at or below which the phase may begin: the confidence band must be narrow. */
  maxSd: number;
}

export interface CueTunables {
  /**
   * Phase entry: both gates must hold. `hysteresis` keeps a player on the border from flip-flopping
   * between runs: once in a phase they stay until the rating falls that far below `minRating` or the
   * band widens that far above `maxSd`. A real decline still brings the cues back.
   */
  phases: {
    bandwidth: PhaseGate;
    summary: PhaseGate;
    hysteresis: { rating: number; sd: number };
  };
  /** Per cue and phase (the `every` phase always shows everything). */
  rules: Record<CueKind, Record<CuePhase, CueRule>>;
  /** What counts as a large error in the `bandwidth` phase. */
  bandwidth: {
    /** Moving shot: horizontal speed at or above this (m/s), or airborne. The deadzone is about 1.5 m/s, a shift-walk about 2.7, a run 5.4. */
    movingMps: number;
    /** Miss ghost: only when the shot passed this many degrees from the nearest head or more. */
    ghostDeg: number;
    /** Time-to-shot readout: shown when slower than the run median times this ... */
    slowFactor: number;
    /** ... or faster than the run median times this (a good trial is worth saying too). */
    fastFactor: number;
  };
  /** The clean run: one cue-free run per session, the cold-open benchmark (issue #129, #128). */
  cleanRun: {
    /** Scored runs the player must have completed (ever) before one is clean: beginners learn with the cues first. */
    minRuns: number;
  };
  /** Surge (first release) may bring the tells back as a reward: tell strength never below this while it is active. */
  surgeTellFloor: number;
}

export const cues: CueTunables = {
  phases: {
    // The s.d. of the grid posterior falls like 20 / sqrt(trials) at a matched dial (about 6 after 10 trials,
    // 4.5 after 20, 3.5 after 30, 2.6 after 60, floor about 2 from the drift), so these gates mean roughly
    // "a full run of evidence" for bandwidth and "two or three runs" for summary.
    bandwidth: { minRating: 25, maxSd: 5.5 },
    summary: { minRating: 50, maxSd: 3.2 },
    hysteresis: { rating: 3, sd: 1 },
  },
  rules: {
    movingShot: { every: 'all', bandwidth: 'large', summary: 'none' },
    missGhost: { every: 'all', bandwidth: 'large', summary: 'none' },
    // A damage number is not an error signal, so there is nothing to threshold: the hitmarker
    // colour already says which zone was hit.
    damageNumbers: { every: 'all', bandwidth: 'none', summary: 'none' },
    readout: { every: 'all', bandwidth: 'large', summary: 'none' },
  },
  bandwidth: { movingMps: 3.5, ghostDeg: 1.5, slowFactor: 1.3, fastFactor: 0.75 },
  cleanRun: { minRuns: 3 },
  surgeTellFloor: 1,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { cues };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
