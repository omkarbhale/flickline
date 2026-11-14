import { describe, expect, it } from 'vitest';
import { tunables } from '../config/tunables';
import { CuePlanner, createCuePlan, type CuePlanInput } from './cuePlanner';

const input = (o: Partial<CuePlanInput> = {}): CuePlanInput => ({
  skill: 'precision', rating: 40, sd: 20, placement: false, fading: true, cleanRunEnabled: true, runsCompleted: 0, ...o,
});
const MIN = tunables.cues.cleanRun.minRuns;

describe('CuePlanner: phases', () => {
  it('plans the phase from the posterior and remembers it per skill for the hysteresis', () => {
    const p = new CuePlanner();
    const b = tunables.cues.phases.bandwidth;
    expect(p.plan(input({ rating: b.minRating + 2, sd: b.maxSd - 1 })).phase).toBe('bandwidth');
    expect(p.phaseOf('precision')).toBe('bandwidth');
    // just under the gate, inside the margin: stays
    expect(p.plan(input({ rating: b.minRating - 1, sd: b.maxSd - 1 })).phase).toBe('bandwidth');
    // another skill is unaffected
    expect(p.plan(input({ skill: 'flick', rating: b.minRating - 1, sd: b.maxSd - 1 })).phase).toBe('every');
  });

  it('"fade cues" off plans every cue, but still tracks the phase so turning it on resumes where it was', () => {
    const p = new CuePlanner();
    expect(p.plan(input({ rating: 60, sd: 3, fading: false })).phase).toBe('every');
    expect(p.phaseOf('precision')).toBe('summary');
  });

  it('a placing run and runs with no skill always get every cue and are never clean', () => {
    const p = new CuePlanner();
    const done = { runsCompleted: 99, rating: 80, sd: 3 };
    expect(p.plan(input({ placement: true, ...done }))).toEqual({ phase: 'every', clean: false });
    expect(p.plan(input({ skill: null, ...done }))).toEqual({ phase: 'every', clean: false });
  });
});

describe('CuePlanner: the clean run', () => {
  it('waits until the player has completed a few scored runs', () => {
    const p = new CuePlanner();
    expect(p.plan(input({ runsCompleted: MIN - 1 })).clean).toBe(false);
    expect(p.plan(input({ runsCompleted: MIN })).clean).toBe(true);
  });

  it('is one run per session: spent when it ends for real, offered again if it was abandoned', () => {
    const p = new CuePlanner();
    const plan = p.plan(input({ runsCompleted: MIN }));
    expect(plan.clean).toBe(true);
    expect(plan.phase).toBe('summary');
    // a restart of the same run is still clean (not spent yet)
    expect(p.plan(input({ runsCompleted: MIN }), createCuePlan()).clean).toBe(true);
    p.finish(plan);
    expect(p.cleanSpent).toBe(true);
    expect(p.plan(input({ runsCompleted: MIN + 1 })).clean).toBe(false);
  });

  it('finishing a run that was not clean spends nothing', () => {
    const p = new CuePlanner();
    p.finish({ phase: 'every', clean: false });
    expect(p.cleanSpent).toBe(false);
  });

  it('the setting turns it off', () => {
    const p = new CuePlanner();
    expect(p.plan(input({ runsCompleted: MIN, cleanRunEnabled: false })).clean).toBe(false);
  });

  it('does not touch the remembered phase (a clean run is not evidence about the cues)', () => {
    const p = new CuePlanner();
    p.plan(input({ runsCompleted: MIN, rating: 60, sd: 3 }));
    expect(p.phaseOf('precision')).toBe('every');
  });

  it('uses the caller-owned plan object without allocating a new one', () => {
    const p = new CuePlanner();
    const out = createCuePlan();
    expect(p.plan(input(), out)).toBe(out);
  });
});
