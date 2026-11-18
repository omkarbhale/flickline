import { walkClear } from '../arrival';
import type { NavGraph } from '../mapTypes';
import type { BoxDef } from '../types';

/**
 * The map's nav graph (`NavGraph`, design §10.2) as flat arrays for the enemy mind (#91): nearest
 * node and A* shortest paths, allocation-free after `build`. Nodes are the map's open areas and
 * doorways; edges are walkable straight lines. A map with no graph has zero nodes, and every path
 * query then falls back to a straight walk.
 */

/** Longest path a query returns, in nodes (the maps have a few dozen nodes; a longer route is truncated at its far end). */
export const MAX_PATH_NODES = 32;

export class NavRuntime {
  /** Node count, and positions (feet). */
  n = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  z = new Float64Array(0);
  /** CSR adjacency: neighbours of node i are `adj[adjStart[i] .. adjStart[i + 1])`. */
  private adjStart = new Int32Array(1);
  private adj = new Int32Array(0);
  // A* scratch.
  private g = new Float64Array(0);
  private f = new Float64Array(0);
  private came = new Int32Array(0);
  private heap = new Int32Array(0);
  /** Generation stamps instead of clearing the arrays per query. */
  private seen = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private gen = 0;

  /** Rebuild from a level's graph (null: no graph). Allocates: call on level load, never per tick. */
  build(graph: NavGraph | null | undefined): void {
    const nodes = graph?.nodes ?? [];
    const n = nodes.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.z = new Float64Array(n);
    const index = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const p = nodes[i]!.pos;
      this.x[i] = p.x; this.y[i] = p.y; this.z[i] = p.z;
      index.set(nodes[i]!.id, i);
    }
    const lists: number[][] = [];
    for (let i = 0; i < n; i++) lists.push([]);
    for (const [a, b] of graph?.edges ?? []) {
      const i = index.get(a), j = index.get(b);
      if (i === undefined || j === undefined || i === j) continue;
      if (!lists[i]!.includes(j)) lists[i]!.push(j);
      if (!lists[j]!.includes(i)) lists[j]!.push(i);
    }
    this.adjStart = new Int32Array(n + 1);
    let total = 0;
    for (let i = 0; i < n; i++) { this.adjStart[i] = total; total += lists[i]!.length; }
    this.adjStart[n] = total;
    this.adj = new Int32Array(total);
    for (let i = 0, k = 0; i < n; i++) for (const j of lists[i]!) this.adj[k++] = j;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.came = new Int32Array(n);
    this.heap = new Int32Array(Math.max(1, n));
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 0;
  }

  private dist(i: number, j: number): number {
    const dx = this.x[i]! - this.x[j]!, dy = this.y[i]! - this.y[j]!, dz = this.z[i]! - this.z[j]!;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * The node nearest (`px`, `py`, `pz`) that a body there can walk to in a straight line, or the
   * nearest node at all when none is walkable (or `boxes` is null). -1 with no graph. Cost: one walk
   * test per node closer than the best walkable one, nearest first.
   */
  nearest(px: number, py: number, pz: number, boxes: readonly BoxDef[] | null, hull: number): number {
    let best = -1, bestD = Infinity;
    let any = -1, anyD = Infinity;
    for (let i = 0; i < this.n; i++) {
      const dx = this.x[i]! - px, dy = (this.y[i]! - py) * 2, dz = this.z[i]! - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < anyD) { anyD = d; any = i; }
    }
    if (boxes === null) return any;
    // Walkable candidates, nearest first: repeated selection (n is small; no sort, no allocation).
    let floor = -1;
    for (let tries = 0; tries < this.n; tries++) {
      let pick = -1, pickD = Infinity;
      for (let i = 0; i < this.n; i++) {
        const dx = this.x[i]! - px, dy = (this.y[i]! - py) * 2, dz = this.z[i]! - pz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > floor && d < pickD) { pickD = d; pick = i; }
      }
      if (pick < 0) break;
      floor = pickD;
      if (straightWalk(boxes, hull, px, py, pz, this.x[pick]!, this.z[pick]!)) { best = pick; bestD = pickD; break; }
    }
    return best >= 0 && bestD < Infinity ? best : any;
  }

  /**
   * A* from node `from` to node `to` (Euclidean heuristic, admissible). Writes the node indices,
   * start first, into `out` and returns the count (0 when unreachable or without a graph). A path
   * longer than `out` keeps its first `out.length` nodes. Allocation-free.
   */
  path(from: number, to: number, out: Int32Array): number {
    if (from < 0 || to < 0 || from >= this.n || to >= this.n) return 0;
    if (from === to) { out[0] = from; return 1; }
    const gen = ++this.gen;
    const g = this.g, f = this.f, came = this.came, heap = this.heap, seen = this.seen, closed = this.closed;
    let hn = 0;
    g[from] = 0; f[from] = this.dist(from, to); came[from] = -1; seen[from] = gen;
    heap[hn++] = from;
    while (hn > 0) {
      // Pop the lowest f (binary heap).
      const cur = heap[0]!;
      const last = heap[--hn]!;
      if (hn > 0) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= hn) break;
          const r = l + 1;
          const c = r < hn && f[heap[r]!]! < f[heap[l]!]! ? r : l;
          if (f[heap[c]!]! >= f[last]!) break;
          heap[i] = heap[c]!;
          i = c;
        }
        heap[i] = last;
      }
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === to) break;
      for (let k = this.adjStart[cur]!; k < this.adjStart[cur + 1]!; k++) {
        const nb = this.adj[k]!;
        if (closed[nb] === gen) continue;
        const ng = g[cur]! + this.dist(cur, nb);
        if (seen[nb] === gen && ng >= g[nb]!) continue;
        seen[nb] = gen;
        g[nb] = ng;
        f[nb] = ng + this.dist(nb, to);
        came[nb] = cur;
        // Push (a node may sit in the heap twice; the stale copy is skipped by `closed`).
        if (hn >= heap.length) continue;
        let i = hn++;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (f[heap[p]!]! <= f[nb]!) break;
          heap[i] = heap[p]!;
          i = p;
        }
        heap[i] = nb;
      }
    }
    if (closed[to] !== gen) return 0;
    // Count, then write start-first.
    let len = 0;
    for (let c = to; c >= 0; c = came[c]!) len++;
    const keep = Math.min(len, out.length);
    let i = len - 1;
    for (let c = to; c >= 0; c = came[c]!, i--) if (i < keep) out[i] = c;
    return keep;
  }
}

/** Whether a body at (`ax`, `ay`, `az`) walks straight to (`bx`, `bz`) without meeting a wall (the director's walk test, `walkClear`). */
export function straightWalk(boxes: readonly BoxDef[], hull: number, ax: number, ay: number, az: number, bx: number, bz: number): boolean {
  return walkClear(boxes, hull, ay, ax, az, bx, bz);
}
