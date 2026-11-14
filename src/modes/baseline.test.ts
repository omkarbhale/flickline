import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { BASELINE_SKILLS } from '../config/baseline';
import { BASELINE_ITEMS } from '../config/baselineItems';
import { cloneTunables, tunables } from '../config/tunables';
import { DEG2RAD } from '../core/math';
import { angleDeg, directionTo } from './aim';
import { baseline, baselineLevelFor, buildBaselineSequence, isBaselineDue, type BaselineLevels, type BaselineState } from './baseline';
import { generateBaselineItems } from './baselineGen';
import { directionFromAngles, vec3 } from '../core/vec3';
import { aimAt, EYE, hall, kill, READY, shot, TABLE, targetOf, untilTarget } from './drillSupport';
import { makeHarness, type Harness } from './testHarness';

const LEVELS: BaselineLevels = { flick: 45, precision: 45 };
const HOUR = 3_600_000;

function startBaseline(seed: number, levels: BaselineLevels = LEVELS): Harness {
  const h = makeHarness(TABLE, 45);
  h.runner.begin(baseline, { seed, anchors: hall(), levels, pinDial: 45 });
  h.step(READY);
  return h;
}

/** Play the trial now up like a perfect player: aim, first-bullet head hit, kill. */
function win(h: Harness): void {
  untilTarget(h, 2000);
  const t = targetOf(h);
  aimAt(h, t.pos, t.kind === 'post' ? h.tunables.targets.hit.headCentreStand : 0);
  h.step(20);
  shot(h, t.id, true);
  kill(h, t.id, 'head');
  h.targets.delete(t.id);
}

const stat = (xs: number[]): [number, number] => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return [m, xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length];
};

describe('isBaselineDue', () => {
  const now = 1_800_000_000_000;
  it('is due with no earlier run, or after 8 hours away, and not before', () => {
    expect(isBaselineDue(null, now)).toBe(true);
    expect(isBaselineDue(Number.NaN, now)).toBe(true);
    expect(isBaselineDue(now - 8 * HOUR + 1, now)).toBe(false);
    expect(isBaselineDue(now - 8 * HOUR, now)).toBe(true);
    expect(isBaselineDue(now - 30 * 60_000, now)).toBe(false);
  });
  it('takes the gap from the config, or an override', () => {
    expect(tunables.baseline.gapHours).toBe(8);
    expect(isBaselineDue(now - 5 * HOUR, now, 4)).toBe(true);
    expect(isBaselineDue(now - 5 * HOUR, now, 6)).toBe(false);
  });
  it('a last run in the future (the clock moved back) is not a gap', () => {
    expect(isBaselineDue(now + HOUR, now)).toBe(false);
  });
  it('is pure: the same inputs give the same answer', () => {
    expect(isBaselineDue(now - 9 * HOUR, now)).toBe(isBaselineDue(now - 9 * HOUR, now));
  });
});

describe('baseline levels', () => {
  it('picks the highest level at or below the matched dial, the lowest for anything under it', () => {
    expect(baselineLevelFor(-5)).toBe(15);
    expect(baselineLevelFor(14.9)).toBe(15);
    expect(baselineLevelFor(15)).toBe(15);
    expect(baselineLevelFor(29.99)).toBe(15);
    expect(baselineLevelFor(30)).toBe(30);
    expect(baselineLevelFor(52)).toBe(45);
    expect(baselineLevelFor(89.9)).toBe(75);
    expect(baselineLevelFor(100)).toBe(90);
  });
  it('the matched success rates are the same as Orbit and Cold Start aim for', () => {
    expect(tunables.baseline.matchedTargetSuccess.flick).toBe(tunables.dial.modes.orbit!.targetSuccess);
    expect(tunables.baseline.matchedTargetSuccess.precision).toBe(tunables.dial.modes.coldStart!.targetSuccess);
  });
});

describe('stored item lists', () => {
  it('are what the generator writes from the fixed seed (npm run baseline:items)', () => {
    expect(JSON.parse(JSON.stringify(generateBaselineItems(tunables)))).toEqual(JSON.parse(JSON.stringify(BASELINE_ITEMS)));
  });

  it('there are 20 items for each of the six levels of each skill, at the level\'s own axis values', () => {
    expect(tunables.baseline.levels).toEqual([15, 30, 45, 60, 75, 90]);
    for (const skill of BASELINE_SKILLS) {
      for (const level of tunables.baseline.levels) {
        const list = BASELINE_ITEMS[skill][level]!;
        expect(list).toHaveLength(20);
        const ax = axes(level);
        for (const [angle, pitch, distance, scale, exposure] of list) {
          expect(Number.isFinite(angle + pitch + distance + scale + exposure)).toBe(true);
          if (skill === 'flick') {
            expect(angle).toBeGreaterThanOrEqual(ax.flickMinDeg - 0.01);
            expect(angle).toBeLessThanOrEqual(ax.flickMaxDeg + 0.01);
            expect(scale).toBeCloseTo(ax.beaconScale, 3);
            expect(exposure).toBeCloseTo(ax.orbitExposureSec, 3);
            expect(distance).toBeGreaterThanOrEqual(tunables.modes.orbit.minDistM);
            expect(distance).toBeLessThanOrEqual(tunables.modes.orbit.maxDistM);
            // never under the floor
            expect(tunables.movement.standEyeHeight + distance * Math.sin(pitch * DEG2RAD)).toBeGreaterThanOrEqual(tunables.baseline.minBeaconHeightM - 0.01);
          } else {
            expect(angle).toBeGreaterThanOrEqual(tunables.modes.coldStart.minAngleDeg - 0.01);
            expect(angle).toBeLessThanOrEqual(tunables.modes.coldStart.maxAngleDeg + 0.01);
            expect(scale).toBe(1);
            expect(exposure).toBeCloseTo(ax.coldStartExposureSec, 3);
            expect(distance).toBeGreaterThanOrEqual(tunables.baseline.minPostDistanceM - 0.01);
            expect(distance).toBeLessThanOrEqual(tunables.baseline.maxDistanceM + 0.01);
          }
        }
      }
    }
  });

  it('are stratified: one flick angle in each twentieth of the level\'s angle range', () => {
    for (const level of tunables.baseline.levels) {
      const ax = axes(level);
      const slice = (ax.flickMaxDeg - ax.flickMinDeg) / 20;
      const sorted = BASELINE_ITEMS.flick[level]!.map(([a]) => a).sort((x, y) => x - y);
      sorted.forEach((a, k) => {
        expect(a).toBeGreaterThanOrEqual(ax.flickMinDeg + k * slice - 0.01);
        expect(a).toBeLessThanOrEqual(ax.flickMinDeg + (k + 1) * slice + 0.01);
      });
    }
  });

  it('get harder with the level: smaller Beacons, shorter exposure, wider flicks, farther Posts', () => {
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const col = (skill: 'flick' | 'precision', level: number, i: number): number => mean(BASELINE_ITEMS[skill][level]!.map((t) => t[i]!));
    const lv = tunables.baseline.levels;
    for (let k = 1; k < lv.length; k++) {
      const a = lv[k - 1]!;
      const b = lv[k]!;
      expect(col('flick', b, 3)).toBeLessThan(col('flick', a, 3));
      expect(col('flick', b, 4)).toBeLessThan(col('flick', a, 4));
      expect(col('flick', b, 0)).toBeGreaterThan(col('flick', a, 0));
      expect(col('precision', b, 4)).toBeLessThan(col('precision', a, 4));
      expect(col('precision', b, 2)).toBeGreaterThanOrEqual(col('precision', a, 2));
    }
  });
});

describe('the daily shuffle', () => {
  it('is 40 trials alternating flick and precision, 20 each', () => {
    const plan = buildBaselineSequence(1, LEVELS);
    expect(plan).toHaveLength(40);
    expect(plan.map((p) => p.skill)).toEqual(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'flick' : 'precision')));
  });

  it('two different seeds give different sequences with identical item statistics', () => {
    const a = buildBaselineSequence(11, LEVELS);
    const b = buildBaselineSequence(12, LEVELS);
    const key = (p: (typeof a)[number]): string => `${p.skill}:${p.item.index}:${p.item.side}`;
    expect(a.map(key)).not.toEqual(b.map(key));
    for (const skill of BASELINE_SKILLS) {
      const of = (plan: typeof a) => plan.filter((p) => p.skill === skill);
      const sa = of(a);
      const sb = of(b);
      // The same items (the stored list, each exactly once), in a different order.
      expect(sa.map((p) => p.item.index).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(sb.map((p) => p.item.index).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(sa.map((p) => p.item.index)).not.toEqual(sb.map((p) => p.item.index));
      // Identical statistics of every column, and half the items on each side.
      for (const f of ['angleDeg', 'pitchDeg', 'distance', 'scale', 'exposureSec'] as const) {
        const [ma, va] = stat(sa.map((p) => p.item[f]));
        const [mb, vb] = stat(sb.map((p) => p.item[f]));
        expect(ma).toBeCloseTo(mb, 9);
        expect(va).toBeCloseTo(vb, 9);
      }
      expect(sa.filter((p) => p.item.side === 1)).toHaveLength(10);
      expect(sb.filter((p) => p.item.side === 1)).toHaveLength(10);
      // Each item is a stored one.
      for (const p of sa) expect([p.item.angleDeg, p.item.pitchDeg, p.item.distance, p.item.scale, p.item.exposureSec]).toEqual([...BASELINE_ITEMS[skill][45]![p.item.index]!]);
    }
  });

  it('the same seed gives the same sequence, and mirroring differs between seeds', () => {
    expect(buildBaselineSequence(5, LEVELS)).toEqual(buildBaselineSequence(5, LEVELS));
    const sides = (seed: number): number[] => buildBaselineSequence(seed, LEVELS).map((p) => p.item.side);
    expect(sides(5)).not.toEqual(sides(6));
  });

  it('each skill runs at its own level', () => {
    const plan = buildBaselineSequence(3, { flick: 15, precision: 90 });
    const flick = plan.filter((p) => p.skill === 'flick');
    const post = plan.filter((p) => p.skill === 'precision');
    expect(flick[0]!.item.scale).toBeCloseTo(axes(15).beaconScale, 3);
    expect(post[0]!.item.exposureSec).toBeCloseTo(axes(90).coldStartExposureSec, 3);
  });
});

describe('the Baseline run', () => {
  it('is a fixed-count hybrid on the Range with the Kestrel, movement locked, no beats or wave', () => {
    expect(baseline.skills).toEqual(['flick', 'precision']);
    expect(baseline.map).toBe('range');
    expect(baseline.weapon).toBe('kestrel');
    expect(baseline.durationSec).toBe(Infinity);
    expect(baseline.beatSec).toBeNull();
    expect(baseline.waveCurve).toEqual([0]);
    expect(baseline.player?.lockMovement).toBe(true);
    expect(baseline.trialSource).toBe('baseline');
    expect(baseline.referenceLike).toBe(true);
  });

  it('places every item at its angle from the crosshair, at its scale, on the side the shuffle chose', () => {
    const seed = 9;
    const h = startBaseline(seed);
    const plan = buildBaselineSequence(seed, LEVELS);
    const view = vec3();
    const dir = vec3();
    for (let i = 0; i < 40; i++) {
      // The view as the trial starts: the player is looking at the last kill.
      untilTarget(h, 2000);
      const t = targetOf(h);
      const item = plan[i]!.item;
      const centre = vec3(t.pos.x, t.pos.y + (t.kind === 'post' ? h.tunables.targets.hit.headCentreStand : 0), t.pos.z);
      // (the view moved on after the spawn; the trial's own record has the geometry)
      const rec = h.log.filter((l) => l.type === 'skillTrial').length;
      expect(rec).toBe(i);
      expect(t.kind).toBe(plan[i]!.skill === 'flick' ? 'beacon' : 'post');
      if (t.kind === 'beacon') expect(t.scale).toBeCloseTo(item.scale, 6);
      directionFromAngles(view, h.player.yaw, h.player.pitch);
      directionTo(dir, EYE, centre);
      const a = angleDeg(view, dir);
      if (t.kind === 'beacon') expect(a).toBeCloseTo(item.angleDeg, 3);
      else {
        // A Post's pitch is fixed by its distance: a view looking up cannot be as near as the item says, so the angle is widened, never narrowed.
        const pPost = Math.asin((centre.y - EYE.y) / Math.hypot(centre.x - EYE.x, centre.y - EYE.y, centre.z - EYE.z)) / DEG2RAD;
        expect(a).toBeGreaterThanOrEqual(item.angleDeg - 1e-3);
        expect(a).toBeLessThanOrEqual(Math.max(item.angleDeg, Math.abs(pPost - h.player.pitch / DEG2RAD)) + 1e-3);
      }
      const dist = Math.hypot(centre.x - EYE.x, centre.y - EYE.y, centre.z - EYE.z);
      expect(dist).toBeLessThanOrEqual(item.distance + 1e-6);
      if (dist < item.distance - 1e-6) expect(dist).toBeGreaterThanOrEqual(item.distance * 0.3); // shrunk to fit the hall, never to nothing
      // Left of the crosshair = positive yaw offset.
      const yawOff = Math.atan2(-(centre.x - EYE.x), -(centre.z - EYE.z)) - h.player.yaw;
      const wrapped = Math.atan2(Math.sin(yawOff), Math.cos(yawOff));
      // (the other side is used only when the hall cannot hold this one)
      expect(Math.sign(wrapped) === item.side || Math.abs(wrapped) < 1e-6).toBe(true);
      aimAt(h, t.pos, t.kind === 'post' ? h.tunables.targets.hit.headCentreStand : 0);
      h.step(10);
      shot(h, t.id, true);
      kill(h, t.id, 'head');
      h.targets.delete(t.id);
    }
  });

  it('ends when the 40th trial resolves, not on a clock, with 40 tagged skillTrials at the levels', () => {
    const h = startBaseline(4, { flick: 30, precision: 60 });
    for (let i = 0; i < 39; i++) {
      win(h);
      expect(h.runner.phase).toBe('live');
    }
    h.step(120 * 128); // time passing does not end it
    expect(h.runner.phase === 'live' || h.events('skillTrial').length === 40).toBe(true);
    if (h.runner.phase === 'live') {
      win(h);
    }
    expect(h.runner.phase).toBe('result');
    expect(h.events('runEnded')[0]!.reason).toBe('complete');
    const trials = h.events('skillTrial');
    expect(trials).toHaveLength(40);
    expect(trials.every((t) => t.source === 'baseline')).toBe(true);
    trials.forEach((t, i) => {
      expect(t.skill).toBe(i % 2 === 0 ? 'flick' : 'precision');
      expect(t.itemDifficulty).toBe(i % 2 === 0 ? 30 : 60);
    });
    expect(h.events('beatStarted')).toHaveLength(1); // no adaptation: one flat beat
    expect(h.dialCalls).toEqual([]); // the pinned run never asks the skill model
  });

  it('a player who never shoots still finishes: every trial times out', () => {
    const h = makeHarness(TABLE, 45);
    h.runner.begin(baseline, { seed: 2, anchors: hall(), levels: LEVELS, pinDial: 45 });
    h.step(READY);
    for (let i = 0; i < 400 * 128 && h.runner.phase === 'live'; i++) h.step(1);
    expect(h.runner.phase).toBe('result');
    const trials = h.events('skillTrial');
    expect(trials).toHaveLength(40);
    expect(trials.every((t) => t.success === false)).toBe(true);
    expect((h.runner.state as BaselineState).resolved).toBe(40);
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number): string => {
      const h = startBaseline(seed);
      for (let i = 0; i < 12; i++) win(h);
      return JSON.stringify(h.log);
    };
    expect(run(21)).toBe(run(21));
    expect(run(21)).not.toBe(run(22));
  });

  it('reports exposure from the item, not the dial', () => {
    const h = startBaseline(6, { flick: 90, precision: 90 });
    untilTarget(h, 2000);
    const first = buildBaselineSequence(6, { flick: 90, precision: 90 })[0]!.item;
    // The Beacon leaves after its stored exposure (floored), not before.
    const t = targetOf(h);
    h.step(Math.floor((first.exposureSec - 0.1) * 128));
    expect(h.targets.has(t.id)).toBe(true);
    h.step(Math.ceil(0.2 * 128) + 2);
    expect(h.targets.has(t.id)).toBe(false);
  });

  it('every placement is fair: no target nearer than the floors', () => {
    const t = cloneTunables();
    const h = startBaseline(14);
    for (let i = 0; i < 40; i++) {
      untilTarget(h, 2000);
      const x = targetOf(h);
      const head = x.pos.y + (x.kind === 'post' ? t.targets.hit.headCentreStand : 0);
      expect(Math.hypot(x.pos.x, head - EYE.y, x.pos.z)).toBeGreaterThanOrEqual(t.dial.floors.spawnMinDistance);
      aimAt(h, x.pos, x.kind === 'post' ? t.targets.hit.headCentreStand : 0);
      h.step(5);
      shot(h, x.id, true);
      kill(h, x.id, 'head');
      h.targets.delete(x.id);
    }
    expect(h.runner.refusedSpawns).toBe(0);
  });
});
