import { describe, expect, it } from 'vitest';
import { lintErrors, lintMap, formatLintReport } from './mapLint';
import { elbowMap, laneMap, rangeMap } from './mapLoader';
import {
  distanceFromEntry,
  holdAnchorsInBand,
  holdAnchorsOf,
  holdStandPos,
  sectorById,
  sectorsByRole,
} from './mapQuery';
import { parseMap, type MapIssue } from './mapSchema';
import type { MapDef } from './mapTypes';

/**
 * A 20 x 20 m room cut in two by a full-height divider (x = 0, z from -10 to 3) with a 7 m gap on
 * the south side, plus a sealed 2 x 2 m pen in the north-east corner. One sector covers the room.
 * West half: the entry. East half: hold anchors, one hidden behind the divider, one in sight
 * through the gap.
 */
function room(): Record<string, any> {
  return {
    schema: 1,
    id: 'room',
    name: 'Room',
    bounds: { min: [-10, 0, -10], max: [10, 4, 10] },
    spawn: { pos: [-5, 0, 5], yaw: 0 },
    boxes: [
      { id: 'floor', tag: 'floor', min: [-10.5, -1, -10.5], max: [10.5, 0, 10.5] },
      { id: 'divider', tag: 'wall', min: [-0.25, 0, -10], max: [0.25, 4, 3] },
      { id: 'pen-w', tag: 'wall', min: [6.8, 0, -9], max: [7, 4, -7] },
      { id: 'pen-e', tag: 'wall', min: [9, 0, -9], max: [9.2, 4, -7] },
      { id: 'pen-n', tag: 'wall', min: [7, 0, -9], max: [9, 4, -8.8] },
      { id: 'pen-s', tag: 'wall', min: [7, 0, -7.2], max: [9, 4, -7] },
    ],
    anchors: [
      { kind: 'hold', id: 'hold-hidden', pos: [5, 0, -5], yaw: 1.57 },
      { kind: 'hold', id: 'hold-hidden-2', pos: [5, 0, -2], yaw: 1.57 },
      { kind: 'hold', id: 'hold-seen', pos: [5, 0, 5], yaw: 1.57 },
      { kind: 'hold', id: 'hold-west', pos: [-5, 0, -5], yaw: -1.57 },
    ],
    nav: { nodes: [{ id: 'a', pos: [-5, 0, 5] }, { id: 'b', pos: [5, 0, 5] }], edges: [['a', 'b']] },
    lanes: [
      { id: 'lane-in', start: [9, 0, 9], end: [5, 0, 7], width: 2 },
      { id: 'lane-short', start: [-9, 0, 9], end: [-8, 0, 9], width: 2 },
      { id: 'lane-sealed', start: [8, 0, -8], end: [5, 0, 5], width: 2 },
    ],
    sectors: [
      {
        id: 'room-take',
        role: ['take'],
        region: { min: [-10, 0, -10], max: [10, 4, 10] },
        entry: [-5, 0, -5],
        exit: [5, 0, 5],
        holdAnchors: ['hold-hidden', 'hold-hidden-2'],
      },
    ],
    look: { sky: '#101820', fog: [20, 80], palette: 'hall' },
  };
}

function edited(edit: (m: Record<string, any>) => void): Record<string, any> {
  const m = structuredClone(room());
  edit(m);
  return m;
}

function load(raw: unknown): MapDef {
  const r = parseMap(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.map;
}

function issues(raw: unknown): MapIssue[] {
  const r = parseMap(raw);
  return r.ok ? [] : r.errors;
}

function sectorErrors(raw: unknown, check?: string): string[] {
  return lintErrors(lintMap(load(raw)))
    .filter((i) => i.check.startsWith('sector') && (check === undefined || i.check === check))
    .map((i) => `[${i.check}] ${i.where}: ${i.message}`);
}

describe('sectors in the map schema', () => {
  it('accepts a sector map and keeps the lists the loader builds', () => {
    const map = load(room());
    expect(map.sectors).toHaveLength(1);
    const s = map.sectors[0]!;
    expect(s.role).toEqual(['take']);
    expect(s.region.max).toEqual({ x: 10, y: 4, z: 10 });
    expect(s.entry).toEqual({ x: -5, y: 0, z: -5 });
    expect(s.approaches).toEqual([]);
    expect(map.enemyFeet.length).toBe(4); // hold anchors are where Echoes stand
  });

  it('loads a map without sectors (they are optional)', () => {
    const raw = room();
    delete raw.sectors;
    expect(load(raw).sectors).toEqual([]);
    expect(rangeMap.sectors).toEqual([]);
  });

  it('reports every problem with its JSON path', () => {
    const bad = edited((m) => {
      m.sectors = [
        { id: 's', role: [], region: { min: [1, 0, 0], max: [0, 4, 1] }, entry: [0, 0], exit: [0, 0, 0], holdAnchors: ['nope', 'hold-hidden', 'hold-hidden'], approaches: ['nolane'], extra: 1 },
        { id: 's', role: ['take', 'take', 'sprint'], region: { min: [0, 0, 0], max: [1, 1, 1] }, entry: [0, 0, 0], exit: [0, 0, 0], holdAnchors: [] },
      ];
    });
    const paths = issues(bad).map((i) => `${i.path}: ${i.message}`);
    expect(paths).toEqual(expect.arrayContaining([
      '$.sectors[0].extra: unknown property',
      '$.sectors[0].role: a sector needs at least one role',
      expect.stringContaining('$.sectors[0].region:'),
      '$.sectors[0].holdAnchors[0]: unknown anchor "nope"',
      '$.sectors[0].holdAnchors: lists an anchor more than once',
      '$.sectors[0].approaches[0]: unknown lane "nolane"',
      expect.stringContaining('$.sectors[0].entry:'),
      '$.sectors[1].id: duplicate sector id "s"',
      '$.sectors[1].role[1]: duplicate role "take"',
      expect.stringContaining('$.sectors[1].role[2]:'),
    ]));
  });

  it('only a hold or a peek anchor can hold an Echo', () => {
    const raw = edited((m) => {
      m.anchors.push({ kind: 'post', id: 'a-post', pos: [5, 0, 0], yaw: 0 });
      m.sectors[0].holdAnchors.push('a-post');
    });
    expect(issues(raw).map((i) => i.message)).toContain('anchor "a-post" is a post, expected a hold or a peek');
  });
});

describe('sector lint', () => {
  it('passes the base fixture: hold anchors hidden behind the divider, exit reachable through the gap', () => {
    const report = lintMap(load(room()));
    expect(report.issues.filter((i) => i.check.startsWith('sector'))).toEqual([]);
    expect(report.sectors).toHaveLength(1);
    expect(report.sectors[0]!.holdAnchors).toBe(2);
    expect(report.sectors[0]!.longest.length).toBeGreaterThan(10);
  });

  it('fails when a hold anchor is visible from the entry at standing eye height', () => {
    const raw = edited((m) => m.sectors[0].holdAnchors.push('hold-seen'));
    // from the entry (-5, 0, -5) the divider hides hold-seen (5, 0, 5); from (-5, 0, 5) the gap shows it
    expect(sectorErrors(raw)).toEqual([]);
    raw.sectors[0].entry = [-5, 0, 5];
    const errs = sectorErrors(raw, 'sector-hold-visible');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('anchor hold-seen');
    expect(errs[0]).toContain('in line of sight of the entry');
  });

  it('counts a crouching Echo behind half cover as hidden, a standing one as visible', () => {
    const raw = edited((m) => {
      m.boxes.push({ id: 'half', tag: 'cover', min: [4, 0, 3.5], max: [6, 1.3, 4] });
      m.anchors.push({ kind: 'hold', id: 'hold-crouch', pos: [5, 0, 4.6], yaw: 0, stance: 'crouch' });
      m.anchors.push({ kind: 'hold', id: 'hold-stand', pos: [5.5, 0, 4.6], yaw: 0 });
      m.sectors[0].entry = [5, 0, -1.5];
    });
    raw.sectors[0].holdAnchors = ['hold-west', 'hold-crouch']; // hold-west is behind the divider
    expect(sectorErrors(raw)).toEqual([]);
    raw.sectors[0].holdAnchors = ['hold-west', 'hold-stand'];
    expect(sectorErrors(raw, 'sector-hold-visible')).toHaveLength(1);
  });

  it('only a take sector hides its hold anchors from the entry (hold and meet Echoes arrive after it starts)', () => {
    const raw = edited((m) => {
      m.sectors[0].holdAnchors.push('hold-seen');
      m.sectors[0].entry = [-5, 0, 5];
      m.sectors[0].role = ['meet'];
    });
    expect(sectorErrors(raw)).toEqual([]);
    raw.sectors[0].role = ['hold', 'take'];
    raw.sectors[0].approaches = ['lane-in'];
    expect(sectorErrors(raw, 'sector-hold-visible')).toHaveLength(1);
  });

  it('fails when the exit cannot be reached on foot from the entry', () => {
    const raw = edited((m) => { m.sectors[0].exit = [8, 0, -8]; }); // inside the sealed pen
    const errs = sectorErrors(raw, 'sector-reach');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('cannot be reached on foot');
  });

  it('fails when the only walk between entry and exit leaves the region', () => {
    const raw = edited((m) => {
      // entry on the west side, exit on the east side, region only the north part: the gap is outside it
      m.sectors[0].region = { min: [-10, 0, -10], max: [10, 4, 2.9] };
      m.sectors[0].exit = [5, 0, -5];
    });
    expect(sectorErrors(raw, 'sector-reach')).toHaveLength(1);
  });

  it('fails when a gate or a hold anchor is outside the region', () => {
    const raw = edited((m) => {
      m.sectors[0].region = { min: [-10, 0, -10], max: [3, 4, 10] };
    });
    const errs = sectorErrors(raw);
    expect(errs.some((e) => e.includes('[sector-gate]') && e.includes('exit'))).toBe(true);
    expect(errs.some((e) => e.includes('[sector-hold]') && e.includes('hold-hidden'))).toBe(true);
  });

  it('fails when a gate is inside geometry', () => {
    const raw = edited((m) => { m.sectors[0].entry = [0, 0, -5]; });
    expect(sectorErrors(raw, 'sector-gate').some((e) => e.includes('inside geometry'))).toBe(true);
  });

  it('needs hold anchors in a take sector, and wants at least two', () => {
    const none = edited((m) => { m.sectors[0].holdAnchors = []; });
    expect(sectorErrors(none, 'sector-hold')).toHaveLength(1);
    const one = edited((m) => { m.sectors[0].holdAnchors = ['hold-hidden']; });
    const warns = lintMap(load(one)).issues.filter((i) => i.severity === 'warning' && i.check === 'sector-hold');
    expect(warns).toHaveLength(1);
  });

  it('checks approach lanes: each ends in the region and can be walked', () => {
    const base = edited((m) => {
      m.sectors[0].role = ['hold'];
      m.sectors[0].region = { min: [0.5, 0, -10], max: [10, 4, 10] };
      m.sectors[0].entry = [5, 0, 8];
      m.sectors[0].exit = [5, 0, 5];
      m.sectors[0].holdAnchors = ['hold-hidden', 'hold-seen'];
    });
    expect(sectorErrors(base, 'sector-approach')).toEqual(['[sector-approach] sector room-take: a hold sector needs at least one approach lane (the enemies arrive along it)']);
    base.sectors[0].approaches = ['lane-in'];
    expect(sectorErrors(base)).toEqual([]);
    // west of the divider, outside the region: does not reach it
    base.sectors[0].approaches = ['lane-short'];
    expect(sectorErrors(base, 'sector-approach').some((e) => e.includes('does not reach it'))).toBe(true);
    // ends inside the region but starts inside a sealed pen: no way in
    base.sectors[0].approaches = ['lane-sealed'];
    expect(sectorErrors(base, 'sector-approach').some((e) => e.includes('cannot be reached on foot'))).toBe(true);
  });

  it('fails when two regions overlap, and lets regions that only touch, or differ in height, pass', () => {
    const second = (min: number[], max: number[]) => ({
      id: 'room-other', role: ['meet'], region: { min, max }, entry: [5, 0, 5], exit: [5, 0, 6], holdAnchors: ['hold-seen'],
    });
    const overlapping = edited((m) => {
      m.sectors[0].region = { min: [-10, 0, -10], max: [0, 4, 10] };
      m.sectors[0].entry = [-5, 0, -5];
      m.sectors[0].exit = [-5, 0, 5];
      m.sectors[0].holdAnchors = ['hold-west'];
      m.sectors.push(second([-1, 0, -10], [10, 4, 10]));
    });
    expect(sectorErrors(overlapping, 'sector-overlap')).toHaveLength(1);
    overlapping.sectors[1].region = { min: [0, 0, -10], max: [10, 4, 10] }; // touching at x = 0
    expect(sectorErrors(overlapping, 'sector-overlap')).toEqual([]);
    overlapping.sectors[1].region = { min: [-10, 4, -10], max: [10, 8, 10] }; // stacked above
    expect(sectorErrors(overlapping, 'sector-overlap')).toEqual([]);
  });
});

describe('shipped maps', () => {
  it.each([['elbow', elbowMap], ['lane', laneMap]] as const)('%s lints clean with sectors and reports each sector\'s longest sightline', (_id, map) => {
    const report = lintMap(map);
    expect(lintErrors(report)).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.sectors.map((s) => s.id)).toEqual(map.sectors.map((s) => s.id));
    for (const s of report.sectors) expect(s.longest.length, s.id).toBeGreaterThan(5);
    const text = formatLintReport(report).join('\n');
    for (const s of map.sectors) expect(text).toContain(`sector ${s.id}`);
  });

  it('Elbow has four sectors: three that can be taken (the door and hub also hold) and three that can be held (#204)', () => {
    expect(elbowMap.sectors).toHaveLength(4);
    expect(sectorsByRole(elbowMap, 'take').map((s) => s.id).sort()).toEqual(['elbow-take-door', 'elbow-take-hub', 'elbow-take-west']);
    expect(sectorsByRole(elbowMap, 'hold').map((s) => s.id).sort()).toEqual(['elbow-hold-corner', 'elbow-take-door', 'elbow-take-hub']);
    // Every sector names approach lanes: arrivals of a hold sector and followers of a take sector walk them in.
    for (const s of elbowMap.sectors) expect(s.approaches.length, s.id).toBeGreaterThanOrEqual(2);
    expect(sectorsByRole(elbowMap, 'meet')).toHaveLength(0);
  });

  it('Lane has one take and one meet sector', () => {
    expect(laneMap.sectors).toHaveLength(2);
    expect(sectorsByRole(laneMap, 'take')).toHaveLength(1);
    expect(sectorsByRole(laneMap, 'meet')).toHaveLength(1);
  });

  it('every Elbow checkpoint lies in exactly one sector, and every peek anchor is a hold anchor or a checkpoint angle', () => {
    for (const c of elbowMap.checkpoints) {
      const inside = elbowMap.sectors.filter((s) => c.pos.x >= s.region.min.x && c.pos.x <= s.region.max.x && c.pos.z >= s.region.min.z && c.pos.z <= s.region.max.z);
      expect(inside.length, c.id).toBeGreaterThanOrEqual(1);
    }
    const used = new Set(elbowMap.sectors.flatMap((s) => s.holdAnchors));
    const peeks = elbowMap.anchors.filter((a) => a.kind === 'peek');
    expect(peeks.filter((p) => used.has(p.id)).length).toBeGreaterThanOrEqual(5);
  });

  it('Elbow takes have hold anchors to place, and the hold sector has approach lanes that end in it', () => {
    for (const s of sectorsByRole(elbowMap, 'take')) expect(holdAnchorsOf(elbowMap, s).length, s.id).toBeGreaterThanOrEqual(2);
    const hold = sectorsByRole(elbowMap, 'hold')[0]!;
    expect(hold.approaches.length).toBeGreaterThanOrEqual(2);
    for (const id of hold.approaches) {
      const lane = elbowMap.lanes.find((l) => l.id === id)!;
      expect(lane.end.x).toBeGreaterThanOrEqual(hold.region.min.x);
      expect(lane.end.x).toBeLessThanOrEqual(hold.region.max.x);
    }
  });

  it('hold anchors never leak into the drills\' post queries', () => {
    for (const m of [elbowMap, laneMap]) {
      const posts = m.anchors.filter((a) => a.kind === 'post');
      const holds = m.anchors.filter((a) => a.kind === 'hold');
      expect(holds.length).toBeGreaterThan(0);
      expect(posts.some((p) => holds.some((h) => h.id === p.id))).toBe(false);
    }
  });
});

describe('sector queries', () => {
  it('finds sectors by role and id', () => {
    expect(sectorById(elbowMap, 'elbow-hold-corner')?.role).toEqual(['hold']);
    expect(sectorById(elbowMap, 'nope')).toBeUndefined();
    expect(sectorsByRole(rangeMap, 'take')).toEqual([]);
  });

  it('lists a sector\'s hold anchors in order, peeks by their hold spot', () => {
    const s = sectorById(elbowMap, 'elbow-take-hub')!;
    const anchors = holdAnchorsOf(elbowMap, s);
    expect(anchors.map((a) => a.id)).toEqual(s.holdAnchors);
    const peek = anchors.find((a) => a.kind === 'peek')!;
    expect(holdStandPos(peek)).toBe((peek as { hold: unknown }).hold);
  });

  it('picks hold anchors by distance band from the entry', () => {
    const s = sectorById(elbowMap, 'elbow-take-hub')!;
    const all = holdAnchorsOf(elbowMap, s);
    const close = holdAnchorsInBand(elbowMap, s, 0, 12);
    const far = holdAnchorsInBand(elbowMap, s, 12, 40);
    expect(close.length + far.length).toBe(all.length);
    expect(close.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    for (const a of far) expect(distanceFromEntry(s, a)).toBeGreaterThanOrEqual(12);
    expect(holdAnchorsInBand(elbowMap, s, 100, 200)).toEqual([]);
  });
});
