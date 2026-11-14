import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { secondsToTicks } from '../core/time';
import type { AnchorSource, AxisValues } from './contracts';
import { rangeMap } from '../sim/mapLoader';
import { strafeTrack } from './strafeTrack';
import { makeHarness, type Harness } from './testHarness';

const range: AnchorSource = { anchors: rangeMap.anchors, bounds: rangeMap.bounds };
const lanes = rangeMap.anchors.filter((a) => a.kind === 'strafe-lane');
const REPLACE = secondsToTicks(0.4);

/** A run of the mode on the real Range anchors, the real dial axes, the player at the Range's spawn, the dial pinned. */
function start(dial: number, seed = 1): Harness {
  const h = makeHarness({}, dial, (d) => axes(d) as unknown as AxisValues);
  const p = rangeMap.spawn.pos;
  h.player.pos.x = p.x;
  h.player.pos.y = p.y;
  h.player.pos.z = p.z;
  h.runner.begin(strafeTrack, { seed, pinDial: dial, anchors: range });
  h.step(secondsToTicks(0.8) + 1); // ready -> live
  return h;
}

const alive = (h: Harness) => [...h.targets.entries()].map(([id, t]) => ({ id, ...t }));
const laneOf = (t: { strafe?: { laneA: { z: number } } }) => lanes.find((l) => l.a!.z === t.strafe!.laneA.z)!;

describe('Strafe Track definition (design §4.3)', () => {
  it('is a 60 s tracking run on the Range with Kestrel, no reload, movement free', () => {
    expect(strafeTrack.skills).toEqual(['track']);
    expect(strafeTrack.map).toBe('range');
    expect(strafeTrack.weapon).toBe('kestrel');
    expect(strafeTrack.durationSec).toBe(60);
    expect(strafeTrack.player?.infiniteMagazine).toBe(true);
    expect(strafeTrack.player?.lockMovement).toBeUndefined();
    expect(strafeTrack.axes).toEqual(
      expect.arrayContaining(['strafeSpeed', 'strafeLegSec', 'standStillSec', 'strafeLimitSec', 'distance', 'density']),
    );
  });

  it('is the dial\'s `strafeTrack` entry (skill track)', async () => {
    const { tunables } = await import('../config/tunables');
    expect(tunables.dial.modes[strafeTrack.id]!.skill).toBe('track');
  });
});

describe('Strafers on the Range lanes', () => {
  it('uses the Range strafe-lane anchors: every Strafer starts at a lane end and runs that lane', () => {
    expect(lanes).toHaveLength(3);
    for (const seed of [1, 2, 3]) {
      const h = start(70, seed);
      h.step(secondsToTicks(1));
      const ts = alive(h);
      expect(ts.length).toBeGreaterThan(0);
      for (const t of ts) {
        expect(t.kind).toBe('strafer');
        const lane = laneOf(t);
        expect(t.strafe!.laneA).toEqual(lane.a);
        expect(t.strafe!.laneB).toEqual(lane.b);
        const atEnd = [lane.a!, lane.b!].some((e) => e.x === t.pos.x && e.z === t.pos.z);
        expect(atEnd).toBe(true);
      }
    }
  });

  it('keeps them 10-35 m from the player', () => {
    for (const dial of [0, 30, 60, 100]) {
      const h = start(dial, 4);
      h.step(secondsToTicks(1));
      for (const t of alive(h)) {
        const d = Math.hypot(t.pos.x - h.player.pos.x, t.pos.z - h.player.pos.z);
        expect(d).toBeGreaterThanOrEqual(10);
        expect(d).toBeLessThanOrEqual(35);
      }
    }
  });

  it('applies the dial: dial 10 and dial 90 differ in speed, leg, stand-still, time limit, distance and density as §9.4 says', () => {
    const lo = start(10);
    const hi = start(90);
    lo.step(secondsToTicks(1));
    hi.step(secondsToTicks(1));
    const a = alive(lo);
    const b = alive(hi);
    const alo = axes(10);
    const ahi = axes(90);
    // Density: 1..3 alive, in equal bands of the dial.
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(3);
    // The numbers each Strafer was given are the dial's.
    for (const t of a) {
      expect(t.strafe!.speed).toBeCloseTo(alo.strafeSpeed, 9);
      expect(t.strafe!.legSec).toBeCloseTo(alo.strafeLegSec, 9);
      expect(t.strafe!.standStillSec).toBeCloseTo(alo.standStillSec, 9);
    }
    for (const t of b) {
      expect(t.strafe!.speed).toBeCloseTo(ahi.strafeSpeed, 9);
      expect(t.strafe!.legSec).toBeCloseTo(ahi.strafeLegSec, 9);
      expect(t.strafe!.standStillSec).toBeCloseTo(ahi.standStillSec, 9);
    }
    // And they differ the way the design says: faster, shorter legs, shorter stand-still, tighter limit.
    expect(b[0]!.strafe!.speed).toBeGreaterThan(a[0]!.strafe!.speed + 2);
    expect(b[0]!.strafe!.legSec).toBeLessThan(a[0]!.strafe!.legSec);
    expect(b[0]!.strafe!.standStillSec).toBeLessThan(a[0]!.strafe!.standStillSec);
    expect(ahi.strafeLimitSec).toBeLessThan(alo.strafeLimitSec);
    // Distance: the dial's far lanes at 90, the near lane at 10.
    const dist = (h: Harness, t: ReturnType<typeof alive>[number]) => Math.hypot(t.pos.x - h.player.pos.x, t.pos.z - h.player.pos.z);
    expect(dist(lo, a[0]!)).toBeLessThan(15);
    for (const t of b) expect(dist(hi, t)).toBeGreaterThan(20);
  });

  it('the dial endpoints: dial 0 is 2.0 m/s, 1 Strafer, 8 s; dial 100 is 5.4 m/s, 3 Strafers, 3 s', () => {
    const lo = start(0);
    const hi = start(100);
    lo.step(secondsToTicks(1));
    hi.step(secondsToTicks(1));
    expect(alive(lo)).toHaveLength(1);
    expect(alive(lo)[0]!.strafe!.speed).toBeCloseTo(2, 9);
    expect(alive(hi)).toHaveLength(3);
    expect(alive(hi)[0]!.strafe!.speed).toBeCloseTo(5.4, 9);
    expect(axes(0).strafeLimitSec).toBe(8);
    expect(axes(100).strafeLimitSec).toBe(3);
  });

  it('puts Strafers on different lanes when the dial offers more than one', () => {
    const h = start(90);
    h.step(secondsToTicks(1));
    const zs = alive(h).map((t) => t.strafe!.laneA.z);
    expect(new Set(zs).size).toBeGreaterThan(1);
  });

  it('a Strafer on a lane another one runs steps out from the end fewer of them used, so they do not spawn on top of each other', () => {
    const h = start(70, 11); // the dial's distance band holds one lane: all three share it
    h.step(secondsToTicks(1));
    const ts = alive(h);
    expect(ts).toHaveLength(3);
    expect(new Set(ts.map((t) => t.strafe!.laneA.z)).size).toBe(1);
    // Right after spawn: two at one end and one at the other, never all three together.
    const h2 = start(70, 11);
    h2.step(secondsToTicks(0.25) * 2 + 2);
    const xs = alive(h2).map((t) => Math.sign(t.pos.x));
    expect(xs.filter((x) => x > 0).length).toBeGreaterThanOrEqual(1);
    expect(xs.filter((x) => x < 0).length).toBeGreaterThanOrEqual(1);
  });

  it('opens with the wave staggered 0.25 s apart', () => {
    const h = start(100);
    expect(alive(h)).toHaveLength(1);
    h.step(secondsToTicks(0.25));
    expect(alive(h)).toHaveLength(2);
    h.step(secondsToTicks(0.25));
    expect(alive(h)).toHaveLength(3);
  });
});

describe('Strafer trials', () => {
  it('a kill is a successful `track` trial with its data, and the replacement steps out 0.4 s later', () => {
    const h = start(50, 5);
    h.step(secondsToTicks(1));
    const before = alive(h);
    const victim = before[0]!;
    h.kill(victim.id, { kind: 'strafer', zone: 'head', ttkMs: 520, rtMs: 410 });
    h.targets.delete(victim.id);
    const trials = h.events('skillTrial');
    expect(trials).toHaveLength(1);
    expect(trials[0]).toMatchObject({ skill: 'track', success: true, rtMs: 410 });
    const x = trials[0]!.extra as Record<string, number>;
    expect(x.ttkMs).toBe(520);
    expect(x.headKill).toBe(1);
    expect(x.speed).toBeCloseTo(axes(50).strafeSpeed, 9);
    expect(x.expired).toBe(0);
    // The replacement: not before 0.4 s, and there by 0.4 s + a tick.
    const n = before.length;
    h.step(REPLACE - 2);
    expect(alive(h)).toHaveLength(n - 1);
    h.step(4);
    expect(alive(h)).toHaveLength(n);
    expect(h.events('scoreAwarded')).toHaveLength(1);
  });

  it('a Strafer not killed within its limit is a failed trial, leaves, and is replaced 0.4 s later', () => {
    const h = start(100, 6);
    h.step(secondsToTicks(0.6));
    const first = alive(h)[0]!;
    const limit = axes(100).strafeLimitSec;
    // Kill the other two so the first is the only one on the clock.
    for (const t of alive(h).slice(1)) { h.kill(t.id, { kind: 'strafer' }); h.targets.delete(t.id); }
    const killedAt = h.simTick;
    h.step(secondsToTicks(limit) - (killedAt - secondsToTicks(0.8)) - 4);
    expect(h.targets.has(first.id)).toBe(true);
    expect(h.events('skillTrial').filter((e) => e.success === false)).toHaveLength(0);
    h.step(secondsToTicks(0.6)); // past the deadline
    expect(h.targets.has(first.id)).toBe(false);
    const failed = h.events('skillTrial').filter((e) => e.success === false);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ skill: 'track' });
    expect((failed[0]!.extra as Record<string, number>).expired).toBe(1);
    expect(alive(h).length).toBeGreaterThanOrEqual(1);
  });

  it('every Strafer resolves exactly one skillTrial, kill or timeout', () => {
    const h = start(80, 9);
    const seen = new Set<number>();
    let trials = 0;
    for (let i = 0; i < 128 * 20; i++) {
      h.step(1);
      const ts = h.events('skillTrial');
      trials = ts.length;
      // Kill whichever Strafer has been up a while, every ~1.5 s.
      if (i % 190 === 100) {
        const t = alive(h)[0];
        if (t && !seen.has(t.id)) { seen.add(t.id); h.kill(t.id, { kind: 'strafer' }); h.targets.delete(t.id); }
      }
    }
    expect(trials).toBeGreaterThan(5);
    expect(h.events('skillTrial').every((e) => e.skill === 'track')).toBe(true);
    // Trials = kills + timeouts; nothing counted twice (a killed Strafer never also times out).
    expect(h.runner.stats.trials).toBe(trials);
    expect(h.runner.stats.trialsWon).toBe(seen.size);
  });

  it('never has more Strafers alive than the dial wants, and is deterministic for a seed', () => {
    const run = (seed: number) => {
      const h = start(60, seed);
      const log: string[] = [];
      for (let i = 0; i < 128 * 10; i++) {
        h.step(1);
        expect(alive(h).length).toBeLessThanOrEqual(3);
        if (i % 32 === 0) log.push(alive(h).map((t) => `${t.id}:${t.pos.x}:${t.pos.z}:${t.strafe!.speed}`).join('|'));
      }
      return log.join('\n');
    };
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });
});
