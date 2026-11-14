import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { cloneTunables } from '../config/tunables';
import { rayBox } from './collision';
import { lintErrors, lintMap } from './mapLint';
import { loadMap, MapError, rangeMap } from './mapLoader';
import { anchorsOfKind, anchorsWithTag, distanceFromSpawn, postsInBand } from './mapQuery';
import { parseMap, type MapIssue } from './mapSchema';
import { createTickInput, type RunAndSimEvents } from './types';
import { vec3 } from '../core/vec3';
import { World } from './world';

/** A tiny valid map: a room split by a divider with a gap on the east, one cover box, one checkpoint. */
function mini(): Record<string, unknown> {
  return {
    schema: 1,
    id: 'mini',
    name: 'Mini',
    bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
    spawn: { pos: [-3, 0, 3], yaw: 0 },
    boxes: [
      { id: 'floor', tag: 'floor', min: [-5, -1, -5], max: [5, 0, 5] },
      { id: 'divider', tag: 'wall', min: [-5, 0, -0.2], max: [1, 3, 0.2] },
      { id: 'cover-1', tag: 'cover', min: [3.6, 0, -3], max: [4.6, 1.3, -2.5] },
    ],
    targets: [],
    anchors: [
      { kind: 'post', id: 'post-1', pos: [3, 0, 3], yaw: 0 },
      { kind: 'peek', id: 'peek-1', cover: 'cover-1', hold: [4.1, 0, -3.5], out: [2, 0, -3], pattern: 'wide' },
    ],
    nav: {
      nodes: [
        { id: 'a', pos: [-3, 0, 3] },
        { id: 'b', pos: [3, 0, 3] },
        { id: 'c', pos: [3, 0, -3.5] },
        { id: 'd', pos: [-3, 0, -3] },
      ],
      edges: [['a', 'b'], ['b', 'c'], ['c', 'd']],
    },
    checkpoints: [{ id: 'cp1', pos: [-3, 0, -3], angleAnchors: ['peek-1'] }],
    look: { sky: '#101820', fog: [20, 80], palette: 'hall' },
  };
}

function parse(raw: unknown): MapIssue[] {
  const r = parseMap(raw);
  return r.ok ? [] : r.errors;
}

/** Deep-clone a raw map, apply `edit`, return it. */
function edited(edit: (m: any) => void): unknown {
  const m = structuredClone(mini());
  edit(m);
  return m;
}

function lintOf(raw: unknown) {
  const r = parseMap(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return lintMap(r.map);
}

function errorsOf(raw: unknown, check: string): string[] {
  return lintOf(raw).issues.filter((i) => i.severity === 'error' && i.check === check).map((i) => `${i.where}: ${i.message}`);
}

describe('schema validator', () => {
  it('accepts a valid map and fills defaults', () => {
    const r = parseMap(mini());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.map.lanes).toEqual([]);
      expect(r.map.marks).toEqual([]);
      expect(r.map.anchors[0]!.tags).toEqual([]);
      expect(r.map.boxes[0]!.min).toEqual({ x: -5, y: -1, z: -5 });
    }
  });

  it('reports each problem with its JSON path', () => {
    const issues = parse(
      edited((m) => {
        m.boxes[1].tag = 'brick';
        m.boxes[2].min = [3, 0];
        m.spawn.yaw = 'north';
        m.bounds.max = [5, 3, -9];
        m.anchors[0].yaw = null;
        m.look.fog = [50, 10];
      }),
    );
    const byPath = Object.fromEntries(issues.map((i) => [i.path, i.message]));
    expect(byPath['$.boxes[1].tag']).toMatch(/expected one of/);
    expect(byPath['$.boxes[2].min']).toMatch(/\[x, y, z\]/);
    expect(byPath['$.spawn.yaw']).toMatch(/finite number/);
    expect(byPath['$.bounds']).toMatch(/min.z/);
    expect(byPath['$.anchors[0].yaw']).toMatch(/finite number/);
    expect(byPath['$.look.fog']).toMatch(/near < far/);
  });

  it('points at the exact component of a bad vector', () => {
    const issues = parse(edited((m) => (m.nav.nodes[2].pos[1] = 'up')));
    expect(issues).toEqual([{ path: '$.nav.nodes[2].pos[1]', message: 'expected a finite number, got "up"' }]);
  });

  it('rejects unknown properties and a wrong schema version', () => {
    const issues = parse(edited((m) => { m.anchor = []; m.schema = 2; m.boxes[0].colour = 'red'; }));
    expect(issues.map((i) => i.path).sort()).toEqual(['$.anchor', '$.boxes[0].colour', '$.schema']);
  });

  it('rejects degenerate boxes, duplicate ids and unknown anchor kinds', () => {
    const issues = parse(
      edited((m) => {
        m.boxes[1].max = [1, 0, 0.2];
        m.boxes[2].id = 'floor';
        m.anchors[1] = { kind: 'teleporter', id: 'x' };
      }),
    );
    expect(issues.find((i) => i.path === '$.boxes[1]')?.message).toMatch(/min.y/);
    expect(issues.find((i) => i.path === '$.boxes[2].id')?.message).toMatch(/duplicate box id "floor"/);
    expect(issues.find((i) => i.path === '$.anchors[1].kind')?.message).toMatch(/expected one of/);
  });

  it('checks references: nav edges, peek cover, checkpoint anchors', () => {
    const issues = parse(
      edited((m) => {
        m.nav.edges.push(['a', 'zz']);
        m.anchors[1].cover = 'nope';
        m.checkpoints[0].angleAnchors = ['post-1', 'ghost'];
      }),
    );
    const byPath = Object.fromEntries(issues.map((i) => [i.path, i.message]));
    expect(byPath['$.nav.edges[3][1]']).toBe('unknown nav node "zz"');
    expect(byPath['$.anchors[1].cover']).toBe('unknown box id "nope"');
    expect(byPath['$.checkpoints[0].angleAnchors[0]']).toMatch(/is a post, expected a peek/);
    expect(byPath['$.checkpoints[0].angleAnchors[1]']).toBe('unknown anchor "ghost"');
  });

  it('validates each anchor kind', () => {
    const issues = parse(
      edited((m) => {
        m.anchors = [
          { kind: 'beacon-shell', id: 's', centre: [0, 1, 0], rMin: 9, rMax: 3 },
          { kind: 'peek', id: 'p', cover: 'cover-1', hold: [0, 0, 0], out: [0, 0, 0], pattern: 'dance' },
          { kind: 'drone-volume', id: 'd', min: [0, 0, 0], max: [0, 1, 1] },
          { kind: 'post', id: 'q', pos: [0, 0, 0], yaw: 0, stance: 'lying' },
          { kind: 'spray-alcove', id: 'sa', stand: [0, 0, 0], yaw: 0, post: [0, 0, -5], panel: 'floor', distance: -1 },
        ];
        m.checkpoints = [];
      }),
    );
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('$.anchors[0]'); // rMin >= rMax
    expect(paths).toContain('$.anchors[1].pattern');
    expect(paths).toContain('$.anchors[2]'); // min.x >= max.x
    expect(paths).toContain('$.anchors[3].stance');
    expect(paths).toContain('$.anchors[4].distance');
  });

  it('never throws on junk', () => {
    for (const junk of [null, 5, 'map', [], { schema: 1 }, { boxes: 'x' }]) expect(parse(junk).length).toBeGreaterThan(0);
  });

  it('loadMap throws a MapError listing every issue', () => {
    try {
      loadMap(edited((m) => { m.id = ''; m.name = ''; }), 'mini');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MapError);
      expect((e as MapError).issues).toHaveLength(2);
      expect((e as MapError).message).toContain('$.id');
    }
  });
});

describe('map lint', () => {
  it('passes the mini map', () => {
    const report = lintOf(mini());
    expect(report.issues).toEqual([]);
    expect(report.stats.navNodes).toBe(4);
  });

  it('flags anchors outside the bounds and anchors buried in geometry', () => {
    const out = errorsOf(edited((m) => (m.anchors[0].pos = [9, 0, 3])), 'bounds');
    expect(out).toEqual(['anchor post-1: pos (9, 0, 3) is outside the map bounds']);
    const buried = errorsOf(edited((m) => (m.anchors[0].pos = [-2, 0, 0])), 'buried');
    expect(buried).toEqual(['anchor post-1: pos (-2, 0, 0) is inside geometry']);
    expect(errorsOf(edited((m) => (m.spawn.pos = [3.5, 0, -2.7])), 'buried')[0]).toMatch(/^spawn/);
  });

  it('flags a disconnected nav graph and blocked edges', () => {
    const split = errorsOf(edited((m) => (m.nav.edges = [['a', 'b'], ['c', 'd']])), 'nav-connected');
    expect(split).toHaveLength(1);
    expect(split[0]).toMatch(/2 disconnected parts/);
    const blocked = errorsOf(edited((m) => m.nav.edges.push(['a', 'd'])), 'nav-edge');
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatch(/nav a - d: edge is blocked/);
  });

  it('flags unreachable checkpoints', () => {
    const far = errorsOf(edited((m) => (m.checkpoints[0].pos = [-3, 0, -4.9])), 'checkpoint-reach');
    expect(far).toEqual([]); // within 4 m of node d and unobstructed
    const noNav = errorsOf(edited((m) => (m.checkpoints[0].pos = [4.5, 0, -4.9])), 'checkpoint-reach');
    expect(noNav).toEqual([]); // node c is 1.6 m away
    const island = errorsOf(
      edited((m) => {
        m.nav.edges = [['a', 'b'], ['b', 'c']];
      }),
      'checkpoint-reach',
    );
    expect(island[0]).toMatch(/checkpoint cp1: nav node d is not connected to the spawn/);
    const emptyNav = errorsOf(edited((m) => { m.nav = { nodes: [], edges: [] }; }), 'checkpoint-reach');
    expect(emptyNav[0]).toMatch(/no nav node within 4 m/);
  });

  it('flags a peek anchor with no line of sight to its checkpoint', () => {
    expect(errorsOf(edited((m) => (m.anchors[1].out = [2, 0, 3])), 'peek-los')).toEqual([
      'anchor peek-1: no line of sight from out (2, 0, 3) to checkpoint cp1 (-3, 0, -3)',
    ]);
  });

  it('flags box overlaps beyond the tolerance only', () => {
    const slight = edited((m) => m.boxes.push({ tag: 'cover', min: [4.56, 0, -3], max: [5, 1, -2.5] }));
    expect(errorsOf(slight, 'overlap')).toEqual([]); // 4 cm: inside the 5 cm tolerance
    const deep = edited((m) => m.boxes.push({ id: 'dup', tag: 'cover', min: [4.1, 0, -3], max: [5, 1, -2.5] }));
    expect(errorsOf(deep, 'overlap')).toEqual([
      'boxes cover-1 / dup: overlap 0.5 m exceeds tolerance 0.05 m (z-fighting and double collision)',
    ]);
    const tolerant = edited((m) => {
      m.boxes.push({ id: 'dup', tag: 'cover', min: [4.1, 0, -3], max: [5, 1, -2.5] });
      m.lint = { overlapTolerance: 0.6 };
    });
    expect(errorsOf(tolerant, 'overlap')).toEqual([]);
  });

  it('warns about posts hidden from the spawn', () => {
    const report = lintOf(edited((m) => (m.anchors[0].pos = [-3, 0, -3])));
    expect(report.issues.map((i) => `${i.severity}:${i.check}`)).toEqual(['warning:visible-from-spawn']);
  });

  it('checks spray stations', () => {
    const base = (patch: object) =>
      edited((m) => {
        m.boxes.push({ id: 'panel', tag: 'panel', min: [-2, 0, 4.5], max: [-1, 3, 5] });
        m.anchors.push({ kind: 'spray-alcove', id: 'spray', stand: [-1.5, 0, -3], yaw: 0, post: [-1.5, 0, 4], panel: 'panel', distance: 7, ...patch });
        m.nav.edges.push(['a', 'b']);
      });
    expect(errorsOf(base({ distance: 8 }), 'spray')[0]).toMatch(/distance says 8 m but stand-to-post is 7 m/);
    expect(errorsOf(base({ stand: [-3, 0, -3], post: [-3, 0, 4], distance: 7 }), 'spray')[0]).toMatch(/no line of sight/);
  });

  it('enforces an optional maximum sightline', () => {
    expect(errorsOf(edited((m) => (m.lint = { maxSightline: 5 })), 'sightline')[0]).toMatch(/exceeds the map's maximum 5 m/);
  });

  it('reports sightline lengths', () => {
    const { sightlines } = lintOf(mini());
    expect(sightlines.rays).toBe(4 * 36);
    expect(sightlines.histogram.reduce((a, b) => a + b.count, 0)).toBe(sightlines.rays);
    expect(sightlines.longest.length).toBeGreaterThan(0);
  });
});

describe('Range', () => {
  const eye = 1.62;

  it('is a valid LevelDef the simulation can run', () => {
    const world = new World({ level: rangeMap, tunables: cloneTunables(), seed: 1 });
    const bus = new EventBus<RunAndSimEvents>();
    const input = createTickInput();
    for (let i = 0; i < 256; i++) world.step(input, bus);
    expect(world.player.grounded).toBe(true);
    expect(world.player.pos.z).toBeCloseTo(25, 5);
  });

  it('lints clean: no errors and no warnings', () => {
    const report = lintMap(rangeMap); // (speed is checked by the CLI run in CI, which prints its time)
    expect(report.issues).toEqual([]);
    expect(report.sightlines.spawnForward).toBeGreaterThan(54); // the whole 54 m hall is visible ahead
  });

  it('is a 54 x 24 m hall, 8 m high', () => {
    const f = rangeMap.boxes.find((b) => b.id === 'floor')!;
    expect(f.max.x - f.min.x).toBe(24);
    const inner = rangeMap.boxes.filter((b) => b.tag === 'wall' && b.id!.startsWith('wall-'));
    const north = rangeMap.boxes.filter((b) => b.id!.startsWith('pier-')).map((b) => b.max.z);
    expect(Math.min(...inner.map((b) => b.min.z))).toBe(-27); // end wall line at z = -27
    expect(Math.max(...inner.map((b) => b.max.z)) - 0.5).toBe(27); // south wall inner face at z = 27
    expect(north.every((z) => z === -27)).toBe(true);
    expect(rangeMap.bounds.max.y).toBe(8);
  });

  it('has sphere targets at the spec distances 5, 10, 20, 30, 50 m, all visible from the spawn', () => {
    const dists = rangeMap.targets.map((t) => Math.round(distanceFromSpawn(rangeMap, t.pos)));
    expect(dists).toEqual([5, 10, 20, 30, 50]);
    const n = vec3();
    for (const t of rangeMap.targets) {
      const dx = t.pos.x - rangeMap.spawn.pos.x, dy = t.pos.y - eye, dz = t.pos.z - rangeMap.spawn.pos.z;
      const len = Math.hypot(dx, dy, dz);
      for (const b of rangeMap.boxes) {
        const hit = rayBox(rangeMap.spawn.pos.x, eye, rangeMap.spawn.pos.z, dx / len, dy / len, dz / len, b, len, n);
        expect(hit, `${b.id} blocks target at ${t.pos.z}`).toBe(-1);
      }
    }
  });

  it('has 3 pillars, 5 m floor ticks to 50 m, and spray stations at 12 / 20 / 28 m', () => {
    expect(rangeMap.boxes.filter((b) => b.tag === 'pillar')).toHaveLength(3);
    const ticks = rangeMap.marks.filter((m) => m.kind !== 'line').map((m) => rangeMap.spawn.pos.z - m.a.z);
    expect(ticks).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    const spray = anchorsOfKind(rangeMap, 'spray-alcove');
    expect(spray.map((a) => a.distance)).toEqual([12, 20, 28]);
    for (const a of spray) {
      expect(Math.hypot(a.post.x - a.stand.x, a.post.z - a.stand.z)).toBeCloseTo(a.distance, 5);
      expect(rangeMap.boxes.find((b) => b.id === a.panel)?.tag).toBe('panel');
    }
  });

  it('has the anchors every Range mode needs', () => {
    // post: every distance band the issue names, several angles each
    for (const band of [6, 10, 15, 20, 30, 40]) {
      const posts = postsInBand(rangeMap, band - 0.1, band + 0.1);
      expect(posts.length, `band ${band}`).toBeGreaterThanOrEqual(5);
      expect(anchorsWithTag(rangeMap, `band-${band}`).filter((a) => a.kind === 'post')).toHaveLength(posts.length);
      // posts face the spawn
      for (const p of posts) {
        const toSpawn = { x: rangeMap.spawn.pos.x - p.pos.x, z: rangeMap.spawn.pos.z - p.pos.z };
        const facing = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
        const cos = (toSpawn.x * facing.x + toSpawn.z * facing.z) / Math.hypot(toSpawn.x, toSpawn.z);
        expect(cos).toBeGreaterThan(0.999);
      }
    }
    const shells = anchorsOfKind(rangeMap, 'beacon-shell');
    expect(shells).toHaveLength(1);
    expect([shells[0]!.rMin, shells[0]!.rMax]).toEqual([8, 25]);
    expect(anchorsOfKind(rangeMap, 'strafe-lane')).toHaveLength(3);
    expect(anchorsWithTag(rangeMap, 'pillar')).toHaveLength(3);
  });

  it('strafe lanes sit 10-35 m from the spawn', () => {
    for (const l of anchorsOfKind(rangeMap, 'strafe-lane')) {
      const d = distanceFromSpawn(rangeMap, l.a);
      expect(d).toBeGreaterThanOrEqual(10);
      expect(d).toBeLessThanOrEqual(35);
    }
  });

  describe('collision matches visuals', () => {
    function walk(x: number, z: number, yawRad: number, input: Partial<ReturnType<typeof createTickInput>>, ticks: number) {
      const world = new World({ level: rangeMap, tunables: cloneTunables(), seed: 1 });
      const bus = new EventBus<RunAndSimEvents>();
      const p = world.player;
      p.pos.x = p.prevPos.x = x;
      p.pos.z = p.prevPos.z = z;
      const inp = createTickInput();
      Object.assign(inp, input, { yaw: yawRad });
      for (let i = 0; i < ticks; i++) world.step(inp, bus);
      return world.player;
    }
    const hw = cloneTunables().movement.hullHalfWidth;

    it('stops at the near face of a pillar', () => {
      const pillar = rangeMap.boxes.find((b) => b.id === 'pillar-a')!;
      const p = walk((pillar.min.x + pillar.max.x) / 2, 20, 0, { moveZ: 1 }, 384); // walking -Z into the pillar
      expect(p.pos.z).toBeCloseTo(pillar.max.z + hw, 4);
      expect(p.pos.y).toBe(0);
    });

    it('stops at the walls', () => {
      const south = walk(0, 25, 0, { moveZ: -1 }, 128); // walking backwards into the south wall
      expect(south.pos.z).toBeCloseTo(27 - hw, 4);
      const west = walk(0, 0, 0, { moveX: -1 }, 384);
      expect(west.pos.x).toBeCloseTo(-12 + hw, 4);
      const east = walk(0, 0, 0, { moveX: 1 }, 384);
      expect(east.pos.x).toBeCloseTo(12 - hw, 4);
    });

    it('stops at the spray panel and cannot leave through the pillars between niches', () => {
      const p = walk(0, 0, 0, { moveZ: 1 }, 1024); // straight up the middle into niche 20
      expect(p.pos.z).toBeCloseTo(-30 + hw, 4);
      const q = walk(-4, -20, 0, { moveZ: 1 }, 256); // x = -4 is the pier between niches
      expect(q.pos.z).toBeCloseTo(-27 + hw, 4);
    });

    it('cannot jump out through the ceiling', () => {
      const world = new World({ level: rangeMap, tunables: cloneTunables(), seed: 1 });
      const bus = new EventBus<RunAndSimEvents>();
      const inp = createTickInput();
      for (let i = 0; i < 400; i++) {
        inp.jump = i % 20 === 0;
        world.step(inp, bus);
        expect(world.player.pos.y + world.player.height).toBeLessThanOrEqual(8 + 1e-6);
      }
    });
  });
});

describe('every shipped map', () => {
  const dir = join(import.meta.dirname, 'levels');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(`${f} validates and lints without errors`, () => {
      const parsed = parseMap(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      expect(parsed.ok ? [] : parsed.errors).toEqual([]);
      if (parsed.ok) expect(lintErrors(lintMap(parsed.map))).toEqual([]);
    });
  }
});
