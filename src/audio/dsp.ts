import type { Layer, NoiseLayer, ToneLayer } from '../config/audio';

/**
 * Sample-domain synthesis. Pure TypeScript, no Web Audio, so the exact buffers the game plays are
 * rendered (and measured) in unit tests. Rendering is synchronous and allocation-light: one
 * Float32Array per cue. Not used per frame; it runs once at load.
 */

/** xorshift32 noise source, deterministic per seed. Returns a float in [-1, 1). */
class NoiseGen {
  private s: number;
  constructor(seed: number) {
    this.s = (seed | 0) || 0x9e3779b9;
  }
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x;
    return (x >>> 0) / 2147483648 - 1;
  }
}

/** RBJ biquad, coefficients recomputed every `UPDATE` samples so a filter can sweep. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;

  constructor(
    private readonly type: NoiseLayer['filter'],
    private readonly q: number,
    private readonly sampleRate: number,
  ) {}

  setFrequency(hz: number): void {
    const f = Math.min(Math.max(hz, 20), this.sampleRate * 0.45);
    const w0 = (2 * Math.PI * f) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * this.q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lowpass') {
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    } else if (this.type === 'highpass') {
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    } else {
      b0 = alpha; b1 = 0; b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const FILTER_UPDATE = 16;

/** Linear attack ramp factor at sample i (1 once past the attack). */
function attackGain(i: number, attackN: number): number {
  return attackN > 0 && i < attackN ? i / attackN : 1;
}

function addTone(out: Float32Array, sr: number, l: ToneLayer, k: number): void {
  const start = Math.round((l.startMs / 1000) * sr);
  const n = Math.round((l.durMs / 1000) * sr);
  const attackN = Math.round((l.attackMs / 1000) * sr);
  const decay = Math.exp(-k / n); // per-sample multiplier: the envelope falls `decayDb` over the layer
  let env = 1;
  const last = Math.min(n, out.length - start);

  if (l.wave === 'sine' && l.endHz === undefined) {
    // Constant sine: two-term recurrence s[n+1] = 2cos(w) s[n] - s[n-1] (no trig per sample).
    const w = (2 * Math.PI * l.hz) / sr;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s0 = -Math.sin(w);
    for (let i = 0; i < last; i++) {
      const s = c * s1 - s0;
      s0 = s1;
      s1 = s;
      out[start + i] += l.gain * attackGain(i, attackN) * env * s;
      env *= decay;
    }
    return;
  }

  // Exponential sweep as a per-sample multiplier (no pow per sample).
  const step = l.endHz === undefined ? 1 : Math.pow(l.endHz / l.hz, 1 / n);
  let hz = l.hz;
  let phase = 0;
  for (let i = 0; i < last; i++) {
    hz *= step;
    phase += hz / sr;
    phase -= Math.floor(phase);
    const w = l.wave === 'sine'
      ? Math.sin(2 * Math.PI * phase)
      : 4 * Math.abs(phase - 0.5) - 1; // triangle
    out[start + i] += l.gain * attackGain(i, attackN) * env * w;
    env *= decay;
  }
}

function addNoise(out: Float32Array, sr: number, l: NoiseLayer, k: number, seed: number): void {
  const start = Math.round((l.startMs / 1000) * sr);
  const n = Math.round((l.durMs / 1000) * sr);
  const attackN = Math.round((l.attackMs / 1000) * sr);
  const gen = new NoiseGen(seed);
  const filt = new Biquad(l.filter, l.q, sr);
  const end = l.endHz ?? l.hz;
  const ratio = end / l.hz;
  filt.setFrequency(l.hz);
  const decay = Math.exp(-k / n);
  let env = 1;
  for (let i = 0; i < n; i++) {
    const idx = start + i;
    if (idx >= out.length) break;
    if (i % FILTER_UPDATE === 0 && l.endHz !== undefined) filt.setFrequency(l.hz * Math.pow(ratio, i / n));
    out[idx] += l.gain * attackGain(i, attackN) * env * filt.process(gen.next());
    env *= decay;
  }
}

/** Total length in ms of a layer list (latest layer end). */
export function layersDurationMs(layers: readonly Layer[]): number {
  let end = 0;
  for (const l of layers) end = Math.max(end, l.startMs + l.durMs);
  return end;
}

/** Peak absolute sample value. */
export function peakOf(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Render a layer stack to one mono buffer, normalised so its peak equals `peakGain` (linear).
 * `decayDb` is the level the envelope reaches at the end of each layer (e.g. -50).
 */
export function renderLayers(
  layers: readonly Layer[], decayDb: number, peakGain: number, sampleRate: number, seed: number,
): Float32Array<ArrayBuffer> {
  const samples = Math.ceil((layersDurationMs(layers) / 1000) * sampleRate) + 1;
  const out = new Float32Array(samples);
  const k = (-decayDb / 20) * Math.LN10; // envelope = exp(-k * t/dur) -> decayDb at the end
  for (let li = 0; li < layers.length; li++) {
    const l = layers[li]!;
    if (l.kind === 'tone') addTone(out, sampleRate, l, k);
    else addNoise(out, sampleRate, l, k, seed + li * 7919);
  }
  const p = peakOf(out);
  if (p > 0) {
    const g = peakGain / p;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * g;
  }
  return out;
}
