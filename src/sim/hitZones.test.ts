import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { createZoneHit, traceTarget, zoneCentre } from './hitZones';
import { TargetField } from './targets';
import { vec3 } from '../core/vec3';
import type { HitZone, SimEvents, TargetKind, TargetState } from './types';

const tun = cloneTunables();
const H = tun.targets.hit;

/** A field with one target at (0, y, z0), plus a trace helper firing -Z rays from the origin. */
function rig(kind: TargetKind, crouched = false, y = 0, z0 = -10) {
  const field = new TargetField(tun);
  const events = new EventBus<SimEvents>();
  const ctx = { tick: 0, rng: new Rng(1), tunables: tun, events };
  field.spawn(kind, 0, y, z0, ctx, null, { crouched });
  const t: TargetState = field.slots[0]!;
  const def = tun.targets.kinds[kind];
  const out = createZoneHit();
  /** Horizontal ray at height `h`, offset `x` sideways, heading -Z. */
  const shoot = (h: number, x = 0): HitZone | null =>
    traceTarget(t, H, def, x, h, 0, 0, 0, -1, 100, out) ? out.zone : null;
  const shootDir = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): HitZone | null => {
    const l = Math.hypot(dx, dy, dz);
    return traceTarget(t, H, def, ox, oy, oz, dx / l, dy / l, dz / l, 100, out) ? out.zone : null;
  };
  return { field, t, def, out, shoot, shootDir };
}

describe('humanoid hit zones: standing (spec §5.1)', () => {
  const { shoot, out } = rig('post');

  it('reads the spec values from tunables', () => {
    expect(H.headRadius).toBe(0.14);
    expect(H.headCentreStand).toBe(1.66);
    expect(H.headCentreCrouch).toBe(1.16);
    expect([H.torsoBottomStand, H.torsoTopStand]).toEqual([0.8, 1.52]);
    expect([H.torsoBottomCrouch, H.torsoTopCrouch]).toEqual([0.55, 1.02]);
    expect([H.legTopStand, H.legTopCrouch]).toEqual([0.8, 0.55]);
  });

  it('head: centre, top and bottom edges of the sphere', () => {
    expect(shoot(1.66)).toBe('head');
    expect(shoot(1.799)).toBe('head'); // just under the top (1.66 + 0.14)
    expect(shoot(1.801)).toBeNull(); // just above
    expect(shoot(1.53)).toBe('head'); // above the torso top (1.52)
  });

  it('head: sideways edge of the sphere at centre height', () => {
    expect(shoot(1.66, 0.139)).toBe('head');
    expect(shoot(1.66, 0.141)).toBeNull();
    expect(shoot(1.66, -0.139)).toBe('head');
  });

  it('torso: 0.80 to 1.52 m, arms count as body (full 0.50 m width)', () => {
    expect(shoot(0.801)).toBe('body');
    expect(shoot(1.2)).toBe('body');
    expect(shoot(1.519)).toBe('body');
    expect(shoot(1.2, 0.249)).toBe('body'); // where an arm would be
    expect(shoot(1.2, 0.251)).toBeNull();
  });

  it('torso/leg boundary at 0.80 m', () => {
    expect(shoot(0.801)).toBe('body');
    expect(shoot(0.799)).toBe('leg');
    expect(shoot(0.8)).toBe('body'); // exactly on the boundary: the wider, nearer torso surface wins
  });

  it('legs: floor to 0.80 m, 0.46 m wide', () => {
    expect(shoot(0.001)).toBe('leg');
    expect(shoot(0.4, 0.229)).toBe('leg');
    expect(shoot(0.4, 0.231)).toBeNull();
    expect(shoot(-0.001)).toBeNull();
  });

  it('returns distance, point-able geometry and the outward normal', () => {
    expect(shoot(1.2)).toBe('body');
    // Front of the torso cylinder (radius 0.25) at z = -10: entry at 10 - 0.25 = 9.75 m.
    expect(out.distance).toBeCloseTo(9.75, 9);
    expect(out.nz).toBeCloseTo(1, 9);
    expect(shoot(1.66)).toBe('head');
    expect(out.distance).toBeCloseTo(10 - 0.14, 9);
  });

  it('from above: head first, shoulders count as body', () => {
    const r = rig('post');
    expect(r.shootDir(0, 5, -10, 0, -1, 0)).toBe('head');
    expect(r.out.distance).toBeCloseTo(5 - 1.8, 9);
    expect(r.out.ny).toBeCloseTo(1, 9);
    expect(r.shootDir(0.2, 5, -10, 0, -1, 0)).toBe('body'); // past the head's radius, over the torso
    expect(r.out.distance).toBeCloseTo(5 - 1.52, 9);
  });

  it('from below the torso: the underside is body', () => {
    const r = rig('post');
    // x = 0.24 is outside the leg cylinder (0.23) but inside the torso (0.25): hits its underside.
    expect(r.shootDir(0.24, 0.5, -10, 0, 1, 0)).toBe('body');
    expect(r.out.distance).toBeCloseTo(0.3, 9);
  });

  it('a ray that starts behind the target, pointing away, misses', () => {
    const r = rig('post');
    expect(r.shootDir(0, 1.2, -20, 0, 0, -1)).toBeNull();
  });

  it('zone centres follow the tunables', () => {
    const r = rig('post');
    const c = vec3();
    expect(zoneCentre(c, r.t, H, r.def, 'head').y).toBeCloseTo(1.66, 12);
    expect(zoneCentre(c, r.t, H, r.def, 'body').y).toBeCloseTo(1.16, 12);
    expect(zoneCentre(c, r.t, H, r.def, 'leg').y).toBeCloseTo(0.4, 12);
  });

  it('follows the target position (feet on a platform at y = 0.6)', () => {
    const r = rig('post', false, 0.6);
    expect(r.shoot(0.6 + 1.66)).toBe('head');
    expect(r.shoot(0.6 + 0.799)).toBe('leg');
    expect(r.shoot(0.6 + 0.801)).toBe('body');
  });
});

describe('humanoid hit zones: crouched (spec §5.1)', () => {
  const { shoot } = rig('post', true);

  it('head sphere centre 1.16 m, radius 0.14', () => {
    expect(shoot(1.16)).toBe('head');
    expect(shoot(1.299)).toBe('head');
    expect(shoot(1.301)).toBeNull();
    expect(shoot(1.03)).toBe('head'); // above the crouched torso top (1.02)
  });

  it('torso 0.55 to 1.02 m; legs 0 to 0.55 m', () => {
    expect(shoot(1.019)).toBe('body');
    expect(shoot(0.551)).toBe('body');
    expect(shoot(0.549)).toBe('leg');
    expect(shoot(0.001)).toBe('leg');
  });

  it('a standing-head-height ray passes over a crouched Echo', () => {
    expect(shoot(1.66)).toBeNull();
  });
});

describe('Beacon (orb)', () => {
  const r = rig('beacon', false, 1.5, -12);

  it('is a single head-sized sphere that counts as the head zone', () => {
    expect(tun.targets.kinds.beacon.orbRadius).toBe(H.headRadius);
    expect(r.shoot(1.5)).toBe('head');
    expect(r.shoot(1.639)).toBe('head');
    expect(r.shoot(1.641)).toBeNull();
    expect(r.shoot(1.5, 0.139)).toBe('head');
    expect(r.shoot(1.5, 0.141)).toBeNull();
    r.shoot(1.5);
    expect(r.out.distance).toBeCloseTo(12 - 0.14, 9);
  });

  it('never depends on any render mesh: bounds come from tunables and state alone', () => {
    expect(r.t.radius).toBe(0.14);
    expect(r.t.boundsY).toBe(0);
  });
});
