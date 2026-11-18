import { attribution as defaultAttribution, type AttributionTunables } from '../config/attribution';
import { audio as defaultAudio } from '../config/audio';
import { movement as defaultMovement, type MovementTunables } from '../config/movement';
import { vec3, type Vec3 } from '../core/vec3';
import { rayBox } from './collision';
import type { MapDef } from './mapTypes';
import type { BoxDef } from './types';

/**
 * The warning a runner gives on a map (engagement-information §4.2, #99): how long before it can be
 * seen at the sector's entry its running steps are first heard there. The map-lint report.
 *
 * For each approach lane of a sector the runner (an Echo that comes from elsewhere on the map by the nav
 * graph, up to 30 m of run-in, then along the lane to its end, at `warning.runSpeedMps`) is walked in 0.1 m steps. Its steps are heard from the first
 * stride (`audio.enemy.strideM`, every stride after) that lands inside the map's footstep radius
 * (`hearing.footstep` over the shared table) of the entry; it is first seen when a ray from a
 * standing eye at the entry reaches its head with nothing in between. The warning is the time
 * between the two. The radii are chosen per map so the main approach, the hold sector's lane with the
 * longest unseen run-in, gives `warning.minSec`..`warning.maxSec` (HYPOTHESIS 40%).
 */
export interface ApproachWarning {
  sectorId: string;
  laneId: string;
  /** Length of the lane itself, metres. */
  laneM: number;
  /** Metres along the runner's path (run-in, then the lane) at which the runner is first seen from the entry; -1: never. */
  seenAtM: number;
  /** Metres along that path at which its steps are first heard at the entry (a stride landing inside the radius); -1: never before it is seen. */
  heardAtM: number;
  /** Seconds between first heard and first seen at run speed; 0 when it is heard only once seen (or never seen). */
  warningSec: number;
  /** The footstep radius that gave it, metres (the map's own, else the table's). */
  footstepM: number;
  /** A footstep radius that would put this lane's warning inside the window (the middle of the radii that do), metres; null when none can. */
  suggestedFootstepM: number | null;
  /** The hold sector's lane with the longest unseen run-in in its map: the one the radius is judged on. */
  main: boolean;
}

export interface HearingOptions {
  movement?: MovementTunables;
  attribution?: AttributionTunables;
  /** Stride between footstep sounds, metres (`audio.enemy.strideM`). */
  strideM?: number;
}

const STEP = 0.1;
/** How much run-in before a lane's start is walked (metres of nav path): a runner that comes from elsewhere. */
const LEAD_IN_M = 30;
const o = vec3();
const n = vec3();

function clear(boxes: readonly BoxDef[], a: Vec3, bx: number, by: number, bz: number): boolean {
  const dx = bx - a.x, dy = by - a.y, dz = bz - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return true;
  const ix = dx / len, iy = dy / len, iz = dz / len;
  const max = len - 1e-4;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(a.x, a.y, a.z, ix, iy, iz, boxes[i]!, max, n);
    if (t >= 0 && t < max) return false;
  }
  return true;
}

/** The nav node nearest `p` (horizontally), or -1 for a map without nav. */
function nearestNode(map: MapDef, p: Vec3): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < map.nav.nodes.length; i++) {
    const q = map.nav.nodes[i]!.pos;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * The run-in before a lane: the nav route (shortest path, `lead` metres at most) from the node farthest
 * by path from the lane's start, to the node nearest the start. An Echo that comes from elsewhere
 * (a flank, a follower, a meet group) runs this before it is on the lane. Points `[x, z, y]`, far end first.
 */
function leadIn(map: MapDef, start: Vec3, lead: number): [number, number, number][] {
  const nodes = map.nav.nodes;
  const from = nearestNode(map, start);
  if (from < 0) return [];
  const idx = new Map<string, number>();
  nodes.forEach((nd, i) => idx.set(nd.id, i));
  const adj: [number, number][][] = nodes.map(() => []);
  for (const [a, b] of map.nav.edges) {
    const ia = idx.get(a), ib = idx.get(b);
    if (ia === undefined || ib === undefined) continue;
    const d = Math.hypot(nodes[ia]!.pos.x - nodes[ib]!.pos.x, nodes[ia]!.pos.z - nodes[ib]!.pos.z);
    adj[ia]!.push([ib, d]);
    adj[ib]!.push([ia, d]);
  }
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[from] = 0;
  for (let k = 0; k < nodes.length; k++) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const [v, d] of adj[u]!) if (dist[u]! + d < dist[v]!) { dist[v] = dist[u]! + d; prev[v] = u; }
  }
  // The farthest node within `lead` metres of path.
  let far = from;
  for (let i = 0; i < nodes.length; i++) if (dist[i]! <= lead && dist[i]! > dist[far]!) far = i;
  const out: [number, number, number][] = [];
  for (let u = far; u >= 0; u = prev[u]!) out.push([nodes[u]!.pos.x, nodes[u]!.pos.z, nodes[u]!.pos.y]);
  return out; // far end first (the walk back from `far` to `from`)
}

/** Each approach lane of each sector of `map`, walked as above. Empty for a map without sectors. */
export function approachWarnings(map: MapDef, opts: HearingOptions = {}): ApproachWarning[] {
  const mv = opts.movement ?? defaultMovement;
  const at = opts.attribution ?? defaultAttribution;
  const stride = opts.strideM ?? defaultAudio.enemy.strideM;
  const footstepM = map.hearing?.footstep ?? at.soundRadiusM.footstep;
  const run = at.warning.runSpeedMps;
  const eye = mv.standEyeHeight;
  const out: ApproachWarning[] = [];
  for (const sector of map.sectors) {
    o.x = sector.entry.x; o.y = sector.entry.y + eye; o.z = sector.entry.z;
    for (const id of sector.approaches) {
      const lane = map.lanes.find((l) => l.id === id);
      if (!lane) continue;
      // The runner's path: the run-in along the nav graph, then the lane.
      const pts = leadIn(map, lane.start, LEAD_IN_M);
      pts.push([lane.start.x, lane.start.z, lane.start.y], [lane.end.x, lane.end.z, lane.end.y]);
      const xs: number[] = [], zs: number[] = [], ys: number[] = [];
      for (let a = 0; a + 1 < pts.length; a++) {
        const [x0, z0, y0] = pts[a]!, [x1, z1, y1] = pts[a + 1]!;
        const seg = Math.hypot(x1 - x0, z1 - z0);
        for (let s = 0; s < seg - 1e-9; s += STEP) {
          const f = s / seg;
          xs.push(x0 + (x1 - x0) * f); zs.push(z0 + (z1 - z0) * f); ys.push(y0 + (y1 - y0) * f);
        }
      }
      xs.push(lane.end.x); zs.push(lane.end.z); ys.push(lane.end.y);
      const laneM = Math.hypot(lane.end.x - lane.start.x, lane.end.z - lane.start.z);
      const dist: number[] = [];
      let seenAt = -1;
      for (let i = 0; i < xs.length; i++) {
        dist.push(Math.hypot(xs[i]! - sector.entry.x, zs[i]! - sector.entry.z));
        if (seenAt < 0 && clear(map.boxes, o, xs[i]!, ys[i]! + eye, zs[i]!)) seenAt = i * STEP;
      }
      // The first stride landing inside radius `r` of the entry, before the runner is seen (-1: none).
      const pathM = (xs.length - 1) * STEP;
      const limit = (seenAt < 0 ? pathM : seenAt) + 1e-9;
      const heardAtFor = (r: number): number => {
        for (let s = stride; s <= limit; s += stride) {
          if (dist[Math.min(dist.length - 1, Math.round(s / STEP))]! <= r) return s;
        }
        return -1;
      };
      const heardAt = heardAtFor(footstepM);
      const warningSec = seenAt >= 0 && heardAt >= 0 ? (seenAt - heardAt) / run : 0;
      // The radii (0.5 m steps) that would put this lane inside the window; the suggestion is the middle of them. The path wanders, so
      // "farther along the path" is not "farther from the entry": this is searched, not computed from one point.
      let suggested: number | null = null;
      if (seenAt >= 0) {
        const ok: number[] = [];
        for (let r = 2; r <= 60; r += 0.5) {
          const h = heardAtFor(r);
          const w = h >= 0 ? (seenAt - h) / run : 0;
          if (h >= 0 && w >= at.warning.minSec && w <= at.warning.maxSec) ok.push(r);
        }
        if (ok.length > 0) suggested = ok[Math.floor(ok.length / 2)]!;
      }
      out.push({ sectorId: sector.id, laneId: lane.id, laneM, seenAtM: seenAt, heardAtM: heardAt, warningSec, footstepM, suggestedFootstepM: suggested, main: false });
    }
  }
  // The main approach: among the hold-capable sectors' lanes (where enemies come running in: design §4.2) the one with the longest
  // unseen run-in (the farthest first sight along its path), preferring a lane whose warning a radius can put inside the window:
  // a long open lane next to a wall-hidden loop, where sound carries through walls and sight does not, has none, and the map
  // is judged on the approach it can be tuned for. With no tunable lane at all, the longest run-in is reported.
  const holds = new Set(map.sectors.filter((x) => x.role.includes('hold')).map((x) => x.id));
  const win = at.warning;
  const tunable = (a: ApproachWarning): boolean => a.suggestedFootstepM !== null || (a.heardAtM >= 0 && a.warningSec >= win.minSec && a.warningSec <= win.maxSec);
  let best = -1;
  for (const onlyTunable of [true, false]) {
    for (let i = 0; i < out.length; i++) {
      const a = out[i]!;
      if (!holds.has(a.sectorId) || a.seenAtM < 0 || (onlyTunable && !tunable(a))) continue;
      if (best < 0 || a.seenAtM > out[best]!.seenAtM) best = i;
    }
    if (best >= 0) break;
  }
  if (best >= 0) out[best]!.main = true;
  return out;
}
