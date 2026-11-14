import type { AxisDef, DialTunables, FairnessFloors } from '../config/dial';
import { tunables } from '../config/tunables';
import { clamp } from '../core/math';

/**
 * Dial -> difficulty axes, fairness floors and tiers (design §9.3.5, §9.4, §8.4).
 * Pure functions of the dial and the `dial` tunables; see `skillModel.ts` for the model overview.
 */

export const DIAL_MIN = 0;
export const DIAL_MAX = 100;

/** Concrete axis values for one dial setting (units as in `config/dial.ts`). */
export interface DialAxes {
  beaconScale: number;
  distance: number;
  flickMinDeg: number;
  flickMaxDeg: number;
  strafeSpeed: number;
  strafeLegSec: number;
  standStillSec: number;
  strafeLimitSec: number;
  exposureSec: number;
  orbitExposureSec: number;
  coldStartExposureSec: number;
  stopAndPopExposureSec: number;
  peekWideSec: number;
  enemyReactionSec: number;
  tellSec: number;
  /** Loudness of the added tell cues, 1 (full) .. 0 (gone); see `TellCueAxis`. */
  tellCue: number;
  enemyHitChance: number;
  density: number;
}

export function createAxes(): DialAxes {
  return {
    beaconScale: 0,
    distance: 0,
    flickMinDeg: 0,
    flickMaxDeg: 0,
    strafeSpeed: 0,
    strafeLegSec: 0,
    standStillSec: 0,
    strafeLimitSec: 0,
    exposureSec: 0,
    orbitExposureSec: 0,
    coldStartExposureSec: 0,
    stopAndPopExposureSec: 0,
    peekWideSec: 0,
    enemyReactionSec: 0,
    tellSec: 0,
    tellCue: 0,
    enemyHitChance: 0,
    density: 0,
  };
}

/** Value of one axis at `dial` (clamped to 0–100). */
export function axisValue(def: AxisDef, dial: number): number {
  const t = clamp(dial, DIAL_MIN, DIAL_MAX) / DIAL_MAX;
  switch (def.curve) {
    case 'linear':
      return def.at0 + (def.at100 - def.at0) * t;
    case 'geometric':
      return def.at0 * Math.pow(def.at100 / def.at0, t);
    case 'step': {
      // Equal dial bands, one per integer value: 1..6 over 0..100 gives bands of 16.7 points.
      const lo = Math.round(def.at0);
      const hi = Math.round(def.at100);
      const n = Math.abs(hi - lo) + 1;
      const k = Math.min(n - 1, Math.floor(t * n));
      return lo + Math.sign(hi - lo) * k;
    }
  }
}

/** Tell-cue loudness at `dial`: 1 up to `fullBelow`, a straight ramp to 0 at `goneAbove`. */
export function tellCueAt(dial: number, cfg: DialTunables = tunables.dial): number {
  const { fullBelow, goneAbove } = cfg.tellCue;
  const d = clamp(dial, DIAL_MIN, DIAL_MAX);
  if (d <= fullBelow) return 1;
  if (d >= goneAbove) return 0;
  return (goneAbove - d) / (goneAbove - fullBelow);
}

/**
 * Axis values for `dial`, with the fairness floors applied last so no tuning of the end points can
 * break them. Writes into `out` (allocation-free when one is passed).
 */
export function axes(dial: number, out: DialAxes = createAxes(), cfg: DialTunables = tunables.dial): DialAxes {
  const a = cfg.axes;
  const f = cfg.floors;
  out.beaconScale = Math.max(f.minTargetScale, axisValue(a.beaconScale, dial));
  out.distance = axisValue(a.distance, dial);
  out.flickMinDeg = axisValue(a.flickMinDeg, dial);
  out.flickMaxDeg = Math.max(out.flickMinDeg, axisValue(a.flickMaxDeg, dial));
  out.strafeSpeed = axisValue(a.strafeSpeed, dial);
  out.strafeLegSec = axisValue(a.strafeLegSec, dial);
  out.standStillSec = axisValue(a.standStillSec, dial);
  out.strafeLimitSec = Math.max(f.exposureSec, axisValue(a.strafeLimitSec, dial));
  out.exposureSec = Math.max(f.exposureSec, axisValue(a.exposureSec, dial));
  out.orbitExposureSec = Math.max(f.exposureSec, f.orbitExposureSec, axisValue(a.orbitExposureSec, dial));
  out.coldStartExposureSec = Math.max(f.exposureSec, f.coldStartExposureSec, axisValue(a.coldStartExposureSec, dial));
  out.stopAndPopExposureSec = Math.max(f.exposureSec, f.stopAndPopExposureSec, axisValue(a.stopAndPopExposureSec, dial));
  out.peekWideSec = Math.max(f.exposureSec, axisValue(a.peekWideSec, dial));
  out.enemyReactionSec = Math.max(f.enemyReactionSec, axisValue(a.enemyReactionSec, dial));
  out.tellSec = Math.max(f.tellSec, axisValue(a.tellSec, dial));
  out.tellCue = tellCueAt(dial, cfg);
  out.enemyHitChance = clamp(axisValue(a.enemyHitChance, dial), 0, 1);
  out.density = Math.max(1, axisValue(a.density, dial));
  return out;
}

/**
 * Spawn fairness (design §9.3.5): nothing spawns closer than `spawnMinDistance` in any direction,
 * and nothing inside the view cone (`spawnViewAngleDeg` either side of the view direction) closer
 * than `spawnViewConeDistance` (no point-blank ambush, #12 P6).
 */
export function isFairSpawn(angleFromViewDeg: number, distance: number, f: FairnessFloors = tunables.dial.floors): boolean {
  if (distance < f.spawnMinDistance) return false;
  return !(Math.abs(angleFromViewDeg) < f.spawnViewAngleDeg && distance < f.spawnViewConeDistance);
}

export interface TierInfo {
  /** Index into `cfg.tiers` (0 = lowest). */
  index: number;
  name: string;
  /** 1–3 (I–III, ascending), or 0 for tiers without divisions (Zenith). */
  division: number;
  /** Display label, e.g. "Cobalt II", or "Zenith" alone. */
  label: string;
  /** 0..1 progress through the current sub-tier towards the next one (1 at the very top). */
  progress: number;
}

const ROMAN = ['', 'I', 'II', 'III'];

export function createTierInfo(): TierInfo {
  return { index: 0, name: '', division: 0, label: '', progress: 0 };
}

/** Tier, division and progress for a dial value (design §8.4). Writes into `out`. */
export function tier(dial: number, out: TierInfo = createTierInfo(), cfg: DialTunables = tunables.dial): TierInfo {
  const d = clamp(dial, DIAL_MIN, DIAL_MAX);
  const tiers = cfg.tiers;
  let i = 0;
  while (i + 1 < tiers.length && d >= tiers[i + 1].from) i++;
  const t = tiers[i];
  const lo = t.from;
  const hi = i + 1 < tiers.length ? tiers[i + 1].from : DIAL_MAX;
  out.index = i;
  out.name = t.name;
  if (t.divisions) {
    const third = (hi - lo) / 3;
    const div = Math.min(2, Math.floor((d - lo) / third));
    out.division = div + 1;
    out.label = `${t.name} ${ROMAN[div + 1]}`;
    out.progress = clamp((d - lo - div * third) / third, 0, 1);
  } else {
    out.division = 0;
    out.label = t.name;
    out.progress = hi > lo ? clamp((d - lo) / (hi - lo), 0, 1) : 1;
  }
  return out;
}

/** Shown rating (design §8.4: 0–3000) for a dial value. */
export function displayRating(dial: number, cfg: DialTunables = tunables.dial): number {
  return Math.round(clamp(dial, DIAL_MIN, DIAL_MAX) * cfg.ratingPerDial);
}

/** Dial offset that makes the expected success rate `p` for ability θ: dial = θ − s·logit(p). */
export function successOffset(p: number, scale: number): number {
  const q = clamp(p, 0.01, 0.99);
  return scale * Math.log(q / (1 - q));
}
