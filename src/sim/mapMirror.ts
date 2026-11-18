import type { Vec3 } from '../core/vec3';
import type { Anchor, MapDef } from './mapTypes';
import type { BoxDef } from './types';

/**
 * Mirrored maps (design §8.5, #209): the cold opener plays each of its stored contacts mirrored left
 * or right, so a player cannot learn a day's layout from the last. A mirror is the map reflected in the
 * plane x = 0: every position's `x` is negated, every yaw is negated (architecture §6: forward is
 * `(-sin yaw, 0, -cos yaw)`, so reflecting x turns `yaw` into `-yaw`), every box swaps its x bounds and
 * an x ramp rises the other way. Sight lines, walk lines and distances are preserved exactly, so
 * whatever was hidden or reachable in the map is hidden or reachable in its mirror.
 *
 * A mirrored map has the id `<id>~m` (`mirrorId`). Pure and allocation-free after the first call per map.
 */

/** Suffix of a mirrored map's id. */
export const MIRROR_SUFFIX = '~m';

/** The id of `id`'s mirror (a mirror of a mirror is the map itself). */
export function mirrorId(id: string): string {
  return id.endsWith(MIRROR_SUFFIX) ? id.slice(0, -MIRROR_SUFFIX.length) : id + MIRROR_SUFFIX;
}

/** Whether `id` names a mirrored map. */
export function isMirrorId(id: string): boolean {
  return id.endsWith(MIRROR_SUFFIX);
}

/** The point reflected in x = 0. */
export function mirrorPoint(p: Vec3): Vec3 {
  return { x: -p.x, y: p.y, z: p.z };
}

/** The yaw reflected in x = 0. */
export function mirrorYaw(yaw: number): number {
  return yaw === 0 ? 0 : -yaw;
}

function mirrorBox(b: BoxDef): BoxDef {
  const out: BoxDef = { min: { x: -b.max.x, y: b.min.y, z: b.min.z }, max: { x: -b.min.x, y: b.max.y, z: b.max.z }, tag: b.tag };
  if (b.id !== undefined) out.id = b.id;
  if (b.ramp) out.ramp = { ...b.ramp, rise: b.ramp.rise === '+x' ? '-x' : b.ramp.rise === '-x' ? '+x' : b.ramp.rise };
  return out;
}

function mirrorAnchor(a: Anchor): Anchor {
  const tags = a.tags.slice();
  switch (a.kind) {
    case 'post':
    case 'gate':
    case 'hold':
      return { ...a, tags, pos: mirrorPoint(a.pos), yaw: mirrorYaw(a.yaw) };
    case 'beacon-shell':
      return { ...a, tags, centre: mirrorPoint(a.centre) };
    case 'strafe-lane':
      return { ...a, tags, a: mirrorPoint(a.a), b: mirrorPoint(a.b) };
    case 'peek':
      return { ...a, tags, hold: mirrorPoint(a.hold), out: mirrorPoint(a.out) };
    case 'drone-volume':
      return { ...a, tags, min: { x: -a.max.x, y: a.min.y, z: a.min.z }, max: { x: -a.min.x, y: a.max.y, z: a.max.z } };
    case 'spray-alcove':
      return { ...a, tags, stand: mirrorPoint(a.stand), post: mirrorPoint(a.post), yaw: mirrorYaw(a.yaw) };
  }
}

/** The map reflected in x = 0, with the id `mirrorId(map.id)`. */
export function mirrorMap(map: MapDef): MapDef {
  const min = map.bounds.min, max = map.bounds.max;
  return {
    ...map,
    id: mirrorId(map.id),
    name: map.name,
    boxes: map.boxes.map(mirrorBox),
    spawn: { pos: mirrorPoint(map.spawn.pos), yaw: mirrorYaw(map.spawn.yaw) },
    targets: map.targets.map((t) => ({ ...t, pos: mirrorPoint(t.pos) })),
    enemyFeet: map.enemyFeet.map(mirrorPoint),
    bounds: { min: { x: -max.x, y: min.y, z: min.z }, max: { x: -min.x, y: max.y, z: max.z } },
    anchors: map.anchors.map(mirrorAnchor),
    nav: { nodes: map.nav.nodes.map((n) => ({ id: n.id, pos: mirrorPoint(n.pos) })), edges: map.nav.edges.map(([a, b]) => [a, b] as [string, string]) },
    lanes: map.lanes.map((l) => ({ ...l, start: mirrorPoint(l.start), end: mirrorPoint(l.end) })),
    checkpoints: map.checkpoints.map((c) => ({ ...c, pos: mirrorPoint(c.pos), angleAnchors: c.angleAnchors.slice() })),
    sectors: map.sectors.map((s) => ({
      ...s,
      role: s.role.slice(),
      region: { min: { x: -s.region.max.x, y: s.region.min.y, z: s.region.min.z }, max: { x: -s.region.min.x, y: s.region.max.y, z: s.region.max.z } },
      entry: mirrorPoint(s.entry),
      exit: mirrorPoint(s.exit),
      holdAnchors: s.holdAnchors.slice(),
      approaches: s.approaches.slice(),
    })),
    marks: map.marks.map((m) => ({ ...m, a: mirrorPoint(m.a), b: mirrorPoint(m.b) })),
    look: { ...map.look },
    lint: { ...map.lint },
  };
}

const cache = new Map<MapDef, MapDef>();

/** `map`'s mirror, built once per map object. */
export function mirroredMap(map: MapDef): MapDef {
  let m = cache.get(map);
  if (!m) {
    m = mirrorMap(map);
    cache.set(map, m);
  }
  return m;
}

/** A map by id from `maps`, where `<id>~m` names the mirror of `<id>`; null when unknown. */
export function resolveMap(maps: Readonly<Record<string, MapDef>>, id: string): MapDef | null {
  if (Object.hasOwn(maps, id)) return maps[id]!;
  if (!isMirrorId(id)) return null;
  const base = mirrorId(id);
  return Object.hasOwn(maps, base) ? mirroredMap(maps[base]!) : null;
}
