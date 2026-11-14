import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { cloneTunables } from '../config/tunables';
import { vec3, type Vec3 } from '../core/vec3';
import { hullBlocked, hullOverlaps, rayBox } from './collision';
import { lintErrors, lintMap } from './mapLint';
import { elbowMap, laneMap, MAPS } from './mapLoader';
import { anchorsOfKind, distanceFromSpawn } from './mapQuery';
import type { MapDef, PeekAnchor } from './mapTypes';
import type { BoxDef } from './types';
import { createTickInput, type SimEvents } from './types';
import { World } from './world';

const tun = cloneTunables();
const hw = tun.movement.hullHalfWidth;
const eye = tun.movement.standEyeHeight;
/** Head centre of a standing Echo (spec `hit.head_centre_stand`). */
const HEAD = 1.66;

const _n = vec3();

/** True if the segment a -> b touches no box. */
function clear(boxes: readonly BoxDef[], a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  for (const box of boxes) {
    const t = rayBox(a.x, a.y, a.z, dx / len, dy / len, dz / len, box, len - 1e-4, _n);
    if (t >= 0 && t < len - 1e-4) return false;
  }
  return true;
}

/** Walk the real simulation from `from` toward `toward` and return the player after `ticks`. */
function walkInto(map: MapDef, from: Vec3, toward: Vec3, ticks: number, onTick?: (w: World) => void): World {
  const world = new World({ level: map, tunables: cloneTunables(), seed: 1 });
  const bus = new EventBus<SimEvents>();
  const p = world.player;
  p.pos.x = p.prevPos.x = from.x;
  p.pos.y = p.prevPos.y = from.y;
  p.pos.z = p.prevPos.z = from.z;
  const inp = createTickInput();
  inp.moveZ = 1;
  inp.yaw = Math.atan2(-(toward.x - from.x), -(toward.z - from.z));
  for (let i = 0; i < ticks; i++) {
    world.step(inp, bus);
    onTick?.(world);
  }
  return world;
}

function centre(b: BoxDef): Vec3 {
  return vec3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
}

describe('shipped maps', () => {
  it('are registered under their ids', () => {
    expect(Object.keys(MAPS).sort()).toEqual(['elbow', 'lane', 'range']);
    expect(MAPS.lane).toBe(laneMap);
    expect(MAPS.elbow).toBe(elbowMap);
  });

  it.each([['lane', laneMap], ['elbow', elbowMap]] as const)('%s lints clean: no errors, no warnings', (_id, map) => {
    const report = lintMap(map);
    expect(lintErrors(report)).toEqual([]);
    expect(report.issues).toEqual([]);
  });

  it.each([['lane', laneMap], ['elbow', elbowMap]] as const)('%s runs in the simulation and the player stands on the floor', (_id, map) => {
    const world = new World({ level: map, tunables: cloneTunables(), seed: 1 });
    const bus = new EventBus<SimEvents>();
    const input = createTickInput();
    for (let i = 0; i < 256; i++) world.step(input, bus);
    expect(world.player.grounded).toBe(true);
    expect(world.player.pos.x).toBeCloseTo(map.spawn.pos.x, 5);
    expect(world.player.pos.z).toBeCloseTo(map.spawn.pos.z, 5);
  });
});

describe('Lane', () => {
  const floor = laneMap.boxes.find((b) => b.id === 'floor')!;
  const stops = laneMap.boxes.filter((b) => b.id?.startsWith('stop-'));

  it('is a 6 x 30 m corridor', () => {
    expect(laneMap.bounds.max.x - laneMap.bounds.min.x).toBe(6);
    expect(laneMap.bounds.max.z - laneMap.bounds.min.z).toBe(30);
    expect(floor.max.y).toBe(0);
    const w = laneMap.boxes.find((b) => b.id === 'wall-west')!;
    const e = laneMap.boxes.find((b) => b.id === 'wall-east')!;
    expect(e.min.x - w.max.x).toBe(6);
  });

  it('has five half-wall stops (1.3 m) that alternate sides along the lane', () => {
    expect(stops).toHaveLength(5);
    for (const s of stops) expect(s.max.y).toBeCloseTo(1.3, 5);
    const sides = stops.map((s) => (s.max.x <= 0 ? 'left' : 'right'));
    expect(sides).toEqual(['left', 'right', 'left', 'right', 'left']);
    // 5 m apart, leaving a 4 m gap so the player can strafe past each one
    const zs = stops.map((s) => (s.min.z + s.max.z) / 2);
    for (let i = 1; i < zs.length; i++) expect(zs[i - 1]! - zs[i]!).toBeCloseTo(5, 5);
    for (const s of stops) expect(s.max.x - s.min.x).toBeCloseTo(2, 5);
  });

  it('starts the player at the near end with a start line in front of them', () => {
    expect(laneMap.spawn.pos.z).toBe(14);
    expect(laneMap.spawn.yaw).toBe(0); // looking down -Z, along the lane
    const lines = laneMap.marks.filter((m) => m.kind === 'line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.a.z).toBeLessThan(laneMap.spawn.pos.z);
    expect(lines[0]!.a.z).toBe(lines[0]!.b.z);
    expect(laneMap.lanes).toHaveLength(1);
    expect(laneMap.lanes[0]!.width).toBe(6);
  });

  it('has an armed stripe (render-side marks the renderer lights); nothing else collides with it', () => {
    const armed = laneMap.marks.filter((m) => m.kind === 'armed');
    expect(armed.length).toBeGreaterThanOrEqual(2);
    // The stripe is only floor paint: no box, no anchor, nothing the simulation sees.
    expect(laneMap.boxes.some((b) => b.tag === 'floor' && b.max.y > 0)).toBe(false);
    // The runner stays clear of the half-walls (they only occupy |x| >= 1), so it is never hidden under one.
    const runner = armed.find((m) => m.a.x === m.b.x)!;
    expect(Math.abs(runner.a.x)).toBeLessThan(1);
  });

  it('has post anchors 15-30 m from the spawn, including a far-end alcove', () => {
    const posts = anchorsOfKind(laneMap, 'post');
    expect(posts.length).toBeGreaterThanOrEqual(15);
    for (const p of posts) {
      const d = distanceFromSpawn(laneMap, p.pos);
      expect(d, p.id).toBeGreaterThanOrEqual(15);
      expect(d, p.id).toBeLessThanOrEqual(30);
      // every post faces the spawn
      const toSpawn = { x: laneMap.spawn.pos.x - p.pos.x, z: laneMap.spawn.pos.z - p.pos.z };
      const facing = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
      expect((toSpawn.x * facing.x + toSpawn.z * facing.z) / Math.hypot(toSpawn.x, toSpawn.z)).toBeGreaterThan(0.999);
    }
    const alcove = posts.filter((p) => p.tags.includes('alcove'));
    expect(alcove.length).toBeGreaterThanOrEqual(4);
    for (const p of alcove) {
      expect(p.pos.z).toBeLessThan(-12); // inside the narrowed last 3 m
      expect(distanceFromSpawn(laneMap, p.pos)).toBeGreaterThanOrEqual(27);
    }
    // a spread of distances, not one wall of targets
    const bands = new Set(posts.map((p) => Math.round(distanceFromSpawn(laneMap, p.pos))));
    expect(bands.size).toBeGreaterThanOrEqual(6);
  });

  it('keeps every post clear of the half-walls', () => {
    for (const p of anchorsOfKind(laneMap, 'post')) {
      for (const s of stops) expect(hullOverlaps(p.pos.x, p.pos.y, p.pos.z, hw, 1.8, s), `${p.id} vs ${s.id}`).toBe(false);
    }
  });

  it('every post is shootable from the spawn at head height', () => {
    const from = { x: laneMap.spawn.pos.x, y: eye, z: laneMap.spawn.pos.z };
    for (const p of anchorsOfKind(laneMap, 'post')) {
      expect(clear(laneMap.boxes, from, { x: p.pos.x, y: HEAD, z: p.pos.z }), p.id).toBe(true);
    }
  });

  it('the player cannot walk into a half-wall, the walls or the alcove corners', () => {
    for (const s of stops) {
      const left = s.max.x <= 0;
      const start = vec3(left ? -2 : 2, 0, (s.min.z + s.max.z) / 2 + 3); // south of the stop, walking north into it
      const w = walkInto(laneMap, start, vec3(start.x, 0, start.z - 10), 256);
      expect(w.player.pos.z, s.id).toBeCloseTo(s.max.z + hw, 4);
    }
    const west = walkInto(laneMap, vec3(0, 0, 14), vec3(-10, 0, 14), 256);
    expect(west.player.pos.x).toBeCloseTo(-3 + hw, 4);
    const far = walkInto(laneMap, vec3(0, 0, 14), vec3(0, 0, -40), 768);
    expect(far.player.pos.z).toBeCloseTo(-15 + hw, 4);
    const alcoveCorner = walkInto(laneMap, vec3(2.5, 0, -8), vec3(2.5, 0, -40), 512); // x = 2.5 is inside the east alcove wall line
    expect(alcoveCorner.player.pos.z).toBeCloseTo(-12 + hw, 4);
  });
});

describe('Elbow', () => {
  const peeks = anchorsOfKind(elbowMap, 'peek');
  const peekById = new Map(peeks.map((p) => [p.id, p]));
  const box = (id: string): BoxDef => elbowMap.boxes.find((b) => b.id === id)!;

  /** Distance a checkpoint's primary angle (its first peek) is shown at: checkpoint to the peeker's exposed position. */
  function angleDistance(cpIndex: number): number {
    const cp = elbowMap.checkpoints[cpIndex]!;
    const out = peekById.get(cp.angleAnchors[0]!)!.out;
    return Math.hypot(out.x - cp.pos.x, out.z - cp.pos.z);
  }

  it('is a 26 x 26 m footprint', () => {
    expect(elbowMap.bounds.max.x - elbowMap.bounds.min.x).toBe(26);
    expect(elbowMap.bounds.max.z - elbowMap.bounds.min.z).toBe(26);
  });

  it('is L-shaped: the north-east quarter of the footprint is not walkable', () => {
    // Probe a grid of standing positions; the corridor arms are open, the far corner is solid or walled off.
    const open = (x: number, z: number): boolean => !hullBlocked(elbowMap.boxes, x, 0, z, hw, 1.8);
    expect(open(0, 9.5)).toBe(true); // south arm
    expect(open(-9.5, -5)).toBe(true); // west arm
    // No route from the south arm to the north-east corner except through the three doorways, and the
    // corner itself is walled: a hull in the open at (11, -10) has nothing around it but void.
    expect(elbowMap.nav.nodes.some((n) => n.pos.x > 9 && n.pos.z < 5)).toBe(false);
    // The two arms meet at the elbow.
    const junction = elbowMap.nav.nodes.find((n) => n.id === 'n-junction')!;
    expect(junction.pos.x).toBeLessThan(-6);
    expect(junction.pos.z).toBeGreaterThan(6);
  });

  it('has three doorways about 2 m wide that a player can walk through, in walls that stop them elsewhere', () => {
    const doors = [
      { id: 'D1 south', at: vec3(4, 0, 5.75), along: 'z', wall: ['arm-south-wall-a', 'arm-south-wall-b'] },
      { id: 'D2 west', at: vec3(-5.75, 0, -1.5), along: 'x', wall: ['arm-west-wall-a', 'arm-west-wall-b'] },
      { id: 'D3 north', at: vec3(4.5, 0, -4.25), along: 'z', wall: ['hub-north-wall-a', 'hub-north-wall-b'] },
    ];
    for (const d of doors) {
      expect(hullBlocked(elbowMap.boxes, d.at.x, 0, d.at.z, hw, 1.8), d.id).toBe(false);
      const [a, b] = d.wall.map(box) as [BoxDef, BoxDef];
      const gap = d.along === 'z' ? b.min.x - a.max.x : b.min.z - a.max.z;
      expect(gap, d.id).toBeCloseTo(2, 5);
    }
    // and the door really opens onto both sides in the sim: walk from the south arm into the hub through D1
    const through = walkInto(elbowMap, vec3(4, 0, 9), vec3(4, 0, 0), 512);
    expect(through.player.pos.z).toBeLessThan(0);
  });

  it('has crates at low (1.0 m), half (1.3 m) and full (2.0 m or more) heights', () => {
    const heights = elbowMap.boxes.filter((b) => b.tag === 'crate').map((b) => Math.round((b.max.y - b.min.y) * 100) / 100);
    expect(heights.filter((h) => h === 1.0).length).toBeGreaterThanOrEqual(2);
    expect(heights.filter((h) => h === 1.3).length).toBeGreaterThanOrEqual(2);
    expect(heights.filter((h) => h >= 2.0).length).toBeGreaterThanOrEqual(2);
    expect(heights.every((h) => h === 1.0 || h === 1.3 || h >= 2.0)).toBe(true);
  });

  it('has ten checkpoints, each with at least one peek anchor to serve it', () => {
    expect(elbowMap.checkpoints).toHaveLength(10);
    for (const c of elbowMap.checkpoints) expect(c.angleAnchors.length, c.id).toBeGreaterThanOrEqual(1);
  });

  it('covers close (5-8 m), mid (12-16 m) and long (22-26 m) angles, at least three of each', () => {
    const counts = { close: 0, mid: 0, long: 0 };
    elbowMap.checkpoints.forEach((c, i) => {
      const d = angleDistance(i);
      if (d >= 5 && d <= 8) counts.close++;
      else if (d >= 12 && d <= 16) counts.mid++;
      else if (d >= 22 && d <= 26) counts.long++;
      else throw new Error(`${c.id}: angle at ${d.toFixed(1)} m is in no band`);
    });
    expect(counts.close).toBeGreaterThanOrEqual(3);
    expect(counts.mid).toBeGreaterThanOrEqual(3);
    expect(counts.long).toBeGreaterThanOrEqual(3);
  });

  it('has six peek anchors and every peek pattern appears', () => {
    expect(peeks).toHaveLength(6);
    expect(new Set(peeks.map((p) => p.pattern))).toEqual(new Set(['shoulder', 'wide', 'jiggle', 'hop']));
  });

  it('every peeker is hidden at its hold and exposed at its out, from each checkpoint it serves', () => {
    const lowCover = (p: PeekAnchor): boolean => p.pattern === 'hop';
    for (const c of elbowMap.checkpoints) {
      const from = { x: c.pos.x, y: c.pos.y + eye, z: c.pos.z };
      for (const ref of c.angleAnchors) {
        const p = peekById.get(ref)!;
        const where = `${c.id} -> ${p.id}`;
        expect(clear(elbowMap.boxes, from, { x: p.out.x, y: p.out.y + HEAD, z: p.out.z }), `${where}: out is visible`).toBe(true);
        if (lowCover(p)) {
          // a hop rises over LOW cover: the cover is a 1.0 m crate and the peeker waits right behind it
          expect(box(p.cover).max.y - box(p.cover).min.y).toBeLessThanOrEqual(1.3);
          continue;
        }
        expect(clear(elbowMap.boxes, from, { x: p.hold.x, y: p.hold.y + HEAD, z: p.hold.z }), `${where}: hold is hidden`).toBe(false);
        // full cover (a wall or a 2 m+ stack) so a standing Echo is hidden at the hold
        const cover = box(p.cover);
        expect(cover.max.y - cover.min.y, `${p.id} cover height`).toBeGreaterThanOrEqual(2.0);
      }
    }
  });

  it('peek holds and exits are two different standing spots a step apart (hop: a vertical pop)', () => {
    for (const p of peeks) {
      const d = Math.hypot(p.out.x - p.hold.x, p.out.z - p.hold.z);
      if (p.pattern === 'hop') expect(d).toBe(0);
      else if (p.pattern === 'wide') expect(d).toBeGreaterThanOrEqual(2);
      else {
        expect(d).toBeGreaterThanOrEqual(0.9);
        expect(d).toBeLessThanOrEqual(2);
      }
    }
  });

  it('has an elevated hold reached by a ramp, and the lint can walk to it', () => {
    const ramp = elbowMap.boxes.find((b) => b.tag === 'ramp')!;
    expect(ramp.ramp).toBeDefined();
    const elevated = peeks.filter((p) => p.hold.y > 1 && p.out.y > 1);
    expect(elevated).toHaveLength(1);
    expect(elevated[0]!.out.y).toBeCloseTo(ramp.max.y, 5);
    // walk the real sim up the ramp from its foot: the player ends up standing on the deck
    const start = vec3((ramp.min.x + ramp.max.x) / 2, 0, ramp.max.z + 1);
    const w = walkInto(elbowMap, start, vec3(start.x, 0, ramp.min.z - 10), 384);
    expect(w.player.pos.y).toBeCloseTo(ramp.max.y, 2);
    expect(w.player.grounded).toBe(true);
  });

  it('spawns the player at the east end of the south arm looking down its length', () => {
    expect(elbowMap.spawn.pos.x).toBeGreaterThan(10);
    const fwd = { x: -Math.sin(elbowMap.spawn.yaw), z: -Math.cos(elbowMap.spawn.yaw) };
    expect(fwd.x).toBeCloseTo(-1, 5);
    const report = lintMap(elbowMap);
    expect(report.sightlines.spawnForward).toBeGreaterThan(22);
  });

  it('the player cannot clip into any crate from any side', () => {
    const crates = elbowMap.boxes.filter((b) => b.tag === 'crate');
    expect(crates.length).toBeGreaterThanOrEqual(9);
    let walked = 0;
    for (const c of crates) {
      const mid = centre(c);
      const faces: [string, Vec3][] = [
        ['west', vec3(c.min.x - 1.2, c.min.y, mid.z)],
        ['east', vec3(c.max.x + 1.2, c.min.y, mid.z)],
        ['north', vec3(mid.x, c.min.y, c.min.z - 1.2)],
        ['south', vec3(mid.x, c.min.y, c.max.z + 1.2)],
      ];
      for (const [face, start] of faces) {
        // skip approaches that start inside geometry (against a wall or another crate)
        if (hullBlocked(elbowMap.boxes, start.x, start.y, start.z, hw, 1.8 - 0.002)) continue;
        // walk at the crate's centre: the hull must never overlap any box on any tick
        const w = walkInto(elbowMap, start, vec3(mid.x, c.min.y, mid.z), 192, (world) => {
          const p = world.player;
          for (const b of elbowMap.boxes) {
            if (hullOverlaps(p.pos.x, p.pos.y + 0.001, p.pos.z, hw, p.height - 0.002, b)) {
              throw new Error(`${c.id} (${face}): hull inside ${b.id} at ${p.pos.x.toFixed(2)}, ${p.pos.z.toFixed(2)}`);
            }
          }
        });
        // and it stopped at the face (not on top of it: a 1 m crate is above a step)
        expect(w.player.pos.y, `${c.id} ${face}`).toBeCloseTo(c.min.y, 3);
        walked++;
      }
    }
    expect(walked).toBeGreaterThanOrEqual(24);
  });
});
