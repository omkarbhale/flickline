import { gainToDb } from './mixer';
import { peakOf } from './dsp';

/** Offline analysis of rendered cues (used by unit tests and the docs snapshot). Pure, node-safe. */

export function peakDb(buf: Float32Array): number {
  return gainToDb(peakOf(buf));
}

/** In-place radix-2 FFT (re/im arrays of equal power-of-two length). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!;
        const ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Spectrum {
  /** Power per bin (0..N/2). */
  power: Float64Array;
  binHz: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Power spectrum of a whole buffer (Hann window, zero-padded to a power of two, min 4096). */
export function powerSpectrum(buf: Float32Array, sampleRate: number): Spectrum {
  const n = Math.max(4096, nextPow2(buf.length));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < buf.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, buf.length - 1));
    re[i] = buf[i]! * w;
  }
  fft(re, im);
  const power = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) power[i] = re[i]! * re[i]! + im[i]! * im[i]!;
  return { power, binHz: sampleRate / n };
}

/** Fraction of total spectral energy at or above `hz`. */
export function energyAbove(buf: Float32Array, sampleRate: number, hz: number): number {
  const { power, binHz } = powerSpectrum(buf, sampleRate);
  let total = 0;
  let above = 0;
  for (let i = 1; i < power.length; i++) {
    total += power[i]!;
    if (i * binHz >= hz) above += power[i]!;
  }
  return total > 0 ? above / total : 0;
}

/** Spectral centroid in Hz. */
export function spectralCentroid(buf: Float32Array, sampleRate: number): number {
  const { power, binHz } = powerSpectrum(buf, sampleRate);
  let num = 0;
  let den = 0;
  for (let i = 1; i < power.length; i++) {
    num += i * binHz * power[i]!;
    den += power[i]!;
  }
  return den > 0 ? num / den : 0;
}

/** Frequency of the strongest bin in Hz. */
export function dominantHz(buf: Float32Array, sampleRate: number): number {
  const { power, binHz } = powerSpectrum(buf, sampleRate);
  let best = 1;
  for (let i = 1; i < power.length; i++) if (power[i]! > power[best]!) best = i;
  return best * binHz;
}

/**
 * Magnitude spectrogram in dB (frames x bins) for docs/inspection. `bins` bins cover 0..maxHz.
 * Hann-windowed frames of `frame` samples, hop `hop`.
 */
export function spectrogram(
  buf: Float32Array, sampleRate: number, frame: number, hop: number, bins: number, maxHz: number,
): Float32Array[] {
  const rows: Float32Array[] = [];
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  const binHz = sampleRate / frame;
  const maxBin = Math.min(frame / 2, Math.floor(maxHz / binHz));
  for (let start = 0; start + frame <= Math.max(buf.length, frame); start += hop) {
    for (let i = 0; i < frame; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1));
      re[i] = (buf[start + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    const row = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      const src = Math.min(maxBin, Math.floor((b / bins) * maxBin));
      row[b] = 10 * Math.log10(re[src]! * re[src]! + im[src]! * im[src]! + 1e-12);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Peak level (dBFS) of the part of `buf` between `loHz` and `hiHz`: an ideal band-pass by FFT
 * (zero the other bins, inverse transform). Used to check that a short click carries its band.
 */
export function bandPeakDb(buf: Float32Array, sampleRate: number, loHz: number, hiHz: number): number {
  const n = Math.max(4096, nextPow2(buf.length * 2));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < buf.length; i++) re[i] = buf[i]!;
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = (Math.min(k, n - k) * sampleRate) / n;
    if (f < loHz || f >= hiHz) {
      re[k] = 0;
      im[k] = 0;
    }
  }
  // Inverse FFT: conjugate, forward transform, conjugate, scale by 1/n (only the real part is read).
  for (let k = 0; k < n; k++) im[k] = -im[k]!;
  fft(re, im);
  let p = 0;
  for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(re[i]! / n));
  return gainToDb(p);
}
