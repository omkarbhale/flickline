import { describe, expect, it } from 'vitest';
import { ModeHost } from '../app/modeHost';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import type { GameEvents } from '../core/gameEvents';
import { StatTracker, type RunStats } from '../feedback/statTracker';
import { rangeMap } from '../sim/mapLoader';
import { createTickInput } from '../sim/types';
import { World } from '../sim/world';
import { SprayBot } from './sprayWallBot';

interface Outcome {
  stats: RunStats;
  sprays: number;
  hits: number;
  burst: number;
  trials: boolean[];
  phase: string;
  ticks: number;
}

/** A full Spray Wall run on the real World + ModeHost + stat tracker, played by the scripted bot. */
function play(control: number, dial: number, seed: number, aimY = 1.3): Outcome {
  const tunables = cloneTunables();
  const bus = new EventBus<GameEvents>();
  const world = new World({ level: rangeMap, tunables, seed });
  const host = new ModeHost(world, bus, rangeMap, tunables);
  const tracker = new StatTracker();
  tracker.attach(bus);
  const trials: boolean[] = [];
  let shooting = false;
  let hits = 0;
  let burst = 0;
  bus.on('skillTrial', (e) => trials.push(e.success));
  bus.on('sprayStarted', () => { shooting = true; });
  bus.on('sprayEnded', (e) => {
    shooting = false;
    hits += e.hits;
    burst += e.burst;
  });
  bus.on('runReady', (e) => tracker.reset(e.mode, e.seed, e.dial));
  expect(host.start('sprayWall', { seed, pinDial: dial })).toBe(true);
  const bot = new SprayBot({ control, aimY });
  const input = createTickInput();
  const plan = { yaw: 0, pitch: 0, fire: false, reload: false };
  let ticks = 0;
  while (host.phase !== 'result' && ticks < 128 * 90) {
    bot.plan(world, shooting, plan);
    input.yaw = plan.yaw;
    input.pitch = plan.pitch;
    input.fire = plan.fire;
    input.reload = plan.reload;
    world.step(input, bus);
    host.tick();
    ticks++;
  }
  return { stats: tracker.result(), sprays: trials.length, hits, burst, trials, phase: host.phase, ticks };
}

describe('Spray Wall played by a scripted bot on the real sim', () => {
  it('the bots only differ in the pull: more control lands more bullets over a full magazine', () => {
    const rate = (control: number): number => {
      let hits = 0;
      let burst = 0;
      for (let seed = 1; seed <= 4; seed++) {
        const o = play(control, 80, seed);
        hits += o.hits;
        burst += o.burst;
      }
      return hits / burst;
    };
    const [none, half, full] = [rate(0), rate(0.5), rate(1)];
    expect(none).toBeLessThan(half);
    expect(half).toBeLessThan(full);
  });

  it('the stat tracker cuts the run into five sprays with the per-bullet trace: impact, pull and the required counter-pull', () => {
    const o = play(1, 80, 2);
    const s = o.stats;
    expect(s.sprays).toHaveLength(5);
    expect(s.sprays.map((r) => r.distanceM)).toEqual([12, 20, 28, 12, 20]);
    for (const r of s.sprays) {
      expect(r.burst).toBe(30);
      expect(r.trace).toHaveLength(30);
      expect(r.trace[0]).toMatchObject({ index: 0, impactXDeg: expect.any(Number) });
      // The first bullet is the baseline: nothing pulled, nothing required yet.
      expect(r.trace[0]!.pullYDeg).toBe(0);
      expect(r.trace[0]!.requiredPullYDeg).toBeCloseTo(0, 9);
    }
    // Recoil kicks up, so the required pull is down (negative) and grows with the bullet index.
    const t = s.sprays[0]!.trace;
    expect(t[10]!.requiredPullYDeg).toBeLessThan(-2.5);
    expect(t[29]!.requiredPullYDeg).toBeLessThan(t[10]!.requiredPullYDeg);
    // The perfect bot's actual pull follows the required one.
    expect(Math.abs(t[20]!.pullYDeg - t[20]!.requiredPullYDeg)).toBeLessThan(0.35);
    expect(s.sprayHitRateByIndex).toHaveLength(30);
    expect(s.sprayPullFallsApartIndex).toBeNull();
    // A bot that never pulls: pull stays ~0, impacts climb, and the hit rate collapses part-way through.
    const n = play(0, 80, 2).stats;
    expect(Math.abs(n.sprays[0]!.trace[20]!.pullYDeg)).toBeLessThan(0.05);
    expect(n.sprays[0]!.trace[20]!.impactYDeg).toBeGreaterThan(3);
    expect(n.sprayCollapseIndex).not.toBeNull();
    expect(n.sprayCollapseIndex!).toBeGreaterThan(0);
    expect(n.sprayCollapseIndex!).toBeLessThan(15);
    expect(n.sprayPullFallsApartIndex).not.toBeNull();
  });

  it('the Post survives the whole spray (a durable target) and the run is deterministic for a seed', () => {
    const a = play(1, 80, 3);
    const b = play(1, 80, 3);
    expect(a.stats.kills).toBe(0);
    expect(b.stats.sprays).toEqual(a.stats.sprays);
    expect(b.ticks).toBe(a.ticks);
  });

  it('a bot that pulls the recoil out exactly lands at least 90% of its bullets on the Post', () => {
    for (const dial of [10, 45, 80]) {
      let hits = 0;
      let burst = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const o = play(1, dial, seed);
        expect(o.phase).toBe('result');
        expect(o.sprays).toBe(5);
        hits += o.hits;
        burst += o.burst;
      }
      expect(hits / burst, `dial ${dial}`).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('a bot that never pulls lands under 50% of its bullets over a full-magazine spray (dial above 60)', () => {
    // Short bursts need almost no control by the spec's own recoil (a 3-round burst climbs 0.6 degrees,
    // inside the body zone at every distance), so only the full magazine separates the two bots.
    for (const dial of [80]) {
      let hits = 0;
      let burst = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const o = play(0, dial, seed);
        hits += o.hits;
        burst += o.burst;
      }
      expect(hits / burst, `dial ${dial}`).toBeLessThan(0.5);
    }
  });
});
