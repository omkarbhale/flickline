import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../../config/tunables';
import { moveTowards } from '../../core/math';
import { Rng } from '../../core/rng';
import { TICK_DT, TICK_RATE } from '../../core/time';
import {
  AIM_HOLD, AIM_MOVE, AIM_SETTLE, aimEngage, aimReset, aimStep, createAimInput, createAimState, type AimInput, type AimState,
} from './aim';
import { createMindProfile, profileFor, type MindProfile } from './profile';

/**
 * Signatures S2-S4 of the aim model (`docs/research/player-like-enemies.md` §7.3; issue #90) on the
 * pure model: an Echo's eye at the origin looking down -Z, the player's aim point somewhere in front.
 */

const tun = cloneTunables();
const ANCHORS = tun.mind.anchorSkills;
const DEG = Math.PI / 180;
const EYE_Y = 1.62;

function profile(m: number, seed: number): MindProfile {
  return profileFor(m, new Rng(seed), createMindProfile(), tun);
}

/** The point at yaw `yawRad` (+ = left), `dist` metres away, at eye height. */
function pointAt(inp: AimInput, yawRad: number, dist: number): void {
  inp.pointX = -Math.sin(yawRad) * dist;
  inp.pointY = EYE_Y;
  inp.pointZ = -Math.cos(yawRad) * dist;
}

/** The duel aims at the torso at every anchor (`aimDropM` > the head radius), so the zone is half the torso. */
function freshInput(): AimInput {
  const inp = createAimInput();
  inp.eyeY = EYE_Y;
  inp.sees = true;
  inp.zoneRadiusM = tun.targets.hit.torsoWidth / 2;
  return inp;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 on erf; plenty for a +-8 point band). */
function phi(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

interface Flick {
  peakOverMean: number;
  peakAt: number;
  overshoot: boolean;
  corrections: number;
  /** Ticks with a view change above 3 degrees outside the primary. */
  bigSteps: number;
  /** Largest per-tick change of the angular velocity, deg/s^2, and largest speed, deg/s. */
  maxAccel: number;
  maxSpeed: number;
}

/** One flick of `ampDeg` onto a still head `dist` metres away, from a settled hold, until it settles. */
function flick(p: MindProfile, seed: number, ampDeg: number, dist: number): Flick {
  const s = createAimState(tun.mind.aim.historyTicks);
  const rng = new Rng(seed);
  const inp = freshInput();
  aimReset(s, 0, 0);
  pointAt(inp, ampDeg * DEG, dist);
  for (let i = 0; i < 40; i++) {
    inp.tick++;
    aimStep(s, inp, p, rng, tun.mind); // the reaction runs: it sees, the view holds
  }
  inp.tick++;
  const startYaw = s.yaw;
  aimEngage(s, inp, p, rng, tun.mind.aim);
  const speeds: number[] = [];
  let overshoot = false;
  let primaryDone = false;
  let bigSteps = 0, maxAccel = 0, maxSpeed = 0;
  for (let i = 0; i < 3 * TICK_RATE && s.phase !== AIM_SETTLE; i++) {
    inp.tick++;
    const inPrimary = s.phase === AIM_MOVE && s.sub === 0;
    const y0 = s.yaw, p0 = s.pitch, wy0 = s.yawRate, wp0 = s.pitchRate;
    aimStep(s, inp, p, rng, tun.mind);
    const step = Math.hypot(s.yaw - y0, s.pitch - p0) / DEG;
    if (step > 3 && !inPrimary) bigSteps++;
    maxAccel = Math.max(maxAccel, Math.hypot(s.yawRate - wy0, s.pitchRate - wp0) / TICK_DT / DEG);
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.yawRate, s.pitchRate) / DEG);
    if (inPrimary) speeds.push(Math.hypot(s.yawRate, s.pitchRate));
    else if (!primaryDone) {
      primaryDone = true;
      // Where the primary left the view along the line to the target: beyond it = an overshoot.
      overshoot = (s.yaw - startYaw) / (ampDeg * DEG) > 1;
    }
  }
  let peak = 0, at = 0, sum = 0;
  for (let i = 0; i < speeds.length; i++) {
    sum += speeds[i]!;
    if (speeds[i]! > peak) { peak = speeds[i]!; at = i; }
  }
  return {
    peakOverMean: peak / (sum / speeds.length), peakAt: (at + 0.5) / speeds.length, overshoot,
    corrections: s.corrections, bigSteps, maxAccel, maxSpeed,
  };
}

describe('S2 flick kinematics and S3 no snapping (flicks over 10 degrees)', () => {
  for (const m of ANCHORS) {
    it(`mind skill ${m}: bell-shaped primary, undershoot bias, corrections, caps`, () => {
      const pick = new Rng(1000 + m);
      const flicks: Flick[] = [];
      let expectedOvershoot = 0;
      const N = 120;
      for (let i = 0; i < N; i++) {
        const p = profile(m, i + 1);
        expectedOvershoot += phi(p.amplitudeBias / p.amplitudeSd);
        flicks.push(flick(p, 7 * i + 3, pick.range(12, 70) * (pick.next() < 0.5 ? -1 : 1), pick.range(8, 25)));
      }
      const ratios = flicks.map((f) => f.peakOverMean).sort((a, b) => a - b);
      const median = ratios[N >> 1]!;
      expect(median, 'peak / mean speed').toBeGreaterThanOrEqual(1.5);
      expect(median, 'peak / mean speed').toBeLessThanOrEqual(2.2);
      // Nearly every single flick sits in the band too (motor noise can push the odd one out).
      expect(ratios.filter((r) => r < 1.5 || r > 2.2).length / N).toBeLessThan(0.1);
      const peakAt = flicks.map((f) => f.peakAt).sort((a, b) => a - b)[N >> 1]!;
      expect(peakAt, 'peak position in the primary').toBeGreaterThanOrEqual(0.35);
      expect(peakAt).toBeLessThanOrEqual(0.65);
      const overshoot = flicks.filter((f) => f.overshoot).length / N;
      expect(Math.abs(overshoot - expectedOvershoot / N), `overshoot ${overshoot} vs ${expectedOvershoot / N}`).toBeLessThanOrEqual(0.08);
      const corrected = flicks.filter((f) => f.corrections >= 1).length / N;
      expect(corrected, 'flicks with a correction').toBeGreaterThanOrEqual(0.4);
      expect(corrected).toBeLessThanOrEqual(0.85);
      for (const f of flicks) {
        expect(f.bigSteps, 'view change > 3 deg in one tick outside the primary').toBe(0);
        expect(f.maxAccel).toBeLessThanOrEqual(tun.mind.caps.angularAccelDegPerSec2 * (1 + 1e-9));
        expect(f.maxSpeed).toBeLessThanOrEqual(tun.mind.caps.angularSpeedDegPerSec * (1 + 1e-9));
      }
    });
  }
});

/**
 * The player strafes across the Echo's view 10 m away (accelerating at the spec's rate towards
 * +-5.4 m/s), legs of `leg()` seconds. Returns the lag (ms) at which the Echo's yaw best matches the
 * player's true bearing (cross-correlation), measured from `fromSec`.
 */
function trackingLag(p: MindProfile, seed: number, leg: (rng: Rng) => number, seconds: number, fromSec: number): number {
  const s = createAimState(tun.mind.aim.historyTicks);
  const rng = new Rng(seed);
  const legs = new Rng(seed + 99);
  const inp = freshInput();
  const dist = 10;
  let x = 0, v = 0, dir = 1, left = leg(legs);
  const place = (): void => { inp.pointX = x; inp.pointY = EYE_Y; inp.pointZ = -dist; };
  aimReset(s, 0, 0);
  place();
  for (let i = 0; i < 64; i++) { inp.tick++; aimStep(s, inp, p, rng, tun.mind); }
  inp.tick++;
  aimEngage(s, inp, p, rng, tun.mind.aim);
  const n = Math.round(seconds * TICK_RATE);
  const truth = new Float64Array(n), view = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    left -= TICK_DT;
    if (left <= 0) { dir = -dir; left += leg(legs); }
    v = moveTowards(v, dir * 5.4, 54 * TICK_DT);
    x += v * TICK_DT;
    // Keep it in front: a strafe that wandered far turns round at the next leg.
    if (Math.abs(x) > 4 && Math.sign(x) === dir) left = Math.min(left, TICK_DT);
    place();
    inp.tick++;
    aimStep(s, inp, p, rng, tun.mind);
    truth[i] = Math.atan2(-x, dist);
    view[i] = s.yaw;
  }
  // Cross-correlate angular velocities (over 4 ticks): they carry the timing; the bearings themselves are
  // dominated by the slow drift of where the player is, which flattens the correlation peak.
  const W = 4;
  const from = Math.round(fromSec * TICK_RATE);
  let best = -Infinity, bestLag = 0;
  for (let lag = 0; lag <= 64; lag++) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, k = 0;
    for (let i = Math.max(from, lag + W); i < n; i++) {
      const a = view[i]! - view[i - W]!, b = truth[i - lag]! - truth[i - lag - W]!;
      sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b; k++;
    }
    const r = (sxy - (sx * sy) / k) / Math.sqrt((sxx - (sx * sx) / k) * (syy - (sy * sy) / k));
    if (r > best) { best = r; bestLag = lag; }
  }
  return (bestLag / TICK_RATE) * 1000;
}

describe('S4 tracking lag', () => {
  const median = (xs: number[]): number => xs.sort((a, b) => a - b)[xs.length >> 1]!;
  for (const m of ANCHORS) {
    it(`mind skill ${m}: a random ADAD is tracked 120-300 ms late`, () => {
      const lags: number[] = [];
      for (let seed = 1; seed <= 9; seed++) {  lags.push(trackingLag(profile(m, seed), seed, (r) => r.range(0.2, 0.7), 10, 1)); }
      const lag = median(lags);
      expect(lag).toBeGreaterThanOrEqual(120);
      expect(lag).toBeLessThanOrEqual(300);
    });
  }
  for (const m of ANCHORS.filter((a) => a >= 65)) {
    it(`mind skill ${m}: a regular ADAD is read after two cycles and tracked under 120 ms`, () => {
      const lags: number[] = [];
      for (let seed = 1; seed <= 9; seed++) lags.push(trackingLag(profile(m, seed), seed, () => 0.45, 10, 2 * 4 * 0.45));
      expect(median(lags)).toBeLessThan(120);
    });
  }
  it('below m = 65 a regular rhythm is not read like that (the lesson is for the better Echoes)', () => {
    const lags: number[] = [];
    for (let seed = 1; seed <= 9; seed++) lags.push(trackingLag(profile(0, seed), seed, () => 0.45, 10, 2 * 4 * 0.45));
    expect(median(lags)).toBeGreaterThanOrEqual(120);
  });
});

describe('aim model basics', () => {
  it('without perception there is no target and the view stays on its hold (F1)', () => {
    const p = profile(65, 1);
    const s = createAimState(tun.mind.aim.historyTicks);
    const inp = freshInput();
    inp.sees = false;
    pointAt(inp, 40 * DEG, 10);
    aimReset(s, 0, 0);
    const rng = new Rng(3);
    for (let i = 0; i < 256; i++) { inp.tick++; aimStep(s, inp, p, rng, tun.mind); }
    expect(s.hasTarget).toBe(false);
    expect(s.phase).toBe(AIM_HOLD);
    expect(Math.abs(s.yaw)).toBeLessThan(5 * p.settleNoiseDeg * DEG); // drift only
  });

  it('the view is never still while holding (settle drift is never zero)', () => {
    const p = profile(100, 1);
    const s = createAimState(tun.mind.aim.historyTicks);
    const inp = freshInput();
    inp.sees = false;
    aimReset(s, 0, 0);
    const rng = new Rng(4);
    const ys = new Set<number>();
    for (let i = 0; i < 512; i++) { inp.tick++; aimStep(s, inp, p, rng, tun.mind); ys.add(Math.round(s.yaw / (0.01 * DEG))); }
    expect(ys.size).toBeGreaterThan(5);
  });

  it('an Echo already inside the zone settles straight away: no aim phase', () => {
    const p = profile(65, 2);
    const s = createAimState(tun.mind.aim.historyTicks);
    const inp = freshInput();
    pointAt(inp, 0, 10);
    aimReset(s, 0, 0);
    const rng = new Rng(5);
    inp.tick++;
    aimStep(s, inp, p, rng, tun.mind);
    inp.tick++;
    expect(aimEngage(s, inp, p, rng, tun.mind.aim)).toBe(0);
    expect(s.phase).toBe(AIM_SETTLE);
  });

  it('is deterministic: the same seed gives the same trace, another seed a different one', () => {
    const trace = (seed: number): number[] => {
      const p = profile(35, 9);
      const s: AimState = createAimState(tun.mind.aim.historyTicks);
      const inp = freshInput();
      aimReset(s, 0, 0);
      pointAt(inp, 30 * DEG, 12);
      const rng = new Rng(seed);
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        inp.tick++;
        if (i === 40) aimEngage(s, inp, p, rng, tun.mind.aim);
        aimStep(s, inp, p, rng, tun.mind);
        out.push(s.yaw, s.pitch);
      }
      return out;
    };
    expect(trace(11)).toEqual(trace(11));
    expect(trace(12)).not.toEqual(trace(11));
  });
});
