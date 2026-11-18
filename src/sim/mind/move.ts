import type { Rng } from '../../core/rng';
import { secondsToTicks } from '../../core/time';
import type { Vec3 } from '../../core/vec3';
import { walkReach } from '../arrival';
import { commandMoveToward } from '../enemyBody';
import { lineClear } from '../exposure';
import type { BehaviourContext } from '../fsm';
import { brakeDistance } from '../movement';
import type { TargetState } from '../types';
import { straightWalk } from './nav';
import { MAX_WAYPOINTS } from './state';

/**
 * How a mind-driven Echo moves (issue #91; research §5.7 "not robotic"): a straight walk when it can,
 * else a path through the map's nav graph (`nav.ts`), followed by look-ahead steering rather than
 * node-to-node, with an anti-stuck watchdog. Writes the body's movement keys like a player's; the
 * player's movement code does the rest. Allocation-free; numbers are `mindDecision.nav` / `watchdog`.
 */

/** Sample step of the walk tests (`walkReach`), metres: the director's. */
export const WALK_STEP_M = 0.25;

export function set(v: Vec3, x: number, y: number, z: number): void {
  v.x = x; v.y = y; v.z = z;
}

/** Let go of every movement key. */
export function stopKeys(t: TargetState): void {
  const c = t.body.cmd;
  c.moveX = c.moveZ = 0;
  c.walk = false;
}

/** Plan a move to (`gx`, `gy`, `gz`): straight when it can walk there, else through the nav graph. */
export function planTo(t: TargetState, ctx: BehaviourContext, gx: number, gy: number, gz: number, walk: boolean): void {
  const m = t.mind;
  const sys = ctx.world.minds!;
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  m.wpN = 0;
  m.wpI = 0;
  if (!straightWalk(boxes, hull, t.pos.x, t.pos.y, t.pos.z, gx, gz)) {
    const nav = sys.nav;
    const a = nav.nearest(t.pos.x, t.pos.y, t.pos.z, boxes, hull);
    const b = nav.nearest(gx, gy, gz, boxes, hull);
    const n = a >= 0 && b >= 0 ? nav.path(a, b, m.pathBuf) : 0;
    for (let i = 0; i < n && m.wpN < MAX_WAYPOINTS - 1; i++) {
      const j = m.pathBuf[i]!;
      m.wpX[m.wpN] = nav.x[j]!; m.wpY[m.wpN] = nav.y[j]!; m.wpZ[m.wpN] = nav.z[j]!;
      m.wpN++;
    }
  }
  m.wpX[m.wpN] = gx; m.wpY[m.wpN] = gy; m.wpZ[m.wpN] = gz;
  m.wpN++;
  m.moving = true;
  m.arrived = false;
  m.moveFailed = false;
  m.walkMove = walk;
  m.stuckTicks = 0;
  m.sidestepLeft = 0;
  m.attempts = 0;
  m.shortcutClock = 0;
}

function endMove(t: TargetState, arrived: boolean): void {
  const m = t.mind;
  m.moving = false;
  m.arrived = arrived;
  m.moveFailed = !arrived;
  m.sidestepLeft = 0;
  stopKeys(t);
}

/** Replan from where it stands to the move's goal (after a sidestep). Keeps the attempt count. */
function replan(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const g = m.wpN - 1;
  const attempts = m.attempts;
  planTo(t, ctx, m.wpX[g]!, m.wpY[g]!, m.wpZ[g]!, m.walkMove);
  m.attempts = attempts;
}

/**
 * One tick of the current move: skip reached (or now directly walkable) waypoints, steer at a
 * carrot `lookAheadM` ahead (blending into the next leg before a corner rather than touching each
 * node), let go of the keys inside the braking distance of the goal, and watch for being stuck:
 * pushing with no speed for `stuckAfterSec` sidesteps (to the side with more room) and replans,
 * and after `maxAttempts` the move is given up. Writes the movement keys and `walk`, and the yaw it
 * is heading along into `m.headingYaw` (for an Echo that looks where it goes).
 */
export function steer(t: TargetState, ctx: BehaviourContext): void {
  const m = t.mind;
  const c = t.body.cmd;
  const k = t.body.kin;
  if (!m.moving) { m.headingYaw = c.yaw; return; }
  const cfg = ctx.tunables.mindDecision;
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  const wd = cfg.watchdog;

  if (m.sidestepLeft > 0) {
    m.sidestepLeft--;
    commandMoveToward(t.body, m.sidestepX, m.sidestepZ);
    c.walk = false;
    if (m.sidestepLeft === 0) replan(t, ctx);
    m.headingYaw = Math.atan2(-m.sidestepX, -m.sidestepZ);
    return;
  }

  const last = m.wpN - 1;
  // Waypoints reached, or skippable because the next one is in a straight walk.
  while (m.wpI < last) {
    const dx = m.wpX[m.wpI]! - t.pos.x, dz = m.wpZ[m.wpI]! - t.pos.z;
    if (dx * dx + dz * dz > cfg.nav.waypointM * cfg.nav.waypointM) break;
    m.wpI++;
  }
  if (++m.shortcutClock >= cfg.nav.shortcutEveryTicks) {
    m.shortcutClock = 0;
    if (m.wpI < last && straightWalk(boxes, hull, t.pos.x, t.pos.y, t.pos.z, m.wpX[m.wpI + 1]!, m.wpZ[m.wpI + 1]!)) m.wpI++;
  }

  const tx = m.wpX[m.wpI]!, tz = m.wpZ[m.wpI]!;
  let dx = tx - t.pos.x, dz = tz - t.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const speed = t.mind.speed;
  if (m.wpI === last) {
    if (d <= cfg.nav.arriveM || (d <= cfg.nav.arriveM * 2 && speed < wd.stuckSpeedMps && c.moveX === 0 && c.moveZ === 0)) {
      endMove(t, true);
      m.headingYaw = c.yaw;
      return;
    }
    // Let go inside the braking distance: it coasts to a stop on the spot (spec §2.3).
    if (d <= brakeDistance(speed, t.body.gait.runSpeedMps, ctx.tunables.movement) + 0.05) {
      stopKeys(t);
      m.stuckTicks = 0;
      m.headingYaw = Math.atan2(-dx, -dz);
      return;
    }
  }
  if (d > 1e-6) { dx /= d; dz /= d; }
  // Look-ahead: within `lookAheadM` of a corner waypoint, blend towards the leg after it.
  const la = cfg.nav.lookAheadM;
  if (m.wpI < last && d < la) {
    let nx = m.wpX[m.wpI + 1]! - tx, nz = m.wpZ[m.wpI + 1]! - tz;
    const nl = Math.sqrt(nx * nx + nz * nz);
    if (nl > 1e-6) {
      nx /= nl; nz /= nl;
      const w = (la - d) / la;
      dx = dx * (1 - w) + nx * w;
      dz = dz * (1 - w) + nz * w;
      const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 1e-6) { dx /= l; dz /= l; }
    }
  }
  commandMoveToward(t.body, dx, dz);
  c.walk = m.walkMove;

  // Watchdog: pushing a key with no speed.
  if (speed < wd.stuckSpeedMps && k.grounded) m.stuckTicks++;
  else m.stuckTicks = 0;
  if (m.stuckTicks >= secondsToTicks(wd.stuckAfterSec)) {
    m.stuckTicks = 0;
    m.attempts++;
    m.stats.unsticks++;
    if (m.attempts > wd.maxAttempts) {
      endMove(t, false);
      m.headingYaw = c.yaw;
      return;
    }
    // Sidestep square to the way it wanted to go, to the side with more room.
    const lx = -dz, lz = dx;
    const left = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, lx, lz, wd.probeM, WALK_STEP_M);
    const right = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, -lx, -lz, wd.probeM, WALK_STEP_M);
    const s = left >= right ? 1 : -1;
    // Away from the wall it pushed as well as sideways.
    m.sidestepX = lx * s - dx * 0.5;
    m.sidestepZ = lz * s - dz * 0.5;
    const l = Math.sqrt(m.sidestepX * m.sidestepX + m.sidestepZ * m.sidestepZ);
    m.sidestepX /= l; m.sidestepZ /= l;
    m.sidestepLeft = secondsToTicks(wd.sidestepSec);
  }
  m.headingYaw = Math.atan2(-dx, -dz);
}


/**
 * A spot beside (`x`, `z`), square to the way to `toward`, `minM`-`maxM` away, that a body walks to
 * straight and that still sees `toward` at head height: an off-angle. Writes `out`; false when no side works.
 */
export function sideSpot(t: TargetState, ctx: BehaviourContext, toward: Vec3, minM: number, maxM: number, rng: Rng, out: Vec3): boolean {
  const boxes = ctx.world.boxes;
  const hull = ctx.tunables.movement.hullHalfWidth;
  let fx = toward.x - t.pos.x, fz = toward.z - t.pos.z;
  const fl = Math.sqrt(fx * fx + fz * fz);
  if (fl < 1e-6) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
  const want = rng.range(minM, maxM);
  const first = rng.next() < 0.5 ? 1 : -1;
  const eye = ctx.tunables.movement.standEyeHeight;
  const hy = toward.y + ctx.tunables.targets.hit.headCentreStand;
  for (let k = 0; k < 2; k++) {
    const s = k === 0 ? first : -first;
    const lx = -fz * s, lz = fx * s;
    const room = walkReach(boxes, hull, t.pos.x, t.pos.y, t.pos.z, lx, lz, want, WALK_STEP_M);
    if (room < minM) continue;
    const x = t.pos.x + lx * room, z = t.pos.z + lz * room;
    if (!lineClear(boxes, x, t.pos.y + eye, z, toward.x, hy, toward.z)) continue;
    set(out, x, t.pos.y, z);
    return true;
  }
  return false;
}
