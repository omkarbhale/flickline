import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT, TICK_RATE } from '../core/time';
import { zoneCentre } from '../sim/hitZones';
import { testRoom } from '../sim/levels';
import { vec3 } from '../core/vec3';
import { createTickInput, type SimEvents, type TickInput } from '../sim/types';
import { World } from '../sim/world';
import { formatRtTtk, hitmarkerKind, provisionalKillScore } from './hitFeedback';
import type { FeedbackOptions } from './options';
import { PulseBudget } from './pulseBudget';
import { IMPACT_KILL, ShotCues, TRACER_GHOST_LINE, TRACER_MOVING, TRACER_NORMAL } from './shotCues';

/** A bot-driven world + cue model, stepped like the game loop: beginFrame, ticks, update, draw. */
function rig(opts: Partial<FeedbackOptions> = {}) {
  const tun = cloneTunables();
  const world = new World({ level: testRoom, tunables: tun, seed: 7 });
  const bus = new EventBus<SimEvents>();
  const options: FeedbackOptions = { coachingCues: true, missGhost: true, damageNumbers: true, reduceFlashing: false, ...opts };
  const cues = new ShotCues(bus, tun.feedback, options, world.targets, tun.targets);
  const input = createTickInput();
  const settle = (n = 4): void => {
    for (let i = 0; i < n; i++) world.step(input, bus);
  };
  /** One rendered frame that runs `ticks` sim ticks with `patch` applied. */
  const frame = (ticks: number, patch: Partial<TickInput> = {}, dt = TICK_DT * ticks): void => {
    cues.beginFrame();
    Object.assign(input, patch);
    for (let i = 0; i < ticks; i++) {
      world.step(input, bus);
      input.jump = false;
    }
    cues.update(dt);
    cues.markDrawn();
  };
  /** Aim at target `i`. */
  const aimAt = (i: number, dyaw = 0): void => {
    const t = world.targets[i]!;
    const p = world.player;
    const hc = zoneCentre(vec3(), t, tun.targets.hit, tun.targets.kinds[t.kind], 'head');
    const dx = hc.x - p.pos.x, dz = hc.z - p.pos.z;
    const dy = hc.y - (p.pos.y + p.eyeHeight);
    input.yaw = Math.atan2(-dx, -dz) + dyaw;
    input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  settle();
  return { world, bus, cues, input, frame, aimAt, tun, options, settle };
}

const tracerKinds = (c: ShotCues): number[] => c.tracers.filter((t) => t.active).map((t) => t.kind);

describe('frame latency: every cue is drawn in the frame of its sim event', () => {
  it('a bot firing at 1 and 2 ticks per frame has 0 latency and no late cue', () => {
    const r = rig();
    r.aimAt(0);
    for (let f = 0; f < 120; f++) r.frame(f % 3 === 0 ? 2 : 1, { fire: f % 4 < 2 });
    expect(r.cues.latency.samples).toBeGreaterThan(20);
    expect(r.cues.latency.max).toBeLessThanOrEqual(1);
    expect(r.cues.latency.max).toBe(0);
    expect(r.cues.latency.late).toBe(0);
  });

  it('a hitch longer than every cue life does not swallow an effect', () => {
    const r = rig();
    r.aimAt(0);
    r.cues.beginFrame();
    r.input.fire = true;
    r.world.step(r.input, r.bus);
    r.input.fire = false;
    r.cues.update(5); // a 5 s frame
    expect(r.cues.tracers.some((t) => t.active)).toBe(true);
    r.cues.markDrawn();
    expect(r.cues.latency.max).toBe(0);
    r.cues.beginFrame();
    r.cues.update(0.2);
    expect(r.cues.tracers.some((t) => t.active)).toBe(false);
  });
});

describe('moving-shot coaching cue', () => {
  it('tracer is amber exactly when shotFired.moving is true', () => {
    const r = rig();
    r.aimAt(0);
    const events: boolean[] = [];
    r.bus.on('shotFired', (e) => events.push(e.moving));
    // Standing shot.
    r.frame(1, { fire: true, moveZ: 0 });
    r.frame(1, { fire: false });
    const standing = events.slice();
    // Run forward (well above 27.5% of run speed), then fire.
    r.frame(40, { moveZ: 1, fire: false });
    r.aimAt(0);
    r.frame(1, { moveZ: 1, fire: true });
    const kinds = tracerKinds(r.cues);
    expect(standing).toEqual([false]);
    expect(events[events.length - 1]).toBe(true);
    expect(kinds).toContain(TRACER_MOVING);
  });

  it('the first shot after a counter-strafe stop is not moving; airborne shots are', () => {
    const r = rig();
    const moving: boolean[] = [];
    r.bus.on('shotFired', (e) => moving.push(e.moving));
    r.frame(40, { moveX: 1 });
    r.frame(60, { moveX: 0 }); // decelerates to a stop
    r.frame(1, { fire: true });
    r.frame(20, { fire: false }); // past the fire-rate cooldown
    r.frame(1, { jump: true });
    r.frame(1, { fire: true });
    expect(moving).toEqual([false, true]);
  });

  it('with coaching cues off the tracer is never amber', () => {
    const r = rig({ coachingCues: false, missGhost: false });
    r.frame(40, { moveZ: 1 });
    r.frame(1, { moveZ: 1, fire: true });
    expect(tracerKinds(r.cues)).toEqual([TRACER_NORMAL]);
  });

  it('a standing shot is a normal tracer', () => {
    const r = rig();
    r.frame(1, { fire: true });
    expect(tracerKinds(r.cues)).toEqual([TRACER_NORMAL]);
  });
});

describe('miss-offset ghost ring', () => {
  it('shows the nearest target head for 0.25 s after a near miss and then goes away', () => {
    const r = rig();
    r.aimAt(0, 0.05); // ~3 degrees off
    r.frame(1, { fire: true });
    r.input.fire = false;
    const g = r.cues.ghost;
    expect(g.active).toBe(true);
    const t = r.world.targets[0]!;
    const head = zoneCentre(vec3(), t, r.tun.targets.hit, r.tun.targets.kinds[t.kind], 'head');
    expect([g.hx, g.hy, g.hz]).toEqual([head.x, head.y, head.z]);
    expect(r.cues.tracers[r.tun.feedback.tracer.capacity]!.kind).toBe(TRACER_GHOST_LINE);
    // Still there at 0.2 s, gone after 0.25 s.
    for (let i = 0; i < 12; i++) r.frame(1, { fire: false }, 0.016);
    expect(g.active).toBe(true);
    for (let i = 0; i < 6; i++) r.frame(1, { fire: false }, 0.016);
    expect(g.active).toBe(false);
  });

  it('is toggleable, and ignores targets far off the aim ray', () => {
    const off = rig({ missGhost: false });
    off.aimAt(0, 0.05);
    off.frame(1, { fire: true });
    expect(off.cues.ghost.active).toBe(false);

    const far = rig();
    far.aimAt(0, Math.PI * 0.9); // looking away from every target
    far.frame(1, { fire: true });
    expect(far.cues.ghost.active).toBe(false);
  });

  it('a hit does not draw a ghost or a decal', () => {
    const r = rig();
    r.aimAt(0);
    r.frame(1, { fire: true });
    expect(r.cues.ghost.active).toBe(false);
    expect(r.cues.decals.some((d) => d.active)).toBe(false);
  });
});

describe('kill shatter and impacts', () => {
  it('a kill spawns one shatter and a kill burst; a miss spawns a decal', () => {
    const r = rig();
    r.aimAt(0);
    // Hold fire until the 34-damage placeholder rifle kills a 100 hp target (3 hits).
    let killed = 0;
    r.bus.on('targetKilled', () => killed++);
    for (let f = 0; f < 40 && killed === 0; f++) r.frame(1, { fire: true });
    expect(killed).toBe(1);
    expect(r.cues.shatters.filter((s) => s.active).length).toBe(1);
    expect(r.cues.impacts.some((i) => i.active && i.kind === IMPACT_KILL)).toBe(true);
    r.frame(20, { fire: false }); // past the fire-rate cooldown
    r.aimAt(1, 1.0);
    r.frame(1, { fire: true });
    expect(r.cues.decals.some((d) => d.active)).toBe(true);
    expect(r.cues.decalsDirty).toBe(true);
  });

  it('decals expire after their ttl', () => {
    const r = rig();
    r.aimAt(1, 1.0);
    r.frame(1, { fire: true });
    r.input.fire = false;
    expect(r.cues.decals.some((d) => d.active)).toBe(true);
    r.cues.update(r.tun.feedback.decal.ttlSec + 0.1);
    expect(r.cues.decals.some((d) => d.active)).toBe(false);
  });
});

describe('pools never grow', () => {
  it('200 shots per second for 10 s reuse the same slot objects', () => {
    const r = rig();
    const before = [r.cues.tracers.slice(), r.cues.impacts.slice(), r.cues.decals.slice(), r.cues.shatters.slice()];
    const lens = before.map((a) => a.length);
    const dt = 1 / 144;
    const ticksPerFrame = TICK_RATE / 144;
    let acc = 0;
    for (let f = 0; f < 1440; f++) {
      acc += ticksPerFrame;
      const n = Math.floor(acc);
      acc -= n;
      r.aimAt(f % 4, f % 2 ? 0 : 0.4);
      r.frame(n, { fire: true }, dt);
    }
    const after = [r.cues.tracers, r.cues.impacts, r.cues.decals, r.cues.shatters];
    after.forEach((a, i) => {
      expect(a.length).toBe(lens[i]);
      a.forEach((o, j) => expect(o).toBe(before[i]![j]));
    });
    expect(r.cues.latency.late).toBe(0);
    expect(r.cues.latency.max).toBe(0);
  });
});

describe('hit classification', () => {
  it('colour and shape differ per zone and kill', () => {
    expect(hitmarkerKind('body', false)).toBe('body');
    expect(hitmarkerKind('leg', false)).toBe('leg');
    expect(hitmarkerKind('head', false)).toBe('head');
    expect(hitmarkerKind('body', true)).toBe('kill');
    expect(hitmarkerKind('leg', true)).toBe('kill');
    expect(hitmarkerKind('head', true)).toBe('headKill');
  });
  it('formats RT and TTK for the kill float', () => {
    expect(formatRtTtk(182.4, 410)).toBe('182 ms · 0.41 s');
    expect(formatRtTtk(undefined, 410)).toBe('0.41 s');
    expect(formatRtTtk(undefined, undefined)).toBeNull();
  });
  it('provisional score favours headshots', () => {
    const fb = cloneTunables().feedback;
    expect(provisionalKillScore('body', fb)).toBe(100);
    expect(provisionalKillScore('head', fb)).toBe(150);
  });
});

describe('PulseBudget (full-width pulses, research R10)', () => {
  it('allows at most 3 per rolling second, deterministically', () => {
    const b = new PulseBudget(3);
    const granted: number[] = [];
    for (let i = 0; i < 60; i++) if (b.tryAcquire(i / 20)) granted.push(i / 20);
    expect(granted.length).toBe(9); // 3 per second over 3 s
    // No window of 1 s contains more than 3.
    for (let i = 0; i + 3 < granted.length; i++) expect(granted[i + 3]! - granted[i]!).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('recovers after a clock reset', () => {
    const b = new PulseBudget(3);
    for (let i = 0; i < 3; i++) expect(b.tryAcquire(100 + i * 0.01)).toBe(true);
    expect(b.tryAcquire(100.5)).toBe(false);
    expect(b.tryAcquire(0)).toBe(true);
  });
});
