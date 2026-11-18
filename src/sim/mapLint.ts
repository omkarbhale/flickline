import { movement as defaultMovement, type MovementTunables } from '../config/movement';
import { vec3, type Vec3 } from '../core/vec3';
import { hullBlocked, hullOverlaps, restHeight, rayBox, supportBelow } from './collision';
import { sweep as defaultSweep, type SweepTunables } from '../config/sweep';
import { attribution as defaultAttribution, type AttributionTunables } from '../config/attribution';
import { targets as defaultTargets, type HitTunables } from '../config/targets';
import { holdStance, holdStandPos } from './mapQuery';
import { approachWarnings, type ApproachWarning } from './mapHearing';
import { walkReach } from './mapReach';
import { bandOf, firstSeenFrom, firstSight, routePoints, type SightBand } from './mapSight';
import type { Anchor, MapDef, SectorDef, SectorRole, Stance } from './mapTypes';
import type { BoxDef } from './types';

/**
 * Semantic map checks (the schema validator has already proven the file is well formed).
 * Pure and fast: a map with ~100 boxes lints in a few milliseconds. The `map-lint` CLI runs it on
 * every JSON file under `src/sim/levels/` and fails CI on any error.
 *
 * Checks: everything inside bounds, spawn/anchors/nav nodes not buried in geometry, nav graph
 * connected with walkable edges (over stairs and ramps too), checkpoints reachable, peek anchors
 * see the checkpoint they serve, ramps walkable (slope, both ends meet a floor), every raised
 * (or sunken) hold reachable on foot from the spawn, box overlap tolerance, posts/lanes visible
 * from the spawn (warnings), sightline report.
 *
 * Sectors (design 4.2, 10.2): entry and exit reachable from each other on foot without leaving the
 * region, every hold anchor inside the region, and in a take sector every hold anchor out of
 * sight of the entry at standing eye height (an Echo is never visible when the sector opens),
 * every approach lane reaching the region on foot; the report gives each sector's longest sightline.
 * A take sector also has to offer the fights the design asks for (#249): walking from its entry to its exit, the
 * anchors first show at close, mid and long range, one of them off the floor plane (a raised or sunken position),
 * one from cover and one crouched; see `sim/mapSight.ts` for what "first shows" means. Sectors may share ground
 * (a map is a venue and a sector a route through it), so regions are allowed to overlap.
 */

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  severity: LintSeverity;
  check: string;
  /** What the issue is about, for example `anchors post-b10-x4` or `boxes pillar-a / wall-west`. */
  where: string;
  message: string;
}

export interface SightlineBin {
  label: string;
  count: number;
}

export interface SightlineReport {
  /** Eye height the rays were cast from, metres above the node. */
  eyeHeight: number;
  rays: number;
  longest: { length: number; from: string; bearingDeg: number };
  /** Longest sightline from each nav node (or from the spawn when the map has no nav). */
  perNode: { id: string; longest: number }[];
  histogram: SightlineBin[];
  /** Distance straight ahead from the spawn to the first wall. */
  spawnForward: number;
}

/** One hold anchor of a take sector as the walk from its entry to its exit first shows it (#249). */
export interface AnchorSight {
  id: string;
  /** Horizontal distance to the player at the first sight, metres; null when the walk never shows the anchor. */
  distM: number | null;
  band: SightBand | null;
  /** Anchor feet minus the player's feet at the first sight, metres (positive: the Echo is above). */
  dy: number | null;
  /** Share of the Echo's body seen at the first sight (0..1). */
  exposure: number | null;
  crouched: boolean;
}

/** One approach lane of a hold sector as the player standing at the entry first sees an arrival walking it (#249). */
export interface LaneSight {
  id: string;
  /** Horizontal distance to the Echo at the first sight, metres; null when the lane is never in sight of the entry. */
  distM: number | null;
  band: SightBand | null;
  /** The Echo's feet minus the player's at the first sight, metres. */
  dy: number | null;
}

export interface SectorReport {
  id: string;
  role: SectorRole[];
  holdAnchors: number;
  /** Longest unobstructed horizontal sightline at eye height inside the region, from the entry, the exit, a hold anchor or a nav node in it. */
  longest: { length: number; from: string; bearingDeg: number };
  /** Take sectors: each hold anchor's first sight along the walk from the entry to the exit (empty for other sectors). */
  sights: AnchorSight[];
  /** Hold sectors: each approach lane's first sight from the entry (empty for other sectors). */
  arrivals: LaneSight[];
}

export interface LintReport {
  mapId: string;
  issues: LintIssue[];
  sightlines: SightlineReport;
  sectors: SectorReport[];
  /** The warning a runner gives on each sector's approach lanes (`sim/mapHearing.ts`, #99). */
  approaches: ApproachWarning[];
  stats: { boxes: number; anchors: number; navNodes: number; navEdges: number; checkpoints: number };
}

export interface LintOptions {
  movement?: MovementTunables;
  /** Humanoid hit zones: the body points of a placed Echo that must stay hidden from a take sector's entry. */
  hit?: HitTunables;
  /** The bands, off-plane and cover thresholds of a take sector's first sights (`sweep.place`). */
  place?: SweepTunables['place'];
  /** The sound radii and the warning window the heard-before-seen report reads (default: `config/attribution.ts`). */
  attribution?: AttributionTunables;
}

const EPS = 1e-6;
const DEFAULT_OVERLAP_TOLERANCE = 0.05;
/** A checkpoint must be within this distance of a nav node it can walk to. */
const CHECKPOINT_NAV_RADIUS = 4;
const SIGHTLINE_RAYS = 36;
const SIGHTLINE_CAP = 200;
const EDGE_SAMPLE_STEP = 0.25;
/** A hold counts as reached when a walkable floor lies within this many metres of its height (ramps put the hull a little above the surface under its centre). */
const RAISED_TOLERANCE = 0.25;
const BIN_EDGES = [5, 10, 20, 30, 40];
/** A take sector wants at least this many hold anchors (a lighter sector is a warning, none an error). */
const MIN_HOLD_ANCHORS = 2;

const _n = vec3();

/** Distance along a unit ray to the nearest box, or `max` if nothing is hit. */
function firstHit(boxes: readonly BoxDef[], o: Vec3, dx: number, dy: number, dz: number, max: number): number {
  let best = max;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(o.x, o.y, o.z, dx, dy, dz, boxes[i]!, best, _n);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/** True if the segment a -> b is free of boxes. */
function segmentClear(boxes: readonly BoxDef[], a: Vec3, b: Vec3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < EPS) return true;
  return firstHit(boxes, a, dx / len, dy / len, dz / len, len - 1e-4) >= len - 1e-4;
}

function inBounds(map: MapDef, p: Vec3): boolean {
  const { min, max } = map.bounds;
  return (
    p.x >= min.x - EPS && p.x <= max.x + EPS &&
    p.y >= min.y - EPS && p.y <= max.y + EPS &&
    p.z >= min.z - EPS && p.z <= max.z + EPS
  );
}

function fmt(p: Vec3): string {
  return `(${round(p.x)}, ${round(p.y)}, ${round(p.z)})`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function boxName(b: BoxDef, i: number): string {
  return b.id ?? `${b.tag}#${i}`;
}

/** Every point an anchor occupies, with a label, for the bounds and buried-in-geometry checks. */
function anchorPoints(a: Anchor): { label: string; pos: Vec3; solid: boolean }[] {
  switch (a.kind) {
    case 'post':
    case 'gate':
      return [{ label: 'pos', pos: a.pos, solid: true }];
    case 'beacon-shell':
      return [{ label: 'centre', pos: a.centre, solid: false }];
    case 'strafe-lane':
      return [{ label: 'a', pos: a.a, solid: true }, { label: 'b', pos: a.b, solid: true }];
    case 'peek':
      return [{ label: 'hold', pos: a.hold, solid: true }, { label: 'out', pos: a.out, solid: true }];
    case 'drone-volume':
      return [{ label: 'min', pos: a.min, solid: false }, { label: 'max', pos: a.max, solid: false }];
    case 'spray-alcove':
      return [{ label: 'stand', pos: a.stand, solid: true }, { label: 'post', pos: a.post, solid: true }];
    case 'hold':
      return [{ label: 'pos', pos: a.pos, solid: true }];
  }
}

export function lintMap(map: MapDef, opts: LintOptions = {}): LintReport {
  const mv = opts.movement ?? defaultMovement;
  const hw = mv.hullHalfWidth;
  const stand = mv.standHeight;
  const eye = mv.standEyeHeight;
  const boxes = map.boxes;
  const issues: LintIssue[] = [];
  const add = (severity: LintSeverity, check: string, where: string, message: string): void => {
    issues.push({ severity, check, where, message });
  };
  // A point on a ramp is written at the surface under its centre, but a box hull rests on the
  // slope by its uphill edge (up to hull half-width x slope higher): not buried, standing on it.
  const rampSlack = hw * Math.tan((mv.maxWalkableSlopeDeg * Math.PI) / 180) + 0.01;
  const buried = (p: Vec3): boolean => {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (!hullOverlaps(p.x, p.y + 0.001, p.z, hw, stand - 0.002, b)) continue;
      if (b.ramp !== undefined && restHeight(b, p.x, p.z, hw) - p.y <= rampSlack) continue;
      return true;
    }
    return false;
  };

  // --- bounds + buried-in-geometry -------------------------------------------------------------
  const checkPoint = (where: string, label: string, p: Vec3, solid: boolean): void => {
    if (!inBounds(map, p)) add('error', 'bounds', where, `${label} ${fmt(p)} is outside the map bounds`);
    else if (solid && buried(p)) add('error', 'buried', where, `${label} ${fmt(p)} is inside geometry`);
  };
  checkPoint('spawn', 'spawn', map.spawn.pos, true);
  map.targets.forEach((t, i) => checkPoint(`targets[${i}]`, 'target', t.pos, false));
  map.anchors.forEach((a) => anchorPoints(a).forEach((q) => checkPoint(`anchor ${a.id}`, q.label, q.pos, q.solid)));
  map.nav.nodes.forEach((n) => checkPoint(`nav ${n.id}`, 'node', n.pos, true));
  map.checkpoints.forEach((c) => checkPoint(`checkpoint ${c.id}`, 'checkpoint', c.pos, true));
  map.lanes.forEach((l) => {
    checkPoint(`lane ${l.id}`, 'start', l.start, true);
    checkPoint(`lane ${l.id}`, 'end', l.end, true);
  });
  for (const a of map.anchors) {
    if (a.kind === 'beacon-shell' && a.rMin >= a.rMax) add('error', 'bounds', `anchor ${a.id}`, 'rMin must be less than rMax');
  }

  // --- nav graph: connected, edges walkable -----------------------------------------------------
  const nodeIndex = new Map<string, number>();
  map.nav.nodes.forEach((n, i) => nodeIndex.set(n.id, i));
  const parent = map.nav.nodes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (const [a, b] of map.nav.edges) {
    const ia = nodeIndex.get(a);
    const ib = nodeIndex.get(b);
    if (ia === undefined || ib === undefined) continue;
    const pa = map.nav.nodes[ia]!.pos, pb = map.nav.nodes[ib]!.pos;
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const steps = Math.max(1, Math.ceil(len / EDGE_SAMPLE_STEP));
    // Walk the edge the way a player would: stay on the floor under each sample, which may rise or
    // fall by at most one step between samples (stairs and ramps are fine, a ledge or a pit is not).
    let y = pa.y;
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const px = pa.x + (pb.x - pa.x) * t;
      const pz = pa.z + (pb.z - pa.z) * t;
      const floor = supportBelow(boxes, px, pz, hw, y + mv.stepHeight);
      const where = `about ${round(t * len)} m from ${a}`;
      if (floor === -Infinity || floor < y - mv.stepHeight - EPS) {
        add('error', 'nav-edge', `nav ${a} - ${b}`, floor === -Infinity ? `edge has no floor ${where}` : `edge drops ${round(y - floor)} m (more than a step) ${where}`);
        break;
      }
      y = floor;
      if (hullBlocked(boxes, px, y, pz, hw, stand - 0.002)) {
        add('error', 'nav-edge', `nav ${a} - ${b}`, `edge is blocked by geometry ${where}`);
        break;
      }
    }
    parent[find(ia)] = find(ib);
  }
  if (map.nav.nodes.length > 0) {
    const roots = new Map<number, string[]>();
    map.nav.nodes.forEach((n, i) => {
      const r = find(i);
      const list = roots.get(r);
      if (list) list.push(n.id);
      else roots.set(r, [n.id]);
    });
    if (roots.size > 1) {
      const parts = [...roots.values()].sort((a, b) => b.length - a.length);
      const orphans = parts.slice(1).map((p) => (p.length <= 3 ? p.join('+') : `${p.length} nodes from ${p[0]}`));
      add('error', 'nav-connected', 'nav', `graph has ${roots.size} disconnected parts; main part has ${parts[0]!.length} nodes, others: ${orphans.join(', ')}`);
    }
  }
  const nearestNode = (p: Vec3): { index: number; dist: number } => {
    let best = -1, bd = Infinity;
    for (let i = 0; i < map.nav.nodes.length; i++) {
      const q = map.nav.nodes[i]!.pos;
      const d = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (d < bd) { bd = d; best = i; }
    }
    return { index: best, dist: bd };
  };
  const spawnNode = nearestNode(map.spawn.pos);

  // --- checkpoints reachable + peek line of sight -----------------------------------------------
  const anchorById = new Map(map.anchors.map((a) => [a.id, a]));
  for (const c of map.checkpoints) {
    const where = `checkpoint ${c.id}`;
    const n = nearestNode(c.pos);
    if (n.index < 0 || n.dist > CHECKPOINT_NAV_RADIUS) {
      add('error', 'checkpoint-reach', where, `no nav node within ${CHECKPOINT_NAV_RADIUS} m (nearest ${n.index < 0 ? 'none' : `${round(n.dist)} m`})`);
    } else {
      const np = map.nav.nodes[n.index]!.pos;
      if (!segmentClear(boxes, { x: c.pos.x, y: c.pos.y + 0.5, z: c.pos.z }, { x: np.x, y: np.y + 0.5, z: np.z })) {
        add('error', 'checkpoint-reach', where, `blocked from its nearest nav node ${map.nav.nodes[n.index]!.id}`);
      }
      if (spawnNode.index >= 0 && find(n.index) !== find(spawnNode.index)) {
        add('error', 'checkpoint-reach', where, `nav node ${map.nav.nodes[n.index]!.id} is not connected to the spawn`);
      }
    }
    for (const ref of c.angleAnchors) {
      const a = anchorById.get(ref);
      if (!a || a.kind !== 'peek') continue;
      const from = { x: a.out.x, y: a.out.y + eye, z: a.out.z };
      const to = { x: c.pos.x, y: c.pos.y + eye, z: c.pos.z };
      if (!segmentClear(boxes, from, to)) {
        add('error', 'peek-los', `anchor ${a.id}`, `no line of sight from out ${fmt(a.out)} to checkpoint ${c.id} ${fmt(c.pos)}`);
      }
    }
  }

  // --- ramps: walkable slope, both ends meet a floor ---------------------------------------------
  boxes.forEach((b, i) => {
    const r = b.ramp;
    if (r === undefined) return;
    const where = `ramp ${boxName(b, i)}`;
    const alongX = r.rise === '+x' || r.rise === '-x';
    const length = alongX ? b.max.x - b.min.x : b.max.z - b.min.z;
    const slopeDeg = (Math.atan2(b.max.y - r.lowY, length) * 180) / Math.PI;
    if (slopeDeg > mv.maxWalkableSlopeDeg) {
      add('error', 'ramp-slope', where, `slope ${round(slopeDeg)} deg is steeper than the walkable maximum ${mv.maxWalkableSlopeDeg} deg`);
    }
    // Where a hull standing just past each end would be (centre of the end face).
    const cxm = (b.min.x + b.max.x) / 2;
    const czm = (b.min.z + b.max.z) / 2;
    const out = hw + 0.05;
    const sign = r.rise === '+x' || r.rise === '+z' ? 1 : -1;
    const low = alongX
      ? { x: (sign > 0 ? b.min.x : b.max.x) - sign * out, z: czm }
      : { x: cxm, z: (sign > 0 ? b.min.z : b.max.z) - sign * out };
    const high = alongX
      ? { x: (sign > 0 ? b.max.x : b.min.x) + sign * out, z: czm }
      : { x: cxm, z: (sign > 0 ? b.max.z : b.min.z) + sign * out };
    const lowFloor = supportBelow(boxes, low.x, low.z, hw, r.lowY + mv.stepHeight);
    if (lowFloor === -Infinity || Math.abs(lowFloor - r.lowY) > mv.stepHeight + EPS) {
      add('error', 'ramp-ends', where, `its low end (height ${round(r.lowY)} m) does not meet a floor within a step: nothing walkable at (${round(low.x)}, ${round(low.z)})`);
    }
    const highFloor = supportBelow(boxes, high.x, high.z, hw, b.max.y + mv.stepHeight);
    if (highFloor === -Infinity || Math.abs(highFloor - b.max.y) > mv.stepHeight + EPS) {
      add('warning', 'ramp-ends', where, `its high end (height ${round(b.max.y)} m) does not meet a floor within a step: nothing walkable at (${round(high.x)}, ${round(high.z)})`);
    }
  });

  // --- raised (or sunken) holds must be reachable on foot from the spawn ---------------------------
  const raisedLimit = 0.25;
  const held: { where: string; label: string; pos: Vec3 }[] = [];
  const consider = (where: string, label: string, p: Vec3): void => {
    if (Math.abs(p.y - map.spawn.pos.y) > raisedLimit && inBounds(map, p)) held.push({ where, label, pos: p });
  };
  map.anchors.forEach((a) => anchorPoints(a).forEach((q) => q.solid && consider(`anchor ${a.id}`, q.label, q.pos)));
  map.nav.nodes.forEach((n) => consider(`nav ${n.id}`, 'node', n.pos));
  map.checkpoints.forEach((c) => consider(`checkpoint ${c.id}`, 'checkpoint', c.pos));
  map.lanes.forEach((l) => {
    consider(`lane ${l.id}`, 'start', l.start);
    consider(`lane ${l.id}`, 'end', l.end);
  });
  if (held.length > 0) {
    const reach = walkReach(boxes, map.bounds, map.spawn.pos, mv);
    for (const h of held) {
      if (!reach.reaches(h.pos.x, h.pos.y, h.pos.z, RAISED_TOLERANCE)) {
        add('error', 'raised-reach', h.where, `${h.label} ${fmt(h.pos)} is ${h.pos.y > map.spawn.pos.y ? 'raised' : 'sunken'} and cannot be reached on foot from the spawn (a step is at most ${mv.stepHeight} m; add stairs or a ramp)`);
      }
    }
  }

  // --- box overlap tolerance --------------------------------------------------------------------
  const tol = map.lint.overlapTolerance ?? DEFAULT_OVERLAP_TOLERANCE;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
      const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
      const oz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
      if (ox <= 0 || oy <= 0 || oz <= 0) continue;
      const depth = Math.min(ox, oy, oz);
      if (depth > tol) {
        add('error', 'overlap', `boxes ${boxName(a, i)} / ${boxName(b, j)}`, `overlap ${round(depth)} m exceeds tolerance ${tol} m (z-fighting and double collision)`);
      }
    }
  }

  // --- things the player must be able to see from the spawn (warnings: other maps differ) --------
  const spawnEye = { x: map.spawn.pos.x, y: map.spawn.pos.y + eye, z: map.spawn.pos.z };
  const seen = (where: string, what: string, p: Vec3): void => {
    if (!segmentClear(boxes, spawnEye, { x: p.x, y: p.y + 1.5, z: p.z })) {
      add('warning', 'visible-from-spawn', where, `${what} ${fmt(p)} is hidden from the spawn`);
    }
  };
  for (const a of map.anchors) {
    if (a.kind === 'post') seen(`anchor ${a.id}`, 'post', a.pos);
    else if (a.kind === 'strafe-lane') {
      seen(`anchor ${a.id}`, 'lane end a', a.a);
      seen(`anchor ${a.id}`, 'lane end b', a.b);
      seen(`anchor ${a.id}`, 'lane middle', { x: (a.a.x + a.b.x) / 2, y: a.a.y, z: (a.a.z + a.b.z) / 2 });
    }
  }

  // --- spray stations: stated distance is true and the post can be shot from the stand ----------
  for (const a of map.anchors) {
    if (a.kind !== 'spray-alcove') continue;
    const d = Math.hypot(a.post.x - a.stand.x, a.post.z - a.stand.z);
    if (Math.abs(d - a.distance) > 0.5) add('error', 'spray', `anchor ${a.id}`, `distance says ${a.distance} m but stand-to-post is ${round(d)} m`);
    const from = { x: a.stand.x, y: a.stand.y + eye, z: a.stand.z };
    if (!segmentClear(boxes, from, { x: a.post.x, y: a.post.y + 1.5, z: a.post.z })) {
      add('error', 'spray', `anchor ${a.id}`, `no line of sight from stand ${fmt(a.stand)} to post ${fmt(a.post)}`);
    }
  }

  // --- sectors ------------------------------------------------------------------------------------
  const sectorReports = lintSectors(map, mv, opts.hit ?? defaultTargets.hit, opts.place ?? defaultSweep.place, add, buried);

  // --- the warning a runner gives (#99) -----------------------------------------------------------
  const approaches = approachWarnings(map, { movement: mv, ...(opts.attribution ? { attribution: opts.attribution } : {}) });
  const win = (opts.attribution ?? defaultAttribution).warning;
  for (const a of approaches) {
    if (!a.main) continue;
    if (a.heardAtM < 0 || a.warningSec < win.minSec || a.warningSec > win.maxSec) {
      const hint = a.suggestedFootstepM !== null ? `; a footstep radius of about ${round(a.suggestedFootstepM)} m (map \`hearing.footstep\`) would put it inside the window` : '; no radius can: the approach is seen too soon after it comes within earshot';
      add('warning', 'heard-before-seen', `sector ${a.sectorId} lane ${a.laneId}`, `a runner on the main approach is heard ${round(a.warningSec)} s before it can be seen at the entry, outside ${win.minSec}-${win.maxSec} s (footstep radius ${round(a.footstepM)} m)${hint}`);
    }
  }

  // --- sightlines -------------------------------------------------------------------------------
  const sources = map.nav.nodes.length > 0 ? map.nav.nodes : [{ id: 'spawn', pos: map.spawn.pos }];
  const counts = new Array<number>(BIN_EDGES.length + 1).fill(0);
  const perNode: { id: string; longest: number }[] = [];
  let longest = { length: 0, from: '', bearingDeg: 0 };
  const o = vec3();
  for (const s of sources) {
    o.x = s.pos.x; o.y = s.pos.y + eye; o.z = s.pos.z;
    let best = 0;
    for (let k = 0; k < SIGHTLINE_RAYS; k++) {
      const yaw = (k / SIGHTLINE_RAYS) * Math.PI * 2;
      const len = firstHit(boxes, o, -Math.sin(yaw), 0, -Math.cos(yaw), SIGHTLINE_CAP);
      let bin = 0;
      while (bin < BIN_EDGES.length && len >= BIN_EDGES[bin]!) bin++;
      counts[bin]!++;
      if (len > best) best = len;
      if (len > longest.length) longest = { length: len, from: s.id, bearingDeg: Math.round((yaw * 180) / Math.PI) };
    }
    perNode.push({ id: s.id, longest: best });
  }
  const labels = BIN_EDGES.map((e, i) => (i === 0 ? `< ${e} m` : `${BIN_EDGES[i - 1]}-${e} m`));
  labels.push(`>= ${BIN_EDGES[BIN_EDGES.length - 1]} m`);
  const spawnYaw = map.spawn.yaw;
  o.x = map.spawn.pos.x; o.y = map.spawn.pos.y + eye; o.z = map.spawn.pos.z;
  const spawnForward = firstHit(boxes, o, -Math.sin(spawnYaw), 0, -Math.cos(spawnYaw), SIGHTLINE_CAP);
  if (map.lint.maxSightline !== undefined && longest.length > map.lint.maxSightline) {
    add('error', 'sightline', `from ${longest.from}`, `sightline ${round(longest.length)} m exceeds the map's maximum ${map.lint.maxSightline} m (bearing ${longest.bearingDeg} deg)`);
  }

  return {
    mapId: map.id,
    issues,
    sectors: sectorReports,
    approaches,
    sightlines: {
      eyeHeight: eye,
      rays: sources.length * SIGHTLINE_RAYS,
      longest,
      perNode,
      histogram: labels.map((label, i) => ({ label, count: counts[i]! })),
      spawnForward,
    },
    stats: {
      boxes: boxes.length,
      anchors: map.anchors.length,
      navNodes: map.nav.nodes.length,
      navEdges: map.nav.edges.length,
      checkpoints: map.checkpoints.length,
    },
  };
}

const inRegion = (r: { min: Vec3; max: Vec3 }, p: Vec3): boolean =>
  p.x >= r.min.x - EPS && p.x <= r.max.x + EPS &&
  p.y >= r.min.y - EPS && p.y <= r.max.y + EPS &&
  p.z >= r.min.z - EPS && p.z <= r.max.z + EPS;

/** Body points of an Echo standing (or crouching) with its feet at `feet`: head centre, torso middle, leg middle. */
function bodyPoints(feet: Vec3, stance: Stance, hit: HitTunables, out: Vec3[]): void {
  const crouch = stance === 'crouch';
  const head = crouch ? hit.headCentreCrouch : hit.headCentreStand;
  const torso = crouch ? (hit.torsoBottomCrouch + hit.torsoTopCrouch) / 2 : (hit.torsoBottomStand + hit.torsoTopStand) / 2;
  const legs = (crouch ? hit.legTopCrouch : hit.legTopStand) / 2;
  const ys = [head, torso, legs];
  for (let i = 0; i < 3; i++) {
    const q = out[i]!;
    q.x = feet.x; q.y = feet.y + ys[i]!; q.z = feet.z;
  }
}

/** Sector checks and the per-sector sightline report. */
function lintSectors(
  map: MapDef,
  mv: MovementTunables,
  hit: HitTunables,
  place: SweepTunables['place'],
  add: (severity: LintSeverity, check: string, where: string, message: string) => void,
  buried: (p: Vec3) => boolean,
): SectorReport[] {
  const boxes = map.boxes;
  const hw = mv.hullHalfWidth;
  const eye = mv.standEyeHeight;
  const anchorIndex = new Map(map.anchors.map((a) => [a.id, a]));
  const laneIndex = new Map(map.lanes.map((l) => [l.id, l]));
  const reports: SectorReport[] = [];
  const body = [vec3(), vec3(), vec3()];
  const eyePoint = vec3();

  const standsOnFloor = (p: Vec3): boolean => {
    const floor = supportBelow(boxes, p.x, p.z, hw, p.y + mv.stepHeight);
    return floor !== -Infinity && Math.abs(floor - p.y) <= RAISED_TOLERANCE;
  };

  for (const sector of map.sectors) {
    const where = `sector ${sector.id}`;
    const region = sector.region;
    const isTake = sector.role.includes('take');

    // entry and exit: in bounds, in the region, on a floor, and reachable from each other without leaving the region
    let gatesOk = true;
    for (const [label, p] of [['entry', sector.entry], ['exit', sector.exit]] as const) {
      if (!inBounds(map, p)) { add('error', 'sector-gate', where, `${label} ${fmt(p)} is outside the map bounds`); gatesOk = false; }
      else if (buried(p)) { add('error', 'sector-gate', where, `${label} ${fmt(p)} is inside geometry`); gatesOk = false; }
      else if (!standsOnFloor(p)) { add('error', 'sector-gate', where, `${label} ${fmt(p)} has no floor under it`); gatesOk = false; }
      if (!inRegion(region, p)) { add('error', 'sector-gate', where, `${label} ${fmt(p)} is outside the sector's region`); gatesOk = false; }
    }
    if (gatesOk) {
      const fromEntry = walkReach(boxes, map.bounds, sector.entry, mv, region);
      if (!fromEntry.reaches(sector.exit.x, sector.exit.y, sector.exit.z, RAISED_TOLERANCE)) {
        add('error', 'sector-reach', where, `exit ${fmt(sector.exit)} cannot be reached on foot from the entry ${fmt(sector.entry)} inside the region`);
      } else {
        const fromExit = walkReach(boxes, map.bounds, sector.exit, mv, region);
        if (!fromExit.reaches(sector.entry.x, sector.entry.y, sector.entry.z, RAISED_TOLERANCE)) {
          add('error', 'sector-reach', where, `entry ${fmt(sector.entry)} cannot be reached on foot back from the exit ${fmt(sector.exit)} inside the region (a drop of more than a step)`);
        }
      }
    }

    // hold anchors: inside the region; in a take sector, hidden from the entry
    eyePoint.x = sector.entry.x; eyePoint.y = sector.entry.y + eye; eyePoint.z = sector.entry.z;
    let holds = 0;
    for (const id of sector.holdAnchors) {
      const a = anchorIndex.get(id);
      const pos = a === undefined ? undefined : holdStandPos(a);
      if (a === undefined || pos === undefined) {
        add('error', 'sector-hold', where, `hold anchor "${id}" is not a hold or peek anchor of this map`);
        continue;
      }
      holds++;
      if (!inRegion(region, pos)) {
        add('error', 'sector-hold', `${where} anchor ${id}`, `stands at ${fmt(pos)}, outside the sector's region`);
        continue;
      }
      if (!isTake || !gatesOk) continue;
      bodyPoints(pos, holdStance(a), hit, body);
      const seen = body.findIndex((q) => segmentClear(boxes, eyePoint, q));
      if (seen >= 0) {
        add('error', 'sector-hold-visible', `${where} anchor ${id}`, `an Echo at ${fmt(pos)} (${holdStance(a)}) is in line of sight of the entry ${fmt(sector.entry)} at standing eye height (its ${['head', 'torso', 'legs'][seen]} shows); a take sector must not open with an Echo in view`);
      }
    }
    if (isTake && holds === 0) add('error', 'sector-hold', where, 'a take sector needs hold anchors to place Echoes on');
    else if ((isTake || sector.role.includes('hold')) && holds < MIN_HOLD_ANCHORS) add('warning', 'sector-hold', where, `only ${holds} hold anchor(s); a run wants at least ${MIN_HOLD_ANCHORS} so the placement can vary`);

    // approach lanes: each ends inside the region and can be walked from its start
    if (sector.role.includes('hold') && sector.approaches.length === 0) {
      add('error', 'sector-approach', where, 'a hold sector needs at least one approach lane (the enemies arrive along it)');
    }
    for (const id of sector.approaches) {
      const lane = laneIndex.get(id);
      if (lane === undefined) { add('error', 'sector-approach', where, `approach lane "${id}" does not exist`); continue; }
      if (!inRegion(region, lane.end)) {
        add('error', 'sector-approach', `${where} lane ${id}`, `ends at ${fmt(lane.end)}, outside the sector's region, so it does not reach it`);
        continue;
      }
      if (inRegion(region, lane.start)) add('warning', 'sector-approach', `${where} lane ${id}`, `starts at ${fmt(lane.start)} inside the region: enemies would arrive from nowhere`);
      const walk = walkReach(boxes, map.bounds, lane.start, mv);
      if (!walk.reaches(lane.end.x, lane.end.y, lane.end.z, RAISED_TOLERANCE)) {
        add('error', 'sector-approach', `${where} lane ${id}`, `its end ${fmt(lane.end)} cannot be reached on foot from its start ${fmt(lane.start)}`);
      }
    }

    const sights = isTake && gatesOk ? sectorSights(map, sector, eye, hit, place) : [];
    const longest = sectorSightline(map, sector, eye);
    if (isTake && gatesOk) lintBands(sector, sights, longest.length, place, add);
    const isHold = sector.role.includes('hold');
    const arrivals = isHold && gatesOk ? sectorArrivals(map, sector, eye, hit, place) : [];
    if (isHold && gatesOk && arrivals.length > 0) lintArrivalBands(sector, arrivals, longest.length, place, add);
    reports.push({ id: sector.id, role: sector.role, holdAnchors: holds, longest, sights, arrivals });
  }
  return reports;
}

/** Each hold anchor of a take sector, as the walk from the sector's entry to its exit first shows it (#249). */
function sectorSights(map: MapDef, sector: SectorDef, eye: number, hit: HitTunables, place: SweepTunables['place']): AnchorSight[] {
  const walk = routePoints(map, sector.entry, sector.exit, place.walkStepM);
  const out: AnchorSight[] = [];
  for (const id of sector.holdAnchors) {
    const a = map.anchors.find((x) => x.id === id);
    const pos = a === undefined ? undefined : holdStandPos(a);
    if (a === undefined || pos === undefined) continue;
    const crouched = holdStance(a) === 'crouch';
    const stands = a.kind === 'peek' ? [pos, a.out] : [pos];
    const f = firstSight(map.boxes, hit, eye, walk, stands, crouched, place.walkStepM);
    out.push({
      id, crouched,
      distM: f ? f.distM : null,
      band: f ? bandOf(f.distM, place.closeToM, place.longFromM) : null,
      dy: f ? f.dy : null,
      exposure: f ? f.exposure : null,
    });
  }
  return out;
}

/** Each approach lane of a hold sector, as a player standing at its entry first sees an Echo walking it (#249). */
function sectorArrivals(map: MapDef, sector: SectorDef, eye: number, hit: HitTunables, place: SweepTunables['place']): LaneSight[] {
  const eyeAt = { x: sector.entry.x, y: sector.entry.y + eye, z: sector.entry.z };
  const out: LaneSight[] = [];
  for (const id of sector.approaches) {
    const lane = map.lanes.find((l) => l.id === id);
    if (lane === undefined) continue;
    const f = firstSeenFrom(map.boxes, hit, eye, eyeAt, routePoints(map, lane.start, lane.end, place.walkStepM));
    out.push({ id, distM: f ? f.distM : null, band: f ? bandOf(f.distM, place.closeToM, place.longFromM) : null, dy: f ? f.dy : null });
  }
  return out;
}

/** What a hold sector's arrivals have to offer (#249): the distance bands its ground reaches and a lane off the floor plane. */
function lintArrivalBands(
  sector: SectorDef, arrivals: readonly LaneSight[], longest: number, place: SweepTunables['place'],
  add: (severity: LintSeverity, check: string, where: string, message: string) => void,
): void {
  const where = `sector ${sector.id}`;
  const seen = arrivals.filter((x) => x.distM !== null);
  for (const band of ['close', 'mid', 'long'] as const) {
    const reach = band === 'close' ? 0 : band === 'mid' ? place.closeToM : place.longFromM;
    if (longest >= reach && !seen.some((x) => x.band === band)) {
      add('error', 'sector-bands', where, `no approach lane shows an arrival first ${band === 'close' ? `under ${place.closeToM} m` : band === 'mid' ? `${place.closeToM} to ${place.longFromM} m` : `${place.longFromM} m or more`} from the entry (the ${band} band); a hold sector has to offer arrivals at close, mid and long range`);
    }
  }
  if (!seen.some((x) => Math.abs(x.dy!) >= place.levelM)) {
    add('error', 'sector-bands', where, `no approach lane brings an arrival ${place.levelM} m or more above or below the player where it first shows; a hold sector needs one fight off the floor plane`);
  }
  const unseen = arrivals.filter((x) => x.distM === null).map((x) => x.id);
  if (unseen.length > 0) add('warning', 'sector-bands', where, `no arrival on ${unseen.join(', ')} is ever in sight of the entry: that fight starts only when the player goes to meet it`);
}

/**
 * What a take sector has to offer (#249): every distance band its own ground reaches (a sector whose longest sightline is
 * `longest` metres cannot start a fight further away than that: mid needs 10 m of it, long 20 m, and close is always owed),
 * something off the floor plane, from cover and crouched.
 */
function lintBands(
  sector: SectorDef, sights: readonly AnchorSight[], longest: number, place: SweepTunables['place'],
  add: (severity: LintSeverity, check: string, where: string, message: string) => void,
): void {
  const where = `sector ${sector.id}`;
  const seen = sights.filter((x) => x.distM !== null);
  for (const band of ['close', 'mid', 'long'] as const) {
    const reach = band === 'close' ? 0 : band === 'mid' ? place.closeToM : place.longFromM;
    if (longest >= reach && !seen.some((x) => x.band === band)) {
      const range = band === 'close' ? `under ${place.closeToM} m` : band === 'mid' ? `${place.closeToM} to ${place.longFromM} m` : `${place.longFromM} m or more`;
      add('error', 'sector-bands', where, `no hold anchor first shows ${range} from the player walking from the entry to the exit (the ${band} band); a take sector has to offer fights at close, mid and long range`);
    }
  }
  if (!seen.some((x) => Math.abs(x.dy!) >= place.levelM)) {
    add('error', 'sector-bands', where, `no hold anchor stands ${place.levelM} m or more above or below the player where it first shows; a take sector needs one fight off the floor plane`);
  }
  if (!seen.some((x) => x.exposure! < place.coverExposureMax)) {
    add('error', 'sector-bands', where, `no hold anchor holds from cover (every one first shows more than ${Math.round(place.coverExposureMax * 100)}% of the body); a take sector needs one over a wall or past a frame`);
  }
  if (!sights.some((x) => x.crouched)) add('error', 'sector-bands', where, 'no hold anchor is crouched; a take sector needs a low position');
  const unseen = sights.filter((x) => x.distM === null).map((x) => x.id);
  if (unseen.length > 0) add('warning', 'sector-bands', where, `the walk from the entry to the exit never shows ${unseen.join(', ')}: an Echo there is met only by leaving the route`);
}

/** Longest horizontal eye-height ray, cut off where it leaves the region, from the sector's gates, hold anchors and nav nodes. */
function sectorSightline(map: MapDef, sector: SectorDef, eye: number): SectorReport['longest'] {
  const { min, max } = sector.region;
  const sources: { id: string; pos: Vec3 }[] = [{ id: 'entry', pos: sector.entry }, { id: 'exit', pos: sector.exit }];
  for (const id of sector.holdAnchors) {
    const a = map.anchors.find((x) => x.id === id);
    const pos = a === undefined ? undefined : holdStandPos(a);
    if (pos !== undefined) sources.push({ id, pos });
  }
  for (const n of map.nav.nodes) if (inRegion(sector.region, n.pos)) sources.push({ id: n.id, pos: n.pos });
  const best = { length: 0, from: '', bearingDeg: 0 };
  const o = vec3();
  for (const s of sources) {
    o.x = s.pos.x; o.y = s.pos.y + eye; o.z = s.pos.z;
    for (let k = 0; k < SIGHTLINE_RAYS; k++) {
      const yaw = (k / SIGHTLINE_RAYS) * Math.PI * 2;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const tx = dx > EPS ? (max.x - o.x) / dx : dx < -EPS ? (min.x - o.x) / dx : Infinity;
      const tz = dz > EPS ? (max.z - o.z) / dz : dz < -EPS ? (min.z - o.z) / dz : Infinity;
      const cut = Math.max(0, Math.min(tx, tz, SIGHTLINE_CAP));
      const len = firstHit(map.boxes, o, dx, 0, dz, cut);
      if (len > best.length) { best.length = len; best.from = s.id; best.bearingDeg = Math.round((yaw * 180) / Math.PI); }
    }
  }
  return best;
}

export function lintErrors(report: LintReport): LintIssue[] {
  return report.issues.filter((i) => i.severity === 'error');
}

/** Human-readable report lines for the CLI (no colour, stable for logs). */
export function formatLintReport(report: LintReport): string[] {
  const { stats: s, sightlines: sl } = report;
  const out: string[] = [];
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.length - errors;
  out.push(`${report.mapId}: ${s.boxes} boxes, ${s.anchors} anchors, ${s.navNodes} nav nodes / ${s.navEdges} edges, ${s.checkpoints} checkpoints, ${report.sectors.length} sectors`);
  for (const i of report.issues) out.push(`  ${i.severity === 'error' ? 'ERROR' : 'warn '} [${i.check}] ${i.where}: ${i.message}`);
  out.push(`  sightlines (eye ${sl.eyeHeight} m, ${sl.rays} rays): longest ${round(sl.longest.length)} m from ${sl.longest.from} at bearing ${sl.longest.bearingDeg} deg; spawn straight ahead ${round(sl.spawnForward)} m`);
  out.push(`  histogram: ${sl.histogram.map((b) => `${b.label}: ${b.count}`).join(' | ')}`);
  const top = [...sl.perNode].sort((a, b) => b.longest - a.longest).slice(0, 5);
  out.push(`  longest per node: ${top.map((n) => `${n.id} ${round(n.longest)} m`).join(', ')}`);
  for (const a of report.approaches) {
    const heard = a.seenAtM < 0 ? 'never in sight' : a.heardAtM < 0 ? 'not heard before it is seen' : `heard ${a.warningSec.toFixed(1)} s before it is seen`;
    out.push(`  approach ${a.sectorId} / ${a.laneId}${a.main ? ' (main)' : ''}: lane ${round(a.laneM)} m, seen from the entry at ${a.seenAtM < 0 ? '-' : `${round(a.seenAtM)} m`}, ${heard} (footstep radius ${round(a.footstepM)} m${a.suggestedFootstepM !== null ? `, ${round(a.suggestedFootstepM)} m would fit the window` : ''})`);
  }
  for (const sec of report.sectors) {
    out.push(`  sector ${sec.id} [${sec.role.join('+')}]: ${sec.holdAnchors} hold anchors, longest sightline ${round(sec.longest.length)} m from ${sec.longest.from} at bearing ${sec.longest.bearingDeg} deg`);
    if (sec.arrivals.length > 0) {
      out.push(`    arrivals first seen: ${sec.arrivals.map((x) => (x.distM === null ? `${x.id} never` : `${x.id} ${round(x.distM)} m ${x.band}${Math.abs(x.dy!) >= 1 ? (x.dy! > 0 ? ' above' : ' below') : ''}`)).join(', ')}`);
    }
    if (sec.sights.length > 0) {
      out.push(`    first sights: ${sec.sights.map((x) => (x.distM === null ? `${x.id} never` : `${x.id} ${round(x.distM)} m ${x.band}${Math.abs(x.dy!) >= 1 ? (x.dy! > 0 ? ' above' : ' below') : ''}${x.crouched ? ' crouched' : ''} ${Math.round(x.exposure! * 100)}%`)).join(', ')}`);
    }
  }
  out.push(`  ${errors} error(s), ${warnings} warning(s)`);
  return out;
}
