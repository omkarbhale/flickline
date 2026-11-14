import { vec3 } from '../core/vec3';
import type { BoxDef, BoxTag, LevelDef } from './types';

function box(tag: BoxTag, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BoxDef {
  return { tag, min: vec3(x0, y0, z0), max: vec3(x1, y1, z1) };
}

/**
 * Flat test room, 40 x 40 m, walls 6 m high, open sky.
 * Props: crates of several heights (0.7 m can be jumped on), a stair of platforms, and a low
 * "crouch gap" (clearance 1.5 m: crouch to pass under).
 */
export const testRoom: LevelDef = {
  name: 'Test Room',
  boxes: [
    box('floor', -20, -1, -20, 20, 0, 20),
    box('wall', -20.5, 0, -20.5, 20.5, 6, -20), // north
    box('wall', -20.5, 0, 20, 20.5, 6, 20.5), // south
    box('wall', -20.5, 0, -20, -20, 6, 20), // west
    box('wall', 20, 0, -20, 20.5, 6, 20), // east
    box('crate', -3, 0, -8, -1.5, 1.2, -6.5),
    box('crate', 3, 0, -10, 4, 0.7, -9),
    box('crate', 6, 0, -6, 8, 2.0, -4),
    box('platform', -9, 0, -12, -7, 0.3, -10),
    box('platform', -9, 0, -14, -7, 0.6, -12),
    box('platform', -9, 0, -16, -7, 0.9, -14),
    // crouch gap: two pillars and a lintel with 1.5 m clearance
    box('wall', 9, 0, 3, 9.4, 3, 6),
    box('wall', 12.6, 0, 3, 13, 3, 6),
    box('wall', 9, 1.5, 3, 13, 3, 6),
  ],
  spawn: { pos: vec3(0, 0, 8), yaw: 0 },
  // Beacons are placed by centre, Posts by feet centre (see World.spawnTarget).
  targets: [
    { kind: 'beacon', pos: vec3(0, 1.5, -12) },
    { kind: 'post', pos: vec3(-6, 0, -16) },
    { kind: 'beacon', pos: vec3(7, 1.8, -17) },
    { kind: 'post', pos: vec3(2, 0, -18.5), crouched: true },
    { kind: 'post', pos: vec3(-4.5, 0, -9) },
  ],
};
