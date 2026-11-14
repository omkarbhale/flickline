import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_DT, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { wrapPi, yawOf } from './aim';
import { createStubEnemyWorld } from './enemyStub';
import { createMindProfile, profileFor } from './mind/profile';
import {
  memoryConfidence, PerceptionSystem, SEEN_CHEST, SEEN_HEAD, SEEN_SHOULDER_L, SEEN_SHOULDER_R,
  type Perceiver,
} from './perception';
import type { BoxDef, PlayerState, SimEvents } from './types';

const DEG = Math.PI / 180;

/** Yaw that looks down +Z (a view that faces a player standing at positive z). */
const FACE_PLUS_Z = Math.PI;
const FACE_MINUS_Z = 0;

interface Rig {
  sys: PerceptionSystem;
  bus: EventBus<SimEvents>;
  player: PlayerState;
  tun: ReturnType<typeof cloneTunables>;
  log: { type: string; e: Record<string, unknown> }[];
  tick: number;
}

function rig(boxes: BoxDef[] = [], mutate?: (t: ReturnType<typeof cloneTunables>) => void): Rig {
  const tun = cloneTunables();
  mutate?.(tun);
  const player = createStubEnemyWorld().player;
  const bus = new EventBus<SimEvents>();
  const sys = new PerceptionSystem(tun, boxes, player, bus);
  const log: Rig['log'] = [];
  bus.onAny((type, e) => {
    if (String(type).startsWith('perceiver')) log.push({ type: String(type), e: { ...(e as object) } as Record<string, unknown> });
  });
  sys.attach(bus);
  return { sys, bus, player, tun, log, tick: 0 };
}

/** An enemy whose eye stands at (x, 1.62, z) looking along `yaw`. */
function enemy(r: Rig, id: number, x: number, z: number, yaw: number, skill = 50, seed = id + 100): Perceiver {
  const p = r.sys.add(id, new Rng(seed), profileFor(skill, new Rng(seed + 1), createMindProfile(), r.tun))!;
  p.eye.x = x; p.eye.y = 1.62; p.eye.z = z; p.yaw = yaw;
  return p;
}

function place(r: Rig, x: number, z: number): void {
  r.player.pos.x = x; r.player.pos.y = 0; r.player.pos.z = z;
}

function run(r: Rig, seconds: number): void {
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n; i++) r.sys.step(++r.tick);
}

const now = (r: Rig): number => r.tick * TICK_DT;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef => ({
  tag: 'cover', min: vec3(x0, y0, z0), max: vec3(x1, y1, z1),
});
const of = (r: Rig, type: string) => r.log.filter((l) => l.type === type);

describe('sight: rays to the head and upper body inside the field of view', () => {
  // The enemy at the origin looks down -Z at a player standing 10 m away (z = -10).
  const seeWith = (boxes: BoxDef[], opts: { yaw?: number; crouch?: boolean } = {}): Perceiver => {
    const r = rig(boxes);
    if (opts.crouch) { r.player.height = 1.35; r.player.eyeHeight = 1.15; r.player.crouching = true; }
    const p = enemy(r, 1, 0, 0, opts.yaw ?? FACE_MINUS_Z);
    place(r, 0, -10);
    run(r, 0.6);
    return p;
  };

  it('sees an open player, with every sample point clear', () => {
    const p = seeWith([]);
    expect(p.sees).toBe(true);
    expect(p.visibleMask).toBe(SEEN_HEAD | SEEN_CHEST | SEEN_SHOULDER_L | SEEN_SHOULDER_R);
    expect(p.sightPoint.y).toBeCloseTo(1.62, 6); // the eye is the best sample
  });

  it('a pillar edge hides the head and chest but a shoulder sticks out: seen, by the shoulder only', () => {
    // x -0.5..0.05 at z -5: the line to the player's centre (x 0) is inside it; the +x shoulder (x 0.2) passes at x 0.1.
    const p = seeWith([box(-0.5, 0, -5.5, 0.05, 3, -4.5)]);
    expect(p.sees).toBe(true);
    expect(p.visibleMask).toBe(SEEN_SHOULDER_L);
    expect(p.sightPoint.x).toBeCloseTo(0.2, 6);
    expect(p.sightPoint.y).toBeCloseTo(1.8 * 0.78, 6); // the aim model aims at the shoulder, not the head
  });

  it('the reverse: a low wall in front of the player hides the shoulders and chest, the head clears it', () => {
    const p = seeWith([box(-3, 0, -9.5, 3, 1.5, -8.5)]);
    expect(p.sees).toBe(true);
    expect(p.visibleMask).toBe(SEEN_HEAD);
    expect(p.sightPoint.y).toBeCloseTo(1.62, 6);
  });

  it('a wall that hides every sample means no sight, and no memory', () => {
    const p = seeWith([box(-5, 0, -5.5, 5, 4, -4.5)]);
    expect(p.sees).toBe(false);
    expect(p.visibleMask).toBe(0);
    expect(p.memory.valid).toBe(false);
  });

  it('crouching lowers every sample: the low wall now hides the whole player', () => {
    expect(seeWith([box(-3, 0, -9.5, 3, 1.5, -8.5)], { crouch: true }).sees).toBe(false);
  });

  it('sees nothing outside the field of view, and casts no ray at all there', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z + 55 * DEG); // the player is 55° off the view: outside ±51.5°
    place(r, 0, -10);
    run(r, 1);
    expect(p.sees).toBe(false);
    expect(p.raysLast).toBe(0);
    expect(r.sys.raysTotal).toBe(0);
    expect(p.decisions).toBeGreaterThan(4);
  });

  it('the field of view is the player\'s 103°: seen at 51° off axis, not at 52°', () => {
    for (const [deg, seen] of [[51, true], [52, false]] as const) {
      const r = rig();
      const p = enemy(r, 1, 0, 0, FACE_MINUS_Z + deg * DEG);
      place(r, 0, -10);
      run(r, 0.5);
      expect(p.sees, `${deg}°`).toBe(seen);
    }
  });

  it('does not see beyond its sight range', () => {
    const r = rig([], (t) => { t.perception.sightRangeM = 30; });
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    place(r, 0, -31);
    run(r, 0.5);
    expect(p.sees).toBe(false);
    place(r, 0, -29);
    run(r, 0.5);
    expect(p.sees).toBe(true);
  });

  it('emits one saw event per sighting and one lost-sight event when it ends; memory stays', () => {
    const r = rig();
    const p = enemy(r, 7, 0, 0, FACE_MINUS_Z);
    place(r, 0, -10);
    run(r, 1);
    expect(of(r, 'perceiverSaw')).toHaveLength(1);
    expect(of(r, 'perceiverSaw')[0]!.e.id).toBe(7);
    r.tun.perception.maxRaysPerDecision = 4;
    place(r, 0, 10); // behind the enemy
    run(r, 1);
    expect(p.sees).toBe(false);
    expect(of(r, 'perceiverLostSight')).toHaveLength(1);
    expect(p.memory.valid).toBe(true);
    expect(p.memory.pos.z).toBeCloseTo(-10, 6);
  });

  it('a dead enemy sees and hears nothing', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    p.alive = false;
    place(r, 0, -10);
    run(r, 1);
    r.sys.hear('shot', r.tick);
    expect(r.log).toHaveLength(0);
  });
});

describe('ray budget', () => {
  it('at most 4 rays per decision point, decisions at jittered ~0.12 s intervals', () => {
    const r = rig([box(-5, 0, -5.5, 5, 4, -4.5)]); // a wall, so every decision spends its whole budget
    const ps = [enemy(r, 1, 0, 0, FACE_MINUS_Z), enemy(r, 2, 2, 0, FACE_MINUS_Z), enemy(r, 3, -2, 0, FACE_MINUS_Z)];
    place(r, 0, -10);
    let maxRays = 0;
    const gaps: number[] = [];
    const last = new Map<number, number>();
    const seenDecisions = new Map<number, number>();
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      r.sys.step(++r.tick);
      for (const p of ps) {
        if (p.decisions !== (seenDecisions.get(p.id) ?? 0)) {
          seenDecisions.set(p.id, p.decisions);
          maxRays = Math.max(maxRays, p.raysLast);
          if (last.has(p.id)) gaps.push(now(r) - last.get(p.id)!);
          last.set(p.id, now(r));
        }
      }
    }
    expect(maxRays).toBe(4);
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median).toBeGreaterThan(0.1);
    expect(median).toBeLessThan(0.14);
    expect(sorted[0]!).toBeGreaterThanOrEqual(0.06 - TICK_DT);
    expect(sorted[sorted.length - 1]!).toBeLessThanOrEqual(0.3 + TICK_DT);
    // Jittered, not a metronome.
    expect(new Set(sorted.map((g) => Math.round(g * 1000))).size).toBeGreaterThan(5);
    expect(r.sys.raysTotal).toBeLessThanOrEqual(4 * r.sys.decisionsTotal);
    // ~8 decisions a second each, whatever happens.
    expect(r.sys.decisionsTotal / 3 / 20).toBeGreaterThan(6);
    expect(r.sys.decisionsTotal / 3 / 20).toBeLessThan(11);
  });

  it('the budget is a tunable: with 2 the eye and the chest are the only samples', () => {
    const r = rig([], (t) => { t.perception.maxRaysPerDecision = 2; });
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    place(r, 0, -10);
    run(r, 0.6);
    expect(p.raysLast).toBe(2);
    expect(p.visibleMask).toBe(SEEN_HEAD | SEEN_CHEST);
  });

  it('enemies do not decide on the same tick', () => {
    const r = rig();
    const ps = Array.from({ length: 8 }, (_, i) => enemy(r, i + 1, i, 0, FACE_MINUS_Z));
    place(r, 0, -10);
    run(r, 0.2);
    const firsts = new Set(ps.map((p) => p.nextDecisionSec.toFixed(4)));
    expect(firsts.size).toBeGreaterThan(4);
  });
});

describe('hearing: the same events and radii as the player\'s hearing of enemies', () => {
  const heardAt = (r: Rig, fire: () => void): number => { r.log.length = 0; fire(); return of(r, 'perceiverHeard').length; };

  it('running footsteps are heard; walking and crouch-walking are silent', () => {
    const r = rig();
    enemy(r, 1, 0, 0, FACE_PLUS_Z);
    place(r, 0, -20);
    expect(heardAt(r, () => r.bus.emit('footstep', { tick: 1, crouching: false, walking: false }))).toBe(1);
    expect(heardAt(r, () => r.bus.emit('footstep', { tick: 2, crouching: false, walking: true }))).toBe(0);
    expect(heardAt(r, () => r.bus.emit('footstep', { tick: 3, crouching: true, walking: false }))).toBe(0);
    expect(heardAt(r, () => r.bus.emit('footstep', { tick: 4, crouching: true, walking: true }))).toBe(0);
  });

  it('landings, shots and reloads are heard, each out to its own radius, and no further', () => {
    const r = rig();
    const radii = r.tun.attribution.soundRadiusM;
    enemy(r, 1, 0, 0, FACE_PLUS_Z);
    const fire = (kind: 'landing' | 'shot' | 'reload', t: number): void => {
      if (kind === 'landing') r.bus.emit('playerLanded', { tick: t, impactSpeed: 6 });
      else if (kind === 'reload') r.bus.emit('reloadStarted', { tick: t, weapon: 'kestrel', durationSec: 2 });
      else r.sys.hear('shot', t); // shotFired carries a heavy payload; the subscription is checked below
    };
    for (const kind of ['landing', 'shot', 'reload'] as const) {
      const radius = radii[kind === 'landing' ? 'landing' : kind];
      place(r, 0, -(radius - 0.5));
      expect(heardAt(r, () => fire(kind, 10)), `${kind} just inside`).toBe(1);
      place(r, 0, -(radius + 0.5));
      expect(heardAt(r, () => fire(kind, 20)), `${kind} just outside`).toBe(0);
    }
  });

  it('shotFired on the bus is a shot sound', () => {
    const r = rig();
    enemy(r, 1, 0, 0, FACE_PLUS_Z);
    place(r, 0, -60);
    r.bus.emit('shotFired', {
      tick: 5, t: 0, shotId: 1, weapon: 'kestrel', origin: vec3(), dir: vec3(), aimDir: vec3(),
    } as SimEvents['shotFired']);
    const ev = of(r, 'perceiverHeard');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.e.sound).toBe('shot');
  });

  it('reads the very table the player\'s hearing reads (scaled by the mind): shrink the radius and who hears changes', () => {
    const r = rig([], (t) => { t.mind.hearing.radiusScale.footstep = 0.5; });
    const full = rig();
    enemy(r, 1, 0, 0, FACE_PLUS_Z);
    enemy(full, 1, 0, 0, FACE_PLUS_Z);
    place(r, 0, -20);
    place(full, 0, -20);
    expect(full.tun.mind.hearing.radiusScale.footstep).toBe(1); // symmetric by default
    expect(heardAt(full, () => full.sys.hear('footstep', 1))).toBe(1);
    expect(heardAt(r, () => r.sys.hear('footstep', 1))).toBe(0); // 20 m > 30 m x 0.5
  });

  it('hearing goes through walls and ignores the field of view (sound is not sight)', () => {
    const r = rig([box(-50, 0, -6, 50, 5, -5)]);
    const p = enemy(r, 1, 0, 0, FACE_PLUS_Z); // facing away, wall between
    place(r, 0, -15);
    expect(heardAt(r, () => r.sys.hear('footstep', 1))).toBe(1);
    expect(p.sees).toBe(false);
  });

  it('the estimate is off by at most max(floor, frac x distance), more at range, less at higher skill', () => {
    const errAt = (skill: number, dist: number): { max: number; mean: number; bound: number } => {
      const r = rig();
      const pe = enemy(r, 1, 0, 0, FACE_PLUS_Z, skill);
      place(r, 0, -dist);
      let sum = 0, max = 0, n = 0;
      for (let i = 0; i < 400; i++) {
        r.log.length = 0;
        r.sys.hear('shot', 1000 + i * 1000); // far apart in time: no repeat narrowing
        const e = of(r, 'perceiverHeard')[0]!.e as { x: number; z: number };
        const d = Math.hypot(e.x - 0, e.z - -dist);
        sum += d; max = Math.max(max, d); n++;
      }
      const bound = Math.max(pe.profile.hearErrorFloorM, pe.profile.hearErrorFrac * dist);
      return { max, mean: sum / n, bound };
    };
    for (const skill of [0, 35, 65, 100]) {
      for (const dist of [4, 20, 60]) {
        const e = errAt(skill, dist);
        expect(e.max, `skill ${skill} @ ${dist} m`).toBeLessThanOrEqual(e.bound + 1e-9);
        expect(e.mean).toBeGreaterThan(e.bound * 0.5); // uniform in a disc: mean 2/3 of the radius
      }
    }
    // The documented anchors: 0.25 d (floor 1 m) at the lowest, 0.10 d (floor 0.5 m) at the top.
    expect(errAt(0, 20).bound).toBeCloseTo(5, 9);
    expect(errAt(100, 20).bound).toBeCloseTo(2, 9);
    expect(errAt(0, 2).bound).toBeCloseTo(1, 9);
    expect(errAt(100, 2).bound).toBeCloseTo(0.5, 9);
    expect(errAt(100, 40).mean).toBeLessThan(errAt(0, 40).mean);
    expect(errAt(0, 60).mean).toBeGreaterThan(errAt(0, 10).mean);
  });

  it('a steady stream of steps from one place narrows the guess; a sound from elsewhere resets it', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_PLUS_Z, 50);
    place(r, 0, -20);
    const errs: number[] = [];
    for (let i = 0; i < 6; i++) {
      r.log.length = 0;
      r.sys.hear('footstep', 1 + i * 64); // 0.5 s apart
      errs.push(of(r, 'perceiverHeard')[0]!.e.errorM as number);
    }
    expect(errs[0]!).toBeCloseTo(Math.max(p.profile.hearErrorFloorM, p.profile.hearErrorFrac * 20), 9);
    for (let i = 1; i < errs.length; i++) expect(errs[i]!).toBeLessThanOrEqual(errs[i - 1]! + 1e-12);
    expect(errs[5]!).toBeCloseTo(errs[0]! * r.tun.perception.hearing.repeatMinScale, 9);
    place(r, 25, 10); // somewhere else entirely: the next error is back to the base
    r.log.length = 0;
    r.sys.hear('footstep', 1 + 6 * 64);
    r.log.length = 0;
    r.sys.hear('footstep', 1 + 7 * 64);
    expect(of(r, 'perceiverHeard')[0]!.e.errorM as number).toBeGreaterThan(errs[5]!);
  });

  it('a heard sound is remembered at the estimate, with the sound\'s confidence', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_PLUS_Z);
    place(r, 4, -12);
    r.sys.hear('footstep', 128);
    expect(p.memory.valid).toBe(true);
    expect(p.memory.source).toBe('sound');
    expect(p.memory.confidence0).toBe(r.tun.perception.confidence.footstep);
    expect(p.memory.stampSec).toBeCloseTo(1, 9);
    expect(Math.hypot(p.memory.pos.x - 4, p.memory.pos.z + 12)).toBeLessThanOrEqual(p.profile.hearErrorFloorM * 12 + 3);
  });
});

describe('memory', () => {
  it('confidence halves every 2 s (tunable) and is never refreshed without new perception', () => {
    const r = rig([box(-5, 0, -5.5, 5, 4, -4.5)]);
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    r.sys.prime(p, 3, 0, -8, 0, 0, 1);
    const stamp = p.memory.stampSec;
    const c0 = p.memory.confidence0;
    const half = r.tun.mind.perception.memoryHalfLifeSec;
    expect(memoryConfidence(p.memory, stamp, half)).toBeCloseTo(c0, 12);
    expect(memoryConfidence(p.memory, stamp + 2, half)).toBeCloseTo(c0 / 2, 12);
    expect(memoryConfidence(p.memory, stamp + 4, half)).toBeCloseTo(c0 / 4, 12);
    expect(memoryConfidence(p.memory, stamp + 3, 3)).toBeCloseTo(c0 / 2, 12); // the half-life is a parameter
    place(r, 0, -10); // hidden behind the wall for 5 s
    run(r, 5);
    expect(p.sees).toBe(false);
    expect(p.memory.stampSec).toBe(stamp); // not touched
    expect(p.memory.pos.x).toBe(3);
    expect(r.sys.confidenceAt(p, now(r))).toBeCloseTo(c0 * Math.pow(0.5, now(r) / 2), 9);
  });

  it('is forgotten below the floor, and the enemy then expects nothing', () => {
    const r = rig([box(-5, 0, -5.5, 5, 4, -4.5)]);
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    r.sys.prime(p, 3, 0, -8, 0, 0, 1);
    place(r, 0, -10);
    run(r, 4);
    expect(p.memory.valid).toBe(true);
    run(r, 4);
    expect(p.memory.valid).toBe(false);
    expect(p.expect.active).toBe(false);
  });

  it('sight stores the player\'s position at full confidence, refreshed at every decision while seen', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    place(r, 0, -10);
    run(r, 0.5);
    expect(p.memory.source).toBe('sight');
    expect(p.memory.confidence0).toBe(1);
    place(r, 3, -10);
    run(r, 0.5);
    expect(p.memory.pos.x).toBe(3);
    expect(p.memory.stampSec).toBeGreaterThan(0.5);
  });

  it('a vague sound does not overwrite a sharper memory, but does once that has faded', () => {
    const r = rig([box(-50, 0, 4, 50, 4, 5)]);
    const p = enemy(r, 1, 0, 0, FACE_PLUS_Z);
    r.sys.prime(p, 1, 0, 15, 0, 0, 1); // confidence 0.9 at t 0
    place(r, -10, 15);
    r.sys.hear('footstep', 0); // 0.55 < 0.9
    expect(p.memory.source).toBe('prior');
    run(r, 2);
    r.sys.hear('footstep', r.tick); // 0.55 > 0.9 / 2 = 0.45
    expect(p.memory.source).toBe('sound');
  });
});

describe('shared sightings', () => {
  it('a teammate learns where the player was seen after the callout delay, with the sighting\'s time', () => {
    const delays: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const r = rig([box(-50, 0, 4, 50, 4, 5)]);
      enemy(r, 1, 0, 0, FACE_MINUS_Z, 50, seed); // sees the player
      const mate = enemy(r, 2, 0, 9, FACE_PLUS_Z, 50, seed * 7 + 1); // behind the wall, facing away
      place(r, 2, -10);
      run(r, 4);
      const got = of(r, 'perceiverGotShared').filter((l) => l.e.id === 2);
      expect(got.length).toBeGreaterThan(0);
      const first = got[0]!.e;
      expect(first.fromId).toBe(1);
      expect(first.adopted).toBe(true);
      delays.push(first.delaySec as number);
      expect(mate.memory.valid).toBe(true);
      expect(mate.memory.source).toBe('shared');
      expect(mate.memory.pos.x).toBe(2);
      expect(mate.memory.pos.z).toBe(-10);
      expect(mate.memory.confidence0).toBe(r.tun.perception.confidence.shared);
    }
    delays.sort((a, b) => a - b);
    const median = delays[Math.floor(delays.length / 2)]!;
    expect(median).toBeGreaterThan(0.6);
    expect(median).toBeLessThan(1.1);
    expect(delays[0]!).toBeGreaterThanOrEqual(0.3 - 1e-9);
    // Never instant: even the quickest callout lags (and the delay includes up to a decision interval of tick rounding).
  });

  it('nothing is shared before the delay has passed, and a dead teammate never hears it', () => {
    const r = rig([box(-50, 0, 4, 50, 4, 5)]);
    enemy(r, 1, 0, 0, FACE_MINUS_Z);
    const mate = enemy(r, 2, 0, 9, FACE_PLUS_Z);
    const dead = enemy(r, 3, 4, 9, FACE_PLUS_Z);
    dead.alive = false;
    place(r, 0, -10);
    run(r, 0.25);
    expect(of(r, 'perceiverSaw')).toHaveLength(1);
    expect(of(r, 'perceiverGotShared')).toHaveLength(0);
    expect(mate.memory.valid).toBe(false);
    run(r, 3);
    expect(of(r, 'perceiverGotShared').every((l) => l.e.id === 2)).toBe(true);
    expect(dead.memory.valid).toBe(false);
  });

  it('the callout carries what was seen, not where the player is now', () => {
    const r = rig([box(-50, 0, 4, 50, 4, 5)]);
    enemy(r, 1, 0, 0, FACE_MINUS_Z);
    const mate = enemy(r, 2, 0, 9, FACE_PLUS_Z);
    place(r, 0, -10);
    run(r, 0.15);
    expect(of(r, 'perceiverSaw').length).toBe(1);
    place(r, 20, -10); // out of the sighter's view before the callout lands
    run(r, 0.05);
    place(r, 200, -10); // beyond everyone's sight range
    run(r, 3);
    const first = of(r, 'perceiverGotShared')[0]!.e;
    expect(Math.abs(first.z as number)).toBeLessThanOrEqual(10);
    expect(mate.memory.pos.z).toBeLessThan(0);
  });
});

describe('expectation (the aim model\'s input)', () => {
  it('points the attended sector at the last known position, wider the less certain it is', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    r.sys.prime(p, 5, 0, -10, 0, 0, 1);
    const e = p.expect;
    expect(e.active).toBe(true);
    expect(e.fromMemory).toBe(true);
    expect(wrapPi(e.yaw - yawOf(5, -10))).toBeCloseTo(0, 9);
    expect(e.dist).toBeCloseTo(Math.hypot(5, 10), 9);
    const w0 = e.halfWidth;
    r.sys.refreshExpectation(p, 3);
    expect(p.expect.halfWidth).toBeGreaterThan(w0); // the player has had 3 s to move
    expect(p.expect.confidence).toBeLessThan(e.confidence + 1e-9);
    expect(p.expect.halfWidth).toBeLessThanOrEqual(r.tun.perception.expectation.maxHalfWidthDeg * DEG + 1e-12);
  });

  it('the predicted window opens when the information arrived and covers the run from there to here', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    r.sys.prime(p, 0, 0, -27, 10, 0, 1);
    const ex = r.tun.perception.expectation;
    expect(p.expect.windowOpenSec).toBe(10);
    expect(p.expect.windowCloseSec).toBeCloseTo(10 + 27 / ex.assumedSpeedMps + ex.windowSec / 2, 9);
    const near = enemy(r, 2, 0, 0, FACE_MINUS_Z);
    r.sys.prime(near, 0, 0, -2, 10, 0, 1);
    expect(near.expect.windowCloseSec).toBeCloseTo(10 + ex.windowSec, 9);
  });

  it('with no information a hold expects its assigned sector; with none it expects nothing', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    r.sys.refreshExpectation(p, 1);
    expect(p.expect.active).toBe(false);
    r.sys.setAttendedSector(p, 20 * DEG, 8 * DEG);
    r.sys.refreshExpectation(p, 1);
    expect(p.expect.active).toBe(true);
    expect(p.expect.fromMemory).toBe(false);
    expect(p.expect.yaw).toBeCloseTo(20 * DEG, 12);
    r.sys.clearAttendedSector(p);
    r.sys.refreshExpectation(p, 1);
    expect(p.expect.active).toBe(false);
  });

  it('classifies a contact: prepared in the sector inside the window, attending in the cone, unaware elsewhere', () => {
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z);
    const bearing = (x: number, z: number): number => yawOf(x, z);
    // No information: the attention cone (+-15 deg round the view) decides.
    expect(r.sys.classifyContact(p, 1, bearing(0, -10))).toBe('attending');
    expect(r.sys.classifyContact(p, 1, bearing(2, -10))).toBe('attending'); // 11 deg
    expect(r.sys.classifyContact(p, 1, bearing(-3, -10))).toBe('unaware'); // 16.7 deg: in the field of view, outside the cone
    expect(r.sys.classifyContact(p, 1, Math.PI)).toBe('unaware'); // behind
    // Information at a spot 31 deg off the view: a player appearing there inside the window is expected.
    r.sys.prime(p, 6, 0, -10, 0, 0, 1);
    expect(r.sys.classifyContact(p, 0.5, bearing(6, -10))).toBe('prepared');
    // The same spot after the window has closed, or the other way round, is a surprise.
    expect(r.sys.classifyContact(p, p.expect.windowCloseSec + 0.01, bearing(6, -10))).toBe('unaware');
    expect(r.sys.classifyContact(p, 0.5, bearing(-6, -10))).toBe('unaware');
    // A hold with a sector is prepared for it, and only it.
    const h = enemy(r, 2, 0, 0, FACE_MINUS_Z);
    r.sys.setAttendedSector(h, 0, 6 * DEG);
    r.sys.refreshExpectation(h, 3);
    expect(r.sys.classifyContact(h, 3, 0)).toBe('prepared');
    expect(r.sys.classifyContact(h, 3, 10 * DEG)).toBe('attending');
  });

  it('judges the contact that starts a sighting before the sighting updates memory', () => {
    const classOf = (setup: (r: Rig, p: Perceiver) => void, yaw: number): unknown => {
      const r = rig();
      const p = enemy(r, 1, 0, 0, yaw);
      setup(r, p);
      place(r, 0, -10);
      run(r, 0.5);
      return of(r, 'perceiverSaw')[0]!.e.contact;
    };
    // Nothing known, the player straight ahead: attending (the base draw).
    expect(classOf(() => undefined, FACE_MINUS_Z)).toBe('attending');
    // Nothing known, 40 deg off the view axis: unaware (orientation cost).
    expect(classOf(() => undefined, FACE_MINUS_Z + 40 * DEG)).toBe('unaware');
    // The same off-axis enemy that heard the player coming from there is prepared.
    expect(classOf((r, p) => r.sys.prime(p, 0, 0, -11, 0, 0, 1), FACE_MINUS_Z + 40 * DEG)).toBe('prepared');
    // A hold with the sector aimed at him.
    expect(classOf((r, p) => r.sys.setAttendedSector(p, 0, 5 * DEG), FACE_MINUS_Z)).toBe('prepared');
    // A re-peek: he was seen a moment ago, ducked away and is back in the same place.
    const r = rig();
    const p = enemy(r, 1, 0, 0, FACE_MINUS_Z + 40 * DEG);
    place(r, 0, -10);
    run(r, 0.4);
    expect(of(r, 'perceiverSaw')[0]!.e.contact).toBe('unaware'); // the first look: off-axis, no information
    place(r, 0, 10);
    run(r, 0.4);
    place(r, 0, -10);
    run(r, 0.4);
    expect(of(r, 'perceiverSaw')[1]!.e.contact).toBe('prepared'); // the second: he was just there
    expect(p.contact).toBe('prepared');
  });
});
