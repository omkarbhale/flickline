import { vec3, type Vec3 } from '../core/vec3';
import {
  ANCHOR_KINDS,
  MAP_SCHEMA_VERSION,
  type Anchor,
  type AnchorKind,
  type CheckpointDef,
  type FloorMark,
  type LaneDef,
  type MapDef,
  type MapLintOptions,
  type MapLook,
  type NavGraph,
  type PeekPattern,
  type Stance,
} from './mapTypes';
import { enemyFeetOf } from './mapQuery';
import { BOX_TAGS, RAMP_RISES, type BoxDef, type BoxTag, type RampDef, type TargetSpawn } from './types';

/**
 * Hand-written validator for map JSON (no schema dependency). `parseMap` never throws: it returns
 * either the typed `MapDef` or every problem found, each with a JSON path such as
 * `anchors[3].pos[1]`, so an author can fix a whole file in one pass.
 */

export interface MapIssue {
  /** JSON path of the offending value, `$` for the document root. */
  path: string;
  message: string;
}

export type ParseResult = { ok: true; map: MapDef } | { ok: false; errors: MapIssue[] };

type Obj = Record<string, unknown>;

const PEEK_PATTERNS: readonly PeekPattern[] = ['shoulder', 'wide', 'jiggle', 'hop'];
const STANCES: readonly Stance[] = ['stand', 'crouch'];
const MARK_KINDS: readonly FloorMark['kind'][] = ['tick', 'major', 'line', 'armed'];
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

class Reader {
  readonly errors: MapIssue[] = [];

  err(path: string, message: string): void {
    this.errors.push({ path, message });
  }

  isObj(v: unknown): v is Obj {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  obj(v: unknown, path: string): Obj | null {
    if (this.isObj(v)) return v;
    this.err(path, `expected an object, got ${describe(v)}`);
    return null;
  }

  arr(v: unknown, path: string, required = true): unknown[] | null {
    if (Array.isArray(v)) return v;
    if (v === undefined && !required) return null;
    this.err(path, `expected an array, got ${describe(v)}`);
    return null;
  }

  /** Reject keys not in `allowed` (catches typos such as `"anchor"` for `"anchors"`). */
  keys(o: Obj, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) this.err(join(path, k), 'unknown property');
  }

  num(v: unknown, path: string): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    this.err(path, `expected a finite number, got ${describe(v)}`);
    return 0;
  }

  posNum(v: unknown, path: string): number {
    const n = this.num(v, path);
    if (n <= 0 && typeof v === 'number') this.err(path, `must be > 0, got ${n}`);
    return n;
  }

  str(v: unknown, path: string): string {
    if (typeof v === 'string' && v.length > 0) return v;
    this.err(path, `expected a non-empty string, got ${describe(v)}`);
    return '';
  }

  oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string, fallback: T): T {
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    this.err(path, `expected one of ${allowed.map((a) => `"${a}"`).join(', ')}, got ${describe(v)}`);
    return fallback;
  }

  vec(v: unknown, path: string): Vec3 {
    if (!Array.isArray(v) || v.length !== 3) {
      this.err(path, `expected [x, y, z], got ${describe(v)}`);
      return vec3();
    }
    return vec3(this.num(v[0], `${path}[0]`), this.num(v[1], `${path}[1]`), this.num(v[2], `${path}[2]`));
  }

  tags(v: unknown, path: string): string[] {
    if (v === undefined) return [];
    const a = this.arr(v, path);
    if (!a) return [];
    return a.map((t, i) => this.str(t, `${path}[${i}]`));
  }
}

function join(path: string, key: string): string {
  return `${path}.${key}`;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `"${v.length > 20 ? `${v.slice(0, 20)}...` : v}"`;
  return typeof v === 'object' ? 'an object' : String(v);
}

/** Records ids and reports duplicates. */
class IdSet {
  private readonly seen = new Set<string>();
  constructor(private readonly r: Reader, private readonly what: string) {}
  add(id: string, path: string): void {
    if (id === '') return;
    if (this.seen.has(id)) this.r.err(path, `duplicate ${this.what} id "${id}"`);
    this.seen.add(id);
  }
  has(id: string): boolean {
    return this.seen.has(id);
  }
}

const TOP_KEYS = [
  'schema', 'id', 'name', 'bounds', 'spawn', 'boxes', 'targets', 'anchors', 'nav', 'lanes',
  'checkpoints', 'marks', 'look', 'lint',
];

export function parseMap(raw: unknown): ParseResult {
  const r = new Reader();
  const root = r.obj(raw, '$');
  if (!root) return { ok: false, errors: r.errors };
  r.keys(root, TOP_KEYS, '$');

  if (root.schema !== MAP_SCHEMA_VERSION) r.err('$.schema', `expected schema ${MAP_SCHEMA_VERSION}, got ${describe(root.schema)}`);
  const id = r.str(root.id, '$.id');
  const name = r.str(root.name, '$.name');

  // bounds
  let bounds = { min: vec3(), max: vec3() };
  const b = r.obj(root.bounds, '$.bounds');
  if (b) {
    r.keys(b, ['min', 'max'], '$.bounds');
    bounds = { min: r.vec(b.min, '$.bounds.min'), max: r.vec(b.max, '$.bounds.max') };
    requireOrdered(r, bounds.min, bounds.max, '$.bounds');
  }

  // spawn
  let spawn = { pos: vec3(), yaw: 0 };
  const sp = r.obj(root.spawn, '$.spawn');
  if (sp) {
    r.keys(sp, ['pos', 'yaw'], '$.spawn');
    spawn = { pos: r.vec(sp.pos, '$.spawn.pos'), yaw: r.num(sp.yaw, '$.spawn.yaw') };
  }

  // boxes
  const boxIds = new IdSet(r, 'box');
  const boxes: BoxDef[] = [];
  const boxList = r.arr(root.boxes, '$.boxes');
  if (boxList) {
    boxList.forEach((raw, i) => {
      const p = `$.boxes[${i}]`;
      const o = r.obj(raw, p);
      if (!o) return;
      r.keys(o, ['id', 'tag', 'min', 'max', 'ramp'], p);
      const tag: BoxTag = r.oneOf(o.tag, BOX_TAGS, `${p}.tag`, 'wall');
      const min = r.vec(o.min, `${p}.min`);
      const max = r.vec(o.max, `${p}.max`);
      requireOrdered(r, min, max, p);
      const box: BoxDef = { tag, min, max };
      if (tag === 'ramp' && o.ramp === undefined) r.err(`${p}.ramp`, 'a ramp box needs "ramp": {"rise": "+x" | "-x" | "+z" | "-z", "lowY": number}');
      if (o.ramp !== undefined) {
        if (tag !== 'ramp') r.err(`${p}.ramp`, 'only boxes tagged "ramp" may have a ramp property');
        const ramp = parseRamp(r, o.ramp, `${p}.ramp`, min.y, max.y);
        if (ramp) box.ramp = ramp;
      }
      if (o.id !== undefined) {
        box.id = r.str(o.id, `${p}.id`);
        boxIds.add(box.id, `${p}.id`);
      }
      boxes.push(box);
    });
    if (boxList.length === 0) r.err('$.boxes', 'a map needs at least one box');
  }

  // targets (placeholder spawn points for sphere targets)
  const targets: TargetSpawn[] = [];
  const targetList = r.arr(root.targets, '$.targets', false);
  if (targetList) {
    targetList.forEach((raw, i) => {
      const o = r.obj(raw, `$.targets[${i}]`);
      if (!o) return;
      r.keys(o, ['pos'], `$.targets[${i}]`);
      targets.push({ pos: r.vec(o.pos, `$.targets[${i}].pos`) });
    });
  }

  // anchors
  const anchorIds = new IdSet(r, 'anchor');
  const anchors: Anchor[] = [];
  const anchorList = r.arr(root.anchors, '$.anchors');
  if (anchorList) {
    anchorList.forEach((raw, i) => {
      const a = parseAnchor(r, raw, `$.anchors[${i}]`, anchorIds);
      if (a) anchors.push(a);
    });
  }

  // nav
  const nav: NavGraph = { nodes: [], edges: [] };
  const navRaw = r.obj(root.nav, '$.nav');
  if (navRaw) {
    r.keys(navRaw, ['nodes', 'edges'], '$.nav');
    const nodeIds = new IdSet(r, 'nav node');
    r.arr(navRaw.nodes, '$.nav.nodes')?.forEach((raw, i) => {
      const p = `$.nav.nodes[${i}]`;
      const o = r.obj(raw, p);
      if (!o) return;
      r.keys(o, ['id', 'pos'], p);
      const nid = r.str(o.id, `${p}.id`);
      nodeIds.add(nid, `${p}.id`);
      nav.nodes.push({ id: nid, pos: r.vec(o.pos, `${p}.pos`) });
    });
    r.arr(navRaw.edges, '$.nav.edges')?.forEach((raw, i) => {
      const p = `$.nav.edges[${i}]`;
      if (!Array.isArray(raw) || raw.length !== 2) {
        r.err(p, `expected [nodeId, nodeId], got ${describe(raw)}`);
        return;
      }
      const e0 = r.str(raw[0], `${p}[0]`);
      const e1 = r.str(raw[1], `${p}[1]`);
      if (e0 !== '' && !nodeIds.has(e0)) r.err(`${p}[0]`, `unknown nav node "${e0}"`);
      if (e1 !== '' && !nodeIds.has(e1)) r.err(`${p}[1]`, `unknown nav node "${e1}"`);
      if (e0 !== '' && e0 === e1) r.err(p, `edge connects node "${e0}" to itself`);
      nav.edges.push([e0, e1]);
    });
  }

  // lanes
  const lanes: LaneDef[] = [];
  const laneIds = new IdSet(r, 'lane');
  r.arr(root.lanes, '$.lanes', false)?.forEach((raw, i) => {
    const p = `$.lanes[${i}]`;
    const o = r.obj(raw, p);
    if (!o) return;
    r.keys(o, ['id', 'start', 'end', 'width'], p);
    const lid = r.str(o.id, `${p}.id`);
    laneIds.add(lid, `${p}.id`);
    lanes.push({ id: lid, start: r.vec(o.start, `${p}.start`), end: r.vec(o.end, `${p}.end`), width: r.posNum(o.width, `${p}.width`) });
  });

  // checkpoints
  const checkpoints: CheckpointDef[] = [];
  const cpIds = new IdSet(r, 'checkpoint');
  r.arr(root.checkpoints, '$.checkpoints', false)?.forEach((raw, i) => {
    const p = `$.checkpoints[${i}]`;
    const o = r.obj(raw, p);
    if (!o) return;
    r.keys(o, ['id', 'pos', 'angleAnchors'], p);
    const cid = r.str(o.id, `${p}.id`);
    cpIds.add(cid, `${p}.id`);
    const refs = (r.arr(o.angleAnchors, `${p}.angleAnchors`) ?? []).map((x, j) => {
      const ref = r.str(x, `${p}.angleAnchors[${j}]`);
      const target = anchors.find((a) => a.id === ref);
      if (ref !== '' && !target) r.err(`${p}.angleAnchors[${j}]`, `unknown anchor "${ref}"`);
      else if (target && target.kind !== 'peek') r.err(`${p}.angleAnchors[${j}]`, `anchor "${ref}" is a ${target.kind}, expected a peek`);
      return ref;
    });
    checkpoints.push({ id: cid, pos: r.vec(o.pos, `${p}.pos`), angleAnchors: refs });
  });

  // anchor references into boxes
  anchorList?.forEach((raw, i) => {
    const a = anchors.find((x) => x.id === (raw as Obj | null)?.id);
    if (!a) return;
    const p = `$.anchors[${i}]`;
    if (a.kind === 'peek' && !boxIds.has(a.cover)) r.err(`${p}.cover`, `unknown box id "${a.cover}"`);
    if (a.kind === 'spray-alcove' && !boxIds.has(a.panel)) r.err(`${p}.panel`, `unknown box id "${a.panel}"`);
  });

  // marks
  const marks: FloorMark[] = [];
  r.arr(root.marks, '$.marks', false)?.forEach((raw, i) => {
    const p = `$.marks[${i}]`;
    const o = r.obj(raw, p);
    if (!o) return;
    r.keys(o, ['kind', 'a', 'b', 'width'], p);
    marks.push({
      kind: r.oneOf(o.kind, MARK_KINDS, `${p}.kind`, 'tick'),
      a: r.vec(o.a, `${p}.a`),
      b: r.vec(o.b, `${p}.b`),
      width: r.posNum(o.width, `${p}.width`),
    });
  });

  // look
  let look: MapLook = { sky: '#000000', fog: [0, 1], palette: 'default' };
  const lk = r.obj(root.look, '$.look');
  if (lk) {
    r.keys(lk, ['sky', 'fog', 'palette'], '$.look');
    const sky = r.str(lk.sky, '$.look.sky');
    if (sky !== '' && !HEX_COLOUR.test(sky)) r.err('$.look.sky', `expected a colour like "#0b0d14", got "${sky}"`);
    let fog: [number, number] = [0, 1];
    if (Array.isArray(lk.fog) && lk.fog.length === 2) {
      fog = [r.num(lk.fog[0], '$.look.fog[0]'), r.num(lk.fog[1], '$.look.fog[1]')];
      if (fog[0] < 0 || fog[1] <= fog[0]) r.err('$.look.fog', `expected 0 <= near < far, got [${fog[0]}, ${fog[1]}]`);
    } else r.err('$.look.fog', `expected [near, far], got ${describe(lk.fog)}`);
    look = { sky, fog, palette: r.str(lk.palette, '$.look.palette') };
  }

  // lint options
  const lint: MapLintOptions = {};
  if (root.lint !== undefined) {
    const lo = r.obj(root.lint, '$.lint');
    if (lo) {
      r.keys(lo, ['overlapTolerance', 'maxSightline'], '$.lint');
      if (lo.overlapTolerance !== undefined) lint.overlapTolerance = r.num(lo.overlapTolerance, '$.lint.overlapTolerance');
      if (lo.maxSightline !== undefined) lint.maxSightline = r.posNum(lo.maxSightline, '$.lint.maxSightline');
    }
  }

  if (r.errors.length > 0) return { ok: false, errors: r.errors };
  return {
    ok: true,
    map: {
      schema: MAP_SCHEMA_VERSION, id, name, bounds, spawn, boxes, targets, anchors, nav, lanes, checkpoints, marks, look, lint,
      enemyFeet: enemyFeetOf(anchors),
    },
  };
}

/** `ramp: {rise, lowY}` on a box spanning `minY..maxY`: the surface climbs from `lowY` to `maxY`. */
function parseRamp(r: Reader, raw: unknown, path: string, minY: number, maxY: number): RampDef | null {
  const o = r.obj(raw, path);
  if (!o) return null;
  r.keys(o, ['rise', 'lowY'], path);
  const rise = r.oneOf(o.rise, RAMP_RISES, `${path}.rise`, '+x');
  const lowY = r.num(o.lowY, `${path}.lowY`);
  if (lowY < minY || lowY >= maxY) r.err(`${path}.lowY`, `must satisfy min.y (${minY}) <= lowY < max.y (${maxY}), got ${lowY}`);
  return { rise, lowY };
}

function requireOrdered(r: Reader, min: Vec3, max: Vec3, path: string): void {
  if (min.x >= max.x) r.err(path, `min.x (${min.x}) must be less than max.x (${max.x})`);
  if (min.y >= max.y) r.err(path, `min.y (${min.y}) must be less than max.y (${max.y})`);
  if (min.z >= max.z) r.err(path, `min.z (${min.z}) must be less than max.z (${max.z})`);
}

function parseAnchor(r: Reader, raw: unknown, p: string, ids: IdSet): Anchor | null {
  const o = r.obj(raw, p);
  if (!o) return null;
  const kind: AnchorKind = r.oneOf(o.kind, ANCHOR_KINDS, `${p}.kind`, 'post');
  if (!(ANCHOR_KINDS as readonly unknown[]).includes(o.kind)) return null; // the rest would only be noise
  const id = r.str(o.id, `${p}.id`);
  ids.add(id, `${p}.id`);
  const tags = r.tags(o.tags, `${p}.tags`);
  const base = ['kind', 'id', 'tags'];
  switch (kind) {
    case 'post': {
      r.keys(o, [...base, 'pos', 'yaw', 'stance'], p);
      const a: Anchor = { kind, id, tags, pos: r.vec(o.pos, `${p}.pos`), yaw: r.num(o.yaw, `${p}.yaw`) };
      if (o.stance !== undefined) a.stance = r.oneOf(o.stance, STANCES, `${p}.stance`, 'stand');
      return a;
    }
    case 'beacon-shell': {
      r.keys(o, [...base, 'centre', 'rMin', 'rMax'], p);
      const rMin = r.posNum(o.rMin, `${p}.rMin`);
      const rMax = r.posNum(o.rMax, `${p}.rMax`);
      if (rMin >= rMax) r.err(p, `rMin (${rMin}) must be less than rMax (${rMax})`);
      return { kind, id, tags, centre: r.vec(o.centre, `${p}.centre`), rMin, rMax };
    }
    case 'strafe-lane':
      r.keys(o, [...base, 'a', 'b'], p);
      return { kind, id, tags, a: r.vec(o.a, `${p}.a`), b: r.vec(o.b, `${p}.b`) };
    case 'peek':
      r.keys(o, [...base, 'cover', 'hold', 'out', 'pattern'], p);
      return {
        kind, id, tags,
        cover: r.str(o.cover, `${p}.cover`),
        hold: r.vec(o.hold, `${p}.hold`),
        out: r.vec(o.out, `${p}.out`),
        pattern: r.oneOf(o.pattern, PEEK_PATTERNS, `${p}.pattern`, 'shoulder'),
      };
    case 'gate':
      r.keys(o, [...base, 'pos', 'yaw'], p);
      return { kind, id, tags, pos: r.vec(o.pos, `${p}.pos`), yaw: r.num(o.yaw, `${p}.yaw`) };
    case 'drone-volume': {
      r.keys(o, [...base, 'min', 'max'], p);
      const min = r.vec(o.min, `${p}.min`);
      const max = r.vec(o.max, `${p}.max`);
      requireOrdered(r, min, max, p);
      return { kind, id, tags, min, max };
    }
    case 'spray-alcove':
      r.keys(o, [...base, 'stand', 'yaw', 'post', 'panel', 'distance'], p);
      return {
        kind, id, tags,
        stand: r.vec(o.stand, `${p}.stand`),
        yaw: r.num(o.yaw, `${p}.yaw`),
        post: r.vec(o.post, `${p}.post`),
        panel: r.str(o.panel, `${p}.panel`),
        distance: r.posNum(o.distance, `${p}.distance`),
      };
  }
}
