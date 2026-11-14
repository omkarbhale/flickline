import { baseline as baselineCfg, BASELINE_SKILLS, type BaselineSkill } from '../config/baseline';
import { BASELINE_ITEMS } from '../config/baselineItems';
import { Rng, shuffle } from '../core/rng';
import { ColdStartTrial, TRIAL_RUNNING, type TrialEngine, type TrialStatus } from './coldStart';
import type { FixedItem, SkillId } from './contracts';
import type { ModeContext, ModeDef } from './modeDef';
import { OrbitTrial } from './orbit';

/**
 * # The Daily Baseline (design §8.5, `docs/research/transfer.md` §5)
 *
 * A fixed, cold, reference-like benchmark: 40 trials on the Range with the Kestrel, 20 Orbit-style
 * (`flick`) and 20 Cold-Start-style (`precision`), alternating, built on the Placement run's trial
 * engines. A fixed count, not a fixed time: it ends when the 40th trial resolves, so every player
 * answers the same items. There is no adaptation inside it (no staircase, no beats, no wave
 * curve): each skill runs at its Baseline level for the whole run.
 *
 * The items are data (`config/baselineItems.ts`, generated once from a fixed seed). The run's seed
 * only decides their order and which side of the crosshair each one is on, so every Baseline is
 * equally hard while no two layouts repeat. Its `skillTrial` events are tagged `baseline`, so the
 * matched posterior never consumes them; its presentation is reference-like (`referenceLike`).
 */

/** One trial of the run: which skill, and the stored item (already mirrored) it plays. */
export interface BaselineTrialPlan {
  readonly skill: BaselineSkill;
  readonly item: FixedItem;
}

/** Baseline level (a dial value of `baseline.levels`) of each skill. */
export type BaselineLevels = Readonly<Record<BaselineSkill, number>>;

/**
 * The highest Baseline level at or below `matchedDial` (transfer.md §5.3: the first Baseline is no
 * harder than the player's matched runs); the lowest level for anything below it.
 */
export function baselineLevelFor(matchedDial: number, levels: readonly number[] = baselineCfg.levels): number {
  let level = levels[0]!;
  for (const l of levels) if (l <= matchedDial) level = l;
  return level;
}

/** Snap any dial value to a Baseline level (a value already on a level stays). */
export const snapToLevel = baselineLevelFor;

/**
 * Is a Baseline due (design §8.5, transfer.md §5.1)? Yes when nothing was finished in the last
 * `gapHours` hours: `lastRunEndMs` is when the player's last finished run ended, in the caller's
 * wall-clock milliseconds (`null` = never played or unknown), and `nowMs` is the same clock now.
 * Pure: the clock is injected. A last run in the future (the clock moved back) is not a gap.
 */
export function isBaselineDue(lastRunEndMs: number | null, nowMs: number, gapHours: number = baselineCfg.gapHours): boolean {
  if (lastRunEndMs === null || !Number.isFinite(lastRunEndMs)) return true;
  return nowMs - lastRunEndMs >= gapHours * 3_600_000;
}

/** A seed for the order stream: the run's seed folded with a constant, so it never shares a stream with the run's gaps. */
const ORDER_SALT = 0xba5e0d3c;

/**
 * The 40 trials of one run, alternating `flick`, `precision`, ...: each skill's stored list for its
 * level, shuffled by the run's seed, with exactly half the items mirrored to each side (a seeded
 * shuffle of the sides). Two seeds give different sequences over exactly the same items, so the
 * item statistics of every Baseline at a level are identical.
 */
export function buildBaselineSequence(seed: number, levels: BaselineLevels): BaselineTrialPlan[] {
  const rng = new Rng((seed ^ ORDER_SALT) >>> 0);
  const perSkill: Record<BaselineSkill, FixedItem[]> = { flick: [], precision: [] };
  for (const skill of BASELINE_SKILLS) {
    const stored = BASELINE_ITEMS[skill][snapToLevel(levels[skill])];
    if (!stored) throw new Error(`baseline: no item list for ${skill} at level ${levels[skill]}`);
    const order = shuffle(rng, stored.map((_, i) => i));
    const sides: (1 | -1)[] = stored.map((_, i) => (i % 2 === 0 ? 1 : -1));
    shuffle(rng, sides);
    perSkill[skill] = order.map((src, k) => {
      const [angleDeg, pitchDeg, distance, scale, exposureSec] = stored[src]!;
      return { angleDeg, pitchDeg, distance, scale, exposureSec, side: sides[k]!, index: src };
    });
  }
  const plan: BaselineTrialPlan[] = [];
  const n = Math.max(perSkill.flick.length, perSkill.precision.length);
  for (let i = 0; i < n; i++) {
    for (const skill of BASELINE_SKILLS) {
      const item = perSkill[skill][i];
      if (item) plan.push({ skill, item });
    }
  }
  return plan;
}

export interface BaselineState {
  readonly plan: readonly BaselineTrialPlan[];
  readonly levels: BaselineLevels;
  readonly orbit: OrbitTrial;
  readonly cold: ColdStartTrial;
  /** Engine of the trial in flight, or null between trials. */
  current: TrialEngine | null;
  /** Trials started so far (the index of the next plan entry). */
  started: number;
  /** Trials resolved so far. */
  resolved: number;
  nextAt: number;
}

/** The level each skill runs at: the host's `levels` for the run, else the run's dial snapped to a level. */
function levelsOf(ctx: ModeContext<BaselineState>): BaselineLevels {
  const pick = (s: SkillId): number => snapToLevel(ctx.levels[s] ?? ctx.dial);
  return { flick: pick('flick'), precision: pick('precision') };
}

export const baseline: ModeDef<BaselineState> = {
  id: 'baseline',
  skills: ['flick', 'precision'],
  map: 'range',
  weapon: 'kestrel',
  player: { standAt: 'beacon-shell', lockMovement: true, infiniteMagazine: true },
  // Fixed trial count, not fixed time: the mode ends the run itself when the last trial resolves.
  durationSec: Infinity,
  axes: ['beaconScale', 'flickMinDeg', 'flickMaxDeg', 'distance', 'orbitExposureSec', 'coldStartExposureSec'],
  // No adaptation: one beat for the whole run, flat.
  beatSec: null,
  waveCurve: [0],
  trialSource: 'baseline',
  referenceLike: true,

  setup(ctx: ModeContext<BaselineState>): BaselineState {
    const levels = levelsOf(ctx);
    return {
      plan: buildBaselineSequence(ctx.seed, levels),
      levels,
      orbit: new OrbitTrial(true),
      cold: new ColdStartTrial(true),
      current: null,
      started: 0,
      resolved: 0,
      nextAt: 0,
    };
  },

  tick(ctx: ModeContext<BaselineState>) {
    const s = ctx.state;
    if (s.current) {
      const ended = s.current.step(ctx);
      if (ended !== TRIAL_RUNNING) finishTrial(ctx, ended);
    }
    if (s.current || ctx.liveTick < s.nextAt || s.started >= s.plan.length) return;
    const step = s.plan[s.started]!;
    const engine = step.skill === 'flick' ? s.orbit : s.cold;
    // The item's difficulty on the dial scale is its level: every item of a list is as hard as the level says.
    const level = s.levels[step.skill];
    if (!engine.start(ctx, ctx.axes, step.skill, level, step.item)) return; // nothing placeable this tick: try again
    s.current = engine;
    s.started++;
  },

  onEvent(ctx: ModeContext<BaselineState>, ev) {
    const cur = ctx.state.current;
    if (!cur) return;
    const ended = cur.onEvent(ctx, ev);
    if (ended !== TRIAL_RUNNING) finishTrial(ctx, ended);
  },
};

/** A trial ended: the gap to the next one starts, and the 40th ends the run. */
function finishTrial(ctx: ModeContext<BaselineState>, how: TrialStatus): void {
  const s = ctx.state;
  const engine = s.current!;
  s.current = null;
  s.resolved++;
  if (s.resolved >= s.plan.length) {
    ctx.end('complete');
    return;
  }
  s.nextAt = ctx.liveTick + engine.gapTicks(ctx, how);
}

/** Trials in a run, from the config (20 per skill). */
export const BASELINE_TRIALS = BASELINE_SKILLS.length * baselineCfg.trialsPerSkill;
