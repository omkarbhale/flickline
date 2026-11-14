import { describe, expect, it } from 'vitest';
import { audio, CUE_IDS, type CueId } from '../config/audio';
import { dominantHz, energyAbove, peakDb, spectralCentroid } from './analysis';
import { renderSoundSet } from './cues';
import { dbToGain, ladderStep, softLimiterCurve } from './mixer';

const SR = 48000;
const set = renderSoundSet(audio, SR);
const one = (id: CueId): Float32Array => set[id].variants[0]!;

describe('sound set', () => {
  it('renders every cue, with 8 ladder variants for the kill chime', () => {
    for (const id of CUE_IDS) expect(set[id].variants.length).toBeGreaterThan(0);
    expect(set.kill.variants.length).toBe(8);
    expect(set.killSparkle.variants.length).toBe(8);
  });

  it('renders the whole set in under 150 ms', () => {
    renderSoundSet(audio, SR); // warm up the JIT like a second page load would not; measure the cold-ish second run too
    const t0 = performance.now();
    renderSoundSet(audio, SR);
    expect(performance.now() - t0).toBeLessThan(150);
  });

  it('peak levels are within 1 dB of the design targets', () => {
    for (const id of CUE_IDS) {
      for (const v of set[id].variants) expect(Math.abs(peakDb(v) - set[id].peakDb), id).toBeLessThan(1);
    }
  });

  it('matches the design section 12 mix: hits about -12 dBFS, weapons about -15 dBFS, leg 6 dB under body', () => {
    expect(peakDb(one('hitBody'))).toBeCloseTo(-12, 0);
    expect(peakDb(one('hitHead'))).toBeCloseTo(-12, 0);
    expect(peakDb(set.kill.variants[0]!)).toBeCloseTo(-12, 0);
    expect(peakDb(one('shotPace'))).toBeCloseTo(-15, 0);
    expect(peakDb(one('shotKestrel'))).toBeCloseTo(-15, 0);
    expect(peakDb(one('hitBody')) - peakDb(one('hitLeg'))).toBeCloseTo(6, 0);
  });

  it('headshot and body hit are told apart by spectrum (tink above 1.5 kHz, thock not)', () => {
    const thock = energyAbove(one('hitBody'), SR, 1500);
    const tink = energyAbove(one('hitHead'), SR, 1500);
    expect(thock).toBeLessThan(0.03);
    expect(tink).toBeGreaterThan(0.2);
    expect(spectralCentroid(one('hitHead'), SR)).toBeGreaterThan(2 * spectralCentroid(one('hitBody'), SR));
    expect(dominantHz(one('hitHead'), SR)).toBeGreaterThan(1500);
    expect(dominantHz(one('hitBody'), SR)).toBeLessThan(400);
  });

  it('leg thock is a semitone lower than the body thock', () => {
    const ratio = dominantHz(one('hitBody'), SR) / dominantHz(one('hitLeg'), SR);
    expect(ratio).toBeGreaterThan(1.03);
    expect(ratio).toBeLessThan(1.09);
  });

  it('the kill ladder rises monotonically across its 8 pentatonic steps', () => {
    let prev = 0;
    for (const v of set.kill.variants) {
      const hz = dominantHz(v, SR);
      expect(hz).toBeGreaterThan(prev);
      prev = hz;
    }
  });

  it('keeps every kill chime below the headshot tink band so a high kill never sounds like a headshot', () => {
    for (const v of set.kill.variants) {
      expect(dominantHz(v, SR)).toBeLessThan(1500);
      expect(energyAbove(v, SR, 1500)).toBeLessThan(0.03);
    }
    expect(dominantHz(set.kill.variants[0]!, SR)).toBeGreaterThan(400);
  });

  it('moving-shot tock is flat, low and has no energy where the headshot lives', () => {
    expect(energyAbove(one('movingShot'), SR, 1500)).toBeLessThan(0.05);
    expect(dominantHz(one('movingShot'), SR)).toBeLessThan(250);
  });

  it('is deterministic', () => {
    const again = renderSoundSet(audio, SR);
    expect(Array.from(again.shotPace.variants[0]!.slice(0, 64))).toEqual(Array.from(set.shotPace.variants[0]!.slice(0, 64)));
  });

  it('contains no NaN or clipping', () => {
    for (const id of CUE_IDS) {
      for (const v of set[id].variants) {
        let bad = 0;
        for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i]!) || Math.abs(v[i]!) > 1) bad++;
        expect(bad, id).toBe(0);
      }
    }
  });
});

describe('ladderStep', () => {
  it('maps the clean streak to steps 1..8 and caps at 8', () => {
    expect(ladderStep(0, 8)).toBe(1);
    expect(ladderStep(1, 8)).toBe(1);
    expect(ladderStep(5, 8)).toBe(5);
    expect(ladderStep(8, 8)).toBe(8);
    expect(ladderStep(30, 8)).toBe(8);
    expect(ladderStep(NaN, 8)).toBe(1);
  });
});

describe('softLimiterCurve', () => {
  const curve = softLimiterCurve(audio.limiter.thresholdDb);
  const at = (x: number): number => curve[Math.round(((x + 1) / 2) * (curve.length - 1))]!;

  it('is transparent below the threshold and symmetric', () => {
    const th = dbToGain(audio.limiter.thresholdDb);
    for (const x of [0, 0.1, 0.3, th * 0.99]) {
      expect(at(x)).toBeCloseTo(x, 2);
      expect(at(-x)).toBeCloseTo(-x, 2);
    }
  });

  it('is monotonic and never reaches full scale', () => {
    let prev = -2;
    for (const y of curve) {
      expect(y).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(y)).toBeLessThan(1);
      prev = y;
    }
  });
});
