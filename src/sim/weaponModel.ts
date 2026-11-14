import type { Rng } from '../core/rng';
import type { DamageBand, WeaponDef, WeaponRules } from '../config/weapon';
import type { HitZone } from './types';

/**
 * Pure weapon rules from `docs/mechanics-spec.md` §3, as small functions of plain data so each
 * rule is unit-testable on its own. `sim/weapon.ts` composes them into the per-tick simulation.
 * No allocation: results are numbers or written into caller-owned objects.
 */

/** Spec §3.3: stationary spread (degrees) for spray count `n`, before stance and movement. */
export function sprayAccumDeg(def: WeaponDef, n: number): number {
  const ramp = def.spreadRampBullets > 0 ? Math.min(1, n / def.spreadRampBullets) : 1;
  return def.spreadFirstDeg + (def.spreadMaxDeg - def.spreadFirstDeg) * ramp;
}

/**
 * Spec §3.3: how much a shot adds to the spray count, given the seconds since the previous shot.
 * Held fire (within `heldFireIntervals` fire intervals) adds 1; a deliberate tap adds 1/tapEfficiency.
 */
export function sprayIncrement(def: WeaponDef, rules: WeaponRules, sinceLastSec: number): number {
  const held = sinceLastSec <= rules.heldFireIntervals / def.fireRateHz;
  return held ? 1 : 1 / def.tapEfficiency;
}

/**
 * Spec §3.4: degrees of movement error for a horizontal speed fraction `f` of the equipped run
 * speed. Zero at or below the deadzone, ramps to the walk (or crouch-walk) value at the walk
 * fraction, then to the run value at full speed; airborne replaces all of it.
 */
export function movementErrorDeg(
  def: WeaponDef,
  rules: WeaponRules,
  f: number,
  crouching: boolean,
  airborne: boolean,
): number {
  if (airborne) return def.errAirDeg;
  const dz = def.deadzoneFraction;
  if (f <= dz) return 0;
  const midFraction = crouching ? rules.crouchWalkFraction : rules.walkFraction;
  const midAdd = crouching ? def.errCrouchMoveDeg : def.errWalkDeg;
  if (f <= midFraction) return (midAdd * (f - dz)) / (midFraction - dz);
  const g = Math.min(1, (f - midFraction) / (1 - midFraction));
  return midAdd + (def.errRunDeg - midAdd) * g;
}

/** Design §3 "moving shot": above the weapon's accuracy deadzone, or airborne. */
export function isMovingShot(def: WeaponDef, speed: number, airborne: boolean): boolean {
  return airborne || speed > def.deadzoneFraction * def.runSpeedMps;
}

/** Spec §3.2: damage for a hit in `zone` at `distanceM` (stepwise bands; past the last, the last). */
export function damageFor(def: WeaponDef, zone: HitZone, distanceM: number): number {
  const bands = def.damageBands;
  let band: DamageBand = bands[bands.length - 1]!;
  for (let i = 0; i < bands.length; i++) {
    if (distanceM <= bands[i]!.upToM) {
      band = bands[i]!;
      break;
    }
  }
  return zone === 'head' ? band.head : zone === 'leg' ? band.leg : band.body;
}

/** Recoil pattern lookup: entry `i`, or the last entry past the end (0 for an empty table). */
export function patternAt(table: readonly number[], i: number): number {
  if (table.length === 0) return 0;
  return table[i < table.length ? i : table.length - 1]!;
}

/** The recoil part of WeaponState that `applyRecoilKick` advances. */
export interface RecoilState {
  recoilIndex: number;
  recoilPitch: number;
  recoilYaw: number;
  yawSign: number;
  yawTarget: number;
}

/**
 * Spec §3.5: after a bullet with index `state.recoilIndex` has been fired, roll the yaw direction
 * switch (never for protected bullets), add that bullet's kick to the aim offset, and advance the
 * index. Returns true if the yaw direction switched on this bullet.
 */
export function applyRecoilKick(
  def: WeaponDef,
  state: RecoilState,
  rng: Rng,
  moving: boolean,
  crouching: boolean,
): boolean {
  const i = state.recoilIndex;
  let flipped = false;
  if (i >= def.recoilProtectedBullets && def.recoilFlipChance > 0 && rng.next() < def.recoilFlipChance) {
    state.yawTarget = -state.yawTarget;
    if (def.recoilFlipTimeSec <= 0) state.yawSign = state.yawTarget;
    flipped = true;
  }
  const pitchMult = moving ? def.recoilMovingPitchMult : 1;
  const yawMult = moving ? def.recoilMovingYawMult : crouching ? def.recoilCrouchYawMult : 1;
  state.recoilPitch += patternAt(def.recoilPitchDeg, i) * pitchMult;
  state.recoilYaw += patternAt(def.recoilYawDeg, i) * yawMult * state.yawSign;
  state.recoilIndex = i + 1;
  return flipped;
}

/** Spec §3.5 switch time: swing the yaw direction towards its target over `recoilFlipTimeSec`. */
export function stepYawSign(def: WeaponDef, state: RecoilState, dt: number): void {
  if (state.yawSign === state.yawTarget) return;
  if (def.recoilFlipTimeSec <= 0) {
    state.yawSign = state.yawTarget;
    return;
  }
  const maxDelta = (2 * dt) / def.recoilFlipTimeSec;
  const d = state.yawTarget - state.yawSign;
  state.yawSign = Math.abs(d) <= maxDelta ? state.yawTarget : state.yawSign + Math.sign(d) * maxDelta;
}

/** Spec §3.5 view recovery: move the aim offset towards zero by `maxDeg` (straight line). */
export function returnRecoil(state: RecoilState, maxDeg: number): void {
  const p = state.recoilPitch;
  const y = state.recoilYaw;
  const len = Math.sqrt(p * p + y * y);
  if (len <= maxDeg) {
    state.recoilPitch = 0;
    state.recoilYaw = 0;
    return;
  }
  const k = (len - maxDeg) / len;
  state.recoilPitch = p * k;
  state.recoilYaw = y * k;
}
