import type { AudioTunables, CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/gameEvents';
import { vec3, type Vec3 } from '../core/vec3';
import { AudioEngine, type CuePlayer, type PlayOptions } from './audioEngine';
import { attachEnemySfx } from './enemySfx';
import { busiestSweepMoment } from './mixScenario';
import { attachSfx } from './sfx';
import { azimuthDeg, positionAtAzimuth } from './spatial';

/**
 * In-browser audio measurements on the REAL graph (the same `AudioEngine`, buses, ducking, limiter,
 * HRTF panner and event wiring the game uses), rendered offline in an `OfflineAudioContext`. Node
 * has no Web Audio, so these cannot run in Vitest; they run in headless Chromium through the debug
 * hook (`__flickline.audioProbe(kind)`) and their numbers go in the PR and `docs/audio.md`.
 * Loaded on demand (dynamic import): it is not part of the game's start-up cost.
 */

const SR = 48000;
const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-9));

function offline(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
}

function engineOn(ctx: OfflineAudioContext, t: AudioTunables): AudioEngine {
  const e = new AudioEngine(t);
  e.build(ctx);
  e.setListener(0, 1.6, 0, 0, 0);
  return e;
}

const rms = (a: Float32Array, from = 0, to = a.length): number => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]! * a[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
};

export interface SpatialResult {
  cue: CueId;
  azimuthDeg: number;
  leftDb: number;
  rightDb: number;
  /** right minus left, dB: positive = heard on the right. */
  diffDb: number;
}

/** Left/right energy of positioned cues at the given bearings (HRTF, listener at the origin facing -Z, 8 m away). */
export async function probeSpatial(t: AudioTunables, cues: CueId[] = ['enemyTell', 'enemyShot', 'whiz'], azimuths: number[] = [-60, 60]): Promise<SpatialResult[]> {
  const out: SpatialResult[] = [];
  for (const cue of cues) {
    for (const az of azimuths) {
      const ctx = offline(0.7);
      const engine = engineOn(ctx, t);
      const pos = positionAtAzimuth(vec3(), 0, 1.6, 0, 0, az, cue === 'whiz' ? 1 : 8);
      engine.play(cue, { position: pos, durationMs: 300 });
      const buf = await ctx.startRendering();
      const l = rms(buf.getChannelData(0));
      const r = rms(buf.getChannelData(1));
      out.push({ cue, azimuthDeg: Math.round(azimuthDeg(0, 0, 0, pos.x, pos.z)), leftDb: db(l), rightDb: db(r), diffDb: db(r) - db(l) });
    }
  }
  return out;
}

export interface DipResult {
  /** Level of the deepest 25 ms window from the dip start, relative to the same tone with no dip, dB. */
  minDb: number;
  /** ms after the dip started that the deepest window occurred. */
  minAtMs: number;
  /** ms after the dip started until the level is back within 1 dB of the undipped tone. */
  recoveredMs: number;
  /** Largest sample-to-sample step of the dipped signal over that of the undipped one, from the dip start to 0.6 s after: <= 1 means the dip added no click. */
  maxStepRatio: number;
  /** Largest step in the 20 ms around the dip start and around its end, over the undipped tone's: the two moments a click would come from. */
  edgeStepRatio: number;
  dipStartedAtSec: number;
}

/**
 * The damage dip on a steady 4 kHz tone fed through the real master chain (the cutoff falls to
 * 900 Hz in 8 ms and returns to open over 300 ms, exponentially in frequency, so a 4 kHz tone is
 * back after about 150 ms and only the very top of the spectrum is cut for the full 300 ms). The
 * same tone is rendered with and without the dip and compared window by window.
 */
export async function probeDamageDip(t: AudioTunables): Promise<DipResult> {
  const dipAt = 0.5;
  const render = async (dip: boolean): Promise<{ x: Float32Array; at: number }> => {
    const ctx = offline(1.6);
    const engine = engineOn(ctx, t);
    const tone = ctx.createBuffer(1, SR, SR); // exactly 4000 cycles: a seamless loop
    const d = tone.getChannelData(0);
    for (let i = 0; i < SR; i++) d[i] = 0.1 * Math.sin((2 * Math.PI * 4000 * i) / SR);
    const src = ctx.createBufferSource();
    src.buffer = tone;
    src.loop = true;
    src.connect(engine.masterInput!);
    src.start(0);
    if (dip) {
      void ctx.suspend(dipAt).then(() => {
        engine.dipLowpass();
        return ctx.resume();
      });
    }
    return { x: (await ctx.startRendering()).getChannelData(0), at: engine.lastDip.at };
  };
  const ref = await render(false);
  const dipped = await render(true);
  const win = Math.round(0.025 * SR);
  const w0 = Math.round(dipAt * SR);
  let minDb = Infinity, minAt = 0;
  const ratios: number[] = [];
  for (let i = w0; i + win <= ref.x.length; i += win / 5) {
    const r = db(rms(dipped.x, i, i + win) / rms(ref.x, i, i + win));
    ratios.push(r);
    if (r < minDb) { minDb = r; minAt = ratios.length - 1; }
  }
  let rec = ratios.length;
  for (let i = minAt; i < ratios.length; i++) if (ratios[i]! > -1) { rec = i; break; }
  const step = (x: Float32Array, from: number, to: number): number => {
    let m = 0;
    for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(x[i]! - x[i - 1]!));
    return m;
  };
  const edge = Math.round(0.02 * SR);
  const endAt = w0 + Math.round(0.3 * SR);
  const edgeRatio = Math.max(
    step(dipped.x, w0 - edge, w0 + edge) / step(ref.x, w0 - edge, w0 + edge),
    step(dipped.x, endAt - edge, endAt + edge) / step(ref.x, endAt - edge, endAt + edge),
  );
  return {
    minDb,
    minAtMs: (minAt * win) / 5 / SR * 1000,
    recoveredMs: (rec * win) / 5 / SR * 1000,
    maxStepRatio: step(dipped.x, w0, w0 + Math.round(0.6 * SR)) / step(ref.x, w0, w0 + Math.round(0.6 * SR)),
    edgeStepRatio: edgeRatio,
    dipStartedAtSec: dipped.at,
  };
}

export interface MixResult {
  hits: number;
  /** Peak of the hits bus over the peak of the weapons bus in the 40 ms from each hit, dB: [min, median]. */
  hitsOverWeaponsDb: [number, number];
  hitsOverEnemiesDb: [number, number];
  hitsOverUiDb: [number, number];
  /** The same ratio by hit zone: [min, median] dB. */
  byZone: Record<string, [number, number]>;
  /** Worst peak of everything at once over the whole scenario, dBFS (the limiter's ceiling is -0.01). */
  mixPeakDb: number;
}

type Bus = 'weapons' | 'hits' | 'enemies' | 'ui';

/**
 * The scenario's clock: every cue the real event wiring asks for is started at the scenario time of
 * the event that asked (`now`), on the offline context's timeline, so no suspend round trips.
 */
class ScenarioClock implements CuePlayer {
  now = 0;
  constructor(private readonly engine: AudioEngine) {}
  play(cue: CueId, opts?: PlayOptions): void {
    this.engine.play(cue, { ...opts, delayMs: this.now * 1000 + (opts?.delayMs ?? 0) });
  }
  setLoop(cue: CueId, on: boolean): void {
    if (on) this.engine.setLoop(cue, true); // the shimmer then runs for the whole scenario
  }
}

async function renderScenario(t: AudioTunables, only: Bus | 'all'): Promise<{ data: Float32Array; hitTimes: number[]; hitZones: string[] }> {
  const sc = busiestSweepMoment({ fireRateHz: 11, seconds: 2.6 });
  const ctx = offline(sc.durationSec + 0.3);
  // Everything is scheduled up front, so no voice has ended yet: lift the live voice limit.
  const engine = engineOn(ctx, { ...t, voiceLimit: 1_000_000 });
  for (const b of ['weapons', 'hits', 'enemies', 'ui'] as Bus[]) engine.setBusVolume(b, only === 'all' || only === b ? 1 : 0);
  const clock = new ScenarioClock(engine);
  const bus = new EventBus<GameEvents>();
  const world = {
    enemyVoice: (id: number, out: Vec3): boolean => {
      const p = sc.enemies[id];
      if (!p) return false;
      out.x = p.x; out.y = p.y; out.z = p.z;
      return true;
    },
    playerEye: (out: Vec3): void => { out.x = sc.eye.x; out.y = sc.eye.y; out.z = sc.eye.z; },
  };
  attachSfx(bus, clock, t);
  attachEnemySfx(bus, clock, world, t);
  const stepPos = vec3();
  for (const e of sc.events) {
    clock.now = e.t;
    if (e.type === '__enemyFootstep') {
      const p = sc.enemies[(e.payload as { id: number }).id]!;
      stepPos.x = p.x; stepPos.y = 0.05; stepPos.z = p.z;
      clock.play('enemyFootstep', { position: stepPos });
    } else {
      bus.emit(e.type as never, e.payload as never);
    }
  }
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  const data = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) data[i] = Math.max(Math.abs(l[i]!), Math.abs(r[i]!));
  return { data, hitTimes: sc.hitTimes, hitZones: sc.hitZones };
}

const peakIn = (x: Float32Array, fromSec: number, toSec: number): number => {
  let p = 0;
  for (let i = Math.round(fromSec * SR); i < Math.min(x.length, Math.round(toSec * SR)); i++) p = Math.max(p, x[i]!);
  return p;
};

/**
 * Mix check: in the busiest Sweep moment, how far above each other bus the hits bus peaks in the
 * 40 ms starting at each hit. Each bus is rendered alone (the others muted at their volume nodes;
 * the weapons duck still fires from the hits, as in the game), so the ratio is bus against bus.
 */
export async function probeMix(t: AudioTunables): Promise<MixResult> {
  const hits = await renderScenario(t, 'hits');
  const weapons = await renderScenario(t, 'weapons');
  const enemies = await renderScenario(t, 'enemies');
  const ui = await renderScenario(t, 'ui');
  const all = await renderScenario(t, 'all');
  const ratios = (other: Float32Array): [number, number] => {
    const d: number[] = [];
    for (const h of hits.hitTimes) d.push(db(peakIn(hits.data, h, h + 0.04)) - db(peakIn(other, h, h + 0.04)));
    d.sort((a, b) => a - b);
    return [d[0]!, d[Math.floor(d.length / 2)]!];
  };
  const byZone: Record<string, [number, number]> = {};
  for (const zone of ['body', 'head', 'leg']) {
    const d: number[] = [];
    hits.hitTimes.forEach((h, i) => {
      if (hits.hitZones[i] === zone) d.push(db(peakIn(hits.data, h, h + 0.04)) - db(peakIn(weapons.data, h, h + 0.04)));
    });
    d.sort((a, b) => a - b);
    if (d.length) byZone[zone] = [d[0]!, d[Math.floor(d.length / 2)]!];
  }
  return {
    hits: hits.hitTimes.length,
    byZone,
    hitsOverWeaponsDb: ratios(weapons.data),
    hitsOverEnemiesDb: ratios(enemies.data),
    hitsOverUiDb: ratios(ui.data),
    mixPeakDb: db(peakIn(all.data, 0, all.data.length / SR)),
  };
}

export interface SynthResult {
  renderMs: number;
  buffers: number;
  seconds: number;
}

/** Synthesis time of the whole set on a fresh engine (what the first click costs). */
export function probeSynth(t: AudioTunables): SynthResult {
  const ctx = offline(0.1);
  const e = new AudioEngine(t);
  e.build(ctx);
  return { renderMs: e.stats!.renderMs, buffers: e.stats!.buffers, seconds: e.stats!.seconds };
}

export type ProbeKind = 'spatial' | 'dip' | 'mix' | 'synth';

export async function runProbe(kind: ProbeKind, t: AudioTunables): Promise<unknown> {
  switch (kind) {
    case 'spatial': return probeSpatial(t);
    case 'dip': return probeDamageDip(t);
    case 'mix': return probeMix(t);
    case 'synth': return probeSynth(t);
  }
}
