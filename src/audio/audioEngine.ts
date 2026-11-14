import { BUS_IDS, CUE_IDS, cueRecipes, type AudioTunables, type BuiltCueId, type BusId, type CueId } from '../config/audio';
import { Rng } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import { renderSoundSet, STEPPED_CUES } from './cues';
import { dbToGain, duckDepthDb, ladderStep, softLimiterCurve } from './mixer';
import { renderTell } from './tell';

export interface PlayOptions {
  /** Kill ladder step (the clean streak); clamped to 1..8. Ignored by non-stepped cues. */
  pitchStep?: number;
  /** World position (metres). When given, the voice is spatialised with an HRTF panner. */
  position?: Readonly<Vec3>;
  /** Extra linear gain on top of the cue level. */
  gain?: number;
  /** Start this many ms after now, on the audio clock (staggered layers, scripted scenarios). */
  delayMs?: number;
  /** `enemyTell` only: the tell's length. The tone is rendered to exactly this length (default: the reference length). */
  durationMs?: number;
}

/** What event subscribers depend on (and what tests fake). */
export interface CuePlayer {
  play(cue: CueId, opts?: PlayOptions): void;
  /** Start or stop a looping cue (the Surge shimmer): faded in and out, idempotent. */
  setLoop(cue: CueId, on: boolean): void;
}

/** The master low-pass dip (taking damage, design §7.1). Separate from `CuePlayer` so cue fakes stay small. */
export interface LowpassDipper {
  dipLowpass(): void;
}

/** The last low-pass dip that was scheduled (debug: what was scheduled where). */
export interface DipLogEntry {
  /** Audio-clock time the dip started (seconds). */
  at: number;
  hz: number;
  durationMs: number;
  /** How many dips so far. */
  count: number;
  /** false when the context was not running, so nothing sounded. */
  sounded: boolean;
}

export interface SoundSetStats {
  renderMs: number;
  buffers: number;
  seconds: number;
  sampleRate: number;
}

/** One entry of the debug play log (what was scheduled where). Preallocated ring, no per-play allocation. */
export interface PlayLogEntry {
  cue: CueId;
  step: number;
  bus: BusId;
  /** Audio-clock time the voice was scheduled for (seconds). */
  at: number;
  rate: number;
  gain: number;
  positional: boolean;
  x: number;
  y: number;
  z: number;
  /** false when the context was not running (before the first user gesture), so nothing sounded. */
  sounded: boolean;
}

interface Bus {
  /** User volume for the bus. */
  volume: GainNode;
  /** Tone stage after the volume (the hits bus only: the hit sound style). */
  tone?: BiquadFilterNode;
  /** Ducking stage (the hit/kill duck of the weapons bus). */
  duck: GainNode;
}

const LOG_SIZE = 64;
/** Never dropped at the voice limit: the built cues, plus every recipe flagged `priority`. */
const HIGH_PRIORITY: ReadonlySet<CueId> = new Set<CueId>([
  'hitHead', 'kill', 'killSparkle', 'chain', 'enemyTell',
  ...(Object.keys(cueRecipes) as Exclude<CueId, BuiltCueId>[]).filter((id) => cueRecipes[id].priority),
]);
/** Cues with random pitch and gain variation per play. */
const JITTERED: ReadonlySet<CueId> = new Set<CueId>(
  (Object.keys(cueRecipes) as Exclude<CueId, BuiltCueId>[]).filter((id) => cueRecipes[id].jitter),
);
/** Maximum distinct tell lengths kept rendered (dial steps are few; this is a safety cap). */
const TELL_CACHE_MAX = 64;
/** The cues that duck the weapons bus. The sparkle rides on a kill, which already ducks. */
const DUCKERS: ReadonlySet<CueId> = new Set<CueId>(['hitBody', 'hitLeg', 'hitHead', 'kill']);

/**
 * Web Audio engine (design section 12). The whole sound set is synthesised once, when the context
 * is created on the first user gesture (audio/cues.ts renders Float32Arrays; no samples, no
 * network). `play()` starts a pre-rendered buffer on the audio clock: one source + one gain node
 * (+ one HRTF panner for positional voices) per call, nothing else is allocated.
 *
 * Graph:  voice -> [panner] -> bus.volume -> bus.duck -> master.volume -> low-pass (open) -> limiter -> destination
 */
export class AudioEngine implements CuePlayer, LowpassDipper {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private lowpassOpenHz = 20000;
  /** The last dip, for the debug hook. */
  readonly lastDip: DipLogEntry = { at: 0, hz: 0, durationMs: 0, count: 0, sounded: false };
  private buses: Partial<Record<BusId, Bus>> = {};
  private buffers: Partial<Record<CueId, AudioBuffer[]>> = {};
  /** Rendered enemy tells by length in whole ms (a cache: dial steps repeat). */
  private tells = new Map<number, AudioBuffer>();
  /** Running loops (the Surge shimmer): the source and its fade gain. */
  private loops: Partial<Record<CueId, { src: AudioBufferSourceNode; gain: GainNode }>> = {};
  private cueBus: Partial<Record<CueId, BusId>> = {};
  /** Peak level of each cue as rendered (dBFS), for the duck depth. */
  private cuePeakDb: Partial<Record<CueId, number>> = {};
  private duckHoldEnd = 0;
  private duckGain = 1;
  private volume = 0.7;
  private hitStyle: 'standard' | 'soft' = 'standard';
  private mono = false;
  /** Enemy tell loudness 0..1 on top of the enemies bus (settings). */
  private tellVolume = 1;
  private readonly busVolume: Record<BusId, number> = { weapons: 1, hits: 1, enemies: 1, ui: 1 };
  private readonly rng: Rng;
  private voices = 0;
  private readonly log: PlayLogEntry[] = [];
  private logHead = 0;
  private logCount = 0;
  private lx = NaN;
  private ly = NaN;
  private lz = NaN;
  private lyaw = NaN;
  private lpitch = NaN;
  /** Filled when the sound set has been rendered. */
  stats: SoundSetStats | null = null;

  constructor(private readonly t: AudioTunables) {
    this.rng = new Rng(t.jitterSeed);
    for (let i = 0; i < LOG_SIZE; i++) {
      this.log.push({ cue: 'uiTick', step: 1, bus: 'ui', at: 0, rate: 1, gain: 1, positional: false, x: 0, y: 0, z: 0, sounded: false });
    }
  }

  /**
   * The audio clock and the device latencies the browser reports (seconds; 0 where it reports none),
   * for timing probes: a cue scheduled at `currentTime` is heard about `baseLatency + outputLatency` later.
   */
  clock(): { currentTime: number; baseLatency: number; outputLatency: number; running: boolean } {
    const c = this.ctx as (BaseAudioContext & { baseLatency?: number; outputLatency?: number }) | null;
    return {
      currentTime: c?.currentTime ?? 0,
      baseLatency: c?.baseLatency ?? 0,
      outputLatency: c?.outputLatency ?? 0,
      running: this.running,
    };
  }

  /** Call from a user gesture (click to play). Safe to call repeatedly. */
  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.build(new Ctor({ latencyHint: 'interactive' }));
    }
    const c = this.ctx;
    if (c && 'resume' in c) void (c as AudioContext).resume().catch(() => undefined);
  }

  /**
   * Build the graph and render the sound set on `ctx`. Public so tooling can drive the real graph
   * on an OfflineAudioContext; the game only ever reaches it through resume().
   */
  build(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    const t = this.t;
    const limiter = ctx.createWaveShaper();
    limiter.curve = softLimiterCurve(t.limiter.thresholdDb);
    limiter.oversample = 'none';
    limiter.connect(ctx.destination);

    // The damage dip lives on the master: open (20 kHz, or just under Nyquist) it is transparent.
    this.lowpassOpenHz = Math.min(20000, ctx.sampleRate / 2 - 100);
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = this.lowpassOpenHz;
    this.lowpass.Q.value = t.damageDip.q;
    this.lowpass.connect(limiter);
    this.master = ctx.createGain();
    this.master.connect(this.lowpass);
    for (const id of BUS_IDS) {
      const volume = ctx.createGain();
      const duck = ctx.createGain();
      let tone: BiquadFilterNode | undefined;
      if (id === 'hits') {
        tone = ctx.createBiquadFilter();
        tone.type = 'lowpass';
        tone.Q.value = 0.5;
        volume.connect(tone).connect(duck);
      } else {
        volume.connect(duck);
      }
      duck.connect(this.master);
      this.buses[id] = { volume, duck, tone };
    }
    this.applyVolumes();
    this.applyMono();

    const t0 = performance.now();
    const set = renderSoundSet(t, ctx.sampleRate);
    let buffers = 0;
    let samples = 0;
    for (const id of CUE_IDS) {
      const cue = set[id];
      this.cueBus[id] = cue.bus;
      this.cuePeakDb[id] = cue.peakDb;
      const list: AudioBuffer[] = [];
      for (const v of cue.variants) {
        const b = ctx.createBuffer(1, v.length, ctx.sampleRate);
        b.copyToChannel(v, 0);
        list.push(b);
        buffers++;
        samples += v.length;
      }
      this.buffers[id] = list;
    }
    this.stats = { renderMs: performance.now() - t0, buffers, seconds: samples / ctx.sampleRate, sampleRate: ctx.sampleRate };
  }

  /**
   * Dip the master low-pass: the cutoff falls to `damageDip.hz` and comes back over
   * `damageDip.durationMs` (design §7.1, taking damage). A hit during a dip restarts it. Parameter
   * scheduling only: nothing is created per call. No-op before the first user gesture.
   */
  dipLowpass(): void {
    const c = this.ctx;
    const f = this.lowpass;
    const d = this.t.damageDip;
    const e = this.lastDip;
    e.count++;
    e.hz = d.hz;
    e.durationMs = d.durationMs;
    e.sounded = false;
    if (!c || !f) return;
    const now = c.currentTime;
    e.at = now;
    e.sounded = c.state === 'running';
    const p = f.frequency;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(d.hz, now + d.attackMs / 1000);
    p.exponentialRampToValueAtTime(this.lowpassOpenHz, now + d.durationMs / 1000);
  }

  /** Master volume 0..1 (settings). */
  setVolume(v: number): void {
    this.volume = v;
    this.applyVolumes();
  }

  /** Per-bus volume 0..1 (settings). */
  setBusVolume(bus: BusId, v: number): void {
    this.busVolume[bus] = v;
    this.applyVolumes();
  }

  /** Hit sound style (settings): `soft` low-passes and lowers the hits bus. */
  setHitStyle(style: 'standard' | 'soft'): void {
    this.hitStyle = style;
    this.applyVolumes();
  }

  /** Mix down to mono (settings): positional cues lose their direction, nothing is lost in level. */
  setMono(on: boolean): void {
    this.mono = on;
    this.applyMono();
  }

  /** Enemy tell volume 0..1 (settings), applied to each tell as it starts. */
  setTellVolume(v: number): void {
    this.tellVolume = v;
  }

  /** What the audio settings did to the graph (debug hook): null before the context exists. */
  mixState(): { hitStyle: string; hitToneHz: number; hitsBusGain: number; mono: boolean; masterChannels: number; masterGain: number } | null {
    const hits = this.buses.hits;
    if (!this.master || !hits) return null;
    return {
      hitStyle: this.hitStyle,
      hitToneHz: hits.tone?.frequency.value ?? 0,
      hitsBusGain: hits.volume.gain.value,
      mono: this.mono,
      masterChannels: this.master.channelCount,
      masterGain: this.master.gain.value,
    };
  }

  get isMono(): boolean {
    return this.mono;
  }

  get hitSoundStyle(): 'standard' | 'soft' {
    return this.hitStyle;
  }

  private applyMono(): void {
    const m = this.master;
    if (!m) return;
    // An explicit one-channel gain node downmixes everything feeding it, then the output upmixes it to both ears.
    m.channelCount = this.mono ? 1 : 2;
    m.channelCountMode = this.mono ? 'explicit' : 'max';
    m.channelInterpretation = 'speakers';
  }

  private applyVolumes(): void {
    if (this.master) this.master.gain.value = this.volume * this.t.masterGain;
    const style = this.t.hitStyles[this.hitStyle];
    for (const id of BUS_IDS) {
      const b = this.buses[id];
      if (!b) continue;
      b.volume.gain.value = id === 'hits' ? this.busVolume[id] * dbToGain(style.gainDb) : this.busVolume[id];
      if (b.tone) b.tone.frequency.value = Math.min(style.hz, this.lowpassOpenHz);
    }
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** The audio context, for tooling (debug hook, offline verification). */
  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  /** The master input node (before the low-pass and limiter), for tooling that feeds a test signal through the real graph. */
  get masterInput(): AudioNode | null {
    return this.master;
  }

  /** Voices currently sounding. */
  get activeVoices(): number {
    return this.voices;
  }

  /**
   * Place the listener (the player's head). Call once per frame; does nothing until the context
   * exists and skips the parameter writes when the pose has not changed.
   */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const c = this.ctx;
    if (!c || (x === this.lx && y === this.ly && z === this.lz && yaw === this.lyaw && pitch === this.lpitch)) return;
    this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; this.lpitch = pitch;
    const l = c.listener;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      const old = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      old.setPosition(x, y, z);
      old.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /**
   * Play a cue now. `pitchStep` selects the kill ladder step (the clean streak, capped at 8).
   * Shot cues get +/-3% random pitch and gain. No-op before the first user gesture.
   */
  play(cue: CueId, opts?: PlayOptions): void {
    const ctx = this.ctx;
    const list = this.buffers[cue];
    const busId = this.cueBus[cue];
    const bus = busId ? this.buses[busId] : undefined;
    if (!ctx || !list || !busId || !bus) return;

    const step = STEPPED_CUES.has(cue) ? ladderStep(opts?.pitchStep ?? 1, list.length) : 1;
    const buffer = cue === 'enemyTell' && opts?.durationMs !== undefined
      ? this.tellBuffer(ctx, opts.durationMs)
      : list[Math.min(step, list.length) - 1]!;
    let rate = 1;
    let gain = opts?.gain ?? 1;
    if (cue === 'enemyTell') gain *= this.tellVolume;
    if (JITTERED.has(cue)) {
      rate += (this.rng.next() * 2 - 1) * this.t.shotJitter.pitch;
      gain *= 1 + (this.rng.next() * 2 - 1) * this.t.shotJitter.gain;
    }
    const at = ctx.currentTime + (opts?.delayMs ?? 0) / 1000;
    const live = ctx.state === 'running' || 'startRendering' in ctx; // offline contexts schedule before they render
    const sounded = live && (this.voices < this.t.voiceLimit || HIGH_PRIORITY.has(cue));
    const e = this.log[this.logHead]!;
    this.logHead = (this.logHead + 1) % LOG_SIZE;
    if (this.logCount < LOG_SIZE) this.logCount++;
    const pos = opts?.position;
    e.cue = cue; e.step = step; e.bus = busId; e.at = at; e.rate = rate; e.gain = gain;
    e.positional = pos !== undefined;
    e.x = pos ? pos.x : 0; e.y = pos ? pos.y : 0; e.z = pos ? pos.z : 0;
    e.sounded = sounded;
    if (!sounded) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      const sp = this.spatialOf(cue);
      p.refDistance = sp.refDistance;
      p.maxDistance = this.t.panner.maxDistance;
      p.rolloffFactor = sp.rolloff;
      if (p.positionX) {
        p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      } else {
        (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      }
      g.connect(p).connect(bus.volume);
    } else {
      g.connect(bus.volume);
    }
    this.voices++;
    src.onended = this.onVoiceEnded;
    src.start(at);

    if (DUCKERS.has(cue)) this.duckWeapons(at, this.cuePeakDb[cue] ?? this.t.duck.weaponsPeakDb);
  }

  /** Distance model of a positional cue: its own, or the engine default. */
  private spatialOf(cue: CueId): { refDistance: number; rolloff: number } {
    if (cue === 'enemyTell') return this.t.enemyTell.spatial;
    const r = (cueRecipes as Partial<Record<CueId, { spatial?: { refDistance: number; rolloff: number } }>>)[cue];
    return r?.spatial ?? this.t.panner;
  }

  /**
   * The tell rendered to exactly `durationMs` (audio/tell.ts), cached by whole ms: the dial moves
   * the length only at beat boundaries, so a run touches a handful of distinct lengths and each
   * costs one short render and one AudioBuffer, once.
   */
  private tellBuffer(ctx: BaseAudioContext, durationMs: number): AudioBuffer {
    const ms = Math.max(1, Math.round(durationMs));
    let b = this.tells.get(ms);
    if (!b) {
      if (this.tells.size >= TELL_CACHE_MAX) this.tells.clear();
      const data = renderTell(ms, this.t.enemyTell, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.copyToChannel(data, 0);
      this.tells.set(ms, b);
    }
    return b;
  }

  /**
   * Start or stop a looping cue (the Surge shimmer). The loop fades in and out over
   * `loopFadeMs` so it never clicks, and starting a running loop or stopping a stopped one is a no-op.
   */
  setLoop(cue: CueId, on: boolean): void {
    const ctx = this.ctx;
    const list = this.buffers[cue];
    const busId = this.cueBus[cue];
    const bus = busId ? this.buses[busId] : undefined;
    if (!ctx || !list || !bus) return;
    const running = this.loops[cue];
    const fade = this.t.loopFadeMs / 1000;
    const now = ctx.currentTime;
    if (on && !running) {
      if (ctx.state !== 'running' && !('startRendering' in ctx)) return;
      const src = ctx.createBufferSource();
      src.buffer = list[0]!;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(1, now + fade);
      src.connect(gain).connect(bus.volume);
      src.start(now);
      this.loops[cue] = { src, gain };
    } else if (!on && running) {
      const g = running.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + fade);
      running.src.stop(now + fade + 0.01);
      delete this.loops[cue];
    }
  }

  /** Whether a looping cue is sounding (debug hook, tests). */
  isLooping(cue: CueId): boolean {
    return this.loops[cue] !== undefined;
  }

  private readonly onVoiceEnded = (): void => {
    if (this.voices > 0) this.voices--;
  };

  /**
   * Duck the weapons bus under a hit or kill (design 12): the depth keeps the weapons `dominanceDb`
   * under the cue (see `AudioTunables.duck`), a deeper duck still holding wins, and the bus
   * releases `holdMs + releaseMs` later. The duck starts instantly: the shot that came with the
   * hit starts on the same sample.
   */
  private duckWeapons(at: number, cuePeakDb: number): void {
    const bus = this.buses.weapons;
    if (!bus) return;
    const d = this.t.duck;
    const depthDb = duckDepthDb(cuePeakDb, d);
    let gain = dbToGain(-depthDb);
    if (at < this.duckHoldEnd) gain = Math.min(gain, this.duckGain);
    this.duckGain = gain;
    this.duckHoldEnd = at + d.holdMs / 1000;
    const g = bus.duck.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(gain, at);
    g.setValueAtTime(gain, this.duckHoldEnd);
    g.linearRampToValueAtTime(1, at + (d.holdMs + d.releaseMs) / 1000);
  }

  /** Most recent plays (oldest first), for the debug hook. Allocates; never call per frame. */
  recentPlays(count = 16): PlayLogEntry[] {
    const n = Math.min(count, this.logCount);
    const out: PlayLogEntry[] = [];
    for (let i = n; i > 0; i--) {
      const e = this.log[(this.logHead - i + LOG_SIZE) % LOG_SIZE]!;
      out.push({ ...e });
    }
    return out;
  }
}
