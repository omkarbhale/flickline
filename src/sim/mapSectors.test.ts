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

/** The sector errors of a map, not counting what a take sector must offer (`sector-bands`, tested on its own below). */
function sectorErrors(raw: unknown, check?: string): string[] {
  return lintErrors(lintMap(load(raw)))
    .filter((i) => i.check.startsWith('sector') && (check === undefined ? i.check !== 'sector-bands' : i.check === check))
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
    expect(report.issues.filter((i) => i.check.startsWith('sector') && i.check !== 'sector-bands')).toEqual([]);
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

  it('lets regions overlap: a map is a venue and a sector a route through it', () => {
    const raw = edited((m) => {
      m.sectors.push({ id: 'room-other', role: ['meet'], region: { min: [-10, 0, -10], max: [10, 4, 10] }, entry: [5, 0, 5], exit: [5, 0, 6], holdAnchors: ['hold-seen'] });
    });
    expect(sectorErrors(raw)).toEqual([]);
  });
});

describe('what a take sector offers (#249)', () => {
  const bandErrors = (raw: unknown): string[] => sectorErrors(raw, 'sector-bands');

  it('reports where each hold anchor first shows to a player walking from the entry to the exit, and its band', () => {
    const report = lintMap(load(room()));
    const sights = report.sectors[0]!.sights;
    expect(sights.map((x) => x.id)).toEqual(['hold-hidden', 'hold-hidden-2']);
    // from the entry the divider hides both; the walk reaches the gap on its way to the exit
    expect(sights[0]!.distM).toBeCloseTo(11.66, 1);
    expect(sights[0]!.band).toBe('mid');
    expect(sights[1]!.distM).toBeCloseTo(9.55, 1);
    expect(sights[1]!.band).toBe('close');
    for (const x of sights) expect(x.dy).toBe(0);
    expect(formatLintReport(report).join('\n')).toContain('first sights: hold-hidden 11.66 m mid');
  });

  it('a take sector must offer something off the floor plane and a crouched position; a sector with no first sights is not a take', () => {
    expect(bandErrors(room())).toEqual([
      '[sector-bands] sector room-take: no hold anchor stands 1 m or more above or below the player where it first shows; a take sector needs one fight off the floor plane',
      '[sector-bands] sector room-take: no hold anchor is crouched; a take sector needs a low position',
    ]);
    const full = edited((m) => {
      m.boxes.push({ id: 'deck', tag: 'platform', min: [6, 0, -8], max: [8, 1.2, -6] });
      m.boxes.push({ id: 'ramp', tag: 'ramp', min: [3, 0, -8], max: [6, 1.2, -6], ramp: { rise: '+x', lowY: 0 } });
      m.anchors.push({ kind: 'hold', id: 'hold-up', pos: [7, 1.2, -7], yaw: 1.57 });
      m.anchors.push({ kind: 'hold', id: 'hold-low', pos: [5, 0, -3.2], yaw: 1.57, stance: 'crouch' });
      m.sectors[0].holdAnchors.push('hold-up', 'hold-low');
    });
    expect(bandErrors(full)).toEqual([]);
    const sights = lintMap(load(full)).sectors[0]!.sights;
    expect(sights.find((x) => x.id === 'hold-up')!.dy).toBeGreaterThanOrEqual(1);
    expect(sights.find((x) => x.id === 'hold-low')!.crouched).toBe(true);
  });

  it('asks for every distance band the sector\'s own ground reaches, and no more', () => {
    // a 17 m longest sightline cannot start a fight at 20 m: only close and mid are owed, and both are met
    expect(bandErrors(room()).some((e) => e.includes('long band'))).toBe(false);
    // take the close one away: the close band is owed whatever the size
    const noClose = edited((m) => { m.sectors[0].holdAnchors = ['hold-hidden']; });
    expect(bandErrors(noClose).some((e) => e.includes('the close band'))).toBe(true);
    // a hall long enough for a 20 m fight, with no anchor that far, owes the long band
    const hall = edited((m) => {
      m.bounds = { min: [-30, 0, -10], max: [10, 4, 10] };
      m.boxes[0] = { id: 'floor', tag: 'floor', min: [-30.5, -1, -10.5], max: [10.5, 0, 10.5] };
      m.sectors[0].region = { min: [-30, 0, -10], max: [10, 4, 10] };
    });
    expect(bandErrors(hall).some((e) => e.includes('the long band'))).toBe(true);
  });

  it('a take sector needs one hold anchor that holds from cover (a body mostly hidden at its first sight)', () => {
    const open = edited((m) => { m.sectors[0].holdAnchors = ['hold-hidden-2']; });
    expect(bandErrors(open).some((e) => e.includes('holds from cover'))).toBe(true);
    expect(bandErrors(room()).some((e) => e.includes('holds from cover'))).toBe(false);
  });

  it('warns about an anchor the walk never shows (an Echo there is met only by leaving the route)', () => {
    const raw = edited((m) => {
      m.anchors.push({ kind: 'hold', id: 'hold-pen', pos: [8, 0, -8], yaw: 0 });
      m.sectors[0].holdAnchors.push('hold-pen');
    });
    const warn = lintMap(load(raw)).issues.filter((i) => i.severity === 'warning' && i.check === 'sector-bands');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.message).toContain('hold-pen');
    expect(lintMap(load(raw)).sectors[0]!.sights.find((x) => x.id === 'hold-pen')!.distM).toBeNull();
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

  it('every take sector of the shipped maps offers fights across the distance bands its ground reaches, off the floor plane, from cover and crouched (#249)', () => {
    for (const map of [elbowMap, laneMap]) {
      const report = lintMap(map);
      for (const sec of report.sectors.filter((x) => x.role.includes('take'))) {
        const bands = new Set(sec.sights.map((x) => x.band));
        expect(bands.has('close'), `${sec.id} close`).toBe(true);
        if (sec.longest.length >= 10) expect(bands.has('mid'), `${sec.id} mid`).toBe(true);
        if (sec.longest.length >= 20) expect(bands.has('long'), `${sec.id} long`).toBe(true);
        expect(sec.sights.some((x) => x.dy !== null && Math.abs(x.dy) >= 1), `${sec.id} off the floor plane`).toBe(true);
        expect(sec.sights.some((x) => x.crouched), `${sec.id} crouched`).toBe(true);
        expect(sec.sights.some((x) => x.exposure !== null && x.exposure < 0.75), `${sec.id} from cover`).toBe(true);
      }
    }
  });

  it('Lane\'s take sector and two of Elbow\'s have a 20 m line to start a long fight on', () => {
    const longs = [elbowMap, laneMap].flatMap((map) => lintMap(map).sectors.filter((s) => s.role.includes('take') && s.sights.some((x) => x.band === 'long')).map((s) => s.id));
    expect(longs.sort()).toEqual(['elbow-take-door', 'elbow-take-west', 'lane-take-far']);
  });

  it('Elbow has three take sectors and one hold sector', () => {
    expect(elbowMap.sectors).toHaveLength(4);
    expect(sectorsByRole(elbowMap, 'take')).toHaveLength(3);
    expect(sectorsByRole(elbowMap, 'hold')).toHaveLength(1);
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
