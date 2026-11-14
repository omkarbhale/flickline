import { describe, expect, it } from 'vitest';
import { secondsToTicks } from '../core/time';
import { laneMap } from '../sim/mapLoader';
import { TABLE } from './drillSupport';
import type { Harness } from './testHarness';
import { makeHarness } from './testHarness';
import {
  CAUSE_MOVING, CAUSE_NO_COUNTER_STRAFE, CAUSE_NOT_FIRST_BULLET, CAUSE_OK, CAUSE_STANCE, CAUSE_TIMEOUT,
  isArmed, lateralSpeed, stanceRules, stopAndPop,
} from './stopAndPop';

const RUN = 5.4; // Kestrel's equipped run speed
const ARMED = 0.8 * RUN; // 4.32 m/s

/** The Lane as the framework sees it: its anchors and bounds; the player starts at the Lane's spawn, facing down the lane. */
function lane(dial = 50, seed = 1): Harness {
  const h = makeHarness(TABLE, dial);
  h.player.pos.x = laneMap.spawn.pos.x;
  h.player.pos.y = laneMap.spawn.pos.y;
  h.player.pos.z = laneMap.spawn.pos.z;
  h.runner.begin(stopAndPop, { seed, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
  h.step(secondsToTicks(0.8));
  return h;
}

const strafe = (h: Harness, vx: number): void => {
  h.player.vel.x = vx;
  h.player.vel.z = 0;
};

/** Strafe until a trial's target is up (or give up). Returns the ids of the targets. */
function arm(h: Harness, maxTicks = 600): number[] {
  for (let i = 0; i < maxTicks && h.targets.size === 0; i++) {
    strafe(h, ARMED + 0.5);
    h.step(1);
  }
  return [...h.targets.keys()];
}

/** Stop dead: speed zero, the stance as given (the sim would have braked in ~0.1 s). */
const stopped = (h: Harness, crouching = false): void => {
  strafe(h, 0);
  h.player.crouching = crouching;
};

let shotId = 0;
/** One bullet: the sim emits `shotFired` (with the movement snapshot) then `shotImpact`. */
function fire(h: Harness, hit: { id: number; zone?: 'head' | 'body' } | null, moving = false): void {
  const id = ++shotId;
  h.bus.emit('shotFired', {
    tick: h.simTick, shotId: id, moving, speed: Math.hypot(h.player.vel.x, h.player.vel.z), airborne: false, crouching: h.player.crouching,
  });
  h.bus.emit('shotImpact', { tick: h.simTick, shotId: id, onTarget: hit !== null, targetId: hit ? hit.id : -1, zone: hit ? (hit.zone ?? 'head') : null });
}
const killIt = (h: Harness, id: number, rtMs = 300): void => h.kill(id, { zone: 'head', rtMs, kind: 'post' });
const trials = (h: Harness): Record<string, unknown>[] => h.events('skillTrial');
const extra = (e: Record<string, unknown>): Record<string, number> => e.extra as Record<string, number>;

/** Play one whole trial the "right way": arm, stop in the ring's stance, fire the first bullet, kill. */
function playRight(h: Harness): { crouch: boolean; ids: number[] } {
  const ids = arm(h);
  const crouch = ringsShown.at(-1)!.crouch;
  stopped(h, crouch);
  h.step(14);
  for (const id of ids) {
    fire(h, { id });
    killIt(h, id);
    h.targets.delete(id);
  }
  return { crouch, ids };
}

let ringsShown: { slot: number; crouch: boolean; x: number; y: number; z: number }[] = [];
let ringEvents: string[] = [];
function watch(h: Harness): void {
  ringsShown = [];
  ringEvents = [];
  h.bus.on('stanceRingShown', (e) => {
    ringsShown.push({ slot: e.slot, crouch: e.crouch, x: e.x, y: e.y, z: e.z });
    ringEvents.push(`shown${e.slot}`);
  });
  h.bus.on('stanceRingJudged', (e) => ringEvents.push(`judged${e.slot}:${e.ok ? 'ok' : 'bad'}`));
  h.bus.on('stanceRingHidden', (e) => ringEvents.push(`hidden${e.slot}`));
}
function laneWith(dial = 50, seed = 1): Harness {
  // the watchers must exist before the first target; the first target needs an armed player, so wiring after `lane` is early enough
  const h = lane(dial, seed);
  watch(h);
  return h;
}

describe('armed logic (design §4.4: lateral speed >= 80% of the equipped run speed)', () => {
  it('is armed from 80% of the run speed: 4.31 m/s no, 4.33 m/s yes', () => {
    expect(isArmed(4.31, 0, 0, true, RUN, 0.8)).toBe(false);
    expect(isArmed(4.33, 0, 0, true, RUN, 0.8)).toBe(true);
    expect(isArmed(-4.33, 0, 0, true, RUN, 0.8)).toBe(true); // either direction
    expect(isArmed(ARMED, 0, 0, true, RUN, 0.8)).toBe(true); // the boundary is inclusive
    expect(isArmed(ARMED - 1e-9, 0, 0, true, RUN, 0.8)).toBe(false);
  });

  it('only sideways counts: running forward at full speed does not arm, and airborne never does', () => {
    expect(isArmed(0, -RUN, 0, true, RUN, 0.8)).toBe(false);
    expect(isArmed(RUN, 0, 0, false, RUN, 0.8)).toBe(false);
    expect(lateralSpeed(0, -RUN, 0)).toBeCloseTo(0, 9);
  });

  it('sideways is relative to the view: after a quarter turn the world z axis is the strafe axis', () => {
    expect(isArmed(0, -4.33, Math.PI / 2, true, RUN, 0.8)).toBe(true);
    expect(isArmed(4.33, 0, Math.PI / 2, true, RUN, 0.8)).toBe(false);
  });

  it('scales with the equipped run speed (a slower weapon arms at a lower speed)', () => {
    expect(isArmed(4.0, 0, 0, true, 5.0, 0.8)).toBe(true);
    expect(isArmed(4.0, 0, 0, true, 5.4, 0.8)).toBe(false);
  });

  it('a synthetic velocity ramp arms on the first tick at or above 80% and announces it once per edge', () => {
    const h = makeHarness(TABLE, 50);
    const armed: boolean[] = [];
    h.bus.on('laneArmedChanged', (e) => armed.push(e.armed));
    h.runner.begin(stopAndPop, { seed: 2, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
    h.player.pos.z = 14;
    h.step(secondsToTicks(0.8));
    // accelerate 70 m/s^2 like the sim: 4.32 m/s is reached after ceil(4.32 / (70/128)) ticks
    let v = 0;
    let firstArmedAt = -1;
    for (let i = 0; i < 40; i++) {
      v = Math.min(RUN, v + 70 / 128);
      strafe(h, v);
      h.step(1);
      if (armed.length > 0 && firstArmedAt < 0) firstArmedAt = i;
    }
    expect(firstArmedAt).toBe(Math.ceil(ARMED / (70 / 128)) - 1);
    expect(armed).toEqual([true]); // no flicker: one edge while it stays above
    strafe(h, 0);
    h.step(1);
    expect(armed).toEqual([true, false]);
  });

  it('no target appears while the player is below 80%, even for seconds', () => {
    const h = lane(50, 3);
    strafe(h, ARMED - 0.05);
    h.step(secondsToTicks(5));
    expect(h.targets.size).toBe(0);
    expect(trials(h)).toHaveLength(0);
    strafe(h, ARMED + 0.05);
    h.step(secondsToTicks(1));
    expect(h.targets.size).toBeGreaterThan(0);
  });
});

describe('the trial (stance requirement, checked from the player state at the first bullet)', () => {
  it('is a 60 s footwork drill on the Lane with Kestrel and no reload', () => {
    expect(stopAndPop.skills).toEqual(['footwork']);
    expect(stopAndPop.map).toBe('lane');
    expect(stopAndPop.weapon).toBe('kestrel');
    expect(stopAndPop.durationSec).toBe(60);
    expect(stopAndPop.player?.infiniteMagazine).toBe(true);
    expect(stopAndPop.axes).toContain('stopAndPopExposureSec');
  });

  it('puts a Post up at the far end (16 m or more from the start) with a ring at its feet', () => {
    const h = laneWith(50, 4);
    const ids = arm(h);
    expect(ids).toHaveLength(1);
    const t = h.targets.get(ids[0]!)!;
    expect(t.kind).toBe('post');
    expect(t.pos.y).toBe(0);
    expect(Math.hypot(t.pos.x - h.player.pos.x, t.pos.z - h.player.pos.z)).toBeGreaterThanOrEqual(16);
    expect(ringsShown).toHaveLength(1);
    expect(ringsShown[0]).toMatchObject({ slot: 0, x: t.pos.x, y: 0, z: t.pos.z });
  });

  it('stand ring: first bullet standing still that kills = success', () => {
    const h = laneWith(10, 5); // dial 10: stand rings only
    const [id] = arm(h);
    expect(ringsShown[0]!.crouch).toBe(false);
    stopped(h);
    h.step(14);
    fire(h, { id: id! });
    killIt(h, id!, 280);
    const t = trials(h);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ skill: 'footwork', success: true, rtMs: 280 });
    expect(extra(t[0]!)).toMatchObject({ cause: CAUSE_OK, stance: 0, crouching: 0, moving: 0, shots: 1 });
    expect(ringEvents).toEqual(['shown0', 'judged0:ok', 'hidden0']);
  });

  it('crouch ring: crouched still = success; standing still = wrong stance, a failed trial', () => {
    let seen = 0;
    for (let seed = 1; seed < 60 && seen < 2; seed++) {
      const h = laneWith(50, seed);
      const [id] = arm(h);
      if (!ringsShown[0]!.crouch) continue;
      seen++;
      if (seen === 1) {
        stopped(h, true);
        h.step(14);
        fire(h, { id: id! });
        killIt(h, id!);
        expect(trials(h)[0]!.success).toBe(true);
        expect(extra(trials(h)[0]!)).toMatchObject({ cause: CAUSE_OK, stance: 1, crouching: 1 });
      } else {
        stopped(h, false); // still, but standing
        h.step(14);
        fire(h, { id: id! });
        killIt(h, id!); // it even killed: a wrong stance still fails the trial
        expect(trials(h)[0]!.success).toBe(false);
        expect(extra(trials(h)[0]!)).toMatchObject({ cause: CAUSE_STANCE, stance: 1, crouching: 0, moving: 0 });
        expect(ringEvents).toContain('judged0:bad');
      }
    }
    expect(seen).toBe(2);
  });

  it('stand ring with the player crouched is also a wrong stance', () => {
    const h = laneWith(10, 6);
    const [id] = arm(h);
    stopped(h, true);
    h.step(14);
    fire(h, { id: id! });
    killIt(h, id!);
    expect(trials(h)[0]!.success).toBe(false);
    expect(extra(trials(h)[0]!).cause).toBe(CAUSE_STANCE);
  });

  it('a moving shot (the sim flags it at the shot) fails the trial even if it kills; the stat flag is the sim\'s own', () => {
    const h = laneWith(10, 7);
    const [id] = arm(h);
    h.step(10); // still strafing at full speed
    fire(h, { id: id! }, true);
    killIt(h, id!);
    const t = trials(h);
    expect(t[0]!.success).toBe(false);
    expect(extra(t[0]!)).toMatchObject({ cause: CAUSE_MOVING, moving: 1 });
    expect(extra(t[0]!).speed).toBeGreaterThan(ARMED);
  });

  it('walking is not a stance: shift-walk speed is above the deadzone, so the sim flags a moving shot', () => {
    const h = laneWith(10, 8);
    const [id] = arm(h);
    strafe(h, 2.7); // walk speed; the deadzone is 0.275 x 5.4 = 1.485
    fire(h, { id: id! }, true);
    killIt(h, id!);
    expect(extra(trials(h)[0]!).cause).toBe(CAUSE_MOVING);
  });

  it('only the first bullet decides: a miss, then a kill with the second bullet is a failed trial', () => {
    const h = laneWith(10, 9);
    const [id] = arm(h);
    stopped(h);
    h.step(14);
    fire(h, null);
    h.step(10);
    fire(h, { id: id! });
    killIt(h, id!);
    const t = trials(h);
    expect(t).toHaveLength(1);
    expect(t[0]!.success).toBe(false);
    expect(extra(t[0]!)).toMatchObject({ cause: CAUSE_NOT_FIRST_BULLET, shots: 2 });
  });

  it('a right-stance first bullet that does not kill fails, and the Post leaves 0.25 s later', () => {
    const h = laneWith(10, 10);
    const [id] = arm(h);
    stopped(h);
    h.step(14);
    fire(h, { id: id!, zone: 'body' });
    h.step(secondsToTicks(0.25) - 2);
    expect(h.targets.has(id!)).toBe(true);
    expect(trials(h)).toHaveLength(0);
    h.step(3);
    expect(h.targets.has(id!)).toBe(false);
    expect(trials(h)[0]!.success).toBe(false);
    expect(ringEvents.at(-1)).toBe('hidden0');
  });

  it('a target nobody shoots leaves when its exposure ends: a timed-out trial', () => {
    const h = laneWith(50, 11);
    const [id] = arm(h);
    stopped(h);
    const exposure = Math.max(h.runner.axes.stopAndPopExposureSec!, h.tunables.dial.floors.exposureSec);
    h.step(secondsToTicks(exposure) - 3);
    expect(h.targets.has(id!)).toBe(true);
    h.step(6);
    expect(h.targets.has(id!)).toBe(false);
    expect(extra(trials(h)[0]!).cause).toBe(CAUSE_TIMEOUT);
    expect(trials(h)[0]!.success).toBe(false);
  });

  it('after a trial the lane stays quiet for the seeded gap and needs the player to strafe again', () => {
    const h = laneWith(10, 12);
    playRight(h);
    expect(h.targets.size).toBe(0);
    stopped(h);
    h.step(secondsToTicks(3)); // standing still: nothing, however long
    expect(h.targets.size).toBe(0);
    strafe(h, RUN);
    h.step(secondsToTicks(1));
    expect(h.targets.size).toBe(1);
  });
});

describe('stance mix by dial (design §4.4)', () => {
  const cfg = makeHarness(TABLE, 50).tunables.modes.stopAndPop;
  const rulesOf = (dial: number) => stanceRules(dial, cfg);
  it('the rule table: < 30 stand only; 30-60 adds crouch; > 60 adds doubles and the counter-strafe rule', () => {
    expect(rulesOf(0)).toEqual({ crouchAllowed: false, advanced: false });
    expect(rulesOf(29.9)).toEqual({ crouchAllowed: false, advanced: false });
    expect(rulesOf(30)).toEqual({ crouchAllowed: true, advanced: false });
    expect(rulesOf(60)).toEqual({ crouchAllowed: true, advanced: false });
    expect(rulesOf(60.1)).toEqual({ crouchAllowed: true, advanced: true });
  });

  /** Play `n` trials (over several 60 s runs) at a pinned dial and report the mix of what was shown. */
  function mix(dial: number, n: number, seed: number) {
    let crouch = 0;
    let stand = 0;
    let doubles = 0;
    let played = 0;
    for (let run = 0; played < n; run++) {
      const h = makeHarness(TABLE, dial);
      h.player.pos.z = 14;
      h.runner.begin(stopAndPop, { seed: seed + run, pinDial: dial, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
      watch(h);
      h.step(secondsToTicks(0.8));
      for (let i = 0; i < 25 && played < n; i++, played++) {
        const shown = ringsShown.length;
        const { ids, crouch: c } = playRight(h);
        if (c) crouch++;
        else stand++;
        if (ids.length === 2) doubles++;
        expect(ringsShown.length - shown).toBe(ids.length);
        h.step(secondsToTicks(0.5));
      }
    }
    return { crouch, stand, doubles };
  }

  it('dial < 30: stand rings only, never a double', () => {
    const m = mix(20, 40, 21);
    expect(m.crouch).toBe(0);
    expect(m.doubles).toBe(0);
  });

  it('dial 30-60: stand and crouch both appear, still single targets', () => {
    const m = mix(45, 60, 22);
    expect(m.crouch).toBeGreaterThan(10);
    expect(m.stand).toBeGreaterThan(10);
    expect(m.doubles).toBe(0);
  });

  it('dial > 60: about 20% of trials are doubles (two targets, two rings)', () => {
    const m = mix(80, 150, 23);
    expect(m.doubles).toBeGreaterThan(15);
    expect(m.doubles).toBeLessThan(45);
    expect(m.crouch).toBeGreaterThan(10);
  });
});

describe('doubles (dial > 60)', () => {
  /** Find a seed whose first trial is a double. */
  function double(): { h: Harness; ids: number[] } {
    for (let seed = 1; seed < 200; seed++) {
      const h = makeHarness(TABLE, 80);
      h.player.pos.z = 14;
      h.runner.begin(stopAndPop, { seed, pinDial: 80, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
      watch(h);
      h.step(secondsToTicks(0.8));
      const ids = arm(h);
      if (ids.length === 2) return { h, ids };
    }
    throw new Error('no double in 200 seeds');
  }

  it('two targets with a ring each, the same stance, at least 1.2 m apart', () => {
    const { h, ids } = double();
    const [a, b] = ids.map((id) => h.targets.get(id)!);
    expect(Math.hypot(a!.pos.x - b!.pos.x, a!.pos.z - b!.pos.z)).toBeGreaterThanOrEqual(1.2);
    expect(ringsShown.map((r) => r.slot).sort()).toEqual([0, 1]);
    expect(ringsShown[0]!.crouch).toBe(ringsShown[1]!.crouch);
  });

  it('each target is its own trial: killing one does not resolve the other', () => {
    const { h, ids } = double();
    const crouch = ringsShown[0]!.crouch;
    // a proper counter-strafe stop
    h.bus.emit('playerStopped', { tick: h.simTick, latencyMs: 60, counterStrafe: true });
    stopped(h, crouch);
    h.step(10);
    fire(h, { id: ids[0]! });
    killIt(h, ids[0]!);
    expect(trials(h)).toHaveLength(1);
    expect(h.targets.has(ids[1]!)).toBe(true);
    h.step(10);
    fire(h, { id: ids[1]! });
    killIt(h, ids[1]!);
    expect(trials(h).map((t) => t.success)).toEqual([true, true]);
  });

  it('a miss with two targets up counts against the one nearest the crosshair', () => {
    const { h, ids } = double();
    const crouch = ringsShown[0]!.crouch;
    h.bus.emit('playerStopped', { tick: h.simTick, latencyMs: 60, counterStrafe: true });
    stopped(h, crouch);
    h.step(10);
    // look straight at the second target's head, then miss
    const b = h.targets.get(ids[1]!)!;
    const dx = b.pos.x - h.player.pos.x;
    const dz = b.pos.z - h.player.pos.z;
    h.player.yaw = Math.atan2(-dx, -dz);
    h.player.pitch = 0;
    fire(h, null);
    expect(ringEvents.filter((e) => e.startsWith('judged'))).toHaveLength(1);
    const slotOfB = ringsShown.findIndex((r) => Math.hypot(r.x - b.pos.x, r.z - b.pos.z) < 1e-6);
    expect(ringEvents).toContain(`judged${slotOfB}:ok`);
  });
});

describe('the stop must come from a direction reversal above dial 60', () => {
  function stopWith(dial: number, counterStrafe: boolean): Record<string, unknown> {
    const h = makeHarness(TABLE, dial);
    h.player.pos.z = 14;
    h.runner.begin(stopAndPop, { seed: 31, pinDial: dial, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
    watch(h);
    h.step(secondsToTicks(0.8));
    // single targets only: find a seed whose first trial is one
    const ids = arm(h);
    const crouch = ringsShown[0]!.crouch;
    h.bus.emit('playerStopped', { tick: h.simTick, latencyMs: 70, counterStrafe });
    stopped(h, crouch);
    h.step(10);
    fire(h, { id: ids[0]! });
    killIt(h, ids[0]!);
    return trials(h)[0]!;
  }

  it('dial 50: a release stop is fine', () => {
    expect(stopWith(50, false).success).toBe(true);
  });

  it('dial 80: a release stop fails (the player waited instead of tapping the opposite key)', () => {
    const t = stopWith(80, false);
    expect(t.success).toBe(false);
    expect(extra(t)).toMatchObject({ cause: CAUSE_NO_COUNTER_STRAFE, reversalRequired: 1, counterStrafe: 0 });
  });

  it('dial 80: a counter-strafe tap passes, and the stop latency is recorded on the trial', () => {
    const t = stopWith(80, true);
    expect(t.success).toBe(true);
    expect(extra(t)).toMatchObject({ cause: CAUSE_OK, reversalRequired: 1, counterStrafe: 1, stopMs: 70 });
  });

  it('dial 80: no stop at all before the shot (never slowed down) is a moving shot, not a pass', () => {
    const h = makeHarness(TABLE, 80);
    h.player.pos.z = 14;
    h.runner.begin(stopAndPop, { seed: 32, pinDial: 80, anchors: { anchors: laneMap.anchors, bounds: laneMap.bounds } });
    watch(h);
    h.step(secondsToTicks(0.8));
    const ids = arm(h);
    fire(h, { id: ids[0]! }, true);
    killIt(h, ids[0]!);
    expect(trials(h)[0]!.success).toBe(false);
  });
});

describe('determinism and bookkeeping', () => {
  it('the same seed gives the same sequence of rings and positions', () => {
    const run = (seed: number): string => {
      const h = laneWith(50, seed);
      const out: string[] = [];
      h.bus.on('stanceRingShown', (e) => out.push(`${e.slot}${e.crouch ? 'c' : 's'}${e.x.toFixed(3)},${e.z.toFixed(3)}`));
      for (let i = 0; i < 12; i++) {
        playRight(h);
        h.step(secondsToTicks(1));
      }
      return out.join('|');
    };
    expect(run(40)).toBe(run(40));
    expect(run(40)).not.toBe(run(41));
  });

  it('every trial carries the extras the results card and the skill model read', () => {
    const h = laneWith(50, 13);
    playRight(h);
    expect(Object.keys(extra(trials(h)[0]!)).sort()).toEqual(
      ['cause', 'counterStrafe', 'crouching', 'double', 'errDeg', 'firstShotMs', 'moving', 'outcome', 'reversalRequired', 'shots', 'speed', 'stance', 'stopMs'],
    );
  });

  it('a clean run of right-stance trials scores and builds the clean streak', () => {
    const h = laneWith(10, 14);
    for (let i = 0; i < 5; i++) {
      playRight(h);
      h.step(secondsToTicks(1));
    }
    expect(h.runner.stats.kills).toBe(5);
    expect(h.runner.cleanStreak).toBe(5);
    expect(trials(h).every((t) => t.success)).toBe(true);
  });

  it('a wrong-stance trial breaks the clean streak (a failed trial does)', () => {
    const h = laneWith(10, 15);
    playRight(h);
    h.step(secondsToTicks(1));
    const [id] = arm(h);
    stopped(h, true); // crouched, but the ring asked for standing
    h.step(14);
    fire(h, { id: id! });
    killIt(h, id!);
    expect(h.runner.cleanStreak).toBe(0);
  });

  it('abandon takes every ring down', () => {
    const h = laneWith(50, 16);
    arm(h);
    const st = h.runner.state as { trial: { abandon(ctx: never): void; count: number } };
    st.trial.abandon(h.runner as never);
    expect(ringEvents.at(-1)).toBe('hidden0');
    expect(st.trial.count).toBe(0);
  });
});

