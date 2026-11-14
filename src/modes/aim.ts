import { RAD2DEG } from '../core/math';
import { TICK_DT } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import type { PlayerView, SourceEvents } from './contracts';

/**
 * Aim geometry and the per-target shot bookkeeping shared by the drills (design §3 stat
 * definitions: flick error, reaction time, first bullet). Pure and allocation-free after
 * construction: every helper writes into caller-owned scratch.
 */

/** Unit direction from `eye` to `p`. Returns false (and a zero vector) if they coincide. */
export function directionTo(out: Vec3, eye: Vec3, p: Vec3): boolean {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-9) {
    out.x = out.y = out.z = 0;
    return false;
  }
  out.x = dx / len;
  out.y = dy / len;
  out.z = dz / len;
  return true;
}

/** Angle in degrees between two unit vectors. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const d = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * RAD2DEG;
}

/**
 * Signed overshoot (design §3 "flick error"), degrees: how far `aim` is from `target` along the
 * flick axis, the great circle from `from` (where the crosshair started) to `target`. Positive =
 * the crosshair went past the target, negative = it stopped short. 0 when `from` is the target.
 */
export function overshootDeg(aim: Vec3, target: Vec3, from: Vec3): number {
  const dt = target.x * from.x + target.y * from.y + target.z * from.z;
  // `from` projected into the tangent plane at the target: points back along the flick.
  const fx = from.x - target.x * dt;
  const fy = from.y - target.y * dt;
  const fz = from.z - target.z * dt;
  const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (fl < 1e-9) return 0;
  const da = aim.x * target.x + aim.y * target.y + aim.z * target.z;
  const ax = aim.x - target.x * da;
  const ay = aim.y - target.y * da;
  const az = aim.z - target.z * da;
  // Component of the aim's offset from the target that points away from where the flick began.
  const along = -(ax * fx + ay * fy + az * fz) / fl;
  return Math.asin(along > 1 ? 1 : along < -1 ? -1 : along) * RAD2DEG;
}

/** What a shot at the current target did. */
export const FIRST_MISS = 0;
export const FIRST_BODY = 1;
export const FIRST_HEAD = 2;

/**
 * Per-target shot bookkeeping, reset by `begin`. A "bullet at the target" is any bullet that lands
 * (shotImpact) while it is up: the modes are single-target, so every shot is aimed at it.
 */
export class ShotTracker {
  /** Unit direction from the eye to the target centre at spawn, and of the crosshair at spawn. */
  readonly targetDir = vec3();
  readonly fromDir = vec3();
  private readonly eye = vec3();
  private readonly aim = vec3();
  private readonly toTarget = vec3();
  centre: Vec3 = vec3();
  spawnTick = 0;
  /** Bullets landed since spawn. */
  shots = 0;
  firstShotTick = -1;
  /** Angle between the crosshair and the target centre when the first bullet was fired (degrees); -1 = none. */
  errDeg = -1;
  /** Signed flick overshoot at the first bullet (degrees). */
  overshoot = 0;
  firstOutcome = FIRST_MISS;
  /** The crosshair-to-target angle at spawn: how far the player has to move (degrees). */
  spawnOffsetDeg = 0;

  /** The target is `centre` (aim point), just spawned. */
  begin(player: PlayerView, centre: Vec3, liveTick: number): void {
    this.centre = centre;
    this.spawnTick = liveTick;
    this.shots = 0;
    this.firstShotTick = -1;
    this.errDeg = -1;
    this.overshoot = 0;
    this.firstOutcome = FIRST_MISS;
    this.setEye(player);
    directionFromAngles(this.fromDir, player.yaw, player.pitch);
    directionTo(this.targetDir, this.eye, centre);
    this.spawnOffsetDeg = angleDeg(this.fromDir, this.targetDir);
  }

  /** Count one bullet; on the first, record where the crosshair was and what it hit. */
  onImpact(player: PlayerView, liveTick: number, ev: SourceEvents['shotImpact'], targetId: number): void {
    this.shots++;
    if (this.shots > 1) return;
    this.firstShotTick = liveTick;
    this.setEye(player);
    directionFromAngles(this.aim, player.yaw, player.pitch);
    directionTo(this.toTarget, this.eye, this.centre);
    this.errDeg = angleDeg(this.aim, this.toTarget);
    this.overshoot = overshootDeg(this.aim, this.toTarget, this.fromDir);
    const hit = ev.onTarget && (ev.targetId === undefined || ev.targetId === targetId);
    this.firstOutcome = !hit ? FIRST_MISS : ev.zone === 'head' || ev.zone === undefined || ev.zone === null ? FIRST_HEAD : FIRST_BODY;
  }

  /** Milliseconds from spawn to the first bullet, or -1 before it. */
  firstShotMs(): number {
    return this.firstShotTick < 0 ? -1 : (this.firstShotTick - this.spawnTick) * TICK_DT * 1000;
  }

  /**
   * Reaction time (design §3): the sim's figure when it has one (it measures from the first tick the
   * target was actually in view), else spawn to the first bullet if that bullet was aimed within
   * `aimDeg` of the target. Undefined if neither.
   */
  rtMs(simRtMs: number, aimDeg: number): number | undefined {
    if (simRtMs > 0) return simRtMs;
    return this.firstShotTick >= 0 && this.errDeg >= 0 && this.errDeg <= aimDeg ? this.firstShotMs() : undefined;
  }

  private setEye(p: PlayerView): void {
    this.eye.x = p.pos.x;
    this.eye.y = p.pos.y + p.eyeHeight;
    this.eye.z = p.pos.z;
  }
}
