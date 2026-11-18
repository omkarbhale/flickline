import { TICK_DT } from '../core/time';
import { DEG2RAD } from '../core/math';
import type { ArriveParams } from './enemyAi';
import { MAX_ROUTE } from './enemyAi';
import { seesPlayer } from './enemyFire';
import { lineClear } from './exposure';
import type { BehaviourContext } from './fsm';
import type { BoxDef, TargetState } from './types';

/**
 * Arrivals (design §4.2 hold sectors, §9.3 fairness floors): an Echo that comes to the player. It
 * spawns at the first point of its route (outside the sector, out of sight), walks the route at
 * its speed and then hands over to its kind's fight behaviour (`strafer.ts`, `peeker.ts`: their
 * `arrive` state calls `arriveStep`).
 *
 * - **Honest.** An arrival never starts a contact before the player has had information about it:
 *   it came into the player's view (`visibleTick`), or its running steps were audible (`ai.audibleTick`,
 *   set by `TargetField.step`). Walking is silent, as for the player. `docs/research/player-like-enemies.md` S9.
 * - **Fair.** It never walks closer to the player than the spawn floors: 4 m anywhere, 5 m inside the
 *   view cone (design §9.3.5: the rule "also binds Echoes that walk closer, such as arrivals in hold
 *   sectors", #32, #204). A Strafer that would break the floor stops there and fights; a Peeker, whose
 *   place is behind its cover, waits where it is until the player is clear of its way.
 * - **Cheap.** Plain numbers on preallocated route arrays, one sight test per tick for a Strafer
 *   that is walking in, nothing allocated.
 */

/** Copy a route into a freshly spawned target (the first point is where it stands). False when the route is unusable. */
export function arriveInit(t: TargetState, p: ArriveParams | undefined): boolean {
  const a = t.ai;
  if (!p || p.route.length < 2) return false;
  const n = Math.min(MAX_ROUTE, p.route.length);
  for (let i = 0; i < n; i++) {
    const r = p.route[i]!;
    a.routeX[i] = r.x; a.routeY[i] = r.y; a.routeZ[i] = r.z;
  }
  a.routeN = n;
  a.routeI = 1;
  a.routeSpeed = p.speed;
  a.engageM = p.engageM;
  a.arriving = true;
  a.honest = true;
  a.audibleTick = -1;
  a.audibleAccum = 0;
  t.pos.x = a.routeX[0]!; t.pos.y = a.routeY[0]!; t.pos.z = a.routeZ[0]!;
  t.prevPos.x = t.pos.x; t.prevPos.y = t.pos.y; t.prevPos.z = t.pos.z;
  const dx = a.routeX[1]! - a.routeX[0]!, dz = a.routeZ[1]! - a.routeZ[0]!;
  const l = Math.sqrt(dx * dx + dz * dz);
  if (l > 1e-9) { a.headX = dx / l; a.headZ = dz / l; }
  return true;
}

/** Whether a position (`x`, `z`) breaks the spawn fairness floors against the player (design §9.3.5). */
export function breaksFloor(ctx: BehaviourContext, x: number, z: number): boolean {
  const f = ctx.tunables.dial.floors;
  const p = ctx.world.player;
  const dx = x - p.pos.x, dz = z - p.pos.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < f.spawnMinDistance * f.spawnMinDistance) return true;
  if (d2 >= f.spawnViewConeDistance * f.spawnViewConeDistance) return false;
  // Inside the view cone: the angle between the view's horizontal direction and the way to the Echo.
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  const cos = (dx * fx + dz * fz) / Math.sqrt(d2);
  return cos > Math.cos(f.spawnViewAngleDeg * DEG2RAD);
}

/**
 * Walk one tick along the route. True when the walk is over and the behaviour should take over:
 * the route's end, or (`engage`, a Strafer) the player is in its sights within `engageM`, or it was
 * hurt, or the next step would break the fairness floor. A Peeker (`engage` false) finishes the whole
 * route and only ever waits for the floor.
 */
export function arriveStep(t: TargetState, ctx: BehaviourContext, engage: boolean): boolean {
  const a = t.ai;
  if (engage) {
    if (t.hp < t.maxHp) return true;
    const p = ctx.world.player;
    const dx = p.pos.x - t.pos.x, dz = p.pos.z - t.pos.z;
    if (dx * dx + dz * dz <= a.engageM * a.engageM && seesPlayer(t, ctx)) return true;
  }
  const i = a.routeI;
  const tx = a.routeX[i]!, ty = a.routeY[i]!, tz = a.routeZ[i]!;
  const dx = tx - t.pos.x, dy = ty - t.pos.y, dz = tz - t.pos.z;
  const dh = Math.sqrt(dx * dx + dz * dz);
  const step = a.routeSpeed * TICK_DT;
  const move = Math.min(step, dh);
  const k = dh > 1e-9 ? move / dh : 1;
  const nx = t.pos.x + dx * k, nz = t.pos.z + dz * k;
  if (breaksFloor(ctx, nx, nz) && move > 0) return engage;
  t.pos.x = nx;
  t.pos.z = nz;
  t.pos.y += dy * k;
  if (dh > 1e-9) { a.headX = dx / dh; a.headZ = dz / dh; }
  if (move >= dh - 1e-9) {
    a.routeI = i + 1;
    if (a.routeI >= a.routeN) return true;
  }
  return false;
}

/** Heights above the feet a walking body must clear (shins, waist, chest): the director's walk test. */
const WALK_HEIGHTS = [0.3, 0.9, 1.3];

/** Whether the straight walk from (`ax`, `az`) to (`bx`, `bz`) at height `y` hits nothing solid (shins, waist and chest, both shoulders). */
export function walkClear(boxes: readonly BoxDef[], hull: number, y: number, ax: number, az: number, bx: number, bz: number): boolean {
  let lx = -(bz - az), lz = bx - ax;
  const ll = Math.sqrt(lx * lx + lz * lz);
  if (ll < 1e-9) return true;
  lx /= ll; lz /= ll;
  // Past the far end by the hull's half width, so the body at the end is clear of walls too.
  const ex = bx + (bx - ax) / ll * hull, ez = bz + (bz - az) / ll * hull;
  for (let h = 0; h < WALK_HEIGHTS.length; h++) {
    const yy = y + WALK_HEIGHTS[h]!;
    for (let s = -1; s <= 1; s++) {
      const o = s * hull;
      if (!lineClear(boxes, ax + lx * o, yy, az + lz * o, ex + lx * o, yy, ez + lz * o)) return false;
    }
  }
  return true;
}

/** How far the body at (`x`, `y`, `z`) can walk along the unit direction (`dx`, `dz`) before a wall, up to `maxM` (sampled every `stepM`, one step of margin). */
export function walkReach(boxes: readonly BoxDef[], hull: number, x: number, y: number, z: number, dx: number, dz: number, maxM: number, stepM: number): number {
  let ok = 0;
  for (let d = stepM; d <= maxM + 1e-9; d += stepM) {
    if (!walkClear(boxes, hull, y, x, z, x + dx * d, z + dz * d)) break;
    ok = d;
  }
  return Math.max(0, ok - stepM);
}
