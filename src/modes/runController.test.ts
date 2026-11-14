import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { secondsToTicks, TICK_RATE } from '../core/time';
import type { FeedbackEvents } from '../feedback/events';
import { computeStats } from '../feedback/statTracker';
import { testRoom } from '../sim/levels';
import type { RunAndSimEvents, TickInput } from '../sim/types';
import { createTickInput } from '../sim/types';
import { World } from '../sim/world';
import { RunController } from './runController';

function setup(seed = 5) {
  const tunables = cloneTunables();
  const world = new World({ level: testRoom, tunables, seed });
  const bus = new EventBus<RunAndSimEvents & FeedbackEvents>();
  const ctl = new RunController(world, bus, tunables.run, tunables.targets);
  const order: string[] = [];
  for (const t of ['runReady', 'runStarted', 'runEnded', 'targetSpawned'] as const) bus.on(t, () => order.push(t));
  const input = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): number => {
    Object.assign(input, patch);
    let ran = 0;
    for (let i = 0; i < n; i++) {
      if (ctl.step(input)) ran++;
      input.jump = false;
    }
    return ran;
  };
  return { tunables, world, bus, ctl, order, input, run };
}

const READY = secondsToTicks(0.8);

describe('run state machine', () => {
  it('starts idle (free play: the world ticks, nothing is recorded)', () => {
    const { ctl, world, run } = setup();
    expect(ctl.state).toBe('idle');
    run(5);
    expect(world.tick).toBe(5);
    expect(ctl.log.events).toHaveLength(0);
  });

  it('ready -> live -> result, with the events in order', () => {
    const { ctl, order, run, world } = setup();
    ctl.startRun({ mode: 'test', seed: 9, dial: 40, durationSec: 2 });
    expect(ctl.state).toBe('ready');
    expect(order).toEqual(['runReady']);
    run(READY - 1);
    expect(ctl.state).toBe('ready');
    run(1);
    expect(ctl.state).toBe('live');
    expect(ctl.liveStartTick).toBe(READY);
    // runStarted, then every living target is announced
    expect(order).toEqual(['runReady', 'runStarted', ...Array.from({ length: world.targetField.aliveCount }, () => 'targetSpawned')]);
    run(2 * TICK_RATE - 1);
    expect(ctl.state).toBe('live');
    run(1);
    expect(ctl.state).toBe('result');
    expect(order.filter((o) => o === 'runEnded')).toHaveLength(1);
    expect(ctl.finalStats?.endReason).toBe('timer');
    expect(ctl.finalStats?.durationSec).toBeCloseTo(2, 9);
  });

  it('the result state freezes the world', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0, durationSec: 1 });
    run(READY + TICK_RATE);
    expect(ctl.state).toBe('result');
    const tick = world.tick;
    const hash = world.hash();
    expect(run(50)).toBe(0);
    expect(world.tick).toBe(tick);
    expect(world.hash()).toBe(hash);
  });

  it('targets are not live and the weapon cannot fire during ready', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    run(READY - 2, { fire: true });
    expect(world.weapon.shots).toBe(0);
    expect(ctl.log.events.filter((e) => e.type === 'shotFired')).toHaveLength(0);
    expect(ctl.log.events.some((e) => e.type === 'targetVisible')).toBe(false);
  });

  it('movement works during ready', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    const z = world.player.pos.z;
    run(40, { moveZ: 1 });
    expect(world.player.pos.z).toBeLessThan(z - 0.5);
  });

  it('endRun(reason) works from ready and live, records the reason, and is a no-op otherwise', () => {
    for (const [reason, ticks] of [['quit', 10], ['death', READY + 30], ['complete', READY + 5]] as const) {
      const { ctl, run } = setup();
      ctl.endRun('quit'); // idle: ignored
      expect(ctl.state).toBe('idle');
      ctl.startRun({ mode: 't', seed: 1, dial: 0 });
      run(ticks);
      ctl.endRun(reason);
      expect(ctl.state).toBe('result');
      expect(ctl.finalStats?.endReason).toBe(reason);
      expect(ctl.log.events[ctl.log.events.length - 1]).toMatchObject({ type: 'runEnded', data: { reason } });
      ctl.endRun('timer'); // already over
      expect(ctl.finalStats?.endReason).toBe(reason);
      expect(ctl.log.events.filter((e) => e.type === 'runEnded')).toHaveLength(1);
    }
  });

  it('a run ended during ready has no live data', () => {
    const { ctl, run } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    run(10);
    ctl.endRun('quit');
    expect(ctl.finalStats?.liveTicks).toBe(0);
    expect(ctl.finalStats?.shots).toBe(0);
  });

  it('uses the default duration and elapsed time counts live seconds only', () => {
    const { ctl, run, tunables } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    expect(ctl.info?.durationSec).toBe(tunables.run.defaultDurationSec);
    expect(ctl.elapsedSec).toBe(0);
    run(READY + TICK_RATE);
    expect(ctl.elapsedSec).toBeCloseTo(1, 9);
  });
});

describe('event order for presentation', () => {
  it('streakUpdated is emitted before later subscribers see the targetKilled that caused it', () => {
    const { ctl, bus, run } = setup();
    const seen: string[] = [];
    bus.on('streakUpdated', (e) => seen.push(`streak${e.streak}`));
    bus.on('targetKilled', () => seen.push('killed')); // like the sound map, subscribed after the controller
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    run(READY + 2);
    run(1, { yaw: 0, pitch: Math.atan2(1.5 - 1.62, 20), fire: true });
    expect(seen).toEqual(['streak1', 'killed']);
  });
});

describe('target expiry', () => {
  it('despawnTarget fires targetExpired once, takes the target down, and the stats record the miss-by-timeout', () => {
    const { ctl, run, world, bus } = setup();
    ctl.startRun({ mode: 't', seed: 1, dial: 0 });
    run(READY + 4);
    const log: string[] = [];
    bus.on('targetExpired', (e) => log.push(`expired${e.targetId}`));
    // A Post straight ahead: one body bullet (39 of 100 HP) leaves it alive, then its exposure runs out.
    const id = world.spawnTarget('post', 0, 0, -8, bus);
    run(2, { yaw: 0, pitch: Math.atan2(1.16 - 1.62, 8) });
    run(1, { fire: true });
    run(1, { fire: false });
    expect(world.targetField.byId(id)).not.toBeNull();
    expect(world.despawnTarget(id, bus)).toBe(true);
    expect(world.despawnTarget(id, bus)).toBe(false); // already gone: no second event
    expect(log).toEqual([`expired${id}`]);
    expect(world.targetField.byId(id)).toBeNull();
    ctl.endRun('complete');
    const t = ctl.finalStats!.targets.find((x) => x.id === id)!;
    expect(t.expired).toBe(true);
    expect(t.killed).toBe(false);
    expect(t.ttkMs).toBeNull();
    expect(t.bullets).toBe(1);
  });
});

describe('instant restart', () => {
  it('returns to ready from the same seed without rebuilding anything', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 'orbit', seed: 77, dial: 33, durationSec: 5 });
    const level = world.level;
    const targets = world.targets;
    const player = world.player;
    run(READY + 200, { moveZ: 1, fire: true });
    expect(world.tick).toBeGreaterThan(READY);
    const hashAfterReset = (() => {
      const w = new World({ level: testRoom, tunables: cloneTunables(), seed: 77 });
      w.live = false;
      return w.hash();
    })();

    expect(ctl.restartRun()).toBe(true);
    expect(ctl.state).toBe('ready');
    expect(world.tick).toBe(0);
    expect(world.seed).toBe(77);
    expect(world.hash()).toBe(hashAfterReset);
    expect(world.level).toBe(level);
    expect(world.targets).toBe(targets);
    expect(world.player).toBe(player);
    expect(ctl.info).toEqual({ mode: 'orbit', seed: 77, dial: 33, durationSec: 5 });
    expect(ctl.finalStats).toBeNull();
    // a fresh log that starts at runReady
    expect(ctl.log.events.map((e) => e.type)).toEqual(['runReady']);
    expect(ctl.tracker.shots).toBe(0);
  });

  it('works from the result state and can take a new seed', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 'm', seed: 1, dial: 10, durationSec: 1 });
    run(READY + TICK_RATE);
    expect(ctl.state).toBe('result');
    expect(ctl.restartRun(2)).toBe(true);
    expect(ctl.state).toBe('ready');
    expect(world.seed).toBe(2);
    expect(run(1)).toBe(1);
  });

  it('does nothing without a run to restart', () => {
    const { ctl } = setup();
    expect(ctl.restartRun()).toBe(false);
    expect(ctl.state).toBe('idle');
  });

  it('is far inside the 250 ms budget (reset only: no scene rebuild, no loading)', () => {
    const { ctl, run, tunables } = setup();
    ctl.startRun({ mode: 'm', seed: 1, dial: 10 });
    run(READY + 500, { fire: true });
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) ctl.restartRun();
    const each = (performance.now() - t0) / 100;
    expect(each).toBeLessThan(tunables.run.restartBudgetMs / 10);
  });

  it('cancel() returns to idle with a reset world', () => {
    const { ctl, run, world } = setup();
    ctl.startRun({ mode: 'm', seed: 3, dial: 10 });
    run(READY + 10);
    ctl.cancel();
    expect(ctl.state).toBe('idle');
    expect(world.tick).toBe(0);
    expect(world.live).toBe(true);
    expect(ctl.log.recording).toBe(false);
  });
});

/** A reproducible "player": a recorded input stream that aims, strafes, fires and jumps. */
function recordStream(ticks: number, seed: number): TickInput[] {
  const rng = new Rng(seed);
  const out: TickInput[] = [];
  let yaw = 0;
  let pitch = 0;
  for (let i = 0; i < ticks; i++) {
    if (i < READY + 150) {
      // Stand still, straight at the first target (it is hit in `live`): guaranteed hits and a kill.
      out.push({ moveX: 0, moveZ: 0, yaw: 0, pitch: Math.atan2(1.5 - 1.62, 20), jump: false, crouch: false, walk: false, fire: true });
      continue;
    }
    if (i % 40 === 0) {
      yaw = rng.range(-0.5, 0.5);
      pitch = rng.range(-0.1, 0.05);
    }
    out.push({
      moveX: i % 97 < 30 ? 1 : i % 97 < 55 ? -1 : 0,
      moveZ: i % 211 < 40 ? 1 : 0,
      yaw, pitch,
      jump: i % 173 === 0,
      crouch: i % 301 > 280,
      walk: false,
      fire: i % 29 < 12,
    });
  }
  return out;
}

function playBack(stream: readonly TickInput[], seed: number) {
  const s = setup(seed);
  s.ctl.startRun({ mode: 'determinism', seed, dial: 50, durationSec: 6 });
  for (const t of stream) s.ctl.step(t);
  return s;
}

describe('determinism', () => {
  const stream = recordStream(READY + 6 * TICK_RATE + 10, 2024);

  it('the same seed and the same input stream give an identical event log (and world hash)', () => {
    const a = playBack(stream, 31337);
    const b = playBack(stream, 31337);
    expect(a.ctl.state).toBe('result');
    const la = JSON.stringify(a.ctl.log.events);
    expect(la).toBe(JSON.stringify(b.ctl.log.events));
    expect(a.world.hash()).toBe(b.world.hash());
    // the log is not trivially empty: it contains shots, hits, kills, edges and samples
    const kinds = new Set(a.ctl.log.events.map((e) => e.type));
    for (const k of ['runReady', 'runStarted', 'runEnded', 'shotFired', 'shotImpact', 'targetHit', 'targetKilled', 'targetSpawned', 'targetVisible', 'aimOnTarget', 'playerStopped']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
    expect(a.ctl.log.truncated).toBe(false);
    // ... and so are the stats computed from it
    expect(computeStats(a.ctl.log)).toEqual(computeStats(b.ctl.log));
  });

  it('a different seed changes the log (the seed really drives the sim)', () => {
    const a = playBack(stream, 1);
    const b = playBack(stream, 2);
    expect(JSON.stringify(a.ctl.log.events)).not.toBe(JSON.stringify(b.ctl.log.events));
  });

  it('a restart from the run seed replays the same log as the first attempt', () => {
    const s = playBack(stream, 4242);
    const first = JSON.stringify(s.ctl.log.events);
    s.ctl.restartRun();
    for (const t of stream) s.ctl.step(t);
    expect(s.ctl.state).toBe('result');
    expect(JSON.stringify(s.ctl.log.events)).toBe(first);
  });

  it("the tracker's per-kill numbers agree with the sim's own kill bookkeeping (targetKilled)", () => {
    const a = playBack(stream, 7);
    const kills = a.ctl.log.events.filter((e) => e.type === 'targetKilled');
    expect(kills.length).toBeGreaterThanOrEqual(1);
    for (const k of kills) {
      if (k.type !== 'targetKilled') continue;
      const t = a.ctl.finalStats!.targets.find((x) => x.id === k.data.targetId)!;
      expect(t.killed).toBe(true);
      expect(t.ttkMs ?? 0).toBeCloseTo(k.data.ttkMs, 6);
      expect(t.rtMs ?? 0).toBeCloseTo(k.data.rtMs, 6);
      expect(t.bullets).toBe(k.data.bullets);
      expect(t.firstBullet).toBe(k.data.firstBullet);
      expect(t.clean).toBe(k.data.clean);
    }
  });

  it('the live tracker and a replay of the log agree exactly', () => {
    const a = playBack(stream, 99);
    expect(a.ctl.finalStats).toEqual(computeStats(a.ctl.log));
    expect(a.ctl.finalStats!.shots).toBeGreaterThan(10);
  });
});
