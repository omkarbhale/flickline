import type { Vec3 } from '../core/vec3';
import type { Anchor, AnchorKind, AnchorOfKind, MapDef, SectorDef, SectorRole, Stance } from './mapTypes';

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

/**
 * Feet positions where an enemy is expected to stand, from the anchors that place humanoids:
 * posts, gates, peek holds and exits, strafe-lane ends and spray-wall posts. Load-time only.
 */
export function enemyFeetOf(anchors: readonly Anchor[]): Vec3[] {
  const out: Vec3[] = [];
  for (const a of anchors) {
    switch (a.kind) {
      case 'post':
      case 'gate':
        out.push(a.pos);
        break;
      case 'peek':
        out.push(a.hold, a.out);
        break;
      case 'strafe-lane':
        out.push(a.a, a.b);
        break;
      case 'spray-alcove':
        out.push(a.post);
        break;
      case 'hold':
        out.push(a.pos);
        break;
      default:
        break;
    }
  }
  return out;
}

// --- sectors (design 4.2, 10.2) --------------------------------------------------------------

export function sectorById(map: MapDef, id: string): SectorDef | undefined {
  return map.sectors.find((s) => s.id === id);
}

/** Sectors the run director may give `role` (a sector can list several roles). */
export function sectorsByRole(map: MapDef, role: SectorRole): SectorDef[] {
  return map.sectors.filter((s) => s.role.includes(role));
}

/** Feet position a placed Echo stands at on a hold anchor: a `hold` anchor's `pos`, a `peek` anchor's `hold`; `undefined` for any other kind. */
export function holdStandPos(a: Anchor): Vec3 | undefined {
  if (a.kind === 'hold') return a.pos;
  if (a.kind === 'peek') return a.hold;
  return undefined;
}

/** Stance of an Echo placed on a hold anchor (peek holds stand). */
export function holdStance(a: Anchor): Stance {
  return a.kind === 'hold' && a.stance === 'crouch' ? 'crouch' : 'stand';
}

/** The anchors a sector places Echoes on, in the order the sector lists them. */
export function holdAnchorsOf(map: MapDef, sector: SectorDef): Anchor[] {
  const out: Anchor[] = [];
  for (const id of sector.holdAnchors) {
    const a = anchorById(map, id);
    if (a !== undefined && holdStandPos(a) !== undefined) out.push(a);
  }
  return out;
}

/** Horizontal distance from the sector's entry to where an Echo on `a` stands, metres. */
export function distanceFromEntry(sector: SectorDef, a: Anchor): number {
  const p = holdStandPos(a);
  return p === undefined ? Infinity : Math.hypot(p.x - sector.entry.x, p.z - sector.entry.z);
}

/** A sector's hold anchors whose distance from its entry lies in `[min, max]` metres (the director's "close / mid / long" bands). */
export function holdAnchorsInBand(map: MapDef, sector: SectorDef, min: number, max: number): Anchor[] {
  return holdAnchorsOf(map, sector).filter((a) => {
    const d = distanceFromEntry(sector, a);
    return d >= min && d <= max;
  });
}
