import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { secondsToTicks, TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import type { ModeDef } from './modeDef';
import { createSpawnQuery } from './scheduler';
import { makeHarness, ringAnchors } from './testHarness';
import { testMode } from './testMode';

/** A bare mode: no targets of its own, the test spawns and resolves them by hand. */
function bareMode(over: Partial<ModeDef<null>> = {}): ModeDef<null> {
  return {
    id: 'bare', skills: ['flick', 'precision'], map: 'range', weapon: 'pace', durationSec: 20, axes: ['exposureSec', 'distance'], waveCurve: [0],
    setup: () => null, tick: () => undefined, onEvent: () => undefined, ...over,
  };
}

const READY = secondsToTicks(0.8);
const far = (): ReturnType<typeof vec3> => vec3(0, 0, -10);

describe('run timing', () => {
  it('ready (0.8 s) -> live -> result at the duration, with events at each boundary', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ durationSec: 2 }), { seed: 1 });
    expect(h.runner.phase).toBe('ready');
    expect(h.events('runReady')).toEqual([{ tick: 0, mode: 'bare', seed: 1, dial: 50 }]);
    h.step(READY - 1);
    expect(h.runner.phase).toBe('ready');
    h.step(1);
    expect(h.runner.phase).toBe('live');
    expect(h.events('runStarted')).toHaveLength(1);
    h.step(2 * 128 - 2); // the tick that starts the run is its first live tick
    expect(h.runner.phase).toBe('live');
    h.step(1);
    expect(h.runner.phase).toBe('result');
    expect(h.runner.endReason).toBe('timer');
    const ended = h.events('runEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.reason).toBe('timer');
    expect(ended[0]!.t).toBeCloseTo(2, 9);
    h.step(500); // nothing more happens after the result
    expect(h.events('runEnded')).toHaveLength(1);
  });

  it('the player dying ends the run with reason death, once; outside a run it does nothing', () => {
    const h = makeHarness();
    h.bus.emit('playerDied', { tick: 1 }); // idle: no run to end
    expect(h.events('runEnded')).toHaveLength(0);
    h.runner.begin(bareMode({ durationSec: Infinity }), { seed: 1 });
    h.step(READY + 10);
    h.bus.emit('playerDied', { tick: h.simTick });
    h.bus.emit('playerDied', { tick: h.simTick });
    expect(h.runner.phase).toBe('result');
    expect(h.runner.endReason).toBe('death');
    expect(h.events('runEnded')).toHaveLength(1);
    expect(h.events('runEnded')[0]!.reason).toBe('death');
  });

  it('ignores sim facts outside the live phase', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.kill(1);
    h.miss();
    expect(h.events('scoreAwarded')).toHaveLength(0);
    expect(h.runner.stats.misses).toBe(0);
  });

  it('a mode can end the run itself, and begin() restarts cleanly', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ durationSec: Infinity, tick: (c) => { if (c.liveTick === 10) c.end('complete'); } }), { seed: 3 });
    h.step(READY + 20);
    expect(h.runner.phase).toBe('result');
    expect(h.runner.endReason).toBe('complete');
    h.runner.begin(bareMode(), { seed: 4 });
    expect(h.runner.phase).toBe('ready');
    expect(h.runner.stats.score).toBe(0);
    expect(h.runner.endReason).toBeNull();
  });

  it('exposes elapsed and remaining time to the mode', () => {
    const h = makeHarness();
    const seen: number[] = [];
    h.runner.begin(bareMode({ durationSec: 5, tick: (c) => { if (c.liveTick === 128) seen.push(c.timeSec, c.remainingSec); } }), { seed: 1 });
    h.step(READY + 200);
    expect(seen[0]).toBeCloseTo(1, 9);
    expect(seen[1]).toBeCloseTo(4, 9);
  });
});

describe('beats and the dial', () => {
  it('asks dialFor once per beat, at the boundary, and applies axes only then', () => {
    const h = makeHarness();
    const axesSeen: number[] = [];
    let bump = 0;
    h.runner.begin(
      bareMode({ durationSec: 35, beatSec: 10, waveCurve: [0, 10, 20, 30], tick: (c) => { axesSeen.push(c.axes.exposureSec!); bump++; } }),
      { seed: 1 },
    );
    expect(h.dialCalls).toEqual([0]); // beat 0 is applied when the run is readied
    h.step(READY + 10 * 128 - 1);
    expect(h.dialCalls).toEqual([0]); // not yet
    const before = axesSeen[axesSeen.length - 1]!;
    expect(new Set(axesSeen).size).toBe(1); // constant through the whole first beat
    h.step(1);
    expect(h.dialCalls).toEqual([0, 1]);
    expect(h.runner.beat).toBe(1);
    expect(h.runner.dial).toBe(60);
    expect(axesSeen[axesSeen.length - 1]).toBeLessThan(before); // exposure shrank with the harder dial
    h.step(25 * 128);
    expect(h.dialCalls).toEqual([0, 1, 2, 3]);
    expect(bump).toBeGreaterThan(0);
    const beats = h.events('beatStarted');
    expect(beats.map((b) => b.beat)).toEqual([0, 1, 2, 3]);
    expect(beats.map((b) => b.dial)).toEqual([50, 60, 70, 80]);
    expect(beats[1]!.t).toBeCloseTo(10, 9);
  });

  it('axis values never change between boundaries, even if the dial module would answer differently', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ beatSec: 10 }), { seed: 1 });
    const frozen = { ...h.runner.axes };
    h.step(READY + 5 * 128);
    expect({ ...h.runner.axes }).toEqual(frozen);
  });

  it('manual beats (Sweep-style): only advanceBeat() moves the dial', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ beatSec: null, durationSec: 60, waveCurve: [0, -5] }), { seed: 1 });
    h.step(READY + 30 * 128);
    expect(h.runner.beat).toBe(0);
    h.runner.advanceBeat();
    expect(h.runner.beat).toBe(1);
    expect(h.runner.dial).toBe(45);
    expect(h.dialCalls).toEqual([0, 1]);
  });

  it('a pinned dial bypasses the skill model entirely', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ beatSec: 5 }), { seed: 1, pinDial: 73 });
    h.step(READY + 12 * 128);
    expect(h.dialCalls).toEqual([]);
    expect(h.runner.dial).toBe(73);
    expect(h.events('beatStarted').map((b) => b.dial)).toEqual([73, 73, 73]);
  });

  it('clamps the dial to 0..100', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ waveCurve: [500] }), { seed: 1 });
    expect(h.runner.dial).toBe(100);
  });

  it('defaults to the drill wave curve and the dial module beat length', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ beatSec: undefined, waveCurve: undefined, durationSec: 25 }), { seed: 1 });
    h.step(READY + 21 * 128);
    expect(h.events('beatStarted').map((b) => b.beat)).toEqual([0, 1, 2]);
    expect(h.events('beatStarted').map((b) => b.dial)).toEqual([42, 47, 50]); // base 50 + drill [-8, -3, 0]
  });
});

describe('skillTrial per resolved target', () => {
  it('a kill is a success; difficulty is derived from the axes in force', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ axes: ['exposureSec', 'distance'] }), { seed: 1, pinDial: 70 });
    h.step(READY);
    const id = h.runner.spawn('post', far());
    h.kill(id, { rtMs: 231 });
    const t = h.events('skillTrial');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ skill: 'flick', success: true, rtMs: 231 });
    expect(t[0]!.itemDifficulty as number).toBeCloseTo(70, 3);
  });

  it('item difficulty follows the axes the mode uses, not unrelated ones', () => {
    const h = makeHarness({ a: { at0: 0, at100: 10 }, b: { at0: 0, at100: 10 } }, 80);
    h.runner.begin(bareMode({ axes: ['a'] }), { seed: 1 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()));
    expect(h.events('skillTrial')[0]!.itemDifficulty as number).toBeCloseTo(80, 3);
  });

  it('an item keeps the difficulty of the beat it spawned in', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ beatSec: 10, waveCurve: [0, 20] }), { seed: 1 });
    h.step(READY);
    const id = h.runner.spawn('post', far());
    h.step(10 * 128); // next beat: dial 70
    h.kill(id);
    expect(h.events('skillTrial')[0]!.itemDifficulty as number).toBeCloseTo(50, 3);
    h.kill(h.runner.spawn('post', far()));
    expect(h.events('skillTrial')[1]!.itemDifficulty as number).toBeCloseTo(70, 3);
  });

  it('lifetime expiry despawns, fails the trial and tells the mode', () => {
    const h = makeHarness();
    const told: number[] = [];
    h.runner.begin(bareMode({ onEvent: (_c, ev) => { if (ev.type === 'targetExpired') told.push(ev.payload.targetId); } }), { seed: 1 });
    h.step(READY);
    const id = h.runner.spawn('post', far(), { lifetimeSec: 1 });
    h.step(128); // up for exactly 1 s of ticks
    expect(h.targets.has(id)).toBe(true);
    h.step(1);
    expect(h.targets.has(id)).toBe(false);
    expect(told).toEqual([id]);
    expect(h.events('skillTrial')).toMatchObject([{ success: false }]);
    expect(h.events('skillTrial')).toHaveLength(1);
  });

  it('the sim reporting targetExpired is handled the same way', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    const id = h.runner.spawn('post', far());
    h.bus.emit('targetExpired', { tick: h.simTick, targetId: id });
    expect(h.events('skillTrial')).toMatchObject([{ success: false }]);
  });

  it('a mode can decide the trial itself, once, with its own skill and extra data', () => {
    const h = makeHarness();
    h.runner.begin(
      bareMode({ onEvent: (c, ev) => { if (ev.type === 'targetKilled') c.resolveTrial(ev.payload.targetId, ev.payload.firstBullet, { extra: { flickErrorDeg: -1.5 } }); } }),
      { seed: 1 },
    );
    h.step(READY);
    h.kill(h.runner.spawn('post', far(), { skill: 'footwork' }), { firstBullet: false });
    const t = h.events('skillTrial');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ skill: 'footwork', success: false, extra: { flickErrorDeg: -1.5 } });
  });

  it('resolveTrial is once-only and unknown ids are refused', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    const id = h.runner.spawn('post', far());
    expect(h.runner.resolveTrial(id, false)).toBe(true);
    expect(h.runner.resolveTrial(id, true)).toBe(false);
    expect(h.runner.resolveTrial(999, true)).toBe(false);
    expect(h.runner.stats).toMatchObject({ trials: 1, trialsWon: 0 });
  });

  it('kills of targets the mode did not spawn still produce a trial', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    h.kill(77);
    expect(h.events('skillTrial')).toHaveLength(1);
  });
});

describe('fairness floors on spawn', () => {
  it('refuses a target closer than 4 m anywhere, or closer than 5 m inside the view cone', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    expect(h.runner.spawn('post', vec3(0, 0, 3.5))).toBe(-1); // behind, 3.6 m from the eye
    expect(h.runner.spawn('post', vec3(0, 0, -4.5))).toBe(-1); // straight ahead, 4.8 m
    expect(h.runner.spawn('post', vec3(0, 0, 4.5))).toBeGreaterThan(0); // behind, 4.8 m: outside the cone
    expect(h.runner.spawn('post', vec3(0, 0, -5))).toBeGreaterThan(0); // ahead, 5.3 m
    expect(h.runner.refusedSpawns).toBe(2);
    expect(h.targets.size).toBe(2);
  });

  it('floors exposure at 0.45 s and scale at the real head size', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    const id = h.runner.spawn('beacon', far(), { lifetimeSec: 0.05, scale: 0.4 });
    expect(h.targets.get(id)!.scale).toBe(1);
    h.step(secondsToTicks(0.45));
    expect(h.targets.has(id)).toBe(true);
    h.step(1);
    expect(h.targets.has(id)).toBe(false);
  });
});

describe('scoring and counters through the runner', () => {
  it('awards the §8.1 score for a kill and keeps the run total', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ parSec: () => 1 }), { seed: 1, pinDial: 75 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()), { zone: 'head', firstBullet: true, ttkMs: 500 });
    // 100 base × 1.875 precision × 1.25 speed × 1.0 streak (none earned yet) × 2.0 difficulty
    expect(h.events('scoreAwarded')[0]).toMatchObject({ points: Math.round(100 * 1.875 * 1.25 * 2), total: Math.round(100 * 1.875 * 1.25 * 2), base: 100 });
    h.kill(h.runner.spawn('post', far()), { zone: 'body', firstBullet: false, ttkMs: 9000 });
    // second kill: streak of 1 earned going in -> ×1.1
    expect(h.events('scoreAwarded')[1]!.points).toBe(Math.round(100 * 1.1 * 2));
    expect(h.runner.stats.score).toBe(Math.round(100 * 1.875 * 1.25 * 2) + Math.round(100 * 1.1 * 2));
    expect(h.runner.stats).toMatchObject({ kills: 2, headshotKills: 1 });
  });

  it('streak and chain events flow through the bus; chain uses run time', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()));
    h.step(64);
    h.kill(h.runner.spawn('post', far()));
    h.step(64);
    h.kill(h.runner.spawn('post', far()), { clean: false });
    expect(h.events('chainUpdated').map((e) => e.count)).toEqual([1, 2, 3]);
    expect(h.events('streakUpdated').map((e) => e.streak)).toEqual([1, 2, 0]);
    h.step(200);
    expect(h.events('chainUpdated').map((e) => e.count)).toEqual([1, 2, 3, 0]);
  });

  it('a miss or a failed trial breaks the clean streak', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()));
    h.miss();
    expect(h.runner.cleanStreak).toBe(0);
    expect(h.runner.stats.misses).toBe(1);
    h.kill(h.runner.spawn('post', far()));
    expect(h.runner.cleanStreak).toBe(1);
    h.runner.resolveTrial(h.runner.spawn('post', far()), false);
    expect(h.runner.cleanStreak).toBe(0);
  });

  it('missBreaksStreak can be turned off in the tunables', () => {
    const h = makeHarness();
    h.tunables.scoring.missBreaksStreak = false;
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()));
    h.miss();
    expect(h.runner.cleanStreak).toBe(1);
  });

  it('the Surge hook doubles the score', () => {
    const h = makeHarness();
    h.runner.begin(bareMode(), { seed: 1 });
    h.step(READY);
    h.kill(h.runner.spawn('post', far()), { zone: 'body', firstBullet: false, ttkMs: 9000 });
    h.runner.setSurge(true);
    h.kill(h.runner.spawn('post', far()), { zone: 'body', firstBullet: false, ttkMs: 9000, clean: false });
    expect(h.events('scoreAwarded').map((e) => e.points)).toEqual([100, 220]); // ×1.1 streak ×2 surge
  });
});

describe('TestMode', () => {
  it('is a complete mode in under 100 lines', () => {
    const src = readFileSync(new URL('./testMode.ts', import.meta.url), 'utf8');
    expect(src.split('\n').length).toBeLessThan(100);
  });

  /** A bot that kills every target `delay` ticks after it appears; returns the full event log. */
  function playBot(seed: number, delay: number): ReturnType<typeof makeHarness> {
    const h = makeHarness();
    h.runner.begin(testMode, { seed, anchors: { anchors: ringAnchors() } });
    const seen = new Map<number, number>();
    for (let i = 0; i < READY + 31 * 128; i++) {
      h.step(1);
      for (const id of h.targets.keys()) {
        if (!seen.has(id)) seen.set(id, h.simTick);
        else if (h.simTick - seen.get(id)! >= delay) {
          seen.set(id, Infinity);
          h.kill(id, { tick: h.simTick });
          h.targets.delete(id);
        }
      }
    }
    return h;
  }

  it('plays a full 30 s run: targets appear, die, score, and the run ends on the timer', () => {
    const h = playBot(9, 40);
    expect(h.runner.phase).toBe('result');
    expect(h.runner.stats.kills).toBeGreaterThan(30);
    expect(h.runner.stats.score).toBeGreaterThan(0);
    expect(h.events('skillTrial').every((t) => t.success === true && t.skill === 'precision')).toBe(true);
    expect(h.events('beatStarted')).toHaveLength(3); // beats at 0, 10, 20 s
  });

  it('never spawns inside the 3 m floor and keeps exposure above 0.3 s', () => {
    const h = makeHarness();
    h.runner.begin(testMode, { seed: 5, anchors: { anchors: ringAnchors() } });
    const eye = h.runner.scheduler.eyePosition();
    for (let i = 0; i < READY + 20 * 128; i++) {
      h.step(1);
      for (const t of h.targets.values()) expect(Math.hypot(t.pos.x - eye.x, t.pos.z - eye.z)).toBeGreaterThanOrEqual(3);
    }
    expect(h.events('skillTrial').every((t) => t.success === false)).toBe(true); // nobody shot: all expired
  });

  it('is deterministic: same seed and inputs give identical event logs; another seed differs', () => {
    const a = playBot(21, 30).log;
    const b = playBot(21, 30).log;
    const c = playBot(22, 30).log;
    expect(a.length).toBeGreaterThan(100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('a query object can be reused across picks (no per-pick allocation contract)', () => {
    const q = createSpawnQuery('post');
    expect(q).toMatchObject({ kind: 'post', minAngleDeg: 0, maxAngleDeg: 180, refDir: null, aimOffsetY: 0 });
    expect(TICK_DT).toBe(1 / 128);
  });
});

describe('run-shaped modes (Sweep, #201)', () => {
  it('the points multiplier scales kill points; awardPoints pays a non-kill result as scoreAwarded with targetId -1', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ durationSec: Infinity }), { seed: 1 });
    h.step(READY);
    const a = h.runner.spawn('post', far());
    h.kill(a);
    const plain = h.events('scoreAwarded')[0]!.points as number;
    h.runner.setPointsMultiplier(2);
    const b = h.runner.spawn('post', far());
    // Same terms as the first kill except the clean streak, which is now 1.
    h.kill(b);
    const doubled = h.events('scoreAwarded')[1]!;
    // `plain` is already rounded, so allow the rounding of one point.
    expect(Math.abs((doubled.points as number) - plain * 2 * (1 + h.tunables.scoring.streakStep))).toBeLessThanOrEqual(1);
    const before = h.runner.stats.score;
    expect(h.runner.awardPoints(123.4)).toBe(123);
    const award = h.events('scoreAwarded')[2]!;
    expect(award).toMatchObject({ targetId: -1, points: 123, total: before + 123, precision: 1, streak: 1 });
    expect(h.runner.awardPoints(-5)).toBe(0);
    // A new run starts unmultiplied.
    h.runner.begin(bareMode({ durationSec: Infinity }), { seed: 2 });
    expect(h.runner.pointsMultiplier).toBe(1);
  });

  it('onEnd runs before runEnded, while points still count, for every end reason', () => {
    const h = makeHarness();
    const seen: string[] = [];
    h.runner.begin(bareMode({
      durationSec: Infinity,
      onEnd(ctx, reason) {
        seen.push(`${reason}:${ctx.phase}`);
        ctx.awardPoints(10);
        ctx.end('quit'); // ignored: the run is already ending
      },
    }), { seed: 1 });
    h.step(READY);
    h.bus.emit('playerDied', { tick: h.simTick });
    expect(seen).toEqual(['death:live']);
    expect(h.runner.stats.score).toBe(10);
    expect(h.events('runEnded').map((e) => e.reason)).toEqual(['death']);
  });

  it('a placed spawn skips the fairness floors; its card rides on its trial', () => {
    const h = makeHarness();
    h.runner.begin(bareMode({ durationSec: Infinity }), { seed: 1 });
    h.step(READY);
    // Straight ahead at 2 m: refused as a normal spawn, accepted as a placed one.
    expect(h.runner.spawn('post', vec3(0, 0, -2))).toBe(-1);
    const id = h.runner.spawn('post', vec3(0, 0, -2), { placed: true, card: 'take-expected' });
    expect(id).toBeGreaterThan(0);
    h.kill(id);
    expect(h.events('skillTrial')[0]).toMatchObject({ success: true, card: 'take-expected' });
  });

  it('forwards sight, enemy fire and damage facts to the mode only while live', () => {
    const h = makeHarness();
    const types: string[] = [];
    h.runner.begin(bareMode({ durationSec: Infinity, onEvent: (_c, ev) => void types.push(ev.type) }), { seed: 1 });
    h.bus.emit('targetVisible', { tick: 0, targetId: 1 });
    h.step(READY);
    h.bus.emit('targetVisible', { tick: h.simTick, targetId: 1 });
    h.bus.emit('enemySawPlayer', { tick: h.simTick, targetId: 1 });
    h.bus.emit('enemyFired', { tick: h.simTick, id: 1 });
    h.bus.emit('playerDamaged', { tick: h.simTick, amount: 10, absorbed: 5, hp: 90, shield: 45, sourceId: 1 });
    expect(types).toEqual(['targetVisible', 'enemySawPlayer', 'enemyFired', 'playerDamaged']);
  });
});
