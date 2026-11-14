import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../core/math';
import { secondsToTicks, TICK_DT } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import { angleDeg, directionTo } from './aim';
import { coldStart } from './coldStart';
import { orbit } from './orbit';
import { aimAt, EYE, kill, shot, start, targetOf, untilTarget } from './drillSupport';

describe('Cold Start', () => {
  it('is a 60 s precision drill on the Range with Kestrel, infinite magazine', () => {
    expect(coldStart.skills).toEqual(['precision']);
    expect(coldStart.weapon).toBe('kestrel');
    expect(coldStart.map).toBe('range');
    expect(coldStart.durationSec).toBe(60);
    expect(coldStart.player?.infiniteMagazine).toBe(true);
    expect(coldStart.player?.lockMovement).toBeUndefined();
  });

  it('places each Post 5-25 degrees from the crosshair, at head height, at the dial distance', () => {
    const h = start(coldStart, 3);
    const view = vec3();
    const dir = vec3();
    for (let n = 0; n < 40; n++) {
      untilTarget(h);
      const t = targetOf(h);
      expect(t.kind).toBe('post');
      const head = vec3(t.pos.x, t.pos.y + h.tunables.targets.hit.headCentreStand, t.pos.z);
      directionFromAngles(view, h.player.yaw, h.player.pitch);
      directionTo(dir, EYE, head);
      const a = angleDeg(view, dir);
      expect(a).toBeGreaterThanOrEqual(5 - 1e-6);
      expect(a).toBeLessThanOrEqual(25 + 1e-6);
      expect(t.pos.y).toBe(0);
      aimAt(h, head); // the player flicks onto it and kills it
      shot(h, t.id, true);
      kill(h, t.id, 'head');
      h.targets.delete(t.id);
    }
    expect(h.events('skillTrial').every((e) => e.success === true)).toBe(true);
  });

  it('the first bullet decides: a head hit is a success and records the first-bullet data', () => {
    const h = start(coldStart, 5);
    untilTarget(h);
    const t = targetOf(h);
    aimAt(h, t.pos, h.tunables.targets.hit.headCentreStand);
    h.step(40); // reaction
    shot(h, t.id, true, 'head');
    kill(h, t.id, 'head', 280);
    const tr = h.events('skillTrial');
    expect(tr).toHaveLength(1);
    expect(tr[0]!.skill).toBe('precision');
    expect(tr[0]!.success).toBe(true);
    expect(tr[0]!.rtMs).toBe(280);
    const extra = tr[0]!.extra as Record<string, number>;
    expect(extra.shots).toBe(1);
    expect(extra.outcome).toBe(2);
    expect(extra.errDeg).toBeLessThan(0.1);
    expect(extra.offsetDeg).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(Math.abs(extra.firstShotMs! - 40 * TICK_DT * 1000)).toBeLessThanOrEqual(TICK_DT * 1000 * 1.5);
    expect(extra.timedOut).toBe(0);
    expect(h.events('scoreAwarded')).toHaveLength(1);
  });

  it('a missed first bullet fails the trial and the Post leaves 0.25 s later, whatever the player does next', () => {
    const h = start(coldStart, 6);
    untilTarget(h);
    const t = targetOf(h);
    const fired = h.simTick;
    shot(h, t.id, false);
    h.step(secondsToTicks(0.25) - 2);
    expect(h.targets.has(t.id)).toBe(true);
    expect(h.events('skillTrial')).toHaveLength(0);
    h.step(3);
    expect(h.targets.has(t.id)).toBe(false);
    const tr = h.events('skillTrial');
    expect(tr).toHaveLength(1);
    expect(tr[0]!.success).toBe(false);
    expect((tr[0]!.extra as Record<string, number>).outcome).toBe(0);
    expect(h.simTick - fired).toBeLessThanOrEqual(secondsToTicks(0.25) + 1);
  });

  it('a body hit makes it leave unkilled (failure); a head kill by the SECOND bullet is not the skill', () => {
    const h = start(coldStart, 7);
    untilTarget(h);
    let t = targetOf(h);
    shot(h, t.id, true, 'body');
    h.step(secondsToTicks(0.25) + 2);
    expect(h.targets.has(t.id)).toBe(false);
    expect(h.events('skillTrial')[0]!.success).toBe(false);
    expect((h.events('skillTrial')[0]!.extra as Record<string, number>).outcome).toBe(1);

    untilTarget(h);
    t = targetOf(h);
    shot(h, t.id, true, 'body');
    h.step(5);
    shot(h, t.id, true, 'head');
    kill(h, t.id, 'head');
    const second = h.events('skillTrial')[1]!;
    expect(second.success).toBe(false);
    expect((second.extra as Record<string, number>).shots).toBe(2);
    expect(h.events('scoreAwarded')).toHaveLength(1); // it still pays for the kill
  });

  it('no bullet before the exposure ends: the Post leaves and it counts as a miss by timeout', () => {
    const h = start(coldStart, 8, 50);
    untilTarget(h);
    const t = targetOf(h);
    const exposure = h.runner.axes.coldStartExposureSec!;
    h.step(secondsToTicks(exposure) - 3);
    expect(h.targets.has(t.id)).toBe(true);
    h.step(6);
    expect(h.targets.has(t.id)).toBe(false);
    const tr = h.events('skillTrial');
    expect(tr).toHaveLength(1);
    expect(tr[0]!.success).toBe(false);
    expect(tr[0]!.rtMs).toBeUndefined();
    expect((tr[0]!.extra as Record<string, number>).timedOut).toBe(1);
  });

  it('paces the next Post 0.5-0.9 s after the last one went (seeded)', () => {
    const h = start(coldStart, 9);
    const gaps: number[] = [];
    for (let n = 0; n < 25; n++) {
      untilTarget(h);
      const t = targetOf(h);
      shot(h, t.id, false);
      h.step(secondsToTicks(0.25) + 2);
      const gone = h.simTick;
      untilTarget(h);
      gaps.push((h.simTick - gone) * TICK_DT);
    }
    // The leave happens up to 2 ticks before `gone`; allow that slack.
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(0.5 - 3 * TICK_DT);
      expect(g).toBeLessThanOrEqual(0.9 + 3 * TICK_DT);
    }
    expect(new Set(gaps.map((g) => g.toFixed(3))).size).toBeGreaterThan(5); // not a metronome
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number): number[] => {
      const h = start(coldStart, seed);
      const out: number[] = [];
      for (let n = 0; n < 10; n++) {
        untilTarget(h);
        const t = targetOf(h);
        out.push(t.pos.x, t.pos.z);
        shot(h, t.id, false);
        h.step(secondsToTicks(0.25) + 2);
      }
      return out;
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });
});

describe('Orbit', () => {
  it('is a 60 s flick drill with Pace, movement locked at the shell centre, infinite magazine', () => {
    expect(orbit.skills).toEqual(['flick']);
    expect(orbit.weapon).toBe('pace');
    expect(orbit.durationSec).toBe(60);
    expect(orbit.player).toEqual({ standAt: 'beacon-shell', lockMovement: true, infiniteMagazine: true });
    expect(orbit.axes).toEqual(['beaconScale', 'flickMinDeg', 'flickMaxDeg', 'orbitExposureSec']);
  });

  it('puts each Beacon on the 8-25 m shell, pitch -20..+25, an angle from the previous one inside the dial range, at the dial scale', () => {
    for (const dial of [0, 50, 100]) {
      const h = start(orbit, 21, dial);
      const ax = h.runner.axes;
      const prev = vec3();
      const cur = vec3();
      let havePrev = false;
      for (let n = 0; n < 30; n++) {
        untilTarget(h);
        const t = targetOf(h);
        expect(t.kind).toBe('beacon');
        const r = Math.hypot(t.pos.x - EYE.x, t.pos.y - EYE.y, t.pos.z - EYE.z);
        expect(r).toBeGreaterThanOrEqual(8 - 1e-6);
        expect(r).toBeLessThanOrEqual(25 + 1e-6);
        const pitch = Math.asin((t.pos.y - EYE.y) / r) / DEG2RAD;
        expect(pitch).toBeGreaterThanOrEqual(-20 - 1e-6);
        expect(pitch).toBeLessThanOrEqual(25 + 1e-6);
        expect(t.scale).toBeCloseTo(ax.beaconScale!, 9);
        expect(t.scale).toBeGreaterThanOrEqual(1);
        directionTo(cur, EYE, t.pos);
        if (havePrev) {
          const a = angleDeg(prev, cur);
          expect(a).toBeGreaterThanOrEqual(ax.flickMinDeg! - 1e-4);
          expect(a).toBeLessThanOrEqual(ax.flickMaxDeg! + 1e-4);
        }
        prev.x = cur.x;
        prev.y = cur.y;
        prev.z = cur.z;
        havePrev = true;
        // The player kills it and the crosshair ends up on it.
        aimAt(h, t.pos);
        shot(h, t.id, true);
        kill(h, t.id, 'head');
        h.targets.delete(t.id);
      }
    }
  });

  it('time to live comes from the dial: an expiry is a failed trial, and the next Beacon follows 0.2 s later (0.1 s after a kill)', () => {
    const h = start(orbit, 22, 50);
    untilTarget(h);
    const first = targetOf(h);
    const ttl = h.runner.axes.orbitExposureSec!;
    h.step(secondsToTicks(ttl) - 3);
    expect(h.targets.has(first.id)).toBe(true);
    h.step(6);
    expect(h.targets.has(first.id)).toBe(false);
    const expiredAt = h.simTick;
    expect(h.events('skillTrial')[0]!.success).toBe(false);
    expect((h.events('skillTrial')[0]!.extra as Record<string, number>).expired).toBe(1);
    untilTarget(h);
    expect((h.simTick - expiredAt) * TICK_DT).toBeGreaterThanOrEqual(0.2 - 8 * TICK_DT);
    expect((h.simTick - expiredAt) * TICK_DT).toBeLessThanOrEqual(0.2 + 2 * TICK_DT);

    const t = targetOf(h);
    shot(h, t.id, true);
    kill(h, t.id, 'head');
    h.targets.delete(t.id);
    const killedAt = h.simTick;
    untilTarget(h);
    expect((h.simTick - killedAt) * TICK_DT).toBeCloseTo(0.1, 1);
  });

  it('records flick error, reaction time and the first-bullet outcome per trial', () => {
    const h = start(orbit, 23, 30);
    untilTarget(h);
    const t = targetOf(h);
    // Start of flick: crosshair at yaw 0, pitch 0. Overshoot the Beacon by 2 degrees along the flick.
    aimAt(h, t.pos);
    const want = h.player.yaw;
    const startYaw = 0;
    h.player.yaw = want + Math.sign(want - startYaw) * 2 * DEG2RAD;
    h.step(30);
    shot(h, t.id, false); // first bullet misses (overshoot), second kills
    aimAt(h, t.pos);
    h.step(10);
    shot(h, t.id, true);
    kill(h, t.id, 'head', 410);
    const tr = h.events('skillTrial')[0]!;
    expect(tr.skill).toBe('flick');
    expect(tr.success).toBe(true);
    expect(tr.rtMs).toBe(410);
    const e = tr.extra as Record<string, number>;
    expect(e.shots).toBe(2);
    expect(e.firstHit).toBe(0);
    expect(e.errDeg).toBeCloseTo(2, 0);
    expect(Math.abs(e.overshootDeg)).toBeGreaterThan(0.5);
    expect(e.flickDeg).toBeGreaterThan(0);
    expect(e.distance).toBeGreaterThanOrEqual(8);
    expect(Math.abs(e.firstShotMs! - 30 * TICK_DT * 1000)).toBeLessThanOrEqual(TICK_DT * 1000 * 1.5);
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number): number[] => {
      const h = start(orbit, seed);
      const out: number[] = [];
      for (let n = 0; n < 12; n++) {
        untilTarget(h);
        const t = targetOf(h);
        out.push(t.pos.x, t.pos.y, t.pos.z);
        shot(h, t.id, true);
        kill(h, t.id, 'head');
        h.targets.delete(t.id);
      }
      return out;
    };
    expect(run(31)).toEqual(run(31));
    expect(run(31)).not.toEqual(run(32));
  });
});
