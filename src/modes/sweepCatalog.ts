import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { bodyTop, lineClear } from '../sim/exposure';
import type { BoxDef } from '../sim/types';
import { holdAnchorsOf, holdStance, holdStandPos } from '../sim/mapQuery';
import type { MapDef } from '../sim/mapTypes';
import type { ApproachLane, SectorSource, SectorSpot } from './sweepDirector';

/**
 * The sector catalog of the Sweep run director (#201): every sector of the shipped maps (#200), with
 * its hold anchors resolved to spots and the two geometric questions the director asks, answered
 * against the map's own collision boxes. Pure: reads map data and tunables only.
 */

/** Sample grid laid over an Echo's body for "is any part of it visible" (finer than the lint's three points). */
const SIGHT_COLUMNS = 7;
const SIGHT_ROWS = 8;
/** Heights of the route's walk-line check (shins, chest). */
const WALK_LINE_Y = [0.3, 1.2];
/** Heights above the feet a walking body must pass at (shins, waist, chest). */
const WALK_HEIGHTS = [0.3, 0.9, 1.3];

/**
 * Whether any part of a body standing at `feet` shows from `eye`: a grid across its width from the
 * ankles up to and including the crown. (The exposure grid of `sim/exposure.ts` samples cell centres,
 * so it misses the top of the head, which is what shows first over half cover.)
 */
export function bodyShows(boxes: readonly BoxDef[], halfWidth: number, top: number, eye: Vec3, feet: Vec3): boolean {
  let lx = -(feet.z - eye.z), lz = feet.x - eye.x;
  const ll = Math.hypot(lx, lz);
  if (ll < 1e-9) { lx = 1; lz = 0; } else { lx /= ll; lz /= ll; }
  for (let r = 0; r < SIGHT_ROWS; r++) {
    const y = feet.y + 0.05 + ((top - 0.05) * r) / (SIGHT_ROWS - 1);
    for (let c = 0; c < SIGHT_COLUMNS; c++) {
      const off = ((c / (SIGHT_COLUMNS - 1)) * 2 - 1) * halfWidth;
      if (lineClear(boxes, eye.x, eye.y, eye.z, feet.x + lx * off, y, feet.z + lz * off)) return true;
    }
  }
  return false;
}

/** The yaw that faces from `a` towards `b` (architecture §6: forward = (-sin yaw, 0, -cos yaw)). */
export function yawTowards(a: Vec3, b: Vec3): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/** One map's sectors as the director's `SectorSource`s. Visibility answers are memoised per sector. */
export function sectorSources(map: MapDef, tunables: Tunables): SectorSource[] {
  const boxes = map.boxes;
  const hit = tunables.targets.hit;
  const hw = tunables.movement.hullHalfWidth;
  return map.sectors.map((sector) => {
    const spots: SectorSpot[] = [];
    for (const a of holdAnchorsOf(map, sector)) {
      const feet = holdStandPos(a)!;
      const crouched = holdStance(a) === 'crouch';
      if (a.kind === 'peek') spots.push({ id: a.id, feet: { ...feet }, crouched, peek: { hold: { ...a.hold }, out: { ...a.out }, pattern: a.pattern } });
      else if (a.kind === 'hold') spots.push({ id: a.id, feet: { ...feet }, crouched, yaw: a.yaw });
    }
    const approaches: ApproachLane[] = [];
    for (const id of sector.approaches) {
      const lane = map.lanes.find((l) => l.id === id);
      if (lane) approaches.push({ id: lane.id, start: { ...lane.start }, end: { ...lane.end }, width: lane.width });
    }
    const seen = new Map<string, boolean>();
    const source: SectorSource = {
      mapId: map.id,
      id: sector.id,
      roles: sector.role,
      approaches,
      entry: { ...sector.entry },
      // Face the way in: the first leg of the walk from the entry to the exit (straight at the exit can be a wall).
      entryYaw: yawTowards(sector.entry, navRoute(map, sector.entry, sector.exit)[0] ?? sector.exit),
      exit: { ...sector.exit },
      spots,
      // A meet group crosses on the first straight leg of the walk from the exit to the entry.
      meetRoute: sector.role.includes('meet')
        ? { from: { ...sector.exit }, to: { ...(navRoute(map, sector.exit, sector.entry)[0] ?? sector.entry) } }
        : undefined,
      visible(eye, feet, crouched) {
        const key = `${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}|${feet.x.toFixed(2)},${feet.y.toFixed(2)},${feet.z.toFixed(2)}|${crouched ? 1 : 0}`;
        let v = seen.get(key);
        if (v === undefined) {
          v = bodyShows(boxes, hit.torsoWidth / 2, bodyTop(hit, crouched), eye, feet);
          seen.set(key, v);
        }
        return v;
      },
      route: (from, to) => navRoute(map, from, to),
      walkable(a, b) {
        // The centre line and both shoulders of the body, at shin, waist and chest height.
        let lx = -(b.z - a.z), lz = b.x - a.x;
        const ll = Math.hypot(lx, lz);
        if (ll < 1e-9) return true;
        lx /= ll; lz /= ll;
        // Run past the far end by the hull's half width, so the body at `b` is clear of walls too.
        const fx = (b.x - a.x) / ll, fz = (b.z - a.z) / ll;
        const ex = b.x + fx * hw, ez = b.z + fz * hw;
        for (const h of WALK_HEIGHTS) {
          for (const side of [-hw, 0, hw]) {
            if (!lineClear(boxes, a.x + lx * side, a.y + h, a.z + lz * side, ex + lx * side, b.y + h, ez + lz * side)) return false;
          }
        }
        return true;
      },
    };
    return source;
  });
}

/** Every sector of every map given. */
export function sectorCatalog(maps: readonly MapDef[], tunables: Tunables): SectorSource[] {
  const out: SectorSource[] = [];
  for (const m of maps) out.push(...sectorSources(m, tunables));
  return out;
}

function walkLine(map: MapDef, a: Vec3, b: Vec3): boolean {
  for (const y of WALK_LINE_Y) if (!lineClear(map.boxes, a.x, a.y + y, a.z, b.x, b.y + y, b.z)) return false;
  return true;
}

/** The nearest nav node with a clear walk line to `p`, or the nearest at all. */
function nearestNode(map: MapDef, p: Vec3): number {
  let best = -1, bestD = Infinity, any = -1, anyD = Infinity;
  const nodes = map.nav.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!.pos;
    const d = Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 2;
    if (d < anyD) { anyD = d; any = i; }
    if (d < bestD && walkLine(map, p, n)) { bestD = d; best = i; }
  }
  return best >= 0 ? best : any;
}

/** Shortest walk from `from` to `to`: straight when the line is clear, else through the nav graph (Dijkstra). */
export function navRoute(map: MapDef, from: Vec3, to: Vec3): Vec3[] {
  if (walkLine(map, from, to)) return [{ ...to }];
  const nodes = map.nav.nodes;
  if (nodes.length === 0) return [{ ...to }];
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const adj: number[][] = nodes.map(() => []);
  for (const [a, b] of map.nav.edges) {
    const i = index.get(a), j = index.get(b);
    if (i === undefined || j === undefined) continue;
    adj[i]!.push(j);
    adj[j]!.push(i);
  }
  const s = nearestNode(map, from), g = nearestNode(map, to);
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity || u === g) break;
    done[u] = true;
    for (const v of adj[u]!) {
      const a = nodes[u]!.pos, b = nodes[v]!.pos;
      const nd = dist[u]! + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (nd < dist[v]!) { dist[v] = nd; prev[v] = u; }
    }
  }
  const chain: Vec3[] = [];
  for (let v = g; v >= 0; v = prev[v]!) chain.unshift({ ...nodes[v]!.pos });
  // Cut corners: drop a node when the walk line skips it.
  const route: Vec3[] = [];
  let at = from;
  const all = [...chain, { ...to }];
  for (let i = 0; i < all.length; i++) {
    const next = all[i + 1];
    if (next && walkLine(map, at, next)) continue;
    route.push(all[i]!);
    at = all[i]!;
  }
  return route;
}
