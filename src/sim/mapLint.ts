import { movement as defaultMovement, type MovementTunables } from '../config/movement';
import { vec3, type Vec3 } from '../core/vec3';
import { hullBlocked, rayBox } from './collision';
import type { Anchor, MapDef } from './mapTypes';
import type { BoxDef } from './types';

/**
 * Semantic map checks (the schema validator has already proven the file is well formed).
 * Pure and fast: a map with ~100 boxes lints in a few milliseconds. The `map-lint` CLI runs it on
 * every JSON file under `src/sim/levels/` and fails CI on any error.
 *
 * Checks: everything inside bounds, spawn/anchors/nav nodes not buried in geometry, nav graph
 * connected with walkable edges, checkpoints reachable, peek anchors see the checkpoint they
 * serve, box overlap tolerance, posts/lanes visible from the spawn (warnings), sightline report.
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

export interface LintReport {
  mapId: string;
  issues: LintIssue[];
  sightlines: SightlineReport;
  stats: { boxes: number; anchors: number; navNodes: number; navEdges: number; checkpoints: number };
}

export interface LintOptions {
  movement?: MovementTunables;
}

const EPS = 1e-6;
const DEFAULT_OVERLAP_TOLERANCE = 0.05;
/** A checkpoint must be within this distance of a nav node it can walk to. */
const CHECKPOINT_NAV_RADIUS = 4;
const SIGHTLINE_RAYS = 36;
const SIGHTLINE_CAP = 200;
const EDGE_SAMPLE_STEP = 0.25;
const BIN_EDGES = [5, 10, 20, 30, 40];

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
  const buried = (p: Vec3): boolean => hullBlocked(boxes, p.x, p.y + 0.001, p.z, hw, stand - 0.002);

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
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (hullBlocked(boxes, pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t + 0.001, pa.z + (pb.z - pa.z) * t, hw, stand - 0.002)) {
        add('error', 'nav-edge', `nav ${a} - ${b}`, `edge is blocked by geometry about ${round(t * len)} m from ${a}`);
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
      const d = Math.hypot(q.x - p.x, q.z - p.z);
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

export function lintErrors(report: LintReport): LintIssue[] {
  return report.issues.filter((i) => i.severity === 'error');
}

/** Human-readable report lines for the CLI (no colour, stable for logs). */
export function formatLintReport(report: LintReport): string[] {
  const { stats: s, sightlines: sl } = report;
  const out: string[] = [];
  const errors = report.issues.filter((i) => i.severity === 'error').length;
  const warnings = report.issues.length - errors;
  out.push(`${report.mapId}: ${s.boxes} boxes, ${s.anchors} anchors, ${s.navNodes} nav nodes / ${s.navEdges} edges, ${s.checkpoints} checkpoints`);
  for (const i of report.issues) out.push(`  ${i.severity === 'error' ? 'ERROR' : 'warn '} [${i.check}] ${i.where}: ${i.message}`);
  out.push(`  sightlines (eye ${sl.eyeHeight} m, ${sl.rays} rays): longest ${round(sl.longest.length)} m from ${sl.longest.from} at bearing ${sl.longest.bearingDeg} deg; spawn straight ahead ${round(sl.spawnForward)} m`);
  out.push(`  histogram: ${sl.histogram.map((b) => `${b.label}: ${b.count}`).join(' | ')}`);
  const top = [...sl.perNode].sort((a, b) => b.longest - a.longest).slice(0, 5);
  out.push(`  longest per node: ${top.map((n) => `${n.id} ${round(n.longest)} m`).join(', ')}`);
  out.push(`  ${errors} error(s), ${warnings} warning(s)`);
  return out;
}
