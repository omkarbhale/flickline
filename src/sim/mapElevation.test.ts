import { describe, expect, it } from 'vitest';
import { lintErrors, lintMap } from './mapLint';
import { parseMap, type MapIssue } from './mapSchema';

/**
 * A 20 x 12 m hall with a 2 m high catwalk on the north side, reached by a ramp from the floor.
 * Anchors, nav nodes and a checkpoint sit on the catwalk, so the lint has raised holds to reach.
 */
function hall(): Record<string, unknown> {
  return {
    schema: 1,
    id: 'hall',
    name: 'Hall',
    bounds: { min: [-10, 0, -6], max: [10, 5, 6] },
    spawn: { pos: [0, 0, 4], yaw: 0 },
    boxes: [
      { id: 'floor', tag: 'floor', min: [-10, -1, -6], max: [10, 0, 6] },
      { id: 'catwalk', tag: 'platform', min: [-10, 0, -6], max: [10, 2, -3] },
      // the rail has a gap where the ramp arrives
      { id: 'rail', tag: 'cover', min: [-10, 2, -3.2], max: [3, 3.2, -3] },
      // 2 m rise over 6 m (18.4 deg), climbing toward the catwalk at the north end
      { id: 'ramp', tag: 'ramp', min: [4, 0, -3], max: [6, 2, 3], ramp: { rise: '-z', lowY: 0 } },
    ],
    targets: [],
    anchors: [
      { kind: 'post', id: 'post-low', pos: [-4, 0, 0], yaw: 0 },
      { kind: 'post', id: 'post-high', pos: [-4, 2, -5], yaw: 0 },
      { kind: 'peek', id: 'peek-high', cover: 'rail', hold: [-6, 2, -5.2], out: [-6, 2, -4], pattern: 'shoulder' },
    ],
    nav: {
      nodes: [
        { id: 'a', pos: [0, 0, 4] },
        { id: 'b', pos: [5, 0, 4.5] },
        { id: 'c', pos: [5, 1, 0] },
        { id: 'd', pos: [5, 2, -4] },
        { id: 'e', pos: [-4, 2, -4] },
      ],
      edges: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e']],
    },
    checkpoints: [{ id: 'cp1', pos: [1, 0, 3], angleAnchors: [] }],
    look: { sky: '#101820', fog: [20, 80], palette: 'hall' },
  };
}

function edited(edit: (m: any) => void): any {
  const m = structuredClone(hall());
  edit(m);
  return m;
}

function parse(raw: unknown): MapIssue[] {
  const r = parseMap(raw);
  return r.ok ? [] : r.errors;
}

function lint(raw: unknown) {
  const r = parseMap(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return lintMap(r.map);
}

function errors(raw: unknown, check: string): string[] {
  return lint(raw).issues.filter((i) => i.severity === 'error' && i.check === check).map((i) => `${i.where}: ${i.message}`);
}

describe('ramp boxes in the map schema', () => {
  it('accepts a ramp and carries it into the MapDef', () => {
    const r = parseMap(hall());
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ramp = r.map.boxes.find((b) => b.id === 'ramp')!;
      expect(ramp.ramp).toEqual({ rise: '-z', lowY: 0 });
      expect(r.map.boxes.find((b) => b.id === 'catwalk')!.ramp).toBeUndefined();
    }
  });

  it('derives the expected enemy feet from the anchors', () => {
    const r = parseMap(hall());
    expect(r.ok && r.map.enemyFeet.map((v) => v.y)).toEqual([0, 2, 2, 2]);
  });

  it('rejects a ramp box without ramp data, ramp data on another tag, and bad values', () => {
    expect(parse(edited((m) => delete m.boxes[3].ramp)).map((e) => e.path)).toContain('$.boxes[3].ramp');
    expect(parse(edited((m) => (m.boxes[1].ramp = { rise: '+x', lowY: 0 }))).map((e) => e.path)).toContain('$.boxes[1].ramp');
    expect(parse(edited((m) => (m.boxes[3].ramp.rise = 'up'))).map((e) => e.path)).toContain('$.boxes[3].ramp.rise');
    expect(parse(edited((m) => (m.boxes[3].ramp.lowY = 2))).map((e) => e.path)).toContain('$.boxes[3].ramp.lowY');
    expect(parse(edited((m) => (m.boxes[3].ramp.lowY = -0.5))).map((e) => e.path)).toContain('$.boxes[3].ramp.lowY');
    expect(parse(edited((m) => (m.boxes[3].ramp.extra = 1))).map((e) => e.path)).toContain('$.boxes[3].ramp.extra');
  });
});

describe('map lint with elevation', () => {
  it('passes a hall whose catwalk is reached by a ramp (nav edges walk over the ramp)', () => {
    const report = lint(hall());
    expect(lintErrors(report).map((i) => `${i.check} ${i.where}: ${i.message}`)).toEqual([]);
  });

  it('flags every raised hold when there is no way up', () => {
    const m = edited((mm) => mm.boxes.splice(3, 1)); // remove the ramp
    const e = errors(m, 'raised-reach');
    expect(e.some((x) => x.startsWith('anchor post-high'))).toBe(true);
    expect(e.some((x) => x.startsWith('anchor peek-high'))).toBe(true);
    expect(e.some((x) => x.startsWith('nav d'))).toBe(true);
    expect(e.every((x) => !x.startsWith('anchor post-low'))).toBe(true);
  });

  it('accepts stairs of 0.3 m risers as a way up, and rejects 0.6 m risers', () => {
    // Three steps in front of a deck, each `riser` taller than the last: 0.3 m steps are walkable, 0.6 m are not.
    const build = (riser: number) =>
      edited((m) => {
        m.boxes.splice(2, 2); // no rail, no ramp
        m.boxes[1].max = [10, riser * 4, -3];
        m.anchors = [{ kind: 'post', id: 'post-high', pos: [-4, riser * 4, -5], yaw: 0 }];
        m.nav = { nodes: [{ id: 'a', pos: [0, 0, 4] }, { id: 'b', pos: [5, 0, 4.5] }], edges: [['a', 'b']] };
        m.checkpoints = [];
        for (let i = 0; i < 3; i++) {
          m.boxes.push({ id: `s${i}`, tag: 'platform', min: [-10, 0, -3], max: [10, riser * (i + 1), -3 + (3 - i)] });
        }
      });
    expect(errors(build(0.3), 'raised-reach')).toEqual([]);
    expect(errors(build(0.6), 'raised-reach').length).toBeGreaterThan(0);
  });

  it('rejects a ramp steeper than the walkable maximum', () => {
    const steep = edited((m) => {
      m.boxes[3].max = [6, 2, -2]; // 2 m rise over 1 m
      m.boxes[3].min = [4, 0, -3];
    });
    expect(errors(steep, 'ramp-slope')[0]).toMatch(/ramp ramp: slope 63\.4/);
  });

  it('rejects a ramp whose low end hangs above the floor and warns about a ramp into a drop', () => {
    const hanging = edited((m) => {
      m.boxes[3].min = [4, 1, -3];
      m.boxes[3].ramp.lowY = 1;
    });
    expect(errors(hanging, 'ramp-ends')[0]).toMatch(/low end/);

    const dropped = edited((m) => {
      m.boxes[1].max = [10, 2, -4.5]; // the catwalk no longer reaches the ramp's top
      m.boxes[2].max = [10, 3.2, -4.5];
      m.boxes[2].min = [-10, 2, -4.7];
    });
    const w = lint(dropped).issues.filter((i) => i.check === 'ramp-ends' && i.severity === 'warning');
    expect(w.length).toBe(1);
  });

  it('rejects a nav edge that crosses a ledge higher than a step', () => {
    const bad = edited((m) => {
      m.nav.edges = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['a', 'c']];
    });
    // a (0,0,4) to c (5,1,0): crosses the ramp's side face from the floor, then climbs: at its start the ramp is >1 step tall
    expect(errors(bad, 'nav-edge').length).toBeGreaterThan(0);
  });

  it('is fast: a flood fill over the hall takes well under a second', () => {
    const t0 = performance.now();
    lint(hall());
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
