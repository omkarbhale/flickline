import { describe, expect, it } from 'vitest';
import { audio, CUE_IDS, type CueId } from '../config/audio';
import { bandPeakDb, dominantHz, energyAbove, peakDb, spectralCentroid } from './analysis';
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

  it('headshot and body hit are told apart by spectrum (tink at 3 kHz, thock energy below 1.5 kHz)', () => {
    const thock = energyAbove(one('hitBody'), SR, 1500);
    const tink = energyAbove(one('hitHead'), SR, 1500);
    expect(thock).toBeLessThan(0.03);
    expect(tink).toBeGreaterThan(0.2);
    expect(spectralCentroid(one('hitHead'), SR)).toBeGreaterThan(2 * spectralCentroid(one('hitBody'), SR));
    expect(dominantHz(one('hitHead'), SR)).toBeGreaterThan(2500); // R4: the tink at 3.0 kHz
    expect(dominantHz(one('hitBody'), SR)).toBeLessThan(400);
  });

  it('body thock carries its pitch above the small-speaker roll-off (#52 R2)', () => {
    // 260 -> 150 Hz with the second harmonic: a fifth of the energy sits above 250 Hz (it was ~0 at 220 -> 110 Hz).
    expect(energyAbove(one('hitBody'), SR, 250)).toBeGreaterThan(0.15);
    expect(dominantHz(one('hitBody'), SR)).toBeGreaterThan(150);
  });

  it('the body click carries the hit above the weapon in the 2.5-4 kHz band (#52 R3)', () => {
    const click = bandPeakDb(one('hitBody'), SR, 2500, 4000);
    expect(click).toBeGreaterThan(-23);
    expect(click).toBeLessThan(-17); // about -20 dBFS, some 8 dB under the thock
    // In the mix a hit ducks the weapons bus (`audio.duck.db`, -3 dB) on the same tick as the shot.
    for (const shot of ['shotPace', 'shotKestrel'] as const) {
      expect(click - (bandPeakDb(one(shot), SR, 2500, 4000) + audio.duck.db), shot).toBeGreaterThanOrEqual(10);
    }
  });

  it('leg is weaker than body in pitch, level, length and attack (#52 R1)', () => {
    const ratio = dominantHz(one('hitBody'), SR) / dominantHz(one('hitLeg'), SR);
    expect(ratio).toBeGreaterThan(1.12); // 3 semitones = 1.19
    expect(ratio).toBeLessThan(1.26);
    expect(peakDb(one('hitBody')) - peakDb(one('hitLeg'))).toBeGreaterThanOrEqual(5.5);
    expect(one('hitLeg').length).toBeLessThan(0.7 * one('hitBody').length); // 35 ms vs 60 ms
    // No click: nothing in the click band, where the body has it.
    expect(bandPeakDb(one('hitLeg'), SR, 2500, 4000)).toBeLessThan(bandPeakDb(one('hitBody'), SR, 2500, 4000) - 20);
  });

  it('keeps the three cue families in separate bands, at least 3 ERB apart (#52 R4)', () => {
    const erb = (hz: number): number => 21.4 * Math.log10((4.37 * hz) / 1000 + 1);
    const thock = dominantHz(one('hitBody'), SR);
    const ladderLo = dominantHz(set.kill.variants[0]!, SR);
    const ladderHi = dominantHz(set.kill.variants[set.kill.variants.length - 1]!, SR);
    const tink = dominantHz(one('hitHead'), SR);
    expect(ladderLo).toBeGreaterThan(430);
    expect(ladderHi).toBeLessThan(1120);
    expect(erb(ladderLo) - erb(thock)).toBeGreaterThanOrEqual(3);
    expect(erb(tink) - erb(ladderHi)).toBeGreaterThanOrEqual(3);
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
