import { DEG2RAD } from '../core/math';
import { secondsToTicks } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { AnchorLike, AnchorSource } from './contracts';
import type { AxisRange } from './linearDial';
import type { ModeDef } from './modeDef';
import { makeHarness, type Harness } from './testHarness';

/** Test support for the drills: a hall like the Range around the origin and helpers to play trials by hand. */
/** Axis table of the dial module's end points (design §9.4), for the drills' axes. */
export const TABLE: Record<string, AxisRange> = {
  beaconScale: { at0: 3, at100: 1 },
  distance: { at0: 5, at100: 50, geometric: true },
  flickMinDeg: { at0: 20, at100: 90 },
  flickMaxDeg: { at0: 40, at100: 180 },
  exposureSec: { at0: 3, at100: 0.45, geometric: true },
};

export const READY = secondsToTicks(0.8);
export const EYE = vec3(0, 1.62, 0);

/** A hall around the origin like the Range's shell and Post bands; the player stands at the centre. */
export function hall(): AnchorSource {
  const anchors: AnchorLike[] = [{ id: 'shell', kind: 'beacon-shell', centre: vec3(0, 1.62, 0), rMin: 8, rMax: 25 }];
  let i = 0;
  for (const r of [6, 10, 15, 20]) {
    for (let a = 0; a < 360; a += 12) {
      const rad = a * DEG2RAD;
      anchors.push({ id: `p${i++}`, kind: 'post', pos: vec3(Math.sin(rad) * r, 0, -Math.cos(rad) * r) });
    }
  }
  return { anchors, bounds: { min: vec3(-30, 0, -30), max: vec3(30, 8, 30) } };
}

export function start<S>(mode: ModeDef<S>, seed = 1, dial = 50): Harness {
  const h = makeHarness(TABLE, dial);
  h.runner.begin(mode, { seed, anchors: hall() });
  h.step(READY);
  return h;
}

export const targetOf = (h: Harness): { id: number; pos: Vec3; kind: string; scale: number } => {
  const [id, t] = [...h.targets.entries()][0]!;
  return { id, ...t };
};

/** Aim the player's view straight at a world point (what a perfect crosshair would do). */
export function aimAt(h: Harness, p: Vec3, dy = 0): void {
  const dx = p.x - EYE.x;
  const dz = p.z - EYE.z;
  const dyy = p.y + dy - EYE.y;
  h.player.yaw = Math.atan2(-dx, -dz);
  h.player.pitch = Math.asin(dyy / Math.hypot(dx, dyy, dz));
}

export const shot = (h: Harness, id: number, hit: boolean, zone: 'head' | 'body' = 'head'): void =>
  h.bus.emit('shotImpact', { tick: h.simTick, onTarget: hit, targetId: hit ? id : -1, zone: hit ? zone : null });

export const kill = (h: Harness, id: number, zone: 'head' | 'body', rtMs = 300): void =>
  h.kill(id, { zone, rtMs, kind: 'post' });

/** Run until a target is up (or give up after `ticks`). */
export function untilTarget(h: Harness, ticks = 600): void {
  for (let i = 0; i < ticks && h.targets.size === 0; i++) h.step(1);
}

