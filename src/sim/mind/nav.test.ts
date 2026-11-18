import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../../config/tunables';
import { vec3 } from '../../core/vec3';
import { elbowMap } from '../mapLoader';
import { MAX_PATH_NODES, NavRuntime, straightWalk } from './nav';

const hull = cloneTunables().movement.hullHalfWidth;

describe('NavRuntime (#91): the map nav graph for the enemy mind', () => {
  const nav = new NavRuntime();
  nav.build(elbowMap.nav);
  const id = (name: string): number => elbowMap.nav.nodes.findIndex((n) => n.id === name);

  it('A* finds the shortest path along edges, start first, every hop an edge', () => {
    const out = new Int32Array(MAX_PATH_NODES);
    const n = nav.path(id('n-spawn'), id('n-deck'), out);
    expect(n).toBeGreaterThan(3);
    expect(out[0]).toBe(id('n-spawn'));
    expect(out[n - 1]).toBe(id('n-deck'));
    const edges = new Set(elbowMap.nav.edges.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    for (let i = 1; i < n; i++) expect(edges.has(`${elbowMap.nav.nodes[out[i - 1]!]!.id}|${elbowMap.nav.nodes[out[i]!]!.id}`)).toBe(true);
    // Same query again (generation stamps, no clearing): same answer.
    const again = new Int32Array(MAX_PATH_NODES);
    expect(nav.path(id('n-spawn'), id('n-deck'), again)).toBe(n);
    expect([...again.slice(0, n)]).toEqual([...out.slice(0, n)]);
  });

  it('the nearest node is one a body walks to straight, not one through a wall', () => {
    // Just south of the arm's south wall: the nearest node by distance may sit behind it.
    const p = vec3(0, 0, 6.6);
    const i = nav.nearest(p.x, p.y, p.z, elbowMap.boxes, hull);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(straightWalk(elbowMap.boxes, hull, p.x, p.y, p.z, nav.x[i]!, nav.z[i]!)).toBe(true);
  });

  it('no graph: no nodes, no path', () => {
    const empty = new NavRuntime();
    empty.build(null);
    expect(empty.n).toBe(0);
    expect(empty.nearest(0, 0, 0, null, hull)).toBe(-1);
    expect(empty.path(0, 1, new Int32Array(4))).toBe(0);
  });
});
