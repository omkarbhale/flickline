import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { bandExposure, bodyTop, lineClear } from '../sim/exposure';
import { holdAnchorsOf, holdStance, holdStandPos } from '../sim/mapQuery';
import type { MapDef } from '../sim/mapTypes';
import type { SectorSource, SectorSpot } from './sweepDirector';

/**
 * The sector catalog of the Sweep run director (#201): every sector of the shipped maps (#200), with
 * its hold anchors resolved to spots and the two geometric questions the director asks, answered
 * against the map's own collision boxes. Pure: reads map data and tunables only.
 */

/** Sample grid laid over an Echo's body for "is any part of it visible" (finer than the lint's three points). */
const SIGHT_COLUMNS = 5;
const SIGHT_ROWS = 6;
/** Heights above the feet a walking body must pass at (shins, waist, chest). */
const WALK_HEIGHTS = [0.3, 0.9, 1.3];

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
    const seen = new Map<string, boolean>();
    const source: SectorSource = {
      mapId: map.id,
      id: sector.id,
      roles: sector.role,
      entry: { ...sector.entry },
      entryYaw: yawTowards(sector.entry, sector.exit),
      exit: { ...sector.exit },
      spots,
      visible(eye, feet, crouched) {
        const key = `${eye.x.toFixed(2)},${eye.y.toFixed(2)},${eye.z.toFixed(2)}|${feet.x.toFixed(2)},${feet.y.toFixed(2)},${feet.z.toFixed(2)}|${crouched ? 1 : 0}`;
        let v = seen.get(key);
        if (v === undefined) {
          v = bandExposure(boxes, hit, crouched, eye.x, eye.y, eye.z, feet.x, feet.y, feet.z, 0, bodyTop(hit, crouched), SIGHT_COLUMNS, SIGHT_ROWS) > 0;
          seen.set(key, v);
        }
        return v;
      },
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
