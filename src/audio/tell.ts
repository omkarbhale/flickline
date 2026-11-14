import type { TellTunables } from '../config/audio';
import { dbToGain } from './mixer';

/**
 * The enemy tell (design 5.3, 12): a rising sweep from `startHz` to `endHz` whose length is exactly
 * the event's `durationMs`, so the player hears how long they have. The length is set by the dial
 * (0.5 s down to 0.15 s), so it cannot be one fixed buffer: the engine renders it per length (a few
 * hundred microseconds, cached) from this pure function, which is also what the unit tests measure.
 *
 * Shape: a triangle at the swept pitch plus a quieter octave partial (a saw-like edge, brighter
 * than a plain triangle), an exponential sweep (even steps in musical pitch), a level that grows
 * from `startLevel` to 1 (urgency), and linear fades at both ends so the tone never clicks.
 * The buffer holds exactly `round(durationMs * sampleRate / 1000)` samples.
 */
export function tellSamples(durationMs: number, sampleRate: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * sampleRate));
}

const tri = (phase: number): number => 4 * Math.abs(phase - Math.floor(phase) - 0.5) - 1;

/** Render a tell into `out` (its length is the tell's length, see `tellSamples`), normalised to the tell's peak. */
export function renderTellInto(out: Float32Array, t: TellTunables, sampleRate: number): void {
  const n = out.length;
  const attackN = Math.min(Math.round((t.attackMs / 1000) * sampleRate), n >> 1);
  const releaseN = Math.min(Math.round((t.releaseMs / 1000) * sampleRate), n >> 1);
  const step = Math.pow(t.endHz / t.startHz, 1 / Math.max(1, n));
  let hz = t.startHz;
  let phase = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    hz *= step;
    phase += hz / sampleRate;
    phase -= Math.floor(phase);
    const rise = t.startLevel + (1 - t.startLevel) * (i / n);
    const fadeIn = attackN > 0 && i < attackN ? i / attackN : 1;
    const fadeOut = releaseN > 0 && i >= n - releaseN ? (n - 1 - i) / releaseN : 1;
    const v = (tri(phase) + t.octaveMix * tri(phase * 2)) * rise * fadeIn * fadeOut;
    out[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const g = dbToGain(t.peakDb) / peak;
    for (let i = 0; i < n; i++) out[i] = out[i]! * g;
  }
}

export function renderTell(durationMs: number, t: TellTunables, sampleRate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(tellSamples(durationMs, sampleRate));
  renderTellInto(out, t, sampleRate);
  return out;
}
