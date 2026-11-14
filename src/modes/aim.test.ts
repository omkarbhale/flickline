import { describe, expect, it } from 'vitest';
import { directionFromAngles, vec3 } from '../core/vec3';
import { DEG2RAD } from '../core/math';
import { angleDeg, directionTo, FIRST_BODY, FIRST_HEAD, FIRST_MISS, overshootDeg, ShotTracker } from './aim';

const dir = (yawDeg: number, pitchDeg = 0) => directionFromAngles(vec3(), yawDeg * DEG2RAD, pitchDeg * DEG2RAD);

describe('flick error (signed overshoot along the flick axis)', () => {
  // The flick starts at yaw 0 and goes left (positive yaw) to a target at yaw 40.
  const from = dir(0);
  const target = dir(40);

  it('is 0 on target, positive past it, negative short of it', () => {
    expect(overshootDeg(dir(40), target, from)).toBeCloseTo(0, 6);
    expect(overshootDeg(dir(43), target, from)).toBeCloseTo(3, 2);
    expect(overshootDeg(dir(37), target, from)).toBeCloseTo(-3, 2);
  });

  it('ignores the sideways part of the error', () => {
    expect(overshootDeg(dir(40, 2), target, from)).toBeCloseTo(0, 1);
    expect(Math.abs(overshootDeg(dir(41, 3), target, from) - 1)).toBeLessThan(0.1);
  });

  it('works for a flick to the right and for a vertical flick', () => {
    expect(overshootDeg(dir(-43), dir(-40), from)).toBeCloseTo(3, 2);
    expect(overshootDeg(dir(0, 12), dir(0, 10), dir(0, 0))).toBeCloseTo(2, 2);
    expect(overshootDeg(dir(0, 8), dir(0, 10), dir(0, 0))).toBeCloseTo(-2, 2);
  });

  it('is 0 when there was no flick', () => {
    expect(overshootDeg(dir(3), target, target)).toBe(0);
  });
});

describe('angles', () => {
  it('angleDeg is the angle between unit vectors', () => {
    expect(angleDeg(dir(0), dir(90))).toBeCloseTo(90, 6);
    expect(angleDeg(dir(10), dir(10))).toBeCloseTo(0, 4);
  });
  it('directionTo normalises and reports a zero distance', () => {
    const out = vec3();
    expect(directionTo(out, vec3(0, 0, 0), vec3(0, 0, -5))).toBe(true);
    expect(out.z).toBeCloseTo(-1, 9);
    expect(directionTo(out, vec3(1, 1, 1), vec3(1, 1, 1))).toBe(false);
  });
});

describe('ShotTracker', () => {
  const player = { pos: vec3(0, 0, 0), eyeHeight: 1.62, yaw: 0, pitch: 0 };
  const centre = vec3(-10, 1.62, -10); // 45 degrees to the left of straight ahead, level with the eye

  it('records the spawn offset, then the first bullet only', () => {
    const t = new ShotTracker();
    t.begin(player, centre, 100);
    expect(t.spawnOffsetDeg).toBeCloseTo(45, 4);
    player.yaw = 47 * DEG2RAD; // crosshair went 2 degrees past the target
    t.onImpact(player, 180, { tick: 1, onTarget: false }, 5);
    expect(t.shots).toBe(1);
    expect(t.errDeg).toBeCloseTo(2, 3);
    expect(t.overshoot).toBeCloseTo(2, 3);
    expect(t.firstOutcome).toBe(FIRST_MISS);
    expect(t.firstShotMs()).toBeCloseTo(80 * (1000 / 128), 6);
    player.yaw = 45 * DEG2RAD;
    t.onImpact(player, 200, { tick: 2, onTarget: true, targetId: 5, zone: 'head' }, 5);
    expect(t.shots).toBe(2);
    expect(t.errDeg).toBeCloseTo(2, 3); // unchanged: the first bullet is what counts
    expect(t.firstOutcome).toBe(FIRST_MISS);
    player.yaw = 0;
  });

  it('classifies the first bullet and derives reaction time', () => {
    const t = new ShotTracker();
    player.yaw = 45 * DEG2RAD;
    t.begin(player, centre, 0);
    t.onImpact(player, 64, { tick: 1, onTarget: true, targetId: 3, zone: 'body' }, 3);
    expect(t.firstOutcome).toBe(FIRST_BODY);
    expect(t.rtMs(0, 5)).toBeCloseTo(500, 6); // aimed within 5 degrees: spawn to first bullet
    expect(t.rtMs(310, 5)).toBe(310); // the sim's figure wins
    const u = new ShotTracker();
    u.begin(player, centre, 0);
    u.onImpact(player, 64, { tick: 1, onTarget: true, targetId: 3, zone: 'head' }, 3);
    expect(u.firstOutcome).toBe(FIRST_HEAD);
    player.yaw = 0;
    const far = new ShotTracker();
    far.begin(player, centre, 0);
    far.onImpact(player, 64, { tick: 1, onTarget: false }, 3);
    expect(far.rtMs(0, 5)).toBeUndefined(); // wild bullet: not a reaction
  });
});
