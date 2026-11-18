import { MIND_PARAMS } from '../../config/mind';
import type { MindParam, MindTunables, ParamBound } from '../../config/mind';
import type { Tunables } from '../../config/tunables';
import type { Rng } from '../../core/rng';

/**
 * The enemy mind's profile: every behaviour parameter of one enemy (`docs/research/player-like-enemies.md`
 * §5.4), from the dial's mind skill and the enemy's own seeded personality (issue #88). Pure,
 * deterministic, allocation-free: `profileFor` writes into a profile made once by `createMindProfile`.
 *
 * The recipe, in this order:
 *  1. **Interpolate** the anchor table linearly by the mind skill (`config/mind.ts`).
 *  2. **Jitter** with the enemy's personality: a reaction factor, an aim-noise factor and an aggression
 *     factor (one draw each, moving their groups together) and one independent draw per habit rate.
 *  3. **Clamp**: probabilities to 0..1, the human limits (`minimums`, `maximums`), the peek mix back to
 *     sum 1, counts to whole numbers, and the fairness floors (`dial.floors`): the mean reaction is
 *     never under the surprised floor, whatever the table and the spreads say.
 *
 * Angles stay in degrees (`...Deg`), times in seconds, distances in metres. Draw order from the
 * personality stream is fixed (reaction, aim noise, aggression, then each habit in the config's order)
 * and every draw happens even when its spread is 0, so a spread change never shifts the stream.
 */

/** Everything the profile reads from `Tunables`. */
export type MindConfig = Pick<Tunables, 'mind' | 'dial' | 'attribution'>;

export interface MindProfile extends Record<MindParam, number> {
  /** The mind skill this profile was built for, clamped to 0..100. */
  mindSkill: number;
  /** The personality factors drawn for this enemy (1 = the anchor value); kept for the death recap (F8) and tests. */
  reactionFactor: number;
  aimNoiseFactor: number;
  aggressionFactor: number;
  /** Mean of the reaction distribution, `mu + tau`, after jitter and floor. */
  reactionMeanSec: number;
  /** Fairness floors (`dial.floors`, #17, #127) the timing code applies to every draw; copied so the mind reads one object. */
  reactionFloorSec: number;
  preparedReactionFloorSec: number;
  tellFloorSec: number;
  /** View caps (`mind.caps`). */
  maxAngularSpeedDegPerSec: number;
  maxAngularAccelDegPerSec2: number;
}

/** A profile with every field at 0; `profileFor` fills it. Allocates once, at enemy creation. */
export function createMindProfile(): MindProfile {
  const p = {
    mindSkill: 0, reactionFactor: 1, aimNoiseFactor: 1, aggressionFactor: 1, reactionMeanSec: 0,
    reactionFloorSec: 0, preparedReactionFloorSec: 0, tellFloorSec: 0, maxAngularSpeedDegPerSec: 0,
    maxAngularAccelDegPerSec2: 0,
  } as MindProfile;
  for (let i = 0; i < MIND_PARAMS.length; i++) p[MIND_PARAMS[i]!] = 0;
  return p;
}

/** Mind skill is 0..100 like the dial (a mode's own choice lives in `ModeDef.mindSkill`); anything else, NaN included, is brought into range. */
export function clampMindSkill(m: number): number {
  return m >= 0 ? (m <= 100 ? m : 100) : 0; // NaN falls through to 0
}

/**
 * Step 1 alone: the anchor table interpolated at `mindSkill`, no personality, no floors. At an anchor
 * it returns that column exactly. Writes only the table's parameters and `mindSkill`.
 */
export function interpolateAnchors(mindSkill: number, out: MindProfile, cfg: MindTunables): void {
  const m = clampMindSkill(mindSkill);
  const a = cfg.anchorSkills;
  let seg = 0;
  while (seg < a.length - 2 && m > a[seg + 1]!) seg++;
  const lo = a[seg]!;
  const t = (m - lo) / (a[seg + 1]! - lo);
  const u = 1 - t; // a*u + b*t is exactly a at t = 0 and exactly b at t = 1
  const rows = cfg.anchors;
  for (let i = 0; i < MIND_PARAMS.length; i++) {
    const k = MIND_PARAMS[i]!;
    const row = rows[k];
    out[k] = row[seg]! * u + row[seg + 1]! * t;
  }
  out.mindSkill = m;
}

function scaleGroup(out: MindProfile, group: readonly MindParam[], f: number): void {
  for (let i = 0; i < group.length; i++) out[group[i]!] *= f;
}

function applyMinimums(out: MindProfile, bounds: readonly ParamBound[]): void {
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!;
    if (out[b.param] < b.value) out[b.param] = b.value;
  }
}

function applyMaximums(out: MindProfile, bounds: readonly ParamBound[]): void {
  for (let i = 0; i < bounds.length; i++) {
    const b = bounds[i]!;
    if (out[b.param] > b.value) out[b.param] = b.value;
  }
}

/** `1 + spread x (2u - 1)`: uniform in `1 +- spread`. */
function factor(rng: Rng, spread: number): number {
  return 1 + spread * (2 * rng.next() - 1);
}

/**
 * Build the profile of one enemy into `out`: interpolated by `mindSkill`, jittered from `rng` (the
 * enemy's personality stream, #86), clamped. Same inputs, same profile; two enemies at the same dial
 * with different serials (so different streams) differ.
 */
export function profileFor(mindSkill: number, rng: Rng, out: MindProfile, cfg: MindConfig): MindProfile {
  const mc = cfg.mind;
  interpolateAnchors(mindSkill, out, mc);

  // Personality.
  const fr = factor(rng, mc.spread.reaction);
  const fn = factor(rng, mc.spread.aimNoise);
  const fa = factor(rng, mc.spread.aggression);
  const g = mc.groups;
  scaleGroup(out, g.reaction, fr);
  scaleGroup(out, g.aimNoise, fn);
  scaleGroup(out, g.aggressionUp, fa);
  scaleGroup(out, g.aggressionDown, 2 - fa);
  for (let i = 0; i < g.habit.length; i++) out[g.habit[i]!] *= factor(rng, mc.spread.habit);
  out.reactionFactor = fr;
  out.aimNoiseFactor = fn;
  out.aggressionFactor = fa;

  // Clamps.
  for (let i = 0; i < g.probabilities.length; i++) {
    const k = g.probabilities[i]!;
    const v = out[k];
    out[k] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  applyMinimums(out, mc.minimums);
  applyMaximums(out, mc.maximums);
  let mix = 0;
  for (let i = 0; i < g.peekMix.length; i++) mix += out[g.peekMix[i]!];
  if (mix > 0) for (let i = 0; i < g.peekMix.length; i++) out[g.peekMix[i]!] /= mix;
  out.burstMin = Math.max(1, Math.round(out.burstMin));
  out.burstMax = Math.max(out.burstMin, Math.round(out.burstMax));
  out.crouchMaxPerDuel = Math.max(0, Math.round(out.crouchMaxPerDuel));
  if (out.tapBeyondM < out.sprayBelowM) out.tapBeyondM = out.sprayBelowM;

  // Fairness floors (dial.floors): the surprised enemy's mean reaction is never under the floor.
  const fl = cfg.dial.floors;
  out.reactionFloorSec = fl.enemyReactionSec;
  out.preparedReactionFloorSec = fl.preparedReactionSec;
  out.tellFloorSec = fl.tellSec;
  const deficit = fl.enemyReactionSec - (out.reactionMuSec + out.reactionTauSec);
  if (deficit > 0) out.reactionMuSec += deficit;
  out.reactionMeanSec = out.reactionMuSec + out.reactionTauSec;

  // Caps and hearing.
  out.maxAngularSpeedDegPerSec = mc.caps.angularSpeedDegPerSec;
  out.maxAngularAccelDegPerSec2 = mc.caps.angularAccelDegPerSec2;
  return out;
}
