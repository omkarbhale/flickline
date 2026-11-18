import type { MindTunables } from '../../config/mind';
import type { Rng } from '../../core/rng';
import { TICK_DT, TICK_RATE } from '../../core/time';
import type { MindProfile } from './profile';

/**
 * The human aim model of a mind-driven Echo (`docs/research/player-like-enemies.md` §2.6, §5.5;
 * issue #90). Pure, seeded, allocation-free: one `AimState` per enemy slot, made once; `aimStep`
 * advances it one tick and leaves the view (`yaw`, `pitch`, radians, the player's conventions) for
 * the body to use as its command's look angles (#87).
 *
 *   HOLD   - no contact, or the reaction is still running: the view rests on its hold direction
 *            with the settle drift. Observations of the player are already being buffered.
 *   MOVE   - a submovement: the primary (index 0) or a correction. Planned amplitude =
 *            distance x (1 + e), e ~ N(bias, SD) (SD and bias halve with each correction); duration
 *            from Fitts (`ID / throughput`); a minimum-jerk (bell) speed profile; smooth Gaussian
 *            motor noise proportional to the current speed, 0.192 of it across the movement.
 *   GAP    - the correction delay (lognormal, the profile's median) after a submovement; the view
 *            keeps pursuing at the target's angular rate but does not close the error. Then a
 *            correction if the error is beyond the aimed zone, else SETTLE.
 *   SETTLE - on target: pursue the tracked point plus a slow seeded drift (never zero). A large
 *            error (the target got away) starts a catch-up correction.
 *
 * Tracking (§5.5 step 5): the target is the player's aim point observed `trackingDelaySec` ago,
 * extrapolated by `trackingLeadGain x velocity x delay`. The lead grows back over `leadRampSec`
 * after each observed reversal, so an irregular strafe is tracked late (120-300 ms) and a reversal
 * produces a real overshoot. A mind with `rhythmGain` that has seen two regular strafe legs predicts
 * the next reversal and leads through it: a rhythm is free damage, as in the reference game.
 *
 * Only what the enemy saw is buffered (F1): the caller says each tick whether it perceives the
 * player. Caps on angular speed and acceleration hold every tick (§5.5 step 7): no snapping.
 *
 * Allocation-free per tick, which in V8 also means no number returned from or passed to a helper
 * that may not be inlined: random draws land in typed arrays (`Rng.uniformsInto`), yaw differences
 * are wrapped inline (both angles are kept in (-PI, PI], so one step is enough).
 */

export const AIM_HOLD = 0;
export const AIM_MOVE = 1;
export const AIM_GAP = 2;
export const AIM_SETTLE = 3;
export type AimPhase = typeof AIM_HOLD | typeof AIM_MOVE | typeof AIM_GAP | typeof AIM_SETTLE;

const DEG = Math.PI / 180;
const PI = Math.PI;
const TWO_PI = 2 * Math.PI;
const PITCH_LIMIT = 89 * DEG;

/** Scratch for draws: uniforms from the stream, and the two normals `drawNormals` makes of them. */
const U = new Float64Array(3);
const N = new Float64Array(2);

/**
 * Draw `uniforms` (2 or 3) from the stream into `U`; the first two become two independent standard
 * normals in `N` (Box-Muller, both outputs used). No number crosses a call boundary.
 */
function drawNormals(rng: Rng, uniforms: number): void {
  rng.uniformsInto(U, uniforms);
  const r = Math.sqrt(-2 * Math.log(1 - U[0]!)); // 1 - u in (0, 1]: the log never sees 0
  const a = TWO_PI * U[1]!;
  N[0] = r * Math.cos(a);
  N[1] = r * Math.sin(a);
}

/** What the aim model reads from the world each tick. Filled by the caller into one reused object. */
export interface AimInput {
  tick: number;
  /** The enemy's eye, world metres. */
  eyeX: number;
  eyeY: number;
  eyeZ: number;
  /** It perceives the player this tick (sight, F1); only then is the point below recorded. */
  sees: boolean;
  /** The player's point it aims at (head centre lowered by the profile's `aimDropM`), metres. */
  pointX: number;
  pointY: number;
  pointZ: number;
  /** Radius of the aimed zone (head sphere or half the torso), metres: Fitts' width and the tolerances. */
  zoneRadiusM: number;
}

export function createAimInput(): AimInput {
  return { tick: 0, eyeX: 0, eyeY: 0, eyeZ: 0, sees: false, pointX: 0, pointY: 0, pointZ: 0, zoneRadiusM: 0.14 };
}

export interface AimState {
  /** The view, radians (yaw 0 = -Z, + = left; pitch + = up), and its rate, rad/s. */
  yaw: number;
  pitch: number;
  yawRate: number;
  pitchRate: number;
  phase: AimPhase;
  /** Where the view rests while holding. */
  holdYaw: number;
  holdPitch: number;

  // ---- the current submovement ----
  /** 0 = the primary, 1.. = corrections, -1 = none since the last engage. */
  sub: number;
  subT: number;
  subDur: number;
  /** Planned displacement (radians), amplitude error included. */
  subDYaw: number;
  subDPitch: number;
  /** The primary's planned amplitude was beyond the target (S2 overshoot share). */
  overshoot: boolean;
  /** Corrections made since the last engage (the primary not counted). */
  corrections: number;
  /** Correction delay left, seconds (GAP). */
  gapLeft: number;
  /** Smooth unit-variance noise along and across the movement (Ornstein-Uhlenbeck). */
  noiseAlong: number;
  noiseAcross: number;
  /** Tick of the last `aimEngage`, -1 = never. */
  engagedTick: number;

  // ---- settle drift (value noise, two knots per axis) ----
  driftT: number;
  driftDur: number;
  driftY0: number;
  driftP0: number;
  driftY1: number;
  driftP1: number;
  driftYaw: number;
  driftPitch: number;

  // ---- what it saw: a ring of observations ----
  obsTick: Int32Array;
  obsX: Float64Array;
  obsY: Float64Array;
  obsZ: Float64Array;
  /** Index of the newest observation, and how many are held. */
  obsHead: number;
  obsCount: number;

  // ---- reversals and rhythm (in observed time, ticks) ----
  /** Sign of the observed lateral motion (+1 / -1), 0 before any. */
  latSign: number;
  /** Tick (observed) of the last reversal, -1 = none. */
  lastRevTick: number;
  /** The last three leg lengths between reversals, oldest first, ticks (0 = unknown). */
  leg0: number;
  leg1: number;
  leg2: number;

  // ---- the tracked target (written by every step) ----
  hasTarget: boolean;
  tgtYaw: number;
  tgtPitch: number;
  /** Angular rate of the tracked point, rad/s (low-passed). */
  tgtYawRate: number;
  tgtPitchRate: number;
  tgtDist: number;
  /** Angular radius of the aimed zone at the tracked distance, radians. */
  zoneAngle: number;
  /**
   * Angle from the view to where it means to aim, radians: the tracked point, plus the settle drift
   * once settled. What the fire decision reads.
   */
  err: number;
}

export function createAimState(historyTicks: number): AimState {
  const n = Math.max(8, historyTicks | 0);
  return {
    yaw: 0, pitch: 0, yawRate: 0, pitchRate: 0, phase: AIM_HOLD, holdYaw: 0, holdPitch: 0,
    sub: -1, subT: 0, subDur: 0, subDYaw: 0, subDPitch: 0, overshoot: false, corrections: 0, gapLeft: 0,
    noiseAlong: 0, noiseAcross: 0, engagedTick: -1,
    driftT: 0, driftDur: 0, driftY0: 0, driftP0: 0, driftY1: 0, driftP1: 0, driftYaw: 0, driftPitch: 0,
    obsTick: new Int32Array(n), obsX: new Float64Array(n), obsY: new Float64Array(n), obsZ: new Float64Array(n),
    obsHead: -1, obsCount: 0,
    latSign: 0, lastRevTick: -1, leg0: 0, leg1: 0, leg2: 0,
    hasTarget: false, tgtYaw: 0, tgtPitch: 0, tgtYawRate: 0, tgtPitchRate: 0, tgtDist: 0, zoneAngle: 0, err: 0,
  };
}

/** Forget the target: no observations, no learnt rhythm (a new contact starts from scratch). */
export function aimForget(s: AimState): void {
  s.obsHead = -1;
  s.obsCount = 0;
  s.latSign = 0;
  s.lastRevTick = -1;
  s.leg0 = 0;
  s.leg1 = 0;
  s.leg2 = 0;
  s.hasTarget = false;
  s.tgtYawRate = 0;
  s.tgtPitchRate = 0;
  s.err = 0;
}

/** A clean slate looking at (`yaw`, `pitch`) and holding there (spawn). */
export function aimReset(s: AimState, yaw: number, pitch: number): void {
  s.yaw = s.holdYaw = yaw;
  s.pitch = s.holdPitch = pitch;
  s.yawRate = s.pitchRate = 0;
  s.phase = AIM_HOLD;
  s.sub = -1;
  s.subT = s.subDur = s.subDYaw = s.subDPitch = 0;
  s.overshoot = false;
  s.corrections = 0;
  s.gapLeft = 0;
  s.noiseAlong = s.noiseAcross = 0;
  s.engagedTick = -1;
  s.driftT = s.driftDur = 0;
  s.driftY0 = s.driftP0 = s.driftY1 = s.driftP1 = s.driftYaw = s.driftPitch = 0;
  aimForget(s);
}

/** Stop aiming at the player (contact lost): hold where the view is now and forget the target. */
export function aimDisengage(s: AimState): void {
  s.phase = AIM_HOLD;
  s.holdYaw = s.yaw;
  s.holdPitch = s.pitch;
  s.sub = -1;
  aimForget(s);
}

/** The primary submovement is running and at least `fraction` (0..1) of it is done. */
export function primaryPast(s: AimState, fraction: number): boolean {
  return s.phase === AIM_MOVE && s.sub === 0 && s.subT >= fraction * s.subDur;
}

// -------------------------------------------------------------------------------------------------
// Tracking: the delayed, lead-extrapolated observation.
// -------------------------------------------------------------------------------------------------

/** Ring index of the newest observation made at or before `tick`, or the oldest held if all are newer; -1 if none. */
function obsAtOrBefore(s: AimState, tick: number): number {
  const n = s.obsTick.length;
  let i = s.obsHead;
  for (let k = 0; k < s.obsCount; k++) {
    if (s.obsTick[i]! <= tick) return i;
    if (k + 1 < s.obsCount) i = i === 0 ? n - 1 : i - 1;
  }
  return i;
}

function record(s: AimState, inp: AimInput): void {
  const n = s.obsTick.length;
  s.obsHead = s.obsHead + 1 >= n ? 0 : s.obsHead + 1;
  if (s.obsCount < n) s.obsCount++;
  const i = s.obsHead;
  s.obsTick[i] = inp.tick;
  s.obsX[i] = inp.pointX;
  s.obsY[i] = inp.pointY;
  s.obsZ[i] = inp.pointZ;
}

/**
 * Update the tracked target from the observations: the delayed sample, its velocity, reversal and
 * rhythm bookkeeping, the lead, then the direction from the eye. Writes the `tgt*` fields.
 */
function track(s: AimState, inp: AimInput, p: MindProfile, cfg: MindTunables['aim']): void {
  if (s.obsCount === 0) {
    s.hasTarget = false;
    return;
  }
  const delayTicks = Math.round(p.trackingDelaySec * TICK_RATE);
  const i1 = obsAtOrBefore(s, inp.tick - delayTicks);
  const t1 = s.obsTick[i1]!;
  const i0 = obsAtOrBefore(s, t1 - Math.max(1, Math.round(cfg.velocityWindowSec * TICK_RATE)));
  const t0 = s.obsTick[i0]!;
  const x1 = s.obsX[i1]!, y1 = s.obsY[i1]!, z1 = s.obsZ[i1]!;
  let vx = 0, vy = 0, vz = 0;
  if (t1 > t0) {
    const inv = TICK_RATE / (t1 - t0);
    vx = (x1 - s.obsX[i0]!) * inv;
    vy = (y1 - s.obsY[i0]!) * inv;
    vz = (z1 - s.obsZ[i0]!) * inv;
  }

  // Lateral motion seen from the eye: reversals of its sign mark strafe legs.
  let hx = x1 - inp.eyeX, hz = z1 - inp.eyeZ;
  const hl = Math.sqrt(hx * hx + hz * hz) || 1;
  hx /= hl;
  hz /= hl;
  const lat = vx * -hz + vz * hx; // velocity along the eye's right-hand perpendicular to the line of sight
  const sign = lat > cfg.reversalSpeedMps ? 1 : lat < -cfg.reversalSpeedMps ? -1 : 0;
  if (sign !== 0 && sign !== s.latSign) {
    if (s.latSign !== 0 && t1 > s.lastRevTick) {
      if (s.lastRevTick >= 0) {
        s.leg0 = s.leg1;
        s.leg1 = s.leg2;
        s.leg2 = t1 - s.lastRevTick;
      }
      s.lastRevTick = t1;
    } else if (s.latSign === 0) {
      s.lastRevTick = t1; // the first motion seen: lead ramps in from here
    }
    s.latSign = sign;
  }

  // Lead: seconds of extrapolation along the observed velocity.
  const h = (inp.tick - t1) * TICK_DT;
  const since = s.lastRevTick < 0 ? Infinity : (t1 - s.lastRevTick) * TICK_DT;
  const ramp = cfg.leadRampSec > 0 ? Math.min(1, since / cfg.leadRampSec) : 1;
  let k = p.trackingLeadGain * ramp * h;
  const g = p.rhythmGain;
  if (g > 0 && s.leg0 > 0) {
    // Three legs alike (two strafe cycles seen): a rhythm. Two alike happen by chance in a random strafe.
    const mean = (s.leg0 + s.leg1 + s.leg2) / 3;
    const lo = Math.min(s.leg0, s.leg1, s.leg2), hi = Math.max(s.leg0, s.leg1, s.leg2);
    const next = s.lastRevTick + mean;
    if (hi - lo > cfg.rhythmTolerance * mean || t1 > next + cfg.rhythmTolerance * mean) {
      // No rhythm, or the reversal it predicted did not come: forget it (a broken rhythm is not read again
      // until three more legs agree; meanwhile the Echo leads as if it had none).
      if (hi - lo <= cfg.rhythmTolerance * mean) s.leg0 = s.leg1 = s.leg2 = 0;
    } else {
      // A regular rhythm: the next reversal is due one leg after the last; lead through it (mirror).
      let kr = h;
      if (next > t1 && next <= inp.tick) kr = ((next - t1) - (inp.tick - next)) * TICK_DT;
      k = (1 - g) * k + g * kr;
    }
  }
  const px = x1 + vx * k, py = y1 + vy * k, pz = z1 + vz * k;

  const dx = px - inp.eyeX, dy = py - inp.eyeY, dz = pz - inp.eyeZ;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, horiz);
  const dist = Math.sqrt(horiz * horiz + dy * dy) || 1e-6;
  if (s.hasTarget) {
    // Low-passed rate of the tracked direction (the pursuit's feed-forward).
    const a = TICK_DT / (cfg.noiseTauSec + TICK_DT);
    let dy = yaw - s.tgtYaw;
    if (dy > PI) dy -= TWO_PI;
    else if (dy <= -PI) dy += TWO_PI;
    s.tgtYawRate += (dy * TICK_RATE - s.tgtYawRate) * a;
    s.tgtPitchRate += ((pitch - s.tgtPitch) * TICK_RATE - s.tgtPitchRate) * a;
  } else {
    s.tgtYawRate = 0;
    s.tgtPitchRate = 0;
  }
  s.tgtYaw = yaw;
  s.tgtPitch = pitch;
  s.tgtDist = dist;
  s.zoneAngle = Math.atan(inp.zoneRadiusM / dist);
  s.hasTarget = true;
}

// -------------------------------------------------------------------------------------------------
// Submovements.
// -------------------------------------------------------------------------------------------------

/** Fitts' duration of a movement of `amp` radians to a zone of angular radius `zone`, seconds. */
function fittsSec(amp: number, zone: number, p: MindProfile, cfg: MindTunables['aim']): number {
  const id = Math.log2(amp / (2 * Math.max(zone, 1e-4)) + 1);
  const mt = id / Math.max(0.1, p.flickThroughputBps);
  return mt > cfg.minMoveSec ? mt : cfg.minMoveSec;
}

/**
 * Plan submovement `index` from the current view towards where the tracked point will be when it
 * lands (the profile's lead applied to the target's angular rate). Returns the planned duration.
 */
function planSub(s: AimState, index: number, p: MindProfile, rng: Rng, cfg: MindTunables['aim']): number {
  // Distance now, then aim where the target will be at the end of a movement that long.
  let dYaw = s.tgtYaw - s.yaw;
  if (dYaw > PI) dYaw -= TWO_PI;
  else if (dYaw <= -PI) dYaw += TWO_PI;
  let dPitch = s.tgtPitch - s.pitch;
  const mt0 = fittsSec(Math.sqrt(dYaw * dYaw + dPitch * dPitch), s.zoneAngle, p, cfg);
  dYaw += s.tgtYawRate * mt0 * p.trackingLeadGain;
  dPitch += s.tgtPitchRate * mt0 * p.trackingLeadGain;
  const amp = Math.sqrt(dYaw * dYaw + dPitch * dPitch);
  const scale = 1 / (1 << index); // the error halves with each submovement
  drawNormals(rng, 2);
  const e = p.amplitudeBias * scale + p.amplitudeSd * scale * N[0]!;
  if (index === 0) s.overshoot = e > 0;
  s.sub = index;
  s.subT = 0;
  s.subDur = fittsSec(amp, s.zoneAngle, p, cfg);
  s.subDYaw = dYaw * (1 + e);
  s.subDPitch = dPitch * (1 + e);
  s.phase = AIM_MOVE;
  return s.subDur;
}

/**
 * Start aiming at the player (the reaction is over: the aim phase, and the tell, start now). Plans
 * the primary submovement, or settles straight away if the view is already inside the zone.
 * Returns the predicted aim phase in seconds (the primary, plus one correction when the drawn
 * amplitude error leaves the view outside the zone): what the tell is sized from (F5).
 */
export function aimEngage(s: AimState, inp: AimInput, p: MindProfile, rng: Rng, cfg: MindTunables['aim']): number {
  track(s, inp, p, cfg);
  s.engagedTick = inp.tick;
  s.corrections = 0;
  s.overshoot = false;
  s.noiseAlong = s.noiseAcross = 0;
  if (!s.hasTarget) return 0;
  let dYaw = s.tgtYaw - s.yaw;
  if (dYaw > PI) dYaw -= TWO_PI;
  else if (dYaw <= -PI) dYaw += TWO_PI;
  const dPitch = s.tgtPitch - s.pitch;
  const dist = Math.sqrt(dYaw * dYaw + dPitch * dPitch);
  if (dist <= s.zoneAngle * cfg.correctTolerance) {
    s.sub = -1;
    s.phase = AIM_SETTLE;
    return 0;
  }
  const mt = planSub(s, 0, p, rng, cfg);
  // Where the primary is planned to leave the view, relative to the target now.
  const ry = s.subDYaw - dYaw, rp = s.subDPitch - dPitch;
  const residual = Math.sqrt(ry * ry + rp * rp);
  if (residual <= s.zoneAngle * cfg.correctTolerance) return mt;
  return mt + p.correctionDelaySec + fittsSec(residual, s.zoneAngle, p, cfg);
}

// -------------------------------------------------------------------------------------------------
// The tick.
// -------------------------------------------------------------------------------------------------

/** Advance the settle drift and write its current offset (radians) into `driftYaw` / `driftPitch`. */
function stepDrift(s: AimState, p: MindProfile, rng: Rng, cfg: MindTunables['aim']): void {
  s.driftT += TICK_DT;
  if (s.driftT >= s.driftDur) {
    s.driftT -= s.driftDur;
    if (s.driftT > TICK_DT) s.driftT = 0;
    s.driftY0 = s.driftY1;
    s.driftP0 = s.driftP1;
    const sd = p.settleNoiseDeg * DEG;
    drawNormals(rng, 3);
    s.driftY1 = sd * N[0]!;
    s.driftP1 = sd * N[1]!;
    s.driftDur = cfg.driftMinSec + (cfg.driftMaxSec - cfg.driftMinSec) * U[2]!;
  }
  const u = s.driftDur > 0 ? s.driftT / s.driftDur : 1;
  const w = (1 - Math.cos(Math.PI * u)) / 2; // cosine ease: smooth through the knots
  s.driftYaw = s.driftY0 + (s.driftY1 - s.driftY0) * w;
  s.driftPitch = s.driftP0 + (s.driftP1 - s.driftP0) * w;
}

/** Scratch for the commanded angular velocity (rad/s); a typed array so no double is boxed between helpers. */
const cmd = new Float64Array(2);

/**
 * Advance the aim one tick: record what it sees, track, step the phase, then move the view under
 * the caps. `rng` is the enemy's aim stream (#86).
 */
export function aimStep(s: AimState, inp: AimInput, p: MindProfile, rng: Rng, mind: MindTunables): void {
  const cfg = mind.aim;
  if (inp.sees) record(s, inp);
  track(s, inp, p, cfg);
  stepDrift(s, p, rng, cfg);
  const dt = TICK_DT;

  let wy = 0, wp = 0;
  switch (s.phase) {
    case AIM_HOLD: {
      const tau = cfg.pursuitTauSec;
      let ey = s.holdYaw + s.driftYaw - s.yaw;
      if (ey > PI) ey -= TWO_PI;
      else if (ey <= -PI) ey += TWO_PI;
      wy = ey / tau;
      wp = (s.holdPitch + s.driftPitch - s.pitch) / tau;
      break;
    }
    case AIM_MOVE: {
      const tau = s.subT / s.subDur;
      const shape = (30 * tau * tau - 60 * tau * tau * tau + 30 * tau * tau * tau * tau) / s.subDur;
      wy = s.subDYaw * shape;
      wp = s.subDPitch * shape;
      // Smooth signal-dependent noise: SD proportional to the planned speed, 0.192 of it across.
      const a = Math.exp(-dt / cfg.noiseTauSec);
      const b = Math.sqrt(1 - a * a);
      drawNormals(rng, 2);
      s.noiseAlong = a * s.noiseAlong + b * N[0]!;
      s.noiseAcross = a * s.noiseAcross + b * N[1]!;
      const speed = Math.sqrt(wy * wy + wp * wp);
      if (speed > 0) {
        const k = cfg.noiseAlong * p.aimNoiseFactor;
        const ux = wy / speed, uy = wp / speed;
        const along = k * speed * s.noiseAlong;
        const across = k * cfg.noiseAcrossRatio * speed * s.noiseAcross;
        wy += ux * along - uy * across;
        wp += uy * along + ux * across;
      }
      s.subT += dt;
      if (s.subT >= s.subDur) {
        if (s.sub >= cfg.maxCorrections) s.phase = AIM_SETTLE;
        else {
          // Correction delay: lognormal with the profile's median (core/dist's `lognormal`, inline).
          s.phase = AIM_GAP;
          drawNormals(rng, 2);
          s.gapLeft = p.correctionDelaySec * Math.exp(Math.sqrt(Math.log(1 + cfg.correctionDelayCv * cfg.correctionDelayCv)) * N[0]!);
        }
      }
      break;
    }
    case AIM_GAP: {
      wy = s.tgtYawRate;
      wp = s.tgtPitchRate;
      s.gapLeft -= dt;
      if (s.gapLeft <= 0) {
        let ey = s.tgtYaw - s.yaw;
        if (ey > PI) ey -= TWO_PI;
        else if (ey <= -PI) ey += TWO_PI;
        const ep = s.tgtPitch - s.pitch;
        if (s.hasTarget && Math.sqrt(ey * ey + ep * ep) > s.zoneAngle * cfg.correctTolerance && s.sub < cfg.maxCorrections) {
          s.corrections++;
          planSub(s, s.sub + 1, p, rng, cfg);
        } else s.phase = AIM_SETTLE;
      }
      break;
    }
    default: {
      // SETTLE: pursue the tracked point plus the drift; a target that got away earns a catch-up correction.
      let ey = s.tgtYaw + s.driftYaw - s.yaw;
      if (ey > PI) ey -= TWO_PI;
      else if (ey <= -PI) ey += TWO_PI;
      const ep = s.tgtPitch + s.driftPitch - s.pitch;
      const far = Math.max(cfg.catchUpZones * s.zoneAngle, cfg.catchUpMinDeg * DEG);
      if (s.hasTarget && Math.sqrt(ey * ey + ep * ep) > far) {
        s.corrections++;
        planSub(s, 1, p, rng, cfg);
        wy = s.yawRate;
        wp = s.pitchRate;
      } else {
        wy = s.tgtYawRate + ey / cfg.pursuitTauSec;
        wp = s.tgtPitchRate + ep / cfg.pursuitTauSec;
      }
    }
  }
  cmd[0] = wy;
  cmd[1] = wp;
  applyCaps(s, p);
  let yaw = s.yaw + s.yawRate * dt;
  if (yaw > PI) yaw -= TWO_PI;
  else if (yaw <= -PI) yaw += TWO_PI;
  s.yaw = yaw;
  s.pitch += s.pitchRate * dt;
  if (s.pitch > PITCH_LIMIT) { s.pitch = PITCH_LIMIT; s.pitchRate = 0; }
  else if (s.pitch < -PITCH_LIMIT) { s.pitch = -PITCH_LIMIT; s.pitchRate = 0; }
  if (s.hasTarget) {
    // Settled, it holds the point plus its drift and believes that is on target: the drift is the
    // imprecision it cannot see, so it fires with it (and misses by it).
    const settled = s.phase === AIM_SETTLE;
    let ey = s.tgtYaw + (settled ? s.driftYaw : 0) - s.yaw;
    if (ey > PI) ey -= TWO_PI;
    else if (ey <= -PI) ey += TWO_PI;
    const ep = s.tgtPitch + (settled ? s.driftPitch : 0) - s.pitch;
    s.err = Math.sqrt(ey * ey + ep * ep);
  }
}

/** Limit the change of the angular velocity (acceleration cap) and its size (speed cap), then store it. */
function applyCaps(s: AimState, p: MindProfile): void {
  const maxAcc = p.maxAngularAccelDegPerSec2 * DEG * TICK_DT;
  let ay = cmd[0]! - s.yawRate, ap = cmd[1]! - s.pitchRate;
  const am = Math.sqrt(ay * ay + ap * ap);
  if (am > maxAcc) {
    ay *= maxAcc / am;
    ap *= maxAcc / am;
  }
  let wy = s.yawRate + ay, wp = s.pitchRate + ap;
  const maxW = p.maxAngularSpeedDegPerSec * DEG;
  const wm = Math.sqrt(wy * wy + wp * wp);
  if (wm > maxW) {
    wy *= maxW / wm;
    wp *= maxW / wm;
  }
  s.yawRate = wy;
  s.pitchRate = wp;
}

/**
 * Seconds the aim model expects to need to get from the view onto the tracked point now (Fitts on
 * the current error; 0 when already inside the zone). Sizes a prepared holder's tell, which starts
 * at first sight, before the aim is planned.
 */
export function aimEstimateSec(s: AimState, p: MindProfile, cfg: MindTunables['aim']): number {
  if (!s.hasTarget || s.err <= s.zoneAngle * cfg.correctTolerance) return 0;
  return fittsSec(s.err, s.zoneAngle, p, cfg);
}
