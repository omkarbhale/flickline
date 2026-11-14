import { describe, expect, it } from 'vitest';
import type { SkillId } from '../config/dial';
import { planSession, SessionQueue, type SessionCandidate, type SessionInput } from './todaysSession';

const ALL: SessionCandidate[] = [
  { id: 'coldStart', skill: 'precision' },
  { id: 'orbit', skill: 'flick' },
  { id: 'strafeTrack', skill: 'track' },
  { id: 'stopAndPop', skill: 'footwork' },
  { id: 'sprayWall', skill: 'spray' },
];

function ratings(over: Partial<Record<SkillId, number>> = {}): Record<SkillId, number> {
  return { precision: 40, flick: 40, track: 40, footwork: 40, spray: 40, switch: 40, angles: 40, ...over };
}

function input(over: Partial<SessionInput> = {}): SessionInput {
  return { candidates: ALL, finaleId: 'sweep', ratings: ratings(), flaggedSkill: null, plays: {}, ...over };
}

const ids = (steps: { modeId: string }[]): string[] => steps.map((s) => s.modeId);

describe('planSession', () => {
  it('is three warm-ups then the finale', () => {
    const plan = planSession(input({ flaggedSkill: 'track' }));
    expect(plan.map((s) => s.role)).toEqual(['weakest', 'flagged', 'favourite', 'finale']);
    expect(plan[3]!.modeId).toBe('sweep');
  });

  it('names the second warm-up for what it is when nothing is flagged', () => {
    expect(planSession(input()).map((s) => s.role)).toEqual(['weakest', 'nextWeakest', 'favourite', 'finale']);
    // A flagged skill that is already the first pick is not flagged again.
    const plan = planSession(input({ ratings: ratings({ track: 12 }), flaggedSkill: 'track' }));
    expect(plan[1]!.role).toBe('nextWeakest');
  });

  it('opens with the lowest-rated skill', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12, spray: 30 }) }));
    expect(plan[0]!.modeId).toBe('strafeTrack');
  });

  it('breaks rating ties by menu order', () => {
    expect(planSession(input())[0]!.modeId).toBe('coldStart');
  });

  it('second run trains the flagged skill', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12 }), flaggedSkill: 'footwork' }));
    expect(ids(plan).slice(0, 2)).toEqual(['strafeTrack', 'stopAndPop']);
  });

  it('with nothing flagged, the second run is the next-weakest skill', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12, spray: 20, flick: 25 }) }));
    expect(ids(plan).slice(0, 2)).toEqual(['strafeTrack', 'sprayWall']);
  });

  it('a flagged skill that is already the weakest does not repeat the drill', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12, spray: 20 }), flaggedSkill: 'track' }));
    expect(ids(plan).slice(0, 2)).toEqual(['strafeTrack', 'sprayWall']);
  });

  it('a flagged skill with no listed drill falls back to the next-weakest', () => {
    const plan = planSession(input({ flaggedSkill: 'angles', ratings: ratings({ track: 12, spray: 20 }) }));
    expect(ids(plan).slice(0, 2)).toEqual(['strafeTrack', 'sprayWall']);
  });

  it('the favourite is the most-played drill not already in the plan', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12 }), plays: { orbit: 9, coldStart: 4, strafeTrack: 50 } }));
    expect(plan[2]!.modeId).toBe('orbit');
  });

  it('with no play history the favourite is the drill of the strongest skill', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12, spray: 20, flick: 80 }) }));
    expect(plan[2]!.modeId).toBe('orbit');
  });

  it('breaks play-count ties by rating', () => {
    const plan = planSession(input({ ratings: ratings({ track: 12, footwork: 60 }), plays: { coldStart: 3, stopAndPop: 3 } }));
    expect(plan[2]!.modeId).toBe('stopAndPop');
  });

  it('uses distinct drills when it can', () => {
    const plan = planSession(input({ plays: { coldStart: 99 } }));
    expect(new Set(ids(plan).slice(0, 3)).size).toBe(3);
  });

  it('repeats a drill rather than shorten the warm-up when there are too few modes', () => {
    const plan = planSession(input({ candidates: ALL.slice(0, 2), plays: { orbit: 5 } }));
    expect(plan).toHaveLength(4);
    expect(ids(plan).slice(0, 3)).toEqual(['coldStart', 'orbit', 'orbit']);
  });

  it('with a single drill, all three warm-ups are that drill', () => {
    const plan = planSession(input({ candidates: ALL.slice(0, 1) }));
    expect(ids(plan)).toEqual(['coldStart', 'coldStart', 'coldStart', 'sweep']);
  });

  it('is only the warm-ups while the finale is not registered', () => {
    const plan = planSession(input({ finaleId: null }));
    expect(plan.map((s) => s.role)).toEqual(['weakest', 'nextWeakest', 'favourite']);
  });

  it('is just the finale when no drill is registered, and empty with nothing at all', () => {
    expect(ids(planSession(input({ candidates: [] })))).toEqual(['sweep']);
    expect(planSession(input({ candidates: [], finaleId: null }))).toEqual([]);
  });

  it('is deterministic and does not touch its input', () => {
    const inp = input({ plays: { orbit: 2 }, flaggedSkill: 'flick' });
    const a = planSession(inp);
    const b = planSession(inp);
    expect(a).toEqual(b);
    expect(inp.plays).toEqual({ orbit: 2 });
  });

  it('treats a missing rating as the bottom, never NaN-poisoning the choice', () => {
    const r = ratings({ flick: NaN });
    expect(planSession(input({ ratings: r }))[0]!.modeId).toBe('orbit');
  });
});

describe('SessionQueue', () => {
  const plan = planSession(input());

  it('walks the plan in order', () => {
    const q = new SessionQueue(plan);
    expect(q.current).toBe(plan[0]);
    expect(q.advance()).toBe(plan[1]);
    expect(q.index).toBe(1);
    q.advance();
    q.advance();
    expect(q.current!.role).toBe('finale');
    expect(q.finished).toBe(false);
    expect(q.advance()).toBeNull();
    expect(q.finished).toBe(true);
  });

  it('skips at any point and counts the skips', () => {
    const q = new SessionQueue(plan);
    q.advance();
    expect(q.skip()).toBe(plan[2]);
    expect(q.skip()).toBe(plan[3]);
    expect(q.skip()).toBeNull();
    expect(q.skipped).toBe(3);
    expect(q.skip()).toBeNull();
    expect(q.skipped).toBe(3);
  });

  it('can be ended, and then stays over', () => {
    const q = new SessionQueue(plan);
    q.end();
    expect(q.finished).toBe(true);
    expect(q.current).toBeNull();
    expect(q.advance()).toBeNull();
  });

  it('an empty plan is already over', () => {
    expect(new SessionQueue([]).finished).toBe(true);
  });
});
