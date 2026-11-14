import { cuePhase } from '../adaptive/cueFade';
import type { CuePhase, CueTunables } from '../config/cues';
import { tunables } from '../config/tunables';

/** Facts about the cue schedule a run starts with (design §7.4). Logged, so playtests can read it. */
export interface CueEvents {
  cueScheduleSet: { tick: number; mode: string; phase: CuePhase; clean: boolean };
}

declare module '../core/gameEvents' {
  interface GameEvents extends CueEvents {}
}

/** What the planner needs to know about the run that is about to start. */
export interface CuePlanInput {
  /**
   * The skill the mode trains, as the key the planner keeps its hysteresis under ('line' for modes
   * that train several), or null for a run that moves no rating (free play).
   */
  skill: string | null;
  /** Posterior mean on the 0-100 dial and its s.d. (the confidence band) for that skill. */
  rating: number;
  sd: number;
  /** The Placement run is the probe: always full cues, never the clean run. */
  placement: boolean;
  /** Settings: fade cues as the player improves / one clean run per session. */
  fading: boolean;
  cleanRunEnabled: boolean;
  /** Scored runs the player has completed, ever (persisted in the profile). */
  runsCompleted: number;
}

export interface CuePlan {
  phase: CuePhase;
  clean: boolean;
}

export function createCuePlan(): CuePlan {
  return { phase: 'every', clean: false };
}

/**
 * Decides each run's cue schedule: the phase from the skill posterior (with hysteresis, kept per
 * skill) and whether this is the session's one clean run. Pure state; `features/cues.ts` feeds it
 * and writes the result into the shared `FeedbackOptions`.
 *
 * The clean run is the **first scored run of the session** once the player has completed
 * `cleanRun.minRuns` scored runs ever: a cold open with no warm-up and no cues, so its score and
 * accuracy are the nearest thing to a reference-game result Flickline can measure (the transfer
 * question, #128). It is spent only when the run ends for real (`finish`), so quitting it early
 * offers it again.
 */
export class CuePlanner {
  private readonly phases = new Map<string, CuePhase>();
  private cleanDone = false;

  constructor(private readonly cfg: CueTunables = tunables.cues) {}

  /** Plan a run into `out`. */
  plan(i: Readonly<CuePlanInput>, out: CuePlan = createCuePlan()): CuePlan {
    out.phase = 'every';
    out.clean = false;
    if (i.placement || i.skill === null) return out;
    if (i.cleanRunEnabled && !this.cleanDone && i.runsCompleted >= this.cfg.cleanRun.minRuns) {
      out.clean = true;
      out.phase = 'summary';
      return out;
    }
    const prev = this.phases.get(i.skill) ?? 'every';
    const phase = cuePhase(i.rating, i.sd, prev, this.cfg);
    this.phases.set(i.skill, phase);
    out.phase = i.fading ? phase : 'every';
    return out;
  }

  /** A planned run ended for real: a clean run is now spent for this session. */
  finish(plan: Readonly<CuePlan>): void {
    if (plan.clean) this.cleanDone = true;
  }

  /** Whether this session's clean run has been spent. */
  get cleanSpent(): boolean {
    return this.cleanDone;
  }

  /** The phase remembered for `skill` (what hysteresis compares against), for the debug hook. */
  phaseOf(skill: string): CuePhase {
    return this.phases.get(skill) ?? 'every';
  }
}
