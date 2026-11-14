import { Rng } from '../core/rng';
import { TICK_DT, secondsToTicks } from '../core/time';
import { RAD2DEG } from '../core/math';
import type { Vec3 } from '../core/vec3';

/**
 * A scripted aimer for the drills: the bot harness of design §14.6 (`debug/`). It plays a mode
 * through a `BotHost` (the running game via `window.__flickline.bot`, or a headless World in the
 * tests) with a human-shaped aimer: a reaction delay, an exponential move towards the target and a
 * small seeded aim error, tapping the trigger when settled. Everything it draws comes from its own
 * seeded `Rng`, so the same options give the same run.
 */

export interface BotHost {
  /** Ready a run of the mode with the seed. False if the mode is unknown. */
  startMode(id: string, opts: { seed: number }): boolean;
  /** Advance one sim tick with the given view (radians) and trigger. */
  tick(yaw: number, pitch: number, fire: boolean): void;
  /** The player's eye position and current view. */
  eye(out: Vec3): void;
  view(): { yaw: number; pitch: number };
  /** Aim point (head centre / orb centre) of the first live target; false when none. */
  nextTarget(out: Vec3): boolean;
  /** Id of the live target, to notice a new one. */
  targetId(): number;
  status(): { phase: string; trials: number; trialsWon: number; kills: number; misses: number; score: number };
  hash(): number;
}

export interface BotOptions {
  seed: number;
  /** Own stream (aim error, reaction jitter). Default: the run seed. */
  botSeed?: number;
  /** Seconds from a target appearing to the first movement. */
  reactionSec?: number;
  /** Exponential approach rate of the crosshair (1/s). */
  aimRate?: number;
  /** Standard-deviation-like aim error per target, degrees (uniform ±this). */
  noiseDeg?: number;
  /** Fire when the crosshair is within this many degrees of the (noisy) aim point. */
  fireWithinDeg?: number;
  /** Hard stop in simulated seconds (default: ready + duration + margin). */
  maxSeconds?: number;
}

export interface BotResult {
  ticks: number;
  phase: string;
  trials: number;
  trialsWon: number;
  kills: number;
  misses: number;
  score: number;
  hash: number;
}

const DEFAULTS = { reactionSec: 0.3, aimRate: 12, noiseDeg: 0.4, fireWithinDeg: 0.25, maxSeconds: 80 };

export function playMode(host: BotHost, modeId: string, o: BotOptions): BotResult {
  const cfg = { ...DEFAULTS, ...o };
  const rng = new Rng((o.botSeed ?? o.seed) >>> 0 || 1);
  if (!host.startMode(modeId, { seed: o.seed })) throw new Error(`unknown mode '${modeId}'`);
  const eye = { x: 0, y: 0, z: 0 };
  const aim = { x: 0, y: 0, z: 0 };
  const v = host.view();
  let yaw = v.yaw;
  let pitch = v.pitch;
  let seen = -1;
  let seenTick = 0;
  let noiseYaw = 0;
  let noisePitch = 0;
  let reactionTicks = 0;
  let lastFire = false;
  const k = 1 - Math.exp(-cfg.aimRate * TICK_DT);
  const maxTicks = secondsToTicks(cfg.maxSeconds);
  let ticks = 0;
  while (ticks < maxTicks && host.status().phase !== 'result') {
    let fire = false;
    if (host.nextTarget(aim)) {
      const id = host.targetId();
      if (id !== seen) {
        seen = id;
        seenTick = ticks;
        noiseYaw = (rng.next() * 2 - 1) * cfg.noiseDeg;
        noisePitch = (rng.next() * 2 - 1) * cfg.noiseDeg;
        reactionTicks = secondsToTicks(cfg.reactionSec * (0.85 + rng.next() * 0.3));
      }
      if (ticks - seenTick >= reactionTicks) {
        host.eye(eye);
        const dx = aim.x - eye.x;
        const dy = aim.y - eye.y;
        const dz = aim.z - eye.z;
        const wantYaw = Math.atan2(-dx, -dz) + (noiseYaw / RAD2DEG);
        const wantPitch = Math.asin(dy / Math.hypot(dx, dy, dz)) + (noisePitch / RAD2DEG);
        let dyaw = wantYaw - yaw;
        while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
        while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
        yaw += dyaw * k;
        pitch += (wantPitch - pitch) * k;
        const err = Math.hypot(dyaw * Math.cos(pitch), wantPitch - pitch) * RAD2DEG;
        fire = err < cfg.fireWithinDeg && !lastFire;
      }
    } else {
      seen = -1;
    }
    lastFire = fire;
    host.tick(yaw, pitch, fire);
    ticks++;
  }
  const s = host.status();
  return { ticks, phase: s.phase, trials: s.trials, trialsWon: s.trialsWon, kills: s.kills, misses: s.misses, score: s.score, hash: host.hash() };
}
