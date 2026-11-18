import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { bodyTop, lineClear } from '../sim/exposure';
import { rayBox } from '../sim/collision';
import { holdAnchorsOf, holdStance, holdStandPos } from '../sim/mapQuery';
import { bodyShows, firstSight, navRoute, routePoints, type FirstSight } from '../sim/mapSight';
import type { MapDef, SectorDef } from '../sim/mapTypes';
import type { ApproachLane, SectorSource, SectorSpot } from './sweepDirector';

export { bodyShows, navRoute };

/**
 * The sector catalog of the Sweep run director (#201): every sector of the shipped maps (#200), with
 * its hold anchors resolved to spots and the two geometric questions the director asks, answered
 * against the map's own collision boxes. Pure: reads map data and tunables only.
 */

/** Heights above the feet a walking body must pass at (shins, waist, chest). */
const WALK_HEIGHTS = [0.3, 0.9, 1.3];

/** Rays of the sightline fan, and the spacing of the walk's points it is cast from, metres. */
const SIGHTLINE_RAYS = 72;
const SIGHTLINE_STEP_M = 2;

const sightlineNormal = { x: 0, y: 0, z: 0 };
/** Sightlines are a property of a static map: each is measured once per map, sector and eye height, whatever catalog asks. */
const lineCache = new WeakMap<MapDef, Map<string, number>>();

/**
 * The longest unobstructed horizontal line at standing eye height from any point of the walk a sector makes from its entry to
 * its exit, staying inside its region (metres): what the gate calls the sector's sightline (design §4.5: long or close). It is
 * measured along the walk, not from the entry alone, because a sector often opens round a corner (#249): standing at the entry
 * you see little, and the fights it holds start a few steps on at the range this reports.
 */
export function routeSightline(map: MapDef, sector: SectorDef, eyeHeight: number): number {
  let cache = lineCache.get(map);
  if (!cache) lineCache.set(map, (cache = new Map()));
  const key = `${sector.id}|${eyeHeight}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  const r = sector.region;
  let best = 0;
  for (const p of routePoints(map, sector.entry, sector.exit, SIGHTLINE_STEP_M)) {
    const eyeY = p.y + eyeHeight;
    for (let k = 0; k < SIGHTLINE_RAYS; k++) {
      const a = (k / SIGHTLINE_RAYS) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      // Cut the ray where it leaves the region, then at the first box it meets.
      const tx = dx > 1e-9 ? (r.max.x - p.x) / dx : dx < -1e-9 ? (r.min.x - p.x) / dx : Infinity;
      const tz = dz > 1e-9 ? (r.max.z - p.z) / dz : dz < -1e-9 ? (r.min.z - p.z) / dz : Infinity;
      let len = Math.max(0, Math.min(tx, tz, 200));
      for (let i = 0; i < map.boxes.length && len > best; i++) {
        const t = rayBox(p.x, eyeY, p.z, dx, 0, dz, map.boxes[i]!, len, sightlineNormal);
        if (t >= 0 && t < len) len = t;
      }
      if (len > best) best = len;
    }
  }
  cache.set(key, best);
  return best;
}

/** The yaw that faces from `a` towards `b` (architecture §6: forward = (-sin yaw, 0, -cos yaw)). */
export function yawTowards(a: Vec3, b: Vec3): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

const quantum = (v: number): number => Math.round(v * 100);
const q = quantum;

/**
 * What a sector's visibility and walkability answers depend on is the map and a few numbers (the body, the hull), not the
 * run: the answers are kept per map and those numbers, so every catalog built over the same map (one per run of the bot, one
 * per test) shares them. Keys quantise positions to a centimetre.
 */
const geometryCache = new WeakMap<MapDef, Map<string, { vis: Map<string, boolean>; walk: Map<string, boolean> }>>();
function geometryMemo(map: MapDef, tunables: Tunables): { vis: Map<string, boolean>; walk: Map<string, boolean> } {
  let byParams = geometryCache.get(map);
  if (!byParams) geometryCache.set(map, (byParams = new Map()));
  const h = tunables.targets.hit;
  const key = `${h.torsoWidth}|${h.headCentreStand}|${h.headCentreCrouch}|${h.headRadius}|${tunables.movement.hullHalfWidth}`;
  let m = byParams.get(key);
  if (!m) byParams.set(key, (m = { vis: new Map(), walk: new Map() }));
  return m;
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
    let line = -1;
    const lineOf = (): number => (line >= 0 ? line : (line = routeSightline(map, sector, tunables.movement.standEyeHeight)));
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
    const { vis: seen, walk: walked } = geometryMemo(map, tunables);
    const approaches: ApproachLane[] = [];
    for (const id of sector.approaches) {
      const lane = map.lanes.find((l) => l.id === id);
      if (lane) approaches.push({ id: lane.id, start: { ...lane.start }, end: { ...lane.end }, width: lane.width });
    }
    const source: SectorSource = {
      mapId: map.id,
      id: sector.id,
      roles: sector.role,
      approaches,
      entry: { ...sector.entry },
      // Face the way in: the first leg of the walk from the entry to the exit (straight at the exit can be a wall).
      entryYaw: yawTowards(sector.entry, navRoute(map, sector.entry, sector.exit)[0] ?? sector.exit),
      exit: { ...sector.exit },
      get sightlineM() { return lineOf(); },
      spots,
      // A meet group crosses on the first straight leg of the walk from the exit to the entry.
      meetRoute: sector.role.includes('meet')
        ? { from: { ...sector.exit }, to: { ...(navRoute(map, sector.exit, sector.entry)[0] ?? sector.entry) } }
        : undefined,
      visible(eye, feet, crouched) {
        const key = `${q(eye.x)},${q(eye.y)},${q(eye.z)}|${q(feet.x)},${q(feet.y)},${q(feet.z)}|${crouched ? 1 : 0}`;
        let v = seen.get(key);
        if (v === undefined) {
          v = bodyShows(boxes, hit.torsoWidth / 2, bodyTop(hit, crouched), eye, feet);
          seen.set(key, v);
        }
        return v;
      },
      route: (from, to) => navRoute(map, from, to),
      walkable(a, b) {
        const key = `${q(a.x)},${q(a.y)},${q(a.z)}|${q(b.x)},${q(b.y)},${q(b.z)}`;
        let w = walked.get(key);
        if (w === undefined) walked.set(key, (w = walkClear(a, b)));
        return w;
      },
    };
    return source;

    /** Whether a body can walk the straight line `a` to `b`: the centre line and both shoulders, at shin, waist and chest height. */
    function walkClear(a: Vec3, b: Vec3): boolean {
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
    }
  });
}

/** Every sector of every map given. */
export function sectorCatalog(maps: readonly MapDef[], tunables: Tunables): SectorSource[] {
  const out: SectorSource[] = [];
  for (const m of maps) out.push(...sectorSources(m, tunables));
  return out;
}
