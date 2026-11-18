import type { MovementTunables } from '../../config/movement';
import type { WeaponDef, WeaponRules } from '../../config/weapon';
import { DEG2RAD } from '../../core/math';
import type { Rng } from '../../core/rng';
import { TICK_DT } from '../../core/time';
import { vec3, type Vec3 } from '../../core/vec3';
import {
  applyRecoilKick, coneDirection, isMovingShot, movementErrorDeg, returnRecoil, sprayAccumDeg, sprayIncrement,
  stepYawSign, type RecoilReturnState,
} from '../weaponModel';

/**
 * A mind-driven Echo's gun (issue #90, research §5.5 step 8, F6): the spray, spread, movement error
 * and recoil of `docs/mechanics-spec.md` §3 through the same `weaponModel` rules as the player's gun,
 * so an Echo's first bullet is accurate only from a stop and its spray climbs like the player's.
 * Plain data, allocation-free. The magazine and reload arrive with the shared body (#87).
 *
 * Spray control: the profile's `sprayCompensation` is the fraction of the recoil offset the Echo
 * pulls against; the barrel points at the view plus the rest. (A player pulling the mouse moves the
 * view instead; for the bullet the two are the same, and keeping the view on the aim model's path
 * keeps the aim signatures clean.)
 */

/** Same rounding guard as the player's gun (`sim/weapon.ts`). */
const EPS = 1e-9;
/** "Never" for the last shot time, finite so hashes stay well-defined. */
const LONG_AGO = -1e9;

export interface MindGun extends RecoilReturnState {
  /** Spec §3.3 spray count `n`. */
  sprayCount: number;
}

export function createMindGun(): MindGun {
  return { sprayCount: 0, lastShotTime: LONG_AGO, recoilIndex: 0, recoilPitch: 0, recoilYaw: 0, yawSign: 1, yawTarget: 1 };
}

/** A gun with no spray in progress (spawn). */
export function gunReset(g: MindGun): void {
  g.sprayCount = 0;
  g.lastShotTime = LONG_AGO;
  g.recoilIndex = 0;
  g.recoilPitch = 0;
  g.recoilYaw = 0;
  g.yawSign = 1;
  g.yawTarget = 1;
}

/** One tick of the gun between shots: the recoil yaw-direction swing and the return to the crosshair (spec §3.5). */
export function gunTick(g: MindGun, def: WeaponDef, tick: number): void {
  stepYawSign(def, g, TICK_DT);
  returnRecoil(def, g, tick);
}

/** One shot's direction and the facts behind it. Reused. */
export interface MindShot {
  /** Unit direction the bullet leaves along: view, uncompensated recoil, spread. */
  dir: Vec3;
  /** Spread half-angle the shot was drawn from, degrees. */
  spreadDeg: number;
  /** Above the weapon's accuracy deadzone (design §3 "moving shot"). */
  moving: boolean;
}

export function createMindShot(): MindShot {
  return { dir: vec3(0, 0, -1), spreadDeg: 0, moving: false };
}

/** What a shot reads of the shooter: its view (radians), horizontal speed (m/s), stance and recoil control. */
export interface Shooter {
  yaw: number;
  pitch: number;
  speed: number;
  crouching: boolean;
  /** Fraction of the recoil offset it pulls against (the profile's `sprayCompensation`). */
  compensation: number;
}

/**
 * Fire one bullet from the shooter's view: spray count and spread (spec §3.3), its own movement
 * error (§3.4), the uncompensated recoil offset, a seeded point in the spread cone (two draws,
 * always), then the kick for the next bullet (§3.5). Writes `out`. Numbers travel in objects, not
 * arguments, so none is boxed on the way in.
 */
export function gunShoot(
  g: MindGun, def: WeaponDef, rules: WeaponRules, move: MovementTunables, body: Shooter, rng: Rng, tick: number,
  out: MindShot,
): MindShot {
  const time = tick * TICK_DT;
  const since = time - g.lastShotTime;
  if (since >= def.recoverySec - EPS) {
    g.sprayCount = 0;
    g.recoilIndex = 0;
    g.recoilPitch = 0;
    g.recoilYaw = 0;
    g.yawSign = 1;
    g.yawTarget = 1;
  }
  const accum = sprayAccumDeg(def, g.sprayCount);
  g.sprayCount += sprayIncrement(def, rules, since);
  g.lastShotTime = time;

  const moving = isMovingShot(def, body.speed, false);
  const stance = body.crouching ? def.crouchSpreadMult : 1;
  const spreadDeg = accum * stance + movementErrorDeg(def, move, body.speed / def.runSpeedMps, body.crouching, false);
  const keep = 1 - body.compensation;
  const by = body.yaw - g.recoilYaw * keep * DEG2RAD; // + recoil yaw = right = smaller view yaw
  const bp = body.pitch + g.recoilPitch * keep * DEG2RAD;
  const u = rng.next();
  const phi = rng.next() * Math.PI * 2;
  const power = moving ? rules.centreBiasPowerMoving : rules.centreBiasPowerStill;
  coneDirection(out.dir, by, bp, spreadDeg * Math.pow(u, power) * DEG2RAD, phi);
  applyRecoilKick(def, g, rng, moving, body.crouching);
  out.spreadDeg = spreadDeg;
  out.moving = moving;
  return out;
}
