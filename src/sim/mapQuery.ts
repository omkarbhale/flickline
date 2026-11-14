import type { Vec3 } from '../core/vec3';
import type { Anchor, AnchorKind, AnchorOfKind, MapDef } from './mapTypes';

/**
 * Anchor lookups for the mode scheduler: "pick anchors by kind, tag and distance band; nothing
 * else in the code knows a map's contents". These allocate; call them when a run starts and keep
 * the result, never per tick.
 */

export function anchorsOfKind<K extends AnchorKind>(map: MapDef, kind: K): AnchorOfKind<K>[] {
  return map.anchors.filter((a): a is AnchorOfKind<K> => a.kind === kind);
}

export function anchorsWithTag(map: MapDef, tag: string): Anchor[] {
  return map.anchors.filter((a) => a.tags.includes(tag));
}

export function anchorById(map: MapDef, id: string): Anchor | undefined {
  return map.anchors.find((a) => a.id === id);
}

/** Horizontal distance from the map's spawn to `p`, metres. */
export function distanceFromSpawn(map: MapDef, p: Vec3): number {
  return Math.hypot(p.x - map.spawn.pos.x, p.z - map.spawn.pos.z);
}

/** Posts whose horizontal distance from the spawn lies in `[min, max]` metres. */
export function postsInBand(map: MapDef, min: number, max: number): AnchorOfKind<'post'>[] {
  return anchorsOfKind(map, 'post').filter((a) => {
    const d = distanceFromSpawn(map, a.pos);
    return d >= min && d <= max;
  });
}
