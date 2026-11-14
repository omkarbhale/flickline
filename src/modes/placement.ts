import { Staircase } from '../adaptive/staircase';
import { modes as modeCfg } from '../config/modes';
import { ColdStartTrial, TRIAL_RUNNING, type TrialEngine, type TrialStatus } from './coldStart';
import type { SkillId } from './contracts';
import type { ModeContext, ModeDef } from './modeDef';
import { OrbitTrial } from './orbit';

export interface PlacementState {
  /** The 2-up/1-down staircase on the dial (design §9.2); its position is the next trial's difficulty. */
  staircase: Staircase;
  readonly orbit: OrbitTrial;
  readonly cold: ColdStartTrial;
  /** Engine of the trial in flight, or null between trials. */
  current: TrialEngine | null;
  /** Skill the trial in flight trains. */
  currentSkill: SkillId;
  /** Trials started so far; even = Orbit-style, odd = Cold-Start-style. */
  started: number;
  nextAt: number;
}

/**
 * The Placement run (design §9.2): 45 s of Orbit and Cold Start trials, alternating, whose dial
 * follows a 2-up/1-down staircase (step 16 / 8 / 4 / 2). Every trial is reported as a `skillTrial`
 * on its own skill at the staircase's dial, so one run initialises the posterior of both skills;
 * the host then hands the staircase to `SkillState.finishPlacement` (the sanity bound). Trials
 * have no dial-driven pacing of their own: the staircase is the only difficulty input.
 */
export const placement: ModeDef<PlacementState> = {
  id: 'placement',
  skills: ['flick', 'precision'],
  map: 'range',
  weapon: 'kestrel',
  player: { standAt: 'beacon-shell', lockMovement: true, infiniteMagazine: true },
  durationSec: modeCfg.placement.durationSec,
  axes: ['beaconScale', 'flickMinDeg', 'flickMaxDeg', 'distance', 'orbitExposureSec', 'coldStartExposureSec'],
  // The dial is the staircase's, not a beat's: one beat for the whole run, flat.
  beatSec: null,
  waveCurve: [0],

  setup: (ctx: ModeContext<PlacementState>) => ({
    staircase: new Staircase(ctx.dial, ctx.tunables.dial),
    orbit: new OrbitTrial(true),
    cold: new ColdStartTrial(true),
    current: null,
    currentSkill: 'flick',
    started: 0,
    nextAt: 0,
  }),

  tick(ctx: ModeContext<PlacementState>) {
    const s = ctx.state;
    if (s.current) {
      const ended = s.current.step(ctx);
      if (ended !== TRIAL_RUNNING) finishTrial(ctx, ended);
    }
    if (s.current || ctx.liveTick < s.nextAt) return;
    const orbitTurn = s.started % 2 === 0;
    const engine = orbitTurn ? s.orbit : s.cold;
    const skill: SkillId = orbitTurn ? 'flick' : 'precision';
    const d = s.staircase.dial;
    if (!engine.start(ctx, ctx.axesAt(d), skill, d)) return; // nothing placeable this tick: try again
    s.current = engine;
    s.currentSkill = skill;
    s.started++;
  },

  onEvent(ctx: ModeContext<PlacementState>, ev) {
    const cur = ctx.state.current;
    if (!cur) return;
    const ended = cur.onEvent(ctx, ev);
    if (ended !== TRIAL_RUNNING) finishTrial(ctx, ended);
  },
};

/** A trial ended: the staircase moves, and the gap to the next one starts. */
function finishTrial(ctx: ModeContext<PlacementState>, how: TrialStatus): void {
  const s = ctx.state;
  const engine = s.current!;
  s.staircase.record(engine.lastSuccess);
  s.current = null;
  s.nextAt = ctx.liveTick + engine.gapTicks(ctx, how);
}
