import type { HitTunables } from '../config/targets';
import type { Vec3 } from '../core/vec3';
import { bodyExposure, bodyTop, lineClear } from './exposure';
import type { MapDef } from './mapTypes';
import type { BoxDef } from './types';

/**
 * Where a sector's Echoes first show, from the walk the player makes through it (#249): the shared geometry of the
 * run director (which anchor to draw for a distance), the map lint (does every sector offer close, mid and long
 * fights) and the bot report. Pure: reads a map's boxes and nav graph, nothing else; load time only (it allocates).
 *
 * Two geometric questions live here: **does any part of a body show from an eye** (`bodyShows`, a fine grid from the
 * ankles to the crown, the one the director and the lint agree on) and **how does a walk go** (`navRoute`: straight when
 * the line is clear, else along the nav graph). From those, `firstSight` answers the one the fights depend on: walking
 * from a sector's entry to its exit, where is the player when an Echo standing at a spot first shows, and how far away.
 */

/** Sample grid laid over an Echo's body for "is any part of it visible" (finer than the lint's three points). */
const SIGHT_COLUMNS = 7;
const SIGHT_ROWS = 8;
/** Heights of the route's walk-line check (shins, chest). */
const WALK_LINE_Y = [0.3, 1.2];
/** Grid of the exposure measure at the first sight: columns x rows across the body. */
const EXPOSURE_COLUMNS = 5;
const EXPOSURE_ROWS = 9;

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

/** The walk from `from` to `to` as points `stepM` apart along it (the first is `from`, the last is `to`). */
export function routePoints(map: MapDef, from: Vec3, to: Vec3, stepM: number): Vec3[] {
  const out: Vec3[] = [{ ...from }];
  let at = from;
  for (const leg of navRoute(map, from, to)) {
    const len = Math.hypot(leg.x - at.x, leg.z - at.z);
    const n = Math.max(1, Math.ceil(len / stepM));
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      out.push({ x: at.x + (leg.x - at.x) * u, y: at.y + (leg.y - at.y) * u, z: at.z + (leg.z - at.z) * u });
    }
    at = leg;
  }
  return out;
}

/** Where, and how, an Echo at a spot first shows to a player walking a route (`firstSight`). */
export interface FirstSight {
  /** Horizontal distance between the player's feet and the Echo's, at the first point of the walk that shows it, metres. */
  distM: number;
  /** The Echo's feet minus the player's, metres: positive = the Echo is above. */
  dy: number;
  /** Metres walked from the start of the route when it first shows (0 = it shows from the entry itself). */
  walkedM: number;
  /** Share (0..1) of the Echo's body the player sees at that point: low = it shows over cover or past a frame, 1 = the whole body. */
  exposure: number;
}

/**
 * The first point of `route` (as `routePoints` gives it) from which the standing eye sees any part of an Echo at one of
 * `stands` (feet positions it can be at: its anchor, and the far end of a peek path), or null when the whole walk never
 * shows it. `stepM` is the route's sample spacing, for `walkedM`.
 */
export function firstSight(
  boxes: readonly BoxDef[], hit: HitTunables, eyeHeight: number, route: readonly Vec3[], stands: readonly Vec3[], crouched: boolean, stepM: number,
): FirstSight | null {
  const top = bodyTop(hit, crouched);
  const half = hit.torsoWidth / 2;
  const eye = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < route.length; i++) {
    const p = route[i]!;
    eye.x = p.x; eye.y = p.y + eyeHeight; eye.z = p.z;
    // The nearest stand that shows from here: a peek path is judged where it first shows, not at its far end.
    let best: Vec3 | null = null, bestD = Infinity;
    for (const f of stands) {
      if (!bodyShows(boxes, half, top, eye, f)) continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (best) {
      return {
        distM: bestD,
        dy: best.y - p.y,
        walkedM: i * stepM,
        exposure: bodyExposure(boxes, hit, crouched, eye.x, eye.y, eye.z, best.x, best.y, best.z, EXPOSURE_COLUMNS, EXPOSURE_ROWS),
      };
    }
  }
  return null;
}

/** Distance bands of a first sight (design §10: close, mid, long). */
export type SightBand = 'close' | 'mid' | 'long';
export const SIGHT_BANDS: readonly SightBand[] = ['close', 'mid', 'long'];

/** The band of a first-sight distance: close below `closeToM`, long from `longFromM`, else mid. */
export function bandOf(distM: number, closeToM: number, longFromM: number): SightBand {
  return distM < closeToM ? 'close' : distM >= longFromM ? 'long' : 'mid';
}
