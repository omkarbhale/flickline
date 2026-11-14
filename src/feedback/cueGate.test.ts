import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { damageNumbersShown, effectivePhase, ghostShown, movingCueShown, readoutShown, tellStrength } from './cueGate';
import type { FeedbackOptions } from './options';

const cfg = tunables.cues;
const dial = tunables.dial;
const opts = (o: Partial<FeedbackOptions> = {}): FeedbackOptions => ({
  coachingCues: true, missGhost: true, damageNumbers: true, reduceFlashing: false, cueFading: true, cuePhase: 'every', clean: false, surge: false, ...o,
});

describe('moving-shot cue', () => {
  it('every phase: every moving shot', () => {
    expect(movingCueShown(opts(), cfg, 1.6, false)).toBe(true);
  });

  it('bandwidth: only a shot well above the deadzone, or an airborne one', () => {
    const o = opts({ cuePhase: 'bandwidth' });
    expect(movingCueShown(o, cfg, 1.6, false)).toBe(false); // just over the 1.5 m/s deadzone
    expect(movingCueShown(o, cfg, cfg.bandwidth.movingMps, false)).toBe(true);
    expect(movingCueShown(o, cfg, 0.5, true)).toBe(true);
  });

  it('summary: never during play', () => {
    expect(movingCueShown(opts({ cuePhase: 'summary' }), cfg, 5.4, true)).toBe(false);
  });

  it('the Coaching cues master switch wins in every phase', () => {
    for (const p of ['every', 'bandwidth', 'summary'] as const) {
      expect(movingCueShown(opts({ coachingCues: false, cuePhase: p }), cfg, 5.4, true)).toBe(false);
    }
  });

  it('"fade cues" off pins the phase to every; a clean run overrides even that', () => {
    expect(movingCueShown(opts({ cuePhase: 'summary', cueFading: false }), cfg, 1.6, false)).toBe(true);
    expect(movingCueShown(opts({ cuePhase: 'every', cueFading: false, clean: true }), cfg, 5.4, true)).toBe(false);
  });
});

describe('miss ghost', () => {
  it('bandwidth: only a miss at least the threshold off the head', () => {
    const o = opts({ cuePhase: 'bandwidth' });
    expect(ghostShown(o, cfg, cfg.bandwidth.ghostDeg - 0.01)).toBe(false);
    expect(ghostShown(o, cfg, cfg.bandwidth.ghostDeg)).toBe(true);
    expect(ghostShown(opts(), cfg, 0.1)).toBe(true);
    expect(ghostShown(opts({ cuePhase: 'summary' }), cfg, 40)).toBe(false);
    expect(ghostShown(opts({ missGhost: false }), cfg, 40)).toBe(false);
  });
});

describe('damage numbers and the time-to-shot readout', () => {
  it('damage numbers are an every-trial cue: gone from bandwidth on', () => {
    expect(damageNumbersShown(opts(), cfg)).toBe(true);
    expect(damageNumbersShown(opts({ cuePhase: 'bandwidth' }), cfg)).toBe(false);
    expect(damageNumbersShown(opts({ damageNumbers: false }), cfg)).toBe(false);
  });

  it('the readout speaks on every kill, then only for slow or fast outliers, then never', () => {
    expect(readoutShown(opts(), cfg, 200, 200)).toBe(true);
    const o = opts({ cuePhase: 'bandwidth' });
    expect(readoutShown(o, cfg, 200, 200)).toBe(false); // typical
    expect(readoutShown(o, cfg, 200 * cfg.bandwidth.slowFactor, 200)).toBe(true); // slow
    expect(readoutShown(o, cfg, 200 * cfg.bandwidth.fastFactor, 200)).toBe(true); // fast
    expect(readoutShown(o, cfg, 900, Number.NaN)).toBe(false); // nothing to compare with
    expect(readoutShown(opts({ cuePhase: 'summary' }), cfg, 900, 200)).toBe(false);
  });
});

describe('effective phase', () => {
  it('reads like every cue when the planner has not run', () => {
    expect(effectivePhase({ coachingCues: true, missGhost: true, damageNumbers: true, reduceFlashing: false })).toBe('every');
  });
});

describe('tell strength', () => {
  it('fades with the dial; a clean run or the master switch off silences it', () => {
    expect(tellStrength(opts(), cfg, dial, 0)).toBe(1);
    expect(tellStrength(opts(), cfg, dial, 100)).toBe(0);
    const mid = tellStrength(opts(), cfg, dial, (dial.tellCue.fullBelow + dial.tellCue.goneAbove) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(tellStrength(opts({ clean: true }), cfg, dial, 0)).toBe(0);
    expect(tellStrength(opts({ coachingCues: false }), cfg, dial, 0)).toBe(0);
  });

  it('"fade cues" off keeps the tells at full; Surge brings them back at the floor', () => {
    expect(tellStrength(opts({ cueFading: false }), cfg, dial, 100)).toBe(1);
    expect(tellStrength(opts({ surge: true }), cfg, dial, 100)).toBe(cfg.surgeTellFloor);
    expect(tellStrength(opts({ surge: true, clean: true }), cfg, dial, 100)).toBe(0); // the clean run is clean
  });
});
