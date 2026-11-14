import { describe, expect, it } from 'vitest';
import { audio } from '../config/audio';
import { dominantHz, energyAbove, peakDb } from './analysis';
import { renderTell, tellSamples } from './tell';

const SR = 48000;
const T = audio.enemyTell;

/** Audible length in ms: first to last sample above 1% of the peak. */
function audibleMs(buf: Float32Array): number {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.01;
  let first = 0;
  while (first < buf.length && Math.abs(buf[first]!) < th) first++;
  let last = buf.length - 1;
  while (last > first && Math.abs(buf[last]!) < th) last--;
  return ((last - first + 1) / SR) * 1000;
}

describe('enemy tell', () => {
  // The dial runs the tell from 0.5 s down to a 0.15 s floor (design 5.3); include fractional lengths.
  const LENGTHS = [150, 151.6, 180, 233.3, 300, 412, 500];

  it('is exactly as long as enemyTell.durationMs (to the sample), audibly within 5 ms', () => {
    for (const ms of LENGTHS) {
      const buf = renderTell(ms, T, SR);
      expect(buf.length, `${ms} ms`).toBe(Math.round((ms / 1000) * SR));
      expect(Math.abs((buf.length / SR) * 1000 - ms), `${ms} ms`).toBeLessThan(0.05);
      expect(Math.abs(audibleMs(buf) - ms), `audible ${ms} ms`).toBeLessThan(5);
    }
  });

  it('works at the other common sample rate and never renders an empty buffer', () => {
    expect(renderTell(300, T, 44100).length).toBe(13230);
    expect(tellSamples(0, SR)).toBe(1);
    expect(renderTell(0.01, T, SR).length).toBe(1);
  });

  it('rises from 300 Hz to 900 Hz, evenly in pitch, over the tell length', () => {
    const ms = 500;
    const buf = renderTell(ms, T, SR);
    const seg = Math.floor(buf.length / 8);
    let prev = 0;
    for (let i = 0; i < 8; i++) {
      const hz = dominantHz(buf.subarray(i * seg, (i + 1) * seg), SR);
      const expected = T.startHz * Math.pow(T.endHz / T.startHz, (i + 0.5) / 8);
      expect(hz, `segment ${i}`).toBeGreaterThan(prev);
      expect(Math.abs(hz / expected - 1), `segment ${i}`).toBeLessThan(0.15);
      prev = hz;
    }
  });

  it('starts and ends at silence and never steps (no clicks)', () => {
    for (const ms of LENGTHS) {
      const buf = renderTell(ms, T, SR);
      const peak = Math.pow(10, T.peakDb / 20);
      expect(Math.abs(buf[0]!)).toBeLessThan(peak * 0.01);
      expect(Math.abs(buf[buf.length - 1]!)).toBeLessThan(peak * 0.01);
      let maxStep = 0;
      for (let i = 1; i < buf.length; i++) maxStep = Math.max(maxStep, Math.abs(buf[i]! - buf[i - 1]!));
      // A 1.8 kHz partial at this level moves at most ~ peak * 2*pi*1800/48000 per sample; a click would be far bigger.
      expect(maxStep, `${ms} ms`).toBeLessThan(peak * 0.5);
    }
  });

  it('gets louder as it ends and has a bright edge above the fundamental', () => {
    const buf = renderTell(400, T, SR);
    const q = Math.floor(buf.length / 4);
    const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(buf.subarray(3 * q, 4 * q - 480))).toBeGreaterThan(rms(buf.subarray(q >> 1, q)) * 1.2);
    expect(energyAbove(buf, SR, 1200)).toBeGreaterThan(0.02);
  });

  it('peaks at the tell level', () => {
    expect(peakDb(renderTell(300, T, SR))).toBeCloseTo(T.peakDb, 1);
  });
});
