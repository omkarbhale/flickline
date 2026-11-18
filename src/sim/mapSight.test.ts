import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { bandOf, bodyShows, firstSeenFrom, firstSight, navRoute, routePoints, SIGHT_BANDS } from './mapSight';
import { elbowMap, laneMap } from './mapLoader';
import { parseMap } from './mapSchema';
import type { MapDef } from './mapTypes';
import { bodyTop } from './exposure';

const t = cloneTunables();
const hit = t.targets.hit;
const eyeH = t.movement.standEyeHeight;

/**
 * A 20 x 20 m room: a full-height divider at x = 0 (z from -10 to 3), a half wall (1.3 m) across the way at x 5..7, z 5.5..6, and a
 * nav graph that goes round the divider's south end.
 */
function room(): MapDef {
  const r = parseMap({
    schema: 1, id: 'room', name: 'Room',
    bounds: { min: [-10, 0, -10], max: [10, 4, 10] },
    spawn: { pos: [-5, 0, 5], yaw: 0 },
    boxes: [
      { id: 'floor', tag: 'floor', min: [-10.5, -1, -10.5], max: [10.5, 0, 10.5] },
      { id: 'divider', tag: 'wall', min: [-0.25, 0, -10], max: [0.25, 4, 3] },
      { id: 'half', tag: 'cover', min: [5, 0, 5.5], max: [7, 1.3, 6] },
    ],
    anchors: [],
    nav: { nodes: [{ id: 'a', pos: [-5, 0, 5] }, { id: 'b', pos: [5, 0, 7] }, { id: 'n', pos: [-5, 0, -5] }], edges: [['n', 'a'], ['a', 'b']] },
    lanes: [],
    sectors: [],
    look: { sky: '#101820', fog: [20, 80], palette: 'hall' },
  });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.map;
}

const p = (x: number, y: number, z: number) => ({ x, y, z });

describe('bodyShows', () => {
  const m = room();
  const half = hit.torsoWidth / 2;
  const top = bodyTop(hit, false);

  it('sees a body in the open and not one behind a full wall', () => {
    expect(bodyShows(m.boxes, half, top, p(-5, eyeH, -5), p(-5, 0, -9))).toBe(true);
    expect(bodyShows(m.boxes, half, top, p(-5, eyeH, -5), p(5, 0, -5))).toBe(false);
  });

  it('sees the head and shoulders of a standing body over a half wall, and the crown of a crouching one level with it', () => {
    expect(bodyShows(m.boxes, half, top, p(6, eyeH, 9), p(6, 0, 4.5))).toBe(true);
    // a crouching Echo's crown (1.30 m) is level with the half wall's top: the grid samples it, so a body there is not hidden (#230)
    expect(bodyShows(m.boxes, half, bodyTop(hit, true), p(6, eyeH, 9), p(6, 0, 5.2))).toBe(true);
  });
});

describe('walks', () => {
  const m = room();

  it('a route is straight when the line is clear and goes round the divider through the nav graph when not', () => {
    expect(navRoute(m, p(-5, 0, 5), p(-5, 0, -5))).toEqual([p(-5, 0, -5)]);
    const round = navRoute(m, p(-5, 0, -5), p(5, 0, 7));
    expect(round.length).toBeGreaterThan(1);
    expect(round[round.length - 1]).toEqual(p(5, 0, 7));
  });

  it('hands every caller its own copy of a cached route', () => {
    const a = navRoute(m, p(-5, 0, -5), p(5, 0, 7));
    a[0]!.x = 999;
    expect(navRoute(m, p(-5, 0, -5), p(5, 0, 7))[0]!.x).not.toBe(999);
  });

  it('keeps a walk off a wall corner the body would catch on: a line that grazes the divider end is not clear', () => {
    // 0.1 m from the divider's south end: a centre line passes, a shoulder 0.3 m to the side does not
    expect(navRoute(m, p(-3, 0, 3.1), p(3, 0, 3.1)).length).toBeGreaterThan(1);
    expect(navRoute(m, p(-3, 0, 4.5), p(3, 0, 4.5))).toEqual([p(3, 0, 4.5)]);
  });

  it('samples a walk every step along its legs, from its start to its end', () => {
    const pts = routePoints(m, p(-5, 0, 5), p(5, 0, 7), 0.5);
    expect(pts[0]).toEqual(p(-5, 0, 5));
    expect(pts[pts.length - 1]!.x).toBeCloseTo(5, 6);
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});

describe('first sight (#249)', () => {
  const m = room();
  const walk = routePoints(m, p(-5, 0, -5), p(5, 0, 7), 0.5);

  it('is where the walk first shows an Echo, how far away, and how much of it', () => {
    // behind the divider from the start; the walk comes round its south end
    const f = firstSight(m.boxes, hit, eyeH, walk, [p(5, 0, -5)], false, 0.5)!;
    expect(f).not.toBeNull();
    expect(f.distM).toBeGreaterThan(5);
    expect(f.walkedM).toBeGreaterThan(0);
    expect(f.dy).toBe(0);
    expect(f.exposure).toBeGreaterThan(0.5);
  });

  it('is null for an Echo the walk never shows, and at the first point for one in sight from the start', () => {
    expect(firstSight(m.boxes, hit, eyeH, walk, [p(-5, 0, -9)], false, 0.5)!.walkedM).toBe(0);
    const sealed = parseMap({
      schema: 1, id: 'pen', name: 'Pen', bounds: { min: [-10, 0, -10], max: [10, 4, 10] }, spawn: { pos: [0, 0, 0], yaw: 0 },
      boxes: [
        { id: 'floor', tag: 'floor', min: [-10.5, -1, -10.5], max: [10.5, 0, 10.5] },
        { id: 'w', tag: 'wall', min: [4, 0, 4], max: [4.2, 4, 8] }, { id: 'e', tag: 'wall', min: [7, 0, 4], max: [7.2, 4, 8] },
        { id: 'n', tag: 'wall', min: [4, 0, 4], max: [7.2, 4, 4.2] }, { id: 's', tag: 'wall', min: [4, 0, 8], max: [7.2, 4, 8.2] },
      ],
      anchors: [], nav: { nodes: [{ id: 'a', pos: [0, 0, 0] }, { id: 'b', pos: [0, 0, -5] }], edges: [['a', 'b']] }, lanes: [], sectors: [],
      look: { sky: '#101820', fog: [20, 80], palette: 'hall' },
    });
    if (!sealed.ok) throw new Error(JSON.stringify(sealed.errors));
    expect(firstSight(sealed.map.boxes, hit, eyeH, routePoints(sealed.map, p(0, 0, 0), p(0, 0, -5), 0.5), [p(5.5, 0, 6)], false, 0.5)).toBeNull();
  });

  it('judges a peek path where it first shows: the nearest stand that shows from a point of the walk', () => {
    const f = firstSight(m.boxes, hit, eyeH, walk, [p(5, 0, -5), p(-5, 0, -9)], false, 0.5)!;
    expect(f.walkedM).toBe(0);
  });

  it('measures height against the player\'s feet', () => {
    const f = firstSight(m.boxes, hit, eyeH, walk, [p(-5, 1.2, -9)], false, 0.5)!;
    expect(f.dy).toBeCloseTo(1.2, 6);
  });

  it('a hold sector\'s arrival is first seen at the first point of its route in sight of a player standing at the entry', () => {
    const eye = p(-5, eyeH, 5);
    const seen = firstSeenFrom(m.boxes, hit, eyeH, eye, routePoints(m, p(-5, 0, -8), p(5, 0, 7), 0.5))!;
    expect(seen.distM).toBeCloseTo(13, 0);
    expect(seen.dy).toBe(0);
    const behind = firstSeenFrom(m.boxes, hit, eyeH, p(5, eyeH, -5), [p(-5, 0, -5), p(-5, 0, 2)]);
    expect(behind).toBeNull();
  });
});

describe('bands', () => {
  it('close below the first threshold, long from the second, mid between', () => {
    expect(SIGHT_BANDS).toEqual(['close', 'mid', 'long']);
    expect(bandOf(3, 10, 20)).toBe('close');
    expect(bandOf(9.99, 10, 20)).toBe('close');
    expect(bandOf(10, 10, 20)).toBe('mid');
    expect(bandOf(19.99, 10, 20)).toBe('mid');
    expect(bandOf(20, 10, 20)).toBe('long');
  });
});

describe('the shipped maps', () => {
  it('Lane\'s take sector is hidden behind its baffle from the entry and open down the whole corridor from the first step past it', () => {
    const sec = laneMap.sectors.find((s) => s.id === 'lane-take-far')!;
    const walk = routePoints(laneMap, sec.entry, sec.exit, 0.5);
    const far = firstSight(laneMap.boxes, hit, eyeH, walk, [p(1.2, 0, -13.6)], false, 0.5)!;
    expect(far.walkedM).toBeGreaterThan(0);
    expect(far.distM).toBeGreaterThan(24);
  });

  it('Elbow\'s south arm shows its far deck to a raised fight at 20 m or more', () => {
    const sec = elbowMap.sectors.find((s) => s.id === 'elbow-take-door')!;
    const walk = routePoints(elbowMap, sec.entry, sec.exit, 0.5);
    const deck = firstSight(elbowMap.boxes, hit, eyeH, walk, [p(-12.2, 1.2, 7.5)], false, 0.5)!;
    expect(deck.distM).toBeGreaterThanOrEqual(20);
    expect(deck.dy).toBeGreaterThanOrEqual(1);
  });
});
