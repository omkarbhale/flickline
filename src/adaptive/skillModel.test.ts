import { describe, expect, it } from 'vitest';
import { SKILL_IDS } from '../config/dial';
import { cloneTunables, tunables } from '../config/tunables';
import { MatchedDifficulty } from './difficulty';
import { SkillState, waveOffset } from './skillModel';
import { Staircase } from './staircase';

const cfg = tunables.dial;

describe('SkillState posterior (design §9.1–9.2)', () => {
  it('starts from the self-report prior', () => {
    expect(new SkillState('competitive').rating('flick')).toBeCloseTo(75, 0);
    expect(new SkillState('new').rating('spray')).toBeCloseTo(15, 2); // mean kept despite the cut at 0
    const s = new SkillState({ mean: 50, sd: 10 });
    expect(s.rating('track')).toBeCloseTo(50, 6);
    expect(s.confidence('track')).toBeCloseTo(10, 1);
    expect(new SkillState().rating('angles')).toBeCloseTo(40, 2);
  });

  it('moves up on success and down on failure, and sharpens', () => {
    const s = new SkillState({ mean: 50, sd: 25 });
    const sd0 = s.confidence('flick');
    s.observe('flick', { itemDifficulty: 50, success: true });
    const up = s.rating('flick');
    expect(up).toBeGreaterThan(50);
    s.observe('flick', { itemDifficulty: 50, success: false });
    expect(s.rating('flick')).toBeLessThan(up);
    expect(s.confidence('flick')).toBeLessThan(sd0);
    expect(s.trialCount('flick')).toBe(2);
  });

  it('climbs faster than it falls (asymmetric scale, §9.3.3)', () => {
    const a = new SkillState({ mean: 50, sd: 8 });
    const b = new SkillState({ mean: 50, sd: 8 });
    a.observe('flick', { itemDifficulty: 50, success: true });
    b.observe('flick', { itemDifficulty: 50, success: false });
    expect(a.rating('flick') - 50).toBeGreaterThan(50 - b.rating('flick'));
  });

  it('moves unplayed skills 40 % of the way, and leaves played ones alone', () => {
    const s = new SkillState({ mean: 40, sd: 25 });
    for (let i = 0; i < 200; i++) s.observe('flick', { itemDifficulty: 75, success: i % 4 !== 0 });
    const flick = s.rating('flick');
    expect(flick).toBeGreaterThan(75);
    for (const k of SKILL_IDS) {
      if (k === 'flick') continue;
      expect(s.rating(k)).toBeCloseTo(40 + 0.4 * (flick - 40), 0);
      expect(s.confidence(k)).toBeGreaterThan(20); // sharpens only when played
    }
    s.observe('precision', { itemDifficulty: 20, success: false });
    const precision = s.rating('precision');
    s.observe('flick', { itemDifficulty: 75, success: true });
    expect(s.rating('precision')).toBe(precision);
  });

  it('ignores unknown skills and non-finite difficulties', () => {
    const s = new SkillState();
    expect(s.observeTrial({ skill: 'juggling', itemDifficulty: 50, success: true })).toBe(false);
    s.observe('flick', { itemDifficulty: Number.NaN, success: true });
    expect(s.trialCount('flick')).toBe(0);
    expect(s.observeTrial({ skill: 'spray', itemDifficulty: 50, success: true })).toBe(true);
    expect(s.trialCount('spray')).toBe(1);
  });

  it('reports the Line Rating as the mean of the seven', () => {
    const s = new SkillState({ mean: 30, sd: 25 });
    s.observe('flick', { itemDifficulty: 60, success: true });
    let sum = 0;
    for (const k of SKILL_IDS) sum += s.rating(k);
    expect(s.rating('line')).toBeCloseTo(sum / 7, 9);
  });
});

describe('beat scheduling (design §9.3.2)', () => {
  it('aims beat 0 at the target success rate plus the warm-up offset', () => {
    const s = new SkillState({ mean: 60, sd: 5 });
    const target = s.rating('flick') - 9 * Math.log(0.7 / 0.3);
    expect(s.dialFor('orbit', 0, [0])).toBeCloseTo(target, 9);
    const s2 = new SkillState({ mean: 60, sd: 5 });
    expect(s2.dialFor('orbit', 0, cfg.waves.drill)).toBeCloseTo(target - 8, 9);
    // Cold Start aims at 55 %
    const s3 = new SkillState({ mean: 60, sd: 5 });
    expect(s3.dialFor('coldStart', 0, [0])).toBeCloseTo(s3.rating('precision') - 9 * Math.log(0.55 / 0.45), 9);
  });

  it('moves the matched dial at most 3 per beat and only at beat boundaries', () => {
    const s = new SkillState({ mean: 30, sd: 25 });
    const start = s.dialFor('orbit', 0, [0]);
    // a long streak of hits on hard items: the estimate jumps far above the dial
    for (let i = 0; i < 40; i++) s.observe('flick', { itemDifficulty: 80, success: true });
    expect(s.rating('flick')).toBeGreaterThan(60);
    expect(s.dialFor('orbit', 1, [0])).toBeCloseTo(start + 3, 9);
    expect(s.dialFor('orbit', 1, [0])).toBeCloseTo(start + 3, 9); // same beat: unchanged
    expect(s.dialFor('orbit', 2, [0])).toBeCloseTo(start + 6, 9);
    expect(s.dialFor('orbit', 4, [0])).toBeCloseTo(start + 12, 9); // two beats skipped: 2 x 3
    // a new run (beat 0) starts at the target
    expect(s.dialFor('orbit', 0, [0])).toBeCloseTo(s.targetDial('flick', 0.7), 9);
  });

  it('applies the wave curve: warm-up once, then build, peak and breather repeat', () => {
    const w = [-8, -3, 0, 3, 6, -6];
    expect([0, 1, 5, 6, 7, 10].map((i) => waveOffset(w, i))).toEqual([-8, -3, -6, -3, 0, -6]);
    expect(waveOffset([], 3)).toBe(0);
    expect(waveOffset([2], 9)).toBe(2);
  });

  it('rejects unknown modes', () => {
    expect(() => new SkillState().dialFor('nope', 0)).toThrow(/unknown mode/);
  });

  it('follows the Line Rating in Sweep', () => {
    const s = new SkillState({ mean: 50, sd: 10 });
    expect(s.dialFor('sweep', 0, [0])).toBeCloseTo(s.targetDial('line', 0.7), 9);
  });
});

describe('MatchedDifficulty (DifficultyModel seam)', () => {
  it('exposes the dial as level and axes, and records trials at the dial', () => {
    const s = new SkillState({ mean: 50, sd: 10 });
    const m = new MatchedDifficulty(s, 'orbit', [0]);
    const d = m.beat(0);
    expect(m.level).toBeCloseTo(d / 100, 9);
    expect(m.axes.flickMinDeg).toBeCloseTo(20 + 0.4 * d, 9);
    m.recordOutcome(true);
    expect(s.trialCount('flick')).toBe(1);
    const sweep = new MatchedDifficulty(s, 'sweep');
    sweep.beat(0);
    sweep.recordOutcome(true); // Sweep reports per-skill trials itself
    expect(s.trialCount('flick')).toBe(1);
    expect(() => new MatchedDifficulty(s, 'nope')).toThrow();
  });
});

describe('placement sanity bound', () => {
  it('pulls a posterior that disagrees with the staircase back to the bound', () => {
    const s = new SkillState({ mean: 90, sd: 3 });
    const sc = new Staircase(40);
    for (let i = 0; i < 8; i++) {
      sc.record(true);
      sc.record(true);
      sc.record(false);
    }
    const est = sc.abilityEstimate();
    expect(s.finishPlacement('flick', sc)).toBeCloseTo(est + cfg.staircase.sanityBound, 0);
    const near = new SkillState({ mean: est, sd: 3 });
    expect(near.finishPlacement('flick', sc)).toBeCloseTo(est, 6);
  });
});

describe('serialisation (design §14.5)', () => {
  function played(): SkillState {
    const s = new SkillState('experienced');
    let d = 20;
    for (const k of SKILL_IDS) {
      for (let i = 0; i < 25; i++) s.observe(k, { itemDifficulty: d, success: i % 3 !== 0 });
      d += 9;
    }
    return s;
  }

  it('is under 4 kB with every skill played', () => {
    const json = JSON.stringify(played().serialize());
    expect(json.length).toBeLessThan(4096);
  });

  it('round-trips ratings, confidence and trial counts', () => {
    const s = played();
    const back = SkillState.deserialize(JSON.parse(JSON.stringify(s.serialize())));
    expect(back).not.toBeNull();
    for (const k of SKILL_IDS) {
      expect(back!.rating(k)).toBeCloseTo(s.rating(k), 1);
      expect(back!.confidence(k)).toBeCloseTo(s.confidence(k), 1);
      expect(back!.trialCount(k)).toBe(s.trialCount(k));
    }
    // stable under repeated round trips
    expect(JSON.stringify(back!.serialize())).toBe(JSON.stringify(s.serialize()));
  });

  it('keeps unplayed skills tied to the prior and the played ones', () => {
    const s = new SkillState('some');
    for (let i = 0; i < 30; i++) s.observe('flick', { itemDifficulty: 60, success: i % 3 !== 0 });
    const snap = s.serialize();
    expect(Object.keys(snap.skills)).toEqual(['flick']);
    const back = SkillState.deserialize(snap)!;
    expect(back.rating('spray')).toBeCloseTo(s.rating('spray'), 1);
    expect(back.confidence('spray')).toBeCloseTo(s.confidence('spray'), 2);
  });

  it('rejects malformed snapshots', () => {
    const good = played().serialize();
    const bad: unknown[] = [
      null,
      42,
      { ...good, v: 2 },
      { ...good, grid: 101 },
      { ...good, prior: [40] },
      { ...good, skills: { flick: { n: 3, p: 'AAAA' } } },
      { ...good, skills: { flick: { n: -1, p: good.skills.flick!.p } } },
      { ...good, skills: { flick: { n: 3, p: '!!not base64!!' } } },
    ];
    for (const b of bad) expect(SkillState.deserialize(b)).toBeNull();
  });

  it('honours an injected grid size', () => {
    const c = cloneTunables().dial;
    c.gridPoints = 101;
    const s = new SkillState('skip', c);
    s.observe('flick', { itemDifficulty: 40, success: true });
    expect(SkillState.deserialize(s.serialize())).toBeNull(); // default config: 201 points
    expect(SkillState.deserialize(s.serialize(), c)!.rating('flick')).toBeCloseTo(s.rating('flick'), 1);
  });
});
