import { describe, expect, it } from 'vitest';
import { MIND_PARAMS } from '../../config/mind';
import { cloneTunables, tunables } from '../../config/tunables';
import { Rng } from '../../core/rng';
import { clampMindSkill, createMindProfile, interpolateAnchors, profileFor } from './profile';

const cfg = tunables;
const ANCHORS = cfg.mind.anchorSkills;

function build(m: number, seed: number, t = cfg) {
  return profileFor(m, new Rng(seed), createMindProfile(), t);
}

describe('anchor table', () => {
  it('every row has four values and is finite', () => {
    for (const k of MIND_PARAMS) {
      const row = cfg.mind.anchors[k];
      expect(row, k).toHaveLength(4);
      for (const v of row) expect(Number.isFinite(v), k).toBe(true);
    }
  });

  it('the peek mix sums to 1 at every anchor and the anchor positions ascend from 0 to 100', () => {
    for (let a = 0; a < 4; a++) {
      let sum = 0;
      for (const k of cfg.mind.groups.peekMix) sum += cfg.mind.anchors[k][a]!;
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(ANCHORS[0]).toBe(0);
    expect(ANCHORS[3]).toBe(100);
    for (let i = 1; i < 4; i++) expect(ANCHORS[i]!).toBeGreaterThan(ANCHORS[i - 1]!);
  });

  it('the research table (§5.4) is in the data: spot values at each anchor', () => {
    const r = cfg.mind.anchors;
    expect([r.reactionMuSec[0], r.reactionSigmaSec[0], r.reactionTauSec[0]]).toEqual([0.43, 0.06, 0.22]);
    expect([r.reactionMuSec[3], r.reactionSigmaSec[3], r.reactionTauSec[3]]).toEqual([0.235, 0.022, 0.055]);
    expect(r.flickThroughputBps).toEqual([3.5, 4.5, 5.6, 7.0]);
    expect(r.tradeChance).toEqual([0.25, 0.45, 0.7, 0.9]);
    expect(r.tradeSwingDelayMedianSec).toEqual([1.6, 1.2, 0.9, 0.7]);
    expect(r.calibrationHeadshotShare).toEqual([0.09, 0.15, 0.23, 0.3]);
  });
});

describe('interpolation', () => {
  it('the four anchors reproduce their table column exactly', () => {
    const out = createMindProfile();
    for (let a = 0; a < 4; a++) {
      interpolateAnchors(ANCHORS[a]!, out, cfg.mind);
      for (const k of MIND_PARAMS) expect(out[k], `${k} @ ${ANCHORS[a]}`).toBe(cfg.mind.anchors[k][a]);
    }
  });

  it('with the personality spreads at 0, profileFor at an anchor is that column exactly, floors permitting', () => {
    const t = cloneTunables();
    t.mind.spread = { reaction: 0, aimNoise: 0, aggression: 0, habit: 0 };
    for (let a = 0; a < 4; a++) {
      const p = build(ANCHORS[a]!, 5, t);
      for (const k of MIND_PARAMS) expect(p[k], `${k} @ ${ANCHORS[a]}`).toBe(t.mind.anchors[k][a]);
      expect(p.reactionFactor).toBe(1);
    }
  });

  it('is linear between anchors', () => {
    const out = createMindProfile();
    interpolateAnchors(17.5, out, cfg.mind); // half way between 0 and 35
    for (const k of MIND_PARAMS) expect(out[k], k).toBeCloseTo((cfg.mind.anchors[k][0] + cfg.mind.anchors[k][1]) / 2, 12);
    interpolateAnchors(82.5, out, cfg.mind); // half way between 65 and 100
    for (const k of MIND_PARAMS) expect(out[k], k).toBeCloseTo((cfg.mind.anchors[k][2] + cfg.mind.anchors[k][3]) / 2, 12);
  });

  it('a mind skill outside 0-100 (or NaN) is clamped to the nearest end', () => {
    expect(clampMindSkill(-20)).toBe(0);
    expect(clampMindSkill(150)).toBe(100);
    expect(clampMindSkill(Number.NaN)).toBe(0);
    const out = createMindProfile();
    interpolateAnchors(250, out, cfg.mind);
    expect(out.reactionMuSec).toBe(cfg.mind.anchors.reactionMuSec[3]);
    expect(out.mindSkill).toBe(100);
  });

  it('skill orders the enemy: reaction, aim noise and habits move the right way from 0 to 100', () => {
    const lo = createMindProfile();
    const hi = createMindProfile();
    interpolateAnchors(0, lo, cfg.mind);
    interpolateAnchors(100, hi, cfg.mind);
    expect(hi.reactionMuSec).toBeLessThan(lo.reactionMuSec);
    expect(hi.settleNoiseDeg).toBeLessThan(lo.settleNoiseDeg);
    expect(hi.flickThroughputBps).toBeGreaterThan(lo.flickThroughputBps);
    expect(hi.movingShotShare).toBeLessThan(lo.movingShotShare);
    expect(hi.sprayCompensation).toBeGreaterThan(lo.sprayCompensation);
  });
});

describe('personality', () => {
  it('two enemies at the same dial with different serials differ; the same stream gives the same profile', () => {
    const a = build(50, 1001);
    const b = build(50, 1002);
    const a2 = build(50, 1001);
    expect(a).toEqual(a2);
    expect(a.reactionMuSec).not.toBe(b.reactionMuSec);
    expect(a.settleNoiseDeg).not.toBe(b.settleNoiseDeg);
    expect(a.tradeChance).not.toBe(b.tradeChance);
    expect(a.repeekSame).not.toBe(b.repeekSame);
  });

  it('the jitter stays inside the spreads: reaction 12%, aim noise 20%, aggression 25%', () => {
    const s = cfg.mind.spread;
    const base = createMindProfile();
    interpolateAnchors(50, base, cfg.mind);
    for (let seed = 0; seed < 400; seed++) {
      const p = build(50, seed);
      expect(Math.abs(p.reactionFactor - 1)).toBeLessThanOrEqual(s.reaction + 1e-12);
      expect(Math.abs(p.aimNoiseFactor - 1)).toBeLessThanOrEqual(s.aimNoise + 1e-12);
      expect(Math.abs(p.aggressionFactor - 1)).toBeLessThanOrEqual(s.aggression + 1e-12);
      expect(p.reactionSigmaSec / base.reactionSigmaSec).toBeCloseTo(p.reactionFactor, 9);
      expect(p.settleNoiseDeg / base.settleNoiseDeg).toBeCloseTo(p.aimNoiseFactor, 9);
      expect(p.tradeChance / base.tradeChance).toBeCloseTo(p.aggressionFactor, 9);
      expect(p.retreatAfterDamage / base.retreatAfterDamage).toBeCloseTo(2 - p.aggressionFactor, 9);
    }
  });

  it('the factors are spread across the allowed range, not stuck at the middle', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let seed = 0; seed < 400; seed++) {
      const f = build(50, seed).reactionFactor;
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    expect(lo).toBeLessThan(0.91);
    expect(hi).toBeGreaterThan(1.09);
  });

  it('a spread of 0 turns a trait off without moving the stream', () => {
    const t = cloneTunables();
    t.mind.spread.reaction = 0;
    const a = build(50, 9);
    const b = build(50, 9, t);
    expect(b.reactionFactor).toBe(1);
    expect(b.aimNoiseFactor).toBe(a.aimNoiseFactor);
    expect(b.aggressionFactor).toBe(a.aggressionFactor);
    expect(b.repeekSame).toBe(a.repeekSame);
  });
});

describe('floors and clamps hold after jitter', () => {
  const dials = [0, 12, 35, 50, 65, 88, 100];

  it('reaction >= 0.25 s and tell >= 0.25 s, the fairness floors, at every dial and seed', () => {
    const fl = cfg.dial.floors;
    for (const m of dials) {
      for (let seed = 0; seed < 300; seed++) {
        const p = build(m, seed);
        expect(p.reactionMeanSec, `m ${m} seed ${seed}`).toBeGreaterThanOrEqual(0.25);
        expect(p.reactionMeanSec).toBeGreaterThanOrEqual(fl.enemyReactionSec);
        expect(p.reactionFloorSec).toBeGreaterThanOrEqual(0.25);
        expect(p.tellFloorSec).toBeGreaterThanOrEqual(0.25);
        expect(p.preparedReactionFloorSec).toBe(fl.preparedReactionSec);
      }
    }
  });

  it('a table that would breach the floor is lifted to it (the floor wins over the data)', () => {
    const t = cloneTunables();
    t.mind.anchors.reactionMuSec = [0.1, 0.1, 0.1, 0.1];
    t.mind.anchors.reactionTauSec = [0.05, 0.05, 0.05, 0.05];
    for (let seed = 0; seed < 50; seed++) {
      const p = build(100, seed, t);
      expect(p.reactionMeanSec).toBeGreaterThanOrEqual(t.dial.floors.enemyReactionSec - 1e-12);
    }
    t.dial.floors.enemyReactionSec = 0.4; // and it follows the dial's floor, not a copy
    expect(build(100, 1, t).reactionMeanSec).toBeGreaterThanOrEqual(0.4 - 1e-12);
    expect(build(100, 1, t).tellFloorSec).toBe(t.dial.floors.tellSec);
  });

  it('probabilities stay in 0..1, the peek mix sums to 1, counts are whole and ordered', () => {
    const t = cloneTunables();
    t.mind.spread = { reaction: 0.12, aimNoise: 0.2, aggression: 0.9, habit: 0.9 }; // extreme spreads
    for (const m of dials) {
      for (let seed = 0; seed < 200; seed++) {
        const p = build(m, seed, t);
        for (const k of t.mind.groups.probabilities) {
          expect(p[k], k).toBeGreaterThanOrEqual(0);
          expect(p[k], k).toBeLessThanOrEqual(1);
        }
        let mix = 0;
        for (const k of t.mind.groups.peekMix) mix += p[k];
        expect(mix).toBeCloseTo(1, 12);
        expect(Number.isInteger(p.burstMin)).toBe(true);
        expect(Number.isInteger(p.burstMax)).toBe(true);
        expect(p.burstMax).toBeGreaterThanOrEqual(p.burstMin);
        expect(Number.isInteger(p.crouchMaxPerDuel)).toBe(true);
        expect(p.tapBeyondM).toBeGreaterThanOrEqual(p.sprayBelowM);
      }
    }
  });

  it('the human limits hold: no enemy has zero settle noise, a faster flick than the cap, or a view beyond the caps', () => {
    for (let seed = 0; seed < 300; seed++) {
      const p = build(100, seed);
      for (const b of cfg.mind.minimums) expect(p[b.param], b.param).toBeGreaterThanOrEqual(b.value);
      for (const b of cfg.mind.maximums) expect(p[b.param], b.param).toBeLessThanOrEqual(b.value);
      expect(p.settleNoiseDeg).toBeGreaterThan(0);
      expect(p.maxAngularSpeedDegPerSec).toBe(cfg.mind.caps.angularSpeedDegPerSec);
      expect(p.maxAngularAccelDegPerSec2).toBe(cfg.mind.caps.angularAccelDegPerSec2);
    }
  });

  it('every field is finite at every dial and seed', () => {
    for (const m of [-5, 0, 1, 34.9, 35, 36, 64.9, 65, 99.9, 100, 140]) {
      for (let seed = 0; seed < 50; seed++) {
        const p = build(m, seed);
        for (const k of Object.keys(p) as (keyof typeof p)[]) expect(Number.isFinite(p[k]), `${k} m ${m}`).toBe(true);
      }
    }
  });
});

describe('hearing and caps come from their one home', () => {
  it('a profile carries no hearing radius: the enemy hears at the shared table (sim/hearing.test.ts asserts the symmetry)', () => {
    const p = build(50, 3) as unknown as Record<string, unknown>;
    expect(Object.keys(p).filter((k) => /^hear.*M$/.test(k) && k !== 'hearErrorFloorM')).toEqual([]);
    expect(cloneTunables().mind).not.toHaveProperty('hearing');
  });

  it('a changed table value changes the profile with no code change', () => {
    const t = cloneTunables();
    t.mind.anchors.settleNoiseDeg = [9, 9, 9, 9];
    t.mind.spread.aimNoise = 0;
    expect(build(40, 1, t).settleNoiseDeg).toBe(9);
  });
});

describe('profileFor allocates nothing', () => {
  it('writes into the object it is given and returns it; no new keys appear', () => {
    const out = createMindProfile();
    const keys = Object.keys(out).join();
    const rng = new Rng(7);
    const ret = profileFor(40, rng, out, cfg);
    expect(ret).toBe(out);
    for (let i = 0; i < 100; i++) profileFor(i, rng, out, cfg);
    expect(Object.keys(out).join()).toBe(keys);
  });
});
