/**
 * Offline measurements for the first human-check review (`docs/reviews/human-check-1.md`, #180):
 * what an agent can establish about recoil, movement, slow-on-hit and flinch, the frame/tick
 * alignment part of input latency, and the hit / headshot / kill sounds, without a person.
 *
 * Everything drives the real simulation (`World` through the headless game) or the real sound set
 * renderer; nothing here is a copy of game logic. Run with `npm run human-check` (a few seconds).
 * Not part of the game bundle and not run by the test suite except for a smoke test.
 */
import { EventBus } from '../../core/eventBus';
import { FixedStepper } from '../../core/fixedStep';
import type { GameEvents } from '../../core/gameEvents';
import { TICK_DT } from '../../core/time';
import { audio as audioTunables, type CueId } from '../../config/audio';
import type { WeaponId } from '../../config/weapon';
import { dominantHz, fft, peakDb, spectralCentroid } from '../../audio/analysis';
import { renderSoundSet } from '../../audio/cues';
import { createTickInput, type TickInput } from '../../sim/types';
import { HeadlessGame } from '../bot/headless';
import { percentiles, type Percentiles } from '../latencyProbe';

const R2D = 180 / Math.PI;

// --- Sim helpers -------------------------------------------------------------------------------

interface Rig {
  game: HeadlessGame;
  bus: EventBus<GameEvents>;
  input: TickInput;
}

/** A free-play world with the player standing at the spawn, `weapon` in hand and ready. */
function rig(weapon: WeaponId, seed = 1): Rig {
  const game = new HeadlessGame({ seed });
  const w = game.world;
  const primary = weapon === 'pace' ? 'kestrel' : weapon;
  const r = w.setLoadout({ primary, sidearm: 'pace' });
  if (!r.ok) throw new Error(`loadout ${primary}: ${r.message}`);
  game.reset(seed);
  w.equipWeapon(weapon);
  w.weapon.equipLeft = 0;
  const input = createTickInput();
  input.yaw = w.player.yaw;
  // Settle onto the floor.
  for (let i = 0; i < 64; i++) game.advance(input);
  return { game, bus: game.bus, input };
}

function step(r: Rig, n: number): void {
  for (let i = 0; i < n; i++) r.game.advance(r.input);
}

// --- Recoil and spread -------------------------------------------------------------------------

export interface SprayRow {
  bullet: number;
  /** Mean aim offset the bullet was fired with (deg; + pitch = up, + yaw = right). */
  pitch: number;
  yawAbs: number;
  /** Share of sprays whose yaw offset at this bullet is to the right. */
  rightShare: number;
  spreadDeg: number;
}

export interface SprayReport {
  weapon: WeaponId;
  sprays: number;
  bullets: number;
  rows: SprayRow[];
  /** First bullet (1-based) whose mean |yaw| offset exceeds 0.05 deg. */
  firstSidewaysBullet: number;
  /** Mean pitch offset at bullets 5, 10, 20 and the last one, deg. */
  climbAt: Record<string, number>;
  /** Mean sideways-kick direction switches per spray, and the share of sprays with at least one. */
  switchesPerSpray: number;
  spraysWithSwitch: number;
  /** Shot timestamps: interval between bullets, ms. */
  intervalMs: number;
}

/** Hold fire for a full magazine `sprays` times with seeded RNG, standing still, no compensation. */
export function measureSpray(weapon: WeaponId, sprays = 200): SprayReport {
  const perBullet: { pitch: number[]; yaw: number[]; spread: number[] }[] = [];
  let switches = 0;
  let withSwitch = 0;
  let intervalMs = 0;
  let bullets = 0;
  for (let s = 0; s < sprays; s++) {
    const r = rig(weapon, 1000 + s);
    const shots: { t: number; pitch: number; yaw: number; spread: number }[] = [];
    const off = r.bus.on('shotFired', (e) => {
      shots.push({ t: e.t, pitch: e.recoilPitchDeg, yaw: e.recoilYawDeg, spread: e.spreadDeg });
    });
    const mag = r.game.world.weapon.slots[r.game.world.weapon.active]!.mag;
    r.input.fire = true;
    let guard = 0;
    // A semi-auto needs a fresh press per shot: alternate press and release at its fire rate.
    const semi = r.game.tunables.weapon[weapon].fireMode === 'semi';
    while (shots.length < mag && guard++ < 2000) {
      if (semi) r.input.fire = !r.input.fire;
      step(r, 1);
    }
    off();
    bullets = shots.length;
    if (s === 0 && shots.length > 1) intervalMs = ((shots[shots.length - 1]!.t - shots[0]!.t) / (shots.length - 1)) * 1000;
    // A switch is a change in the direction of the sideways KICK (the step between bullets), not of
    // the accumulated offset, which can stay on one side long after the kick has turned.
    let sw = 0;
    let lastSign = 0;
    shots.forEach((b, i) => {
      perBullet[i] ??= { pitch: [], yaw: [], spread: [] };
      perBullet[i]!.pitch.push(b.pitch);
      perBullet[i]!.yaw.push(b.yaw);
      perBullet[i]!.spread.push(b.spread);
      if (i === 0) return;
      const kick = b.yaw - shots[i - 1]!.yaw;
      const sign = Math.abs(kick) < 1e-6 ? 0 : Math.sign(kick);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) sw++;
      if (sign !== 0) lastSign = sign;
    });
    switches += sw;
    if (sw > 0) withSwitch++;
  }
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const rows: SprayRow[] = perBullet.map((b, i) => ({
    bullet: i + 1,
    pitch: mean(b.pitch),
    yawAbs: mean(b.yaw.map(Math.abs)),
    rightShare: b.yaw.filter((y) => y > 1e-6).length / b.yaw.length,
    spreadDeg: mean(b.spread),
  }));
  const first = rows.find((r) => r.yawAbs > 0.05);
  const at = (n: number): number => rows[Math.min(n, rows.length) - 1]?.pitch ?? NaN;
  return {
    weapon,
    sprays,
    bullets,
    rows,
    firstSidewaysBullet: first ? first.bullet : -1,
    climbAt: { b5: at(5), b10: at(10), b20: at(20), last: at(rows.length) },
    switchesPerSpray: switches / sprays,
    spraysWithSwitch: withSwitch / sprays,
    intervalMs,
  };
}

export interface ResetRow {
  burst: number;
  pauseMs: number;
  /** Aim offset (deg) the next shot is fired with, and its spread (deg). */
  pitchOffsetDeg: number;
  yawOffsetDeg: number;
  spreadDeg: number;
}

/**
 * Fire a burst of `burst` bullets, release for `pauseMs`, fire one more: what offset and spread does
 * that shot get? Shows how long a tap really takes to reset after a burst.
 */
export function measureReset(weapon: WeaponId, bursts: number[], pausesMs: number[]): ResetRow[] {
  const out: ResetRow[] = [];
  for (const burst of bursts) {
    for (const pauseMs of pausesMs) {
      const r = rig(weapon, 7);
      r.game.world.weapon.infiniteMagazine = true; // a 30-bullet burst must not end in an auto-reload
      let last: { pitch: number; yaw: number; spread: number } | null = null;
      let n = 0;
      const off = r.bus.on('shotFired', (e) => {
        n++;
        last = { pitch: e.recoilPitchDeg, yaw: e.recoilYawDeg, spread: e.spreadDeg };
      });
      const semi = r.game.tunables.weapon[weapon].fireMode === 'semi';
      let guard = 0;
      r.input.fire = true;
      while (n < burst && guard++ < 1000) {
        if (semi) r.input.fire = !r.input.fire;
        step(r, 1);
      }
      r.input.fire = false;
      step(r, Math.max(1, Math.round(pauseMs / 1000 / TICK_DT)));
      const before = n;
      r.input.fire = true;
      guard = 0;
      while (n === before && guard++ < 200) step(r, 1);
      off();
      const l = n > before ? (last as { pitch: number; yaw: number; spread: number } | null) : null;
      out.push({ burst, pauseMs, pitchOffsetDeg: l?.pitch ?? NaN, yawOffsetDeg: l?.yaw ?? NaN, spreadDeg: l?.spread ?? NaN });
    }
  }
  return out;
}

// --- Movement ----------------------------------------------------------------------------------

export interface MovementReport {
  weapon: WeaponId;
  runSpeed: number;
  /** Rest to 90 % / 100 % of run speed, ms. */
  accelTo90Ms: number;
  accelTo100Ms: number;
  /** From full run: release (or counter-strafe) to the 27.5 % deadzone, and to a full stop, ms. */
  releaseToDeadzoneMs: number;
  releaseToStopMs: number;
  counterToDeadzoneMs: number;
  counterToStopMs: number;
  /** First tick after the stopping input whose shot would carry no movement error, ms. */
  releaseFirstAccurateMs: number;
  counterFirstAccurateMs: number;
  /** A-D strafe: time from pressing the opposite key at full speed to full speed the other way, ms. */
  reverseToFullMs: number;
}

function speedOf(r: Rig): number {
  const v = r.game.world.player.vel;
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

export function measureMovement(weapon: WeaponId): MovementReport {
  const max = (() => {
    const r = rig(weapon);
    r.input.moveX = 1;
    step(r, 128);
    return speedOf(r);
  })();
  const def = new HeadlessGame().tunables.weapon[weapon];
  const dz = def.deadzoneFraction * def.runSpeedMps;
  const timeTo = (r: Rig, pred: () => boolean, limit = 256): number => {
    for (let i = 1; i <= limit; i++) {
      step(r, 1);
      if (pred()) return i * TICK_DT * 1000;
    }
    return NaN;
  };
  const a = rig(weapon);
  a.input.moveX = 1;
  const to90 = timeTo(a, () => speedOf(a) >= 0.9 * max);
  const a2 = rig(weapon);
  a2.input.moveX = 1;
  const to100 = timeTo(a2, () => speedOf(a2) >= max - 1e-6);

  const stop = (counter: boolean): [number, number] => {
    const r = rig(weapon);
    r.input.moveX = 1;
    step(r, 128);
    r.input.moveX = counter ? -1 : 0;
    let tDz = NaN;
    for (let i = 1; i <= 256; i++) {
      step(r, 1);
      const s = speedOf(r);
      // Counter-strafing: "stopped" is the moment the velocity reverses or reaches zero.
      const vx = r.game.world.player.vel.x;
      if (Number.isNaN(tDz) && s <= dz + 1e-9) tDz = i * TICK_DT * 1000;
      if ((counter && vx <= 1e-9) || (!counter && s <= 1e-9)) return [tDz, i * TICK_DT * 1000];
    }
    return [tDz, NaN];
  };
  const [relDz, relStop] = stop(false);
  const [ctrDz, ctrStop] = stop(true);
  const rev = rig(weapon);
  rev.input.moveX = 1;
  step(rev, 128);
  rev.input.moveX = -1;
  const reverse = timeTo(rev, () => rev.game.world.player.vel.x <= -(max - 1e-6));
  return {
    weapon,
    runSpeed: max,
    accelTo90Ms: to90,
    accelTo100Ms: to100,
    releaseToDeadzoneMs: relDz,
    releaseToStopMs: relStop,
    counterToDeadzoneMs: ctrDz,
    counterToStopMs: ctrStop,
    // A shot carries zero movement error at or below the deadzone (spec §3.4).
    releaseFirstAccurateMs: relDz,
    counterFirstAccurateMs: ctrDz,
    reverseToFullMs: reverse,
  };
}

export interface TaggingReport {
  zone: string;
  /** Lowest speed while tagged as a fraction of run speed. */
  minSpeedFraction: number;
  /** Hit to the lowest speed, ms. */
  toMinMs: number;
  /** Hit until speed is back to 95 % of run speed, ms. */
  recoverTo95Ms: number;
  /** Peak view kick (deg) and the time until it is under 0.05 deg, ms. */
  flinchPeakDeg: number;
  flinchRecoverMs: number;
}

/**
 * Run at full speed, take one 20 HP hit to `zone` from straight ahead at 10 m (small enough that a
 * head hit does not kill; tagging is flat per bullet, flinch depends only on the zone), record speed
 * and flinch. The position is put back after every tick so no wall ever stops the run.
 */
export function measureTagging(zone: 'body' | 'head' | 'leg'): TaggingReport {
  const r = rig('kestrel');
  const w = r.game.world;
  const p = w.player;
  const x0 = p.pos.x, z0 = p.pos.z;
  const hold = (): void => {
    p.pos.x = p.prevPos.x = x0;
    p.pos.z = p.prevPos.z = z0;
  };
  r.input.moveX = 1;
  for (let i = 0; i < 128; i++) {
    step(r, 1);
    hold();
  }
  const max = speedOf(r);
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  w.damagePlayer(20, zone, p.pos.x + fx * 10, p.pos.y + p.eyeHeight, p.pos.z + fz * 10, -1, r.bus);
  let min = Infinity, tMin = 0, tBack = NaN, peak = 0, tFlinch = NaN;
  for (let i = 1; i <= 256; i++) {
    step(r, 1);
    hold();
    const s = speedOf(r) / max;
    if (s < min) {
      min = s;
      tMin = i;
    }
    if (Number.isNaN(tBack) && i > tMin && min < 0.9 && s >= 0.95) tBack = i;
    const punch = Math.abs(p.aimPunch) * R2D;
    if (punch > peak) peak = punch;
    if (Number.isNaN(tFlinch) && peak > 0 && punch < 0.05) tFlinch = i;
  }
  const ms = (t: number): number => t * TICK_DT * 1000;
  return { zone, minSpeedFraction: min, toMinMs: ms(tMin), recoverTo95Ms: ms(tBack), flinchPeakDeg: peak, flinchRecoverMs: ms(tFlinch) };
}

// --- Tick and frame alignment (the part of input latency the game's loop itself adds) ----------

export interface AlignmentRow {
  hz: number;
  /** Click to the start of the frame that fires it (waits for the next frame and, if that frame runs no tick, another), ms. */
  clickToFiringFrame: Percentiles;
  /** Share of frames that run no sim tick (a click landing just before one waits a whole extra frame). */
  zeroTickFrames: number;
  /** Mouse move to the start of the frame that renders it, ms (look is applied per frame, not per tick). */
  moveToFrame: Percentiles;
}

/**
 * The game's own loop (rAF -> sample input -> FixedStepper ticks -> draw), modelled with the real
 * `FixedStepper` at an ideal display rate: an input at a uniformly random time is picked up by the
 * next frame; a click fires in that frame's first tick, or waits for the next frame that has one.
 * Excludes event dispatch, the draw itself, the compositor and the display, which the page probe
 * and the reasoning in the review cover. Assumes Chrome dispatches mousedown immediately and
 * mousemove aligned to the frame (rAF-aligned input), so only the click pays the wait.
 */
export function measureAlignment(hz: number, events = 20000, seed = 3): AlignmentRow {
  const frame = 1 / hz;
  const frames = Math.ceil(hz * 60);
  const st = new FixedStepper(TICK_DT, 8);
  const tickCount: number[] = [];
  for (let i = 0; i < frames; i++) tickCount.push(st.advance(i === 0 ? 0 : frame));
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return s / 4294967296;
  };
  const click: number[] = [];
  const move: number[] = [];
  const span = (frames - 32) * frame;
  for (let k = 0; k < events; k++) {
    const t = frame + rnd() * span;
    let f = Math.ceil(t / frame);
    move.push((f * frame - t) * 1000);
    while (f < frames && tickCount[f] === 0) f++;
    click.push((f * frame - t) * 1000);
  }
  const zero = tickCount.slice(1).filter((n) => n === 0).length / (frames - 1);
  return { hz, clickToFiringFrame: percentiles(click), zeroTickFrames: zero, moveToFrame: percentiles(move) };
}

// --- Sounds ------------------------------------------------------------------------------------

export interface CueMetrics {
  cue: CueId;
  /** First sample above -40 dBFS relative to the cue's own peak, ms (onset delay inside the buffer). */
  onsetMs: number;
  /** Time to the peak sample, ms. */
  peakAtMs: number;
  /** Time until the level stays 30 dB under the peak, ms. */
  durationMs: number;
  peakDb: number;
  /** RMS over the first 50 ms, dBFS (a short-term loudness proxy). */
  rms50Db: number;
  centroidHz: number;
  dominantHz: number;
}

function cueMetrics(cue: CueId, buf: Float32Array, sr: number): CueMetrics {
  let peak = 0, peakAt = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > peak) {
      peak = a;
      peakAt = i;
    }
  }
  const onT = peak * 0.01; // -40 dB under the peak
  let on = 0;
  while (on < buf.length && Math.abs(buf[on]!) < onT) on++;
  const offT = peak * 10 ** (-30 / 20);
  let end = buf.length - 1;
  while (end > 0 && Math.abs(buf[end]!) < offT) end--;
  const n50 = Math.min(buf.length - on, Math.round(0.05 * sr));
  let sq = 0;
  for (let i = on; i < on + n50; i++) sq += buf[i]! * buf[i]!;
  const rms = Math.sqrt(sq / Math.max(1, n50));
  return {
    cue,
    onsetMs: (on / sr) * 1000,
    peakAtMs: (peakAt / sr) * 1000,
    durationMs: ((end - on) / sr) * 1000,
    peakDb: peakDb(buf),
    rms50Db: 20 * Math.log10(rms || 1e-12),
    centroidHz: spectralCentroid(buf, sr),
    dominantHz: dominantHz(buf, sr),
  };
}

/** Log-magnitude spectral distance between two cues (dB, RMS over 1/3-octave bands 100 Hz–8 kHz). */
function bandProfile(buf: Float32Array, sr: number): number[] {
  const n = 8192;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, buf.length); i++) re[i] = buf[i]! * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  fft(re, im);
  const bands: number[] = [];
  for (let f = 100; f < 8000; f *= 2 ** (1 / 3)) {
    const lo = Math.floor((f * n) / sr), hi = Math.max(lo + 1, Math.floor((f * 2 ** (1 / 3) * n) / sr));
    let e = 0;
    for (let k = lo; k < hi; k++) e += re[k]! * re[k]! + im[k]! * im[k]!;
    bands.push(10 * Math.log10(e + 1e-12));
  }
  return bands;
}

export interface SoundReport {
  cues: CueMetrics[];
  /** Spectral distance between cue pairs (dB RMS over third-octave bands, levels normalised to the peak). */
  distance: { a: CueId; b: CueId; db: number }[];
}

export function measureSounds(): SoundReport {
  const sr = 48000;
  const set = renderSoundSet(audioTunables, sr);
  const ids: CueId[] = ['shotKestrel', 'shotPace', 'hitBody', 'hitLeg', 'hitHead', 'kill', 'killSparkle', 'miss'];
  const cues = ids.map((id) => cueMetrics(id, set[id].variants[0]!, sr));
  const prof = new Map<CueId, number[]>();
  for (const id of ids) {
    const p = bandProfile(set[id].variants[0]!, sr);
    const m = Math.max(...p);
    prof.set(id, p.map((v) => v - m));
  }
  const pairs: [CueId, CueId][] = [['hitBody', 'hitLeg'], ['hitBody', 'hitHead'], ['hitLeg', 'hitHead'], ['hitHead', 'kill'], ['hitBody', 'kill'], ['shotKestrel', 'hitBody'], ['shotKestrel', 'hitHead']];
  const distance = pairs.map(([a, b]) => {
    const pa = prof.get(a)!, pb = prof.get(b)!;
    let s = 0;
    for (let i = 0; i < pa.length; i++) s += (Math.max(-60, pa[i]!) - Math.max(-60, pb[i]!)) ** 2;
    return { a, b, db: Math.sqrt(s / pa.length) };
  });
  return { cues, distance };
}

// --- Restart -----------------------------------------------------------------------------------

/** Synchronous cost of the sim side of an instant restart (mode start from a seed), ms. */
export function measureRestartSim(mode = 'coldStart', n = 50): Percentiles {
  const g = new HeadlessGame();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    g.modes.start(mode, { seed: 100 + i });
    out.push(performance.now() - t0);
  }
  return percentiles(out);
}

export interface RestartFlow {
  mode: string;
  /** Mode start (the results card's `Enter`) to `runStarted`, and to the first target spawn after it, ms of sim time. */
  toLiveMs: number;
  toFirstTargetMs: number;
}

/** Sim time from starting a mode to the run going live and to its first target (the wait a player sits through). */
export function measureRestartFlow(mode: string): RestartFlow {
  const g = new HeadlessGame();
  let live = NaN, first = NaN, ticks = 0;
  const offLive = g.bus.on('runStarted', () => {
    if (Number.isNaN(live)) live = ticks;
  });
  const offSpawn = g.bus.on('targetSpawned', () => {
    if (!Number.isNaN(live) && Number.isNaN(first)) first = ticks;
  });
  g.modes.start(mode, { seed: 5 });
  const input = createTickInput();
  input.yaw = g.world.player.yaw;
  while (ticks < 128 * 10 && Number.isNaN(first)) {
    ticks++;
    g.advance(input);
  }
  offLive();
  offSpawn();
  const ms = (t: number): number => t * TICK_DT * 1000;
  return { mode, toLiveMs: ms(live), toFirstTargetMs: ms(first) };
}
