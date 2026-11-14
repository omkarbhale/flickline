import { DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import type { WeaponDef } from '../config/weapon';
import type { ViewmodelTunables, ViewmodelWeaponTunables } from '../config/viewmodel';
import type { WeaponState } from '../sim/types';

/**
 * Where the first-person weapon is, as a pure function of the sim's weapon state (design section 11:
 * "recoil animation driven by the sim's recoil state"; issue #45).
 *
 * Inputs are the sim's own numbers and nothing else: the aim offset (`recoilPitch`, `recoilYaw`),
 * the yaw direction (`yawSign`), the time of the last shot (`lastShotTime`), `equipLeft` and
 * `reloadLeft`, plus the sim time to evaluate at. There is no random number, no clock and no
 * remembered state in here, so the same sim state always gives the same pose, bit for bit
 * (`viewmodelPose.test.ts`). It reads the sim and never writes it. Allocates nothing.
 *
 * Pose conventions: viewmodel space (+X right, +Y up, the camera looks down -Z), rotations applied
 * in the order Y, X, Z (three.js 'YXZ'): `p' = pos + Ry * Rx * Rz * p`. +rx pitches the muzzle up,
 * +ry turns it LEFT (to turn it right use -ry), as for the world camera.
 */

export interface ViewmodelPose {
  /** Placement of the model origin (the grip), metres. Already mirrored for the left hand. */
  x: number;
  y: number;
  z: number;
  /** Euler angles in radians (order YXZ), already mirrored for the left hand. */
  rx: number;
  ry: number;
  rz: number;
  /** True when the model is mirrored (left hand): the mesh is drawn with scale.x = -1. */
  mirror: boolean;
}

export function createViewmodelPose(): ViewmodelPose {
  return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, mirror: false };
}

function smoothstep(a: number, b: number, x: number): number {
  if (b <= a) return x >= b ? 1 : 0;
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * The pose at `nowSec`. `stateSec` is the sim time the state belongs to (`tick * TICK_DT`); the
 * renderer draws `alpha` of the way between the last two ticks, so `nowSec` is up to one tick
 * earlier and the timers are advanced by that difference, which makes the animation smooth at any
 * frame rate. A shot fired this very tick has `nowSec < lastShotTime`; it counts as time 0, so the
 * kick shows in the same frame as the shot.
 */
export function viewmodelPose(
  out: ViewmodelPose,
  w: WeaponState,
  def: WeaponDef,
  vt: ViewmodelWeaponTunables,
  cfg: ViewmodelTunables,
  stateSec: number,
  nowSec: number,
  mirror: boolean,
): ViewmodelPose {
  const ahead = nowSec - stateSec; // <= 0 between ticks

  // Per-shot kick: instant, then an exponential decay since the last shot. A held spray at the
  // fire rate restarts it every shot, so the gun visibly pumps in time with the sim.
  const since = Math.max(0, nowSec - w.lastShotTime);
  const kick = Math.exp(-since / vt.kickDecaySec);

  // Climb: follow the sim's aim offset so the player sees the pattern building and recovering.
  // (+ pitch = bullets go up; + yaw = bullets go right, which is -ry.)
  let pitch = (w.recoilPitch * vt.climbPitchGain + vt.kickPitchDeg * kick) * DEG2RAD;
  let yaw = (-w.recoilYaw * vt.climbYawGain + vt.restYawDeg) * DEG2RAD;
  let roll = vt.kickRollDeg * kick * w.yawSign * DEG2RAD;
  let px = vt.rest.x;
  let py = vt.rest.y;
  let pz = vt.rest.z + vt.kickBackM * kick;

  // Equip: rise from below over the sim's equip time (the sim's `equipLeft` counts down).
  if (w.equipLeft > 0 && def.equipSec > 0) {
    const left = Math.max(0, w.equipLeft - ahead);
    const lowered = 1 - smoothstep(0, 1, 1 - left / def.equipSec);
    const e = lowered * lowered; // quick lift at the end, no float at the start
    py -= cfg.equip.dropM * e;
    pitch -= cfg.equip.pitchDeg * DEG2RAD * e;
    roll += cfg.equip.rollDeg * DEG2RAD * e;
    px += 0.04 * e;
  }

  // Reload: tilt and lower, two knocks (magazine out at 0.38, in at 0.64), then come back.
  if (w.reloadLeft > 0 && def.reloadSec > 0) {
    const left = Math.max(0, w.reloadLeft - ahead);
    const r = 1 - left / def.reloadSec;
    const lower = cfg.reload.lowerFrac;
    const w01 = smoothstep(0, lower, r) * (1 - smoothstep(1 - cfg.reload.raiseFrac, 1, r));
    const knock = (c: number): number => {
      const d = (r - c) / 0.05;
      return Math.exp(-d * d);
    };
    py -= cfg.reload.dropM * w01;
    pitch -= cfg.reload.pitchDeg * DEG2RAD * w01;
    roll += cfg.reload.rollDeg * DEG2RAD * w01;
    px -= 0.03 * w01;
    py += cfg.reload.knockM * (knock(0.64) - knock(0.38)) * w01;
    pitch += 0.06 * (knock(0.38) - knock(0.64)) * w01;
  }

  out.mirror = mirror;
  out.x = mirror ? -px : px;
  out.y = py;
  out.z = pz;
  out.rx = pitch;
  out.ry = mirror ? -yaw : yaw;
  out.rz = mirror ? -roll : roll;
  return out;
}

/** Sim time of the pose to draw: `alpha` of the way between the last two ticks. */
export function poseTimeSec(tick: number, alpha: number): number {
  return (tick - 1 + alpha) * TICK_DT;
}

/**
 * Transform a model-space point by a pose (same maths as three.js: scale.x = -1 when mirrored,
 * then rotation YXZ, then translation). Used for the muzzle position and the safe-zone test.
 * Writes `out` (xyz) and returns it. No allocation.
 */
export function transformPoint(
  pose: ViewmodelPose,
  px: number,
  py: number,
  pz: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const x0 = pose.mirror ? -px : px;
  // Rz
  const cz = Math.cos(pose.rz), sz = Math.sin(pose.rz);
  const x1 = x0 * cz - py * sz;
  const y1 = x0 * sz + py * cz;
  // Rx
  const cx = Math.cos(pose.rx), sx = Math.sin(pose.rx);
  const y2 = y1 * cx - pz * sx;
  const z2 = y1 * sx + pz * cx;
  // Ry
  const cy = Math.cos(pose.ry), sy = Math.sin(pose.ry);
  out.x = x1 * cy + z2 * sy + pose.x;
  out.y = y2 + pose.y;
  out.z = -x1 * sy + z2 * cy + pose.z;
  return out;
}
