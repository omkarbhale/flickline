/**
 * The bot's skill model: one number (`skill`, 0..100, the same scale as the difficulty dial and the
 * latent ability of design §9.1) expands into the handful of human-shaped parameters the `Bot`
 * actually uses. Every parameter can also be set directly (`Partial<BotParams>`), which is how the
 * regression suite isolates one effect at a time. Numbers come from
 * `docs/research/human-performance.md` (simple visual RT 0.22 s, Fitts throughput 4.5 -> 7 bits/s);
 * where that document has no figure the value is an ESTIMATE, marked below. See the README.
 */

export interface BotParams {
  /**
   * Standard deviation of the aim error at the moment of the shot, degrees per axis (a 2-D
   * Gaussian around the aim point). The residual of the last submovement: the main skill lever.
   */
  aimSigmaDeg: number;
  /** Seconds from a target becoming visible (or the bot being free) to the first movement. */
  reactionMeanSec: number;
  /** Standard deviation of the reaction time, seconds. */
  reactionSdSec: number;
  /**
   * Flick overshoot bias: the primary submovement lands `bias x distance` past the target (+) or
   * short of it (-). Novices overshoot; set a negative value to model an under-flicker.
   */
  overshootBias: number;
  /** Standard deviation of the primary submovement's endpoint, as a fraction of its distance. */
  overshootSpread: number;
  /** Fitts throughput in bits per second: flick time = log2(distance / width + 1) / throughput. */
  throughputBitsPerSec: number;
  /** Seconds from the crosshair settling to the trigger press. */
  clickDelaySec: number;
  /**
   * Spray control, 0..1: the share of the weapon's known recoil offset the bot pulls back out of
   * its view while firing (1 = perfect pull-down, 0 = ignores the recoil).
   */
  sprayControl: number;
  /** Bullets per trigger pull on an automatic weapon before the bot lets go and re-aims. Semi-auto weapons always fire one. */
  burstBullets: number;
  /** Seconds the bot holds off between bursts, and after a kill before it notices the next target. */
  recoverySec: number;
  /** Seconds the bot gives a target before it gives up on it (it left, or it is not reachable). */
  giveUpSec: number;
  /** Degrees per second of the search turn towards a target that is not in view yet (e.g. behind the player). */
  searchDegPerSec: number;
}

/** Skill 0 and skill 100 values; everything in between is interpolated (`geometric` ones in log space). */
interface Range {
  at0: number;
  at100: number;
  geometric?: boolean;
}

const RANGES: { [K in keyof BotParams]: Range } = {
  // ESTIMATE. 0.5 deg at skill 0 (a shaky novice: about one head radius at 15 m), 0.03 deg
  // at skill 100 (a flick-stable expert). Geometric: each 10 skill points shave about a quarter off.
  aimSigmaDeg: { at0: 0.5, at100: 0.03, geometric: true },
  // Research §1: simple RT 0.218 s (SD 0.039 s trial to trial); experts about 90 ms faster than novices.
  reactionMeanSec: { at0: 0.4, at100: 0.2 },
  reactionSdSec: { at0: 0.05, at100: 0.025 },
  // ESTIMATE: novices fling the crosshair past the target, experts land on it.
  overshootBias: { at0: 0.1, at100: 0.005 },
  overshootSpread: { at0: 0.1, at100: 0.015 },
  // Research §2: TP 4.5 bits/s (the ISO mouse figure, a floor for a gamer) -> 7 (ESTIMATE, skilled aimers).
  throughputBitsPerSec: { at0: 4.5, at100: 7 },
  clickDelaySec: { at0: 0.09, at100: 0.03 },
  sprayControl: { at0: 0.15, at100: 0.95 },
  burstBullets: { at0: 6, at100: 3 },
  recoverySec: { at0: 0.3, at100: 0.12 },
  giveUpSec: { at0: 3, at100: 3 },
  searchDegPerSec: { at0: 420, at100: 900 },
};

export const BOT_PARAM_KEYS = Object.keys(RANGES) as (keyof BotParams)[];

function lerp(r: Range, s: number): number {
  return r.geometric ? r.at0 * Math.pow(r.at100 / r.at0, s) : r.at0 + (r.at100 - r.at0) * s;
}

export function clampSkill(skill: number): number {
  return Number.isFinite(skill) ? Math.min(100, Math.max(0, skill)) : 50;
}

/** The parameters of a bot of the given skill (0..100). */
export function paramsForSkill(skill: number): BotParams {
  const s = clampSkill(skill) / 100;
  const out = {} as Record<keyof BotParams, number>;
  for (const k of BOT_PARAM_KEYS) out[k] = lerp(RANGES[k], s);
  out.burstBullets = Math.round(out.burstBullets);
  return out;
}

/** Skill-derived parameters with explicit overrides on top (undefined overrides are ignored). */
export function resolveParams(skill: number, overrides: Partial<BotParams> = {}): BotParams {
  const p = paramsForSkill(skill);
  for (const k of BOT_PARAM_KEYS) {
    const v = overrides[k];
    if (v !== undefined && Number.isFinite(v)) p[k] = v;
  }
  return p;
}
