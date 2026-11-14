import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import type { RunEvents } from '../sim/runEvents';
import type { HitZone, SimEvents, TargetKind } from '../sim/types';
import type { LoggedEvent, RunLog } from './eventLog';
import { StatTracker, computeStats } from './statTracker';

const MS = TICK_DT * 1000;

/** Small DSL that builds a logged run. `live` ticks run from tick 0 to `end`. */
class Log {
  events: LoggedEvent[] = [];
  private shotId = 0;
  constructor(readonly end = 1280) {
    this.events.push({ type: 'runStarted', data: { tick: 0 } });
  }
  spawn(tick: number, id: number, kind: TargetKind = 'post'): this {
    this.events.push({ type: 'targetSpawned', data: { tick, t: 0, targetId: id, kind, pos: vec3(), tags: [] } });
    return this;
  }
  visible(tick: number, id: number, preAimDeg = 30, dYawDeg = 30, dPitchDeg = 0): this {
    this.events.push({ type: 'targetVisible', data: { tick, t: 0, targetId: id, preAim: preAimDeg * DEG2RAD, dYaw: dYawDeg * DEG2RAD, dPitch: dPitchDeg * DEG2RAD } });
    return this;
  }
  /** A shot. `at` = nearest visible target and the angle to it; `hit` adds the impact (+ kill). */
  shot(
    tick: number,
    o: {
      at?: number; errDeg?: number; moving?: boolean; recoil?: number; yaw?: number; pitch?: number;
      dYawDeg?: number; dPitchDeg?: number; hit?: number; zone?: HitZone; kill?: boolean; kind?: TargetKind;
      dirYawDeg?: number; dirPitchDeg?: number;
    } = {},
  ): this {
    const id = ++this.shotId;
    const yaw = o.yaw ?? 0;
    const pitch = o.pitch ?? 0;
    const dir = directionFromAngles(vec3(), o.dirYawDeg !== undefined ? o.dirYawDeg * DEG2RAD : yaw, (o.dirPitchDeg ?? 0) * DEG2RAD);
    this.events.push({
      type: 'shotFired',
      data: {
        tick, t: 0, shotId: id, weapon: 'kestrel', origin: vec3(), dir, yaw, pitch, moving: o.moving ?? false, speed: 0,
        airborne: false, crouching: false, spreadDeg: 0, recoilIndex: o.recoil ?? 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: -1,
        aimTargetId: o.at ?? -1, aimErr: (o.errDeg ?? 0) * DEG2RAD,
        aimDYaw: (o.dYawDeg ?? 0) * DEG2RAD, aimDPitch: (o.dPitchDeg ?? 0) * DEG2RAD,
      },
    });
    const hit = o.hit ?? -1;
    this.events.push({
      type: 'shotImpact',
      data: {
        tick, t: 0, shotId: id, result: hit >= 0 ? 'hit' : 'miss', onTarget: hit >= 0, targetId: hit,
        zone: hit >= 0 ? (o.zone ?? 'body') : null, damage: hit >= 0 ? 34 : 0, killed: !!o.kill,
        point: vec3(), normal: vec3(), distance: 10,
      },
    });
    if (o.kill && hit >= 0) {
      // The sim's own derived fields are not used by the tracker (it derives them from the raw events).
      this.events.push({
        type: 'targetKilled',
        data: {
          tick, t: 0, targetId: hit, kind: o.kind ?? 'post', zone: o.zone ?? 'body', point: vec3(), distance: 10,
          ttkMs: 0, rtMs: 0, firstBullet: false, bullets: 0, clean: false,
        },
      });
    }
    return this;
  }
  expire(tick: number, id: number): this {
    this.events.push({ type: 'targetExpired', data: { tick, t: 0, targetId: id, kind: 'post' } });
    return this;
  }
  aim(tick: number, on: boolean, id = 0): this {
    this.events.push({ type: 'aimOnTarget', data: { tick, on, id } });
    return this;
  }
  head(tick: number, errDeg: number): this {
    this.events.push({ type: 'headHeightSampled', data: { tick, err: errDeg * DEG2RAD } });
    return this;
  }
  stop(tick: number, latencyMs: number): this {
    this.events.push({ type: 'playerStopped', data: { tick, latencyMs } });
    return this;
  }
  finish(reason: 'timer' | 'quit' = 'timer'): RunLog {
    this.events.push({ type: 'runEnded', data: { tick: this.end, t: this.end / 128, reason } });
    return { mode: 'test', seed: 7, dial: 40, events: this.events, truncated: false };
  }
}

const stats = (l: Log) => computeStats(l.finish());

describe('computeStats: counters and rates', () => {
  it('an empty run has no data, not fake zeros', () => {
    const s = stats(new Log(1280));
    expect(s.shots).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.headshotRate).toBeNull();
    expect(s.medianRtMs).toBeNull();
    expect(s.medianTtkMs).toBeNull();
    expect(s.medianStopLatencyMs).toBeNull();
    expect(s.preAimErrorDeg).toBeNull();
    expect(s.headHeightDisciplineDeg).toBeNull();
    expect(s.flickErrorBiasDeg).toBeNull();
    expect(s.kills).toBe(0);
    expect(s.maxChain).toBe(0);
    expect(s.liveTicks).toBe(1280);
    expect(s.durationSec).toBeCloseTo(10, 9);
    expect(s.timeOnTarget).toBe(0);
    expect(s.sprayBursts).toEqual([]);
    expect(s.endReason).toBe('timer');
  });

  it('accuracy = hits / shots and headshot rate = head hits / hits', () => {
    const l = new Log()
      .spawn(0, 0).visible(1, 0)
      .shot(100, { at: 0, hit: 0, zone: 'head' })
      .shot(110, { at: 0, hit: 0, zone: 'body' })
      .shot(120, { at: 0, hit: 0, zone: 'head' })
      .shot(130, { at: 0, errDeg: 0.5 });
    const s = stats(l);
    expect(s.shots).toBe(4);
    expect(s.hits).toBe(3);
    expect(s.misses).toBe(1);
    expect(s.accuracy).toBeCloseTo(0.75, 9);
    expect(s.headHits).toBe(2);
    expect(s.bodyHits).toBe(1);
    expect(s.headshotRate).toBeCloseTo(2 / 3, 9);
  });

  it('shots with no hits: accuracy 0, headshot rate null', () => {
    const s = stats(new Log().shot(50).shot(60));
    expect(s.accuracy).toBe(0);
    expect(s.headshotRate).toBeNull();
  });

  it('ignores events before runStarted and after runEnded', () => {
    const stray = (tick: number): LoggedEvent[] => new Log().shot(tick, { hit: 0, moving: true }).events.slice(1); // shotFired + shotImpact
    const l = new Log();
    l.events.unshift(...stray(5));
    const done = l.finish();
    const s = computeStats({ ...done, events: [...done.events, ...stray(1300)] });
    expect(s.shots).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.movingShots).toBe(0);
  });

  it('counts moving shots from the flag set at fire time', () => {
    const s = stats(new Log().shot(10, { moving: true }).shot(20).shot(30, { moving: true }));
    expect(s.movingShots).toBe(2);
  });
});

describe('computeStats: reaction time and time to kill', () => {
  it('RT = visible -> first shot aimed within 5 degrees', () => {
    const l = new Log().spawn(0, 0).visible(100, 0)
      .shot(110, { at: 0, errDeg: 9 }) // wild: not aimed
      .shot(126, { at: 0, errDeg: 4.9, hit: 0, kill: true });
    const t = stats(l).targets[0]!;
    expect(t.rtMs).toBeCloseTo(26 * MS, 6);
  });

  it('a shot outside the 5 degree cone is not an RT shot; no aimed shot = null', () => {
    const t = stats(new Log().spawn(0, 0).visible(10, 0).shot(50, { at: 0, errDeg: 5.1 }).expire(200, 0)).targets[0]!;
    expect(t.rtMs).toBeNull();
  });

  it('median RT over targets', () => {
    const l = new Log()
      .spawn(0, 0).visible(10, 0).shot(20, { at: 0, errDeg: 0.2, hit: 0, kill: true }) // 10 ticks
      .spawn(0, 1).visible(100, 1).shot(140, { at: 1, errDeg: 0.2, hit: 1, kill: true }) // 40
      .spawn(0, 2).visible(200, 2).shot(270, { at: 2, errDeg: 0.2, hit: 2, kill: true }); // 70
    expect(stats(l).medianRtMs).toBeCloseTo(40 * MS, 6);
  });

  it('TTK = first shot at the target (hit or within 1 degree) -> death', () => {
    const l = new Log().spawn(0, 0).visible(10, 0)
      .shot(100, { at: 0, errDeg: 1.5 }) // too far off to count as "at it"
      .shot(120, { at: 0, errDeg: 0.8 }) // first engagement (a miss within 1 degree)
      .shot(140, { at: 0, errDeg: 0.1, hit: 0 })
      .shot(160, { at: 0, errDeg: 0.1, hit: 0, kill: true });
    const t = stats(l).targets[0]!;
    expect(t.ttkMs).toBeCloseTo(40 * MS, 6);
    expect(t.bullets).toBe(3);
    expect(t.killed).toBe(true);
  });

  it('a one-bullet kill has a TTK of 0 and is a first-bullet kill', () => {
    const t = stats(new Log().spawn(0, 0).visible(10, 0).shot(60, { at: 0, errDeg: 0.1, hit: 0, kill: true })).targets[0]!;
    expect(t.ttkMs).toBe(0);
    expect(t.firstBullet).toBe(true);
  });

  it('median TTK ignores targets that were not killed', () => {
    const l = new Log()
      .spawn(0, 0).visible(1, 0).shot(10, { at: 0, errDeg: 0.1, hit: 0 }).shot(30, { at: 0, errDeg: 0.1, hit: 0, kill: true }) // 20 ticks
      .spawn(0, 1).visible(1, 1).shot(40, { at: 1, errDeg: 0.1, hit: 1 }).shot(100, { at: 1, errDeg: 0.1, hit: 1, kill: true }) // 60
      .spawn(0, 2).visible(1, 2).shot(200, { at: 2, errDeg: 0.1, hit: 2 }).expire(900, 2); // never dies
    const s = stats(l);
    expect(s.medianTtkMs).toBeCloseTo(40 * MS, 6);
    expect(s.kills).toBe(2);
  });
});

describe('computeStats: edge case, first bullet at a target that expires', () => {
  const l = (): Log => new Log().spawn(0, 0).visible(100, 0)
    .shot(130, { at: 0, errDeg: 0.4 }) // first (and only) bullet at it: a miss within 1 degree
    .expire(160, 0); // the Post leaves 0.25 s later

  it('keeps RT, counts the bullet as a miss, has no TTK, and is not a kill', () => {
    const s = stats(l());
    const t = s.targets[0]!;
    expect(t.rtMs).toBeCloseTo(30 * MS, 6);
    expect(t.ttkMs).toBeNull();
    expect(t.bullets).toBe(1);
    expect(t.misses).toBe(1);
    expect(t.killed).toBe(false);
    expect(t.expired).toBe(true);
    expect(s.medianTtkMs).toBeNull();
    expect(s.kills).toBe(0);
    expect(s.accuracy).toBe(0);
  });

  it('breaks the clean streak', () => {
    const log = new Log()
      .spawn(0, 0).visible(1, 0).shot(10, { at: 0, errDeg: 0, hit: 0, kill: true })
      .spawn(0, 1).visible(20, 1).shot(30, { at: 1, errDeg: 0.4 }).expire(60, 1);
    const s = stats(log);
    expect(s.maxCleanStreak).toBe(1);
    expect(s.cleanStreak).toBe(0);
  });

  it('a target that expires without ever being shot at or seen leaves no record', () => {
    const s = stats(new Log().spawn(0, 0).expire(50, 0));
    expect(s.targets).toEqual([]);
  });

  it('a target still alive at run end appears as unresolved', () => {
    const s = stats(new Log().spawn(0, 0).visible(5, 0));
    expect(s.targets).toHaveLength(1);
    expect(s.targets[0]!.killed).toBe(false);
    expect(s.targets[0]!.expired).toBe(false);
  });
});

describe('computeStats: clean kill, chain and streak', () => {
  it('clean = no missed shot at it and no moving shot', () => {
    const l = new Log()
      .spawn(0, 0).visible(1, 0).shot(10, { at: 0, errDeg: 0, hit: 0, kill: true }) // clean
      .spawn(0, 1).visible(1, 1).shot(20, { at: 1, errDeg: 0.3 }).shot(30, { at: 1, errDeg: 0, hit: 1, kill: true }) // a miss at it
      .spawn(0, 2).visible(1, 2).shot(40, { at: 2, errDeg: 0, hit: 2, kill: true, moving: true }); // moving
    const s = stats(l);
    expect(s.kills).toBe(3);
    expect(s.cleanKills).toBe(1);
    expect(s.targets.map((t) => t.clean)).toEqual([true, false, false]);
  });

  it('a miss at nothing does not spoil a kill', () => {
    const l = new Log().spawn(0, 0).visible(1, 0).shot(5).shot(10, { at: 0, errDeg: 0, hit: 0, kill: true });
    expect(stats(l).cleanKills).toBe(1);
  });

  it('chain counts kills each within 1.5 s of the previous one', () => {
    const k = (l: Log, tick: number, id: number): Log =>
      l.spawn(0, id).visible(1, id).shot(tick, { at: id, errDeg: 0, hit: id, kill: true });
    let l = new Log(4000);
    l = k(l, 100, 0); // chain 1
    l = k(l, 250, 1); // +150 ticks (1.17 s): chain 2
    l = k(l, 440, 2); // +190 ticks (1.48 s): chain 3
    l = k(l, 640, 3); // +200 ticks (1.56 s): chain breaks, 1
    expect(stats(l).maxChain).toBe(3);
    const tr = new StatTracker();
    tr.reset();
    for (const e of l.finish().events) tr.consume(e);
    expect(tr.chain).toBe(1);
  });

  it('clean streak counts consecutive clean kills and resets on a non-clean one', () => {
    const clean = (l: Log, t: number, id: number): Log => l.spawn(0, id).visible(1, id).shot(t, { at: id, errDeg: 0, hit: id, kill: true });
    const dirty = (l: Log, t: number, id: number): Log => l.spawn(0, id).visible(1, id).shot(t - 2, { at: id, errDeg: 0.2 }).shot(t, { at: id, errDeg: 0, hit: id, kill: true });
    let l = new Log(4000);
    l = clean(l, 10, 0); l = clean(l, 20, 1); l = clean(l, 30, 2); l = dirty(l, 40, 3); l = clean(l, 50, 4);
    const s = stats(l);
    expect(s.maxCleanStreak).toBe(3);
    expect(s.cleanStreak).toBe(1);
  });
});

describe('computeStats: positional and timing stats', () => {
  it('time on target = on-target ticks / live ticks, closing an open interval at the end', () => {
    const l = new Log(200).aim(20, true, 0).aim(70, false, 0).aim(150, true, 1);
    // 50 ticks + (200 - 150) open at the end = 100 of 200
    expect(stats(l).timeOnTarget).toBeCloseTo(0.5, 9);
  });

  it('switching target while on target does not double count', () => {
    const l = new Log(100).aim(10, true, 0).aim(40, true, 1).aim(60, false, 1);
    expect(stats(l).timeOnTarget).toBeCloseTo(0.5, 9);
  });

  it('stop latency is the median of stop events', () => {
    const s = stats(new Log().stop(50, 90).stop(120, 140).stop(200, 100));
    expect(s.medianStopLatencyMs).toBe(100);
    expect(s.stopCount).toBe(3);
  });

  it('head-height discipline = mean absolute vertical error, in degrees', () => {
    const s = stats(new Log().head(10, 1).head(20, 3).head(30, 2));
    expect(s.headHeightDisciplineDeg).toBeCloseTo(2, 9);
    expect(s.headHeightSamples).toBe(3);
  });

  it('pre-aim error is the median of the aim error when each target became visible', () => {
    const l = new Log().spawn(0, 0).visible(5, 0, 10).spawn(0, 1).visible(6, 1, 40).spawn(0, 2).visible(7, 2, 25);
    expect(stats(l).preAimErrorDeg).toBeCloseTo(25, 9);
  });

  it('flick error: overshoot is positive, undershoot negative, along the flick axis', () => {
    // The target appeared 20 deg to the left (+yaw). Shot taken with the crosshair 3 deg past it.
    const over = stats(new Log().spawn(0, 0).visible(5, 0, 20, 20, 0)
      .shot(30, { at: 0, errDeg: 3, dYawDeg: -3, dPitchDeg: 0, hit: 0, kill: true })).targets[0]!;
    expect(over.flickErrorDeg).toBeCloseTo(3, 6);
    const under = stats(new Log().spawn(0, 0).visible(5, 0, 20, 20, 0)
      .shot(30, { at: 0, errDeg: 2, dYawDeg: 2, dPitchDeg: 0, hit: 0, kill: true })).targets[0]!;
    expect(under.flickErrorDeg).toBeCloseTo(-2, 6);
    // Vertical flick (target above): the axis is pitch.
    const up = stats(new Log().spawn(0, 0).visible(5, 0, 15, 0, 15)
      .shot(30, { at: 0, errDeg: 1, dYawDeg: 0, dPitchDeg: 1, hit: 0, kill: true })).targets[0]!;
    expect(up.flickErrorDeg).toBeCloseTo(-1, 6);
  });

  it('flick error is only defined for real flicks, and aggregates as bias and mean absolute', () => {
    const l = new Log()
      .spawn(0, 0).visible(5, 0, 0.5, 0.5, 0).shot(20, { at: 0, errDeg: 0.1, dYawDeg: 0.1, hit: 0, kill: true }) // pre-aimed: no flick
      .spawn(0, 1).visible(5, 1, 20, 20, 0).shot(20, { at: 1, errDeg: 4, dYawDeg: -4, hit: 1, kill: true }) // +4
      .spawn(0, 2).visible(5, 2, 20, 20, 0).shot(20, { at: 2, errDeg: 2, dYawDeg: 2, hit: 2, kill: true }); // -2
    const s = stats(l);
    expect(s.targets[0]!.flickErrorDeg).toBeNull();
    expect(s.flickCount).toBe(2);
    expect(s.flickErrorBiasDeg).toBeCloseTo(1, 6);
    expect(s.flickErrorMeanAbsDeg).toBeCloseTo(3, 6);
  });
});

describe('computeStats: spray trace', () => {
  it('lists each burst with per-bullet impact offset and mouse pull from the first bullet', () => {
    const l = new Log()
      .shot(10, { recoil: 0, yaw: 0, pitch: 0, dirYawDeg: 0, dirPitchDeg: 0, hit: 0 })
      .shot(20, { recoil: 1, yaw: 0, pitch: -1 * DEG2RAD, dirYawDeg: 0.5, dirPitchDeg: 2 })
      .shot(30, { recoil: 2, yaw: 0.2 * DEG2RAD, pitch: -3 * DEG2RAD, dirYawDeg: -0.5, dirPitchDeg: 1 })
      .shot(400, { recoil: 0 }); // a new burst
    const s = stats(l);
    expect(s.sprayBursts).toHaveLength(2);
    const b = s.sprayBursts[0]!;
    expect(b.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(b[0]).toMatchObject({ impactYawDeg: 0, impactPitchDeg: 0, pullYawDeg: 0, pullPitchDeg: 0, hit: true });
    expect(b[1]!.impactPitchDeg).toBeCloseTo(2, 6);
    expect(b[1]!.pullPitchDeg).toBeCloseTo(-1, 6);
    expect(b[1]!.hit).toBe(false);
    expect(b[2]!.pullYawDeg).toBeCloseTo(0.2, 6);
    expect(b[2]!.pullPitchDeg).toBeCloseTo(-3, 6);
    expect(s.sprayBursts[1]).toHaveLength(1);
  });
});

describe('StatTracker live use', () => {
  it('follows the bus live and ends up exactly where a replay of the same events does', () => {
    const bus = new EventBus<SimEvents & RunEvents>();
    const live = new StatTracker();
    live.reset('m', 1, 2);
    live.attach(bus);

    const l = new Log().spawn(0, 0).visible(1, 0).shot(10, { at: 0, errDeg: 0.2 }).shot(20, { at: 0, errDeg: 0, hit: 0, kill: true })
      .spawn(0, 1).visible(1, 1).shot(30, { at: 1, errDeg: 0, hit: 1, kill: true }).expire(31, 5); // never seen: not a miss
    const log = l.finish();
    for (const e of log.events) bus.emit(e.type, e.data as never);

    expect(live.accuracy).toBeCloseTo(2 / 3, 9);
    expect(live.kills).toBe(2);
    expect(live.chain).toBe(2);
    expect(live.streak).toBe(1);
    const replay = computeStats({ ...log, mode: 'm', seed: 1, dial: 2 });
    expect(live.result()).toEqual(replay);
  });
});
