import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { bodyTop, lineClear } from '../sim/exposure';
import { holdAnchorsOf, holdStance, holdStandPos } from '../sim/mapQuery';
import { bodyShows, firstSight, navRoute, routePoints, type FirstSight } from '../sim/mapSight';
import type { MapDef, SectorDef } from '../sim/mapTypes';
import type { SectorSource, SectorSpot } from './sweepDirector';

export { bodyShows, navRoute };

/**
 * The sector catalog of the Sweep run director (#201): every sector of the shipped maps (#200), with
 * its hold anchors resolved to spots and the two geometric questions the director asks, answered
 * against the map's own collision boxes. Pure: reads map data and tunables only.
 */

/** Heights above the feet a walking body must pass at (shins, waist, chest). */
const WALK_HEIGHTS = [0.3, 0.9, 1.3];

/** Rays of the entry sightline fan, and the step along each, metres. */
const SIGHTLINE_RAYS = 72;
const SIGHTLINE_STEP_M = 0.5;

/**
 * The longest unobstructed horizontal line at standing eye height from a sector's entry, staying inside
 * its region (metres): what the gate calls the sector's sightline (design §4.5: long or close).
 */
export function entrySightline(map: MapDef, sector: SectorDef, eyeHeight: number): number {
  const e = sector.entry, r = sector.region;
  const eyeY = e.y + eyeHeight;
  let best = 0;
  for (let k = 0; k < SIGHTLINE_RAYS; k++) {
    const a = (k / SIGHTLINE_RAYS) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    for (let t = SIGHTLINE_STEP_M; t <= 200; t += SIGHTLINE_STEP_M) {
      const x = e.x + dx * t, z = e.z + dz * t;
      if (x < r.min.x || x > r.max.x || z < r.min.z || z > r.max.z) break;
      if (!lineClear(map.boxes, e.x, eyeY, e.z, x, eyeY, z)) break;
      if (t > best) best = t;
    }
  }
  return best;
}

/** The yaw that faces from `a` towards `b` (architecture §6: forward = (-sin yaw, 0, -cos yaw)). */
export function yawTowards(a: Vec3, b: Vec3): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/**
 * First sights are a few millions of ray tests per map, and the maps are static: each is worked out once per map (and
 * the numbers it depends on), the first time a placement asks for it.
 */
const sightCache = new WeakMap<MapDef, Map<string, FirstSight | null>>();

/** One map's sectors as the director's `SectorSource`s. Visibility answers are memoised per sector. */
export function sectorSources(map: MapDef, tunables: Tunables): SectorSource[] {
  const boxes = map.boxes;
  const hit = tunables.targets.hit;
  const hw = tunables.movement.hullHalfWidth;
  const step = tunables.sweep.place.walkStepM;
  return map.sectors.map((sector) => {
    const spots: SectorSpot[] = [];
    // Where each anchor first shows to a player walking the sector from its entry to its exit (#249), worked out on first use.
    let walk: Vec3[] | null = null;
    const memos = new Map<string, FirstSight | null>();
    const sightOf = (a: ReturnType<typeof holdAnchorsOf>[number], feet: Vec3, crouched: boolean): FirstSight | null => {
      const memo = memos.get(a.id);
      if (memo !== undefined) return memo;
      let cache = sightCache.get(map);
      if (!cache) sightCache.set(map, (cache = new Map()));
      const key = `${sector.id}|${a.id}|${tunables.movement.standEyeHeight}|${step}|${hit.torsoWidth}|${hit.headCentreStand}|${hit.headCentreCrouch}|${hit.headRadius}`;
      let v = cache.get(key);
      if (v === undefined) {
        walk ??= routePoints(map, sector.entry, sector.exit, step);
        v = firstSight(boxes, hit, tunables.movement.standEyeHeight, walk, a.kind === 'peek' ? [feet, a.out] : [feet], crouched, step);
        cache.set(key, v);
      }
      memos.set(a.id, v);
      return v;
    };
    for (const a of holdAnchorsOf(map, sector)) {
      const feet = holdStandPos(a)!;
      const crouched = holdStance(a) === 'crouch';
      if (a.kind === 'peek') {
        spots.push({ id: a.id, feet: { ...feet }, crouched, get sight() { return sightOf(a, feet, crouched); }, peek: { hold: { ...a.hold }, out: { ...a.out }, pattern: a.pattern } });
      } else if (a.kind === 'hold') {
        spots.push({ id: a.id, feet: { ...feet }, crouched, get sight() { return sightOf(a, feet, crouched); }, yaw: a.yaw });
      }
    }
    const seen = new Map<string, boolean>();
    const source: SectorSource = {
      mapId: map.id,
      id: sector.id,
      roles: sector.role,
      entry: { ...sector.entry },
      // Face the way in: the first leg of the walk from the entry to the exit (straight at the exit can be a wall).
      entryYaw: yawTowards(sector.entry, navRoute(map, sector.entry, sector.exit)[0] ?? sector.exit),
      exit: { ...sector.exit },
      sightlineM: entrySightline(map, sector, tunables.movement.standEyeHeight),
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
