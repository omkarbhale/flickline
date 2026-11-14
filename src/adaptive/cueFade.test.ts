import { describe, expect, it } from 'vitest';
import { CUE_PHASES, type CuePhase } from '../config/cues';
import { tunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { axes, tellCueAt } from './dial';
import { cuePhase } from './cueFade';
import { SkillState } from './skillModel';

const cfg = tunables.cues;
const order = (p: CuePhase): number => CUE_PHASES.indexOf(p);

describe('cuePhase: fades with the posterior (design §7.4)', () => {
  it('a new, uncertain or weak player gets every cue', () => {
    expect(cuePhase(40, 25)).toBe('every'); // the prior: mean 40, s.d. 25
    expect(cuePhase(10, 3)).toBe('every'); // sure, but low
    expect(cuePhase(80, 20)).toBe('every'); // high, but the band is wide: maybe lucky
  });

  it('needs both a rating above the dial threshold and a narrow band', () => {
    const b = cfg.phases.bandwidth;
    const s = cfg.phases.summary;
    expect(cuePhase(b.minRating, b.maxSd)).toBe('bandwidth');
    expect(cuePhase(b.minRating - 0.1, b.maxSd)).toBe('every');
    expect(cuePhase(b.minRating, b.maxSd + 0.1)).toBe('every');
    expect(cuePhase(s.minRating, s.maxSd)).toBe('summary');
    expect(cuePhase(s.minRating, s.maxSd + 0.1)).toBe('bandwidth'); // high rating, band not narrow enough yet
    expect(cuePhase(s.minRating - 0.1, s.maxSd)).toBe('bandwidth');
  });

  it('never gives more cues to a better rating or a narrower band', () => {
    for (let sd = 1; sd <= 30; sd += 1) {
      let last = 0;
      for (let r = 0; r <= 100; r += 1) {
        const p = order(cuePhase(r, sd));
        expect(p, `rating ${r} sd ${sd}`).toBeGreaterThanOrEqual(last);
        last = p;
      }
    }
    for (let r = 0; r <= 100; r += 5) {
      let last = 2;
      for (let sd = 1; sd <= 30; sd += 1) {
        const p = order(cuePhase(r, sd));
        expect(p, `rating ${r} sd ${sd}`).toBeLessThanOrEqual(last);
        last = p;
      }
    }
  });

  it('hysteresis: a player on a border does not flip between runs, but a real decline brings the cues back', () => {
    const b = cfg.phases.bandwidth;
    const h = cfg.phases.hysteresis;
    expect(cuePhase(b.minRating - 1, 4, 'every')).toBe('every');
    expect(cuePhase(b.minRating - 1, 4, 'bandwidth')).toBe('bandwidth'); // stays inside the margin
    expect(cuePhase(b.minRating - h.rating - 0.1, 4, 'bandwidth')).toBe('every');
    expect(cuePhase(b.minRating + 5, b.maxSd + 1, 'bandwidth')).toBe('bandwidth');
    expect(cuePhase(b.minRating + 5, b.maxSd + h.sd + 0.1, 'bandwidth')).toBe('every');
    // summary falls back one step, not two
    const s = cfg.phases.summary;
    expect(cuePhase(s.minRating - h.rating - 0.1, 2.5, 'summary')).toBe('bandwidth');
  });

  it('non-finite input is treated as unknown: every cue', () => {
    expect(cuePhase(Number.NaN, 5, 'summary')).toBe('every');
    expect(cuePhase(60, Number.NaN, 'summary')).toBe('every');
  });

  it('follows a simulated player: every cue at first, faded only once the band has narrowed', () => {
    // A skilled player (θ = 70) who is rated by the real model, trial by trial at a matched dial.
    const rng = new Rng(11);
    const state = new SkillState('skip');
    const phases: CuePhase[] = [];
    let prev: CuePhase = 'every';
    for (let t = 0; t < 400; t++) {
      const d = state.targetDial('precision', 0.7);
      const p = 1 / (1 + Math.exp(-(70 - d) / 9));
      state.observe('precision', { itemDifficulty: d, success: rng.next() < p });
      prev = cuePhase(state.rating('precision'), state.confidence('precision'), prev);
      phases.push(prev);
    }
    expect(phases[0]).toBe('every');
    expect(phases[phases.length - 1]).not.toBe('every'); // it does fade
    const first = phases.findIndex((p) => p !== 'every');
    expect(first, 'not on a lucky first minute').toBeGreaterThan(10);
    // Hysteresis keeps it from chattering once it has faded: very few changes after the first.
    let changes = 0;
    for (let i = first + 1; i < phases.length; i++) if (phases[i] !== phases[i - 1]) changes++;
    expect(changes).toBeLessThanOrEqual(4);
  });

  it('a weak player simulated at θ = 15 keeps every cue however long they play', () => {
    const rng = new Rng(5);
    const state = new SkillState('skip');
    let prev: CuePhase = 'every';
    for (let t = 0; t < 400; t++) {
      const d = state.targetDial('precision', 0.7);
      state.observe('precision', { itemDifficulty: d, success: rng.next() < 1 / (1 + Math.exp(-(15 - d) / 9)) });
      prev = cuePhase(state.rating('precision'), state.confidence('precision'), prev);
    }
    expect(prev).toBe('every');
  });
});

describe('the tell-cue axis (design §5.3, §9.4)', () => {
  const t = tunables.dial.tellCue;

  it('is full below the threshold, gone above it, a straight ramp between', () => {
    expect(tellCueAt(0)).toBe(1);
    expect(tellCueAt(t.fullBelow)).toBe(1);
    expect(tellCueAt((t.fullBelow + t.goneAbove) / 2)).toBeCloseTo(0.5, 9);
    expect(tellCueAt(t.goneAbove)).toBe(0);
    expect(tellCueAt(100)).toBe(0);
    expect(tellCueAt(-40)).toBe(1);
    expect(tellCueAt(400)).toBe(0);
  });

  it('never rises with the dial', () => {
    let last = 1;
    for (let d = 0; d <= 100; d += 0.5) {
      const v = tellCueAt(d);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });

  it('is one of the dial axes, and fading it leaves the tell duration and its floor alone', () => {
    for (const d of [0, 40, 100]) expect(axes(d).tellCue).toBe(tellCueAt(d));
    expect(axes(100).tellSec).toBeGreaterThanOrEqual(tunables.dial.floors.tellSec);
    expect(axes(100).tellCue).toBe(0);
    expect(axes(100).tellSec).toBeCloseTo(tunables.dial.axes.tellSec.at100, 9);
  });
});
