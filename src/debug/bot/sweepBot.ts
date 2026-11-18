import { DEG2RAD } from '../../core/math';
import { secondsToTicks, TICK_DT } from '../../core/time';
import { vec3, type Vec3 } from '../../core/vec3';
import { lineClear } from '../../sim/exposure';
import { targetAimPoint, wrapPi, yawOf } from '../../sim/aim';
import { Rng } from '../../core/rng';
import { atRisk, currentSector, sectorKey, sweepCatalog, type GateRt, type SweepState } from '../../modes/sweep';
import { navRoute } from '../../modes/sweepCatalog';
import type { TickInput } from '../../sim/types';
import type { World } from '../../sim/world';
import type { Bot, BotStats } from './bot';
import type { BotGame } from './headless';
import { alwaysLeave, leftDoor, type GatePolicy, type OvertimePolicy } from './gatePolicy';

/** A waypoint counts as reached within this horizontal distance, metres. */
const REACH_M = 0.6;
/** Turn rate of the view while walking (no target), degrees per second. */
const WALK_TURN_DEG_PER_SEC = 360;
/** The bot lets go of the opposite key (and may shoot) once its speed is this share of the accuracy threshold. */
const STOPPED_SHARE = 0.85;
/** No progress towards the waypoint for this long: skip to the next one (stuck on a corner). */
const STUCK_SEC = 3;

/**
 * The bot's feet for Sweep (#201): it walks each sector from the entry to the exit along the map's
 * nav graph, looking where it walks, and takes the fights it meets: when the aiming `Bot` engages an
 * Echo it has seen, it counter-strafes to a stop and lets the aimer fire only while the Echo is in
 * plain sight. It never looks through walls (`Bot.visibleOnly`) and never writes sim state.
 *
 * At a gate it chooses a door with its `GatePolicy` (default: the left door), walks to it and through.
 *
 * What it does not do (so its numbers are a floor, not a ceiling): clear angles one at a time,
 * pre-aim, use cover, crouch, reposition or back off a fight it is losing. #53 tunes against it.
 */
export class SweepBot {
  private path: Vec3[] = [];
  private wp = 0;
  /** It was in a fight since the route was planned. */
  private fought = false;
  private sector = -1;
  /** The sector's exit was open when last looked at: a hold sector's opens when its Echoes are dead, then the route is planned from where the bot stands. */
  private exitOpen = true;
  private bestDist = Infinity;
  private bestAt = 0;
  private readonly aim = vec3();
  /** The gate it is walking through and the door it chose. */
  private gate: GateRt | null = null;
  private door: 0 | 1 = 0;
  /** Tick the current fight began (the bot stopped being idle), -1 while idle, and how long it keeps running into it. */
  private engagedAt = -1;
  private holdOffTicks = 0;
  /** This fight is one the bot fires in on the move (the planted weakness). */
  private movingFight = false;
  private readonly rng: Rng;

  /**
   * `stopDelayMaxSec`: the bot keeps running its route for a uniform 0..this many seconds after it first engages an
   * Echo before it counter-strafes, without shooting (a person who has seen the enemy and not yet stopped). 0 (the
   * default): it stops at once, as every report before the meet sectors (#212) assumed. The meet report sets it so
   * both orders of "who stopped first" occur.
   */
  constructor(
    private readonly bot: Bot,
    private readonly game: BotGame,
    private readonly stopDelayMaxSec = 0,
    seed = 1,
    private readonly policy: GatePolicy = leftDoor,
    /**
     * A planted weakness (#210, the lean's A/B): this share of the fights it takes, it never stops: it keeps running its
     * route and fires on the move, as a player who has not learned to counter-strafe does. 0 (the default): it stops in
     * every fight, as every report before the lean assumed. No random draw is made at 0, so those reports do not change.
     */
    private readonly movingFireShare = 0,
    /** At an Overtime gate (design §4.7, #206): leave or push on. Default: leave, so a run ends at the Finale as it did before Overtime. */
    private readonly overtimePolicy: OvertimePolicy = alwaysLeave,
  ) {
    this.rng = new Rng((seed ^ 0x2545f491) >>> 0 || 1);
    bot.visibleOnly = true;
    bot.inSight = (t) => {
      const p = game.world.player;
      targetAimPoint(t, game.tunables.targets, this.aim);
      return lineClear(game.world.boxes, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z, this.aim.x, this.aim.y, this.aim.z);
    };
  }

  get stats(): BotStats {
    return this.bot.stats;
  }

  step(world: World, out: TickInput): TickInput {
    this.bot.step(world, out);
    if (!world.health.alive || !world.live) return out;
    const st = this.game.modes.runner.state as SweepState | undefined;
    if (!st?.plan) return out;
    if (st.gate) return this.throughGate(st.gate, world, out);
    this.gate = null;
    if (sectorKey(st) !== this.sector) {
      this.plan(st, true);
      this.exitOpen = st.exitOpen;
    } else if (st.exitOpen && !this.exitOpen) {
      this.exitOpen = true;
      this.plan(st, false);
    }

    const p = world.player;
    const eyeY = p.pos.y + p.eyeHeight;
    if (this.bot.idle) this.engagedAt = -1;
    else if (this.engagedAt < 0) {
      this.engagedAt = world.tick;
      this.holdOffTicks = this.stopDelayMaxSec > 0 ? secondsToTicks(this.rng.next() * this.stopDelayMaxSec) : 0;
      this.movingFight = this.movingFireShare > 0 && this.rng.next() < this.movingFireShare;
    }
    if (!this.bot.idle && this.movingFight) {
      // The planted weakness: keep running the route and shoot whatever is in plain sight, stopped or not.
      const wp = this.path[this.wp];
      if (wp) this.moveTowards(wp, out);
      const t = world.targetField.byId(this.bot.target);
      if (out.fire && t) {
        targetAimPoint(t, this.game.tunables.targets, this.aim);
        if (!lineClear(world.boxes, p.pos.x, eyeY, p.pos.z, this.aim.x, this.aim.y, this.aim.z)) out.fire = false;
      }
      this.fought = true;
      return out;
    }
    if (!this.bot.idle && world.tick - this.engagedAt < this.holdOffTicks) {
      // Seen, not stopped yet: keep running the route (aim stays on the Echo; no shot while moving).
      const wp = this.path[this.wp];
      if (wp) this.moveTowards(wp, out);
      out.fire = false;
      this.fought = true;
      return out;
    }
    if (!this.bot.idle) {
      // In a fight: stop, then shoot only at what is in plain sight.
      const def = this.game.tunables.weapon[world.weapon.slots[world.weapon.active]!.id];
      const threshold = def.deadzoneFraction * def.runSpeedMps * STOPPED_SHARE;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > threshold) {
        // Counter-strafe: the keys opposite the velocity, in the view's frame.
        const right = p.vel.x * Math.cos(out.yaw) - p.vel.z * Math.sin(out.yaw);
        const fwd = -p.vel.x * Math.sin(out.yaw) - p.vel.z * Math.cos(out.yaw);
        out.moveX = Math.abs(right) > threshold * 0.5 ? -Math.sign(right) : 0;
        out.moveZ = Math.abs(fwd) > threshold * 0.5 ? -Math.sign(fwd) : 0;
        out.fire = false;
      }
      const t = world.targetField.byId(this.bot.target);
      if (out.fire && t) {
        targetAimPoint(t, this.game.tunables.targets, this.aim);
        if (!lineClear(world.boxes, p.pos.x, eyeY, p.pos.z, this.aim.x, this.aim.y, this.aim.z)) out.fire = false;
      }
      this.fought = true;
      return out;
    }
    // A hold sector: the Echoes come to the player. It stands at its entry facing where they come from and fights what arrives.
    if (!st.exitOpen) {
      const way = this.arrivalDirection(st);
      const turn = WALK_TURN_DEG_PER_SEC * DEG2RAD * TICK_DT;
      this.bot.yaw += Math.max(-turn, Math.min(turn, wrapPi(way - this.bot.yaw)));
      this.bot.pitch += (0 - this.bot.pitch) * 0.2;
      out.yaw = this.bot.yaw;
      out.pitch = this.bot.pitch;
      out.moveX = 0;
      out.moveZ = 0;
      out.fire = false;
      return out;
    }
    // A fight pulled it off its route: walk on from where it stands.
    if (this.fought) {
      this.fought = false;
      this.plan(st, false);
    }

    // Walking: towards the next waypoint, looking where it goes, crosshair at head height.
    const target = this.path[this.wp];
    if (!target) return out;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const now = world.tick;
    if (dist < this.bestDist - 0.05) {
      this.bestDist = dist;
      this.bestAt = now;
    }
    if (now - this.bestAt > secondsToTicks(STUCK_SEC)) {
      // Stuck on a corner: a fresh route from here.
      this.plan(st, false);
    } else if (dist < REACH_M && this.wp < this.path.length - 1) {
      this.wp++;
      this.bestDist = Infinity;
      this.bestAt = now;
    }
    const want = yawOf(dx, dz);
    const turn = WALK_TURN_DEG_PER_SEC * DEG2RAD * TICK_DT;
    const d = wrapPi(want - this.bot.yaw);
    this.bot.yaw += Math.max(-turn, Math.min(turn, d));
    this.bot.pitch += (0 - this.bot.pitch) * 0.2;
    out.yaw = this.bot.yaw;
    out.pitch = this.bot.pitch;
    this.moveTowards(target, out);
    out.fire = false;
    return out;
  }

  /** Keys that move towards `target` in the view's frame: the forward and right components of the way to go. */
  private moveTowards(target: Vec3, out: TickInput): void {
    const p = this.game.world.player;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    const ux = dx / (dist || 1), uz = dz / (dist || 1);
    const fwd = -ux * Math.sin(out.yaw) - uz * Math.cos(out.yaw);
    const right = ux * Math.cos(out.yaw) - uz * Math.sin(out.yaw);
    out.moveZ = Math.abs(fwd) > 0.3 ? Math.sign(fwd) : 0;
    out.moveX = Math.abs(right) > 0.3 ? Math.sign(right) : 0;
  }

  /** In a gate: choose the door once, then walk straight to it and through (nothing shoots at the player there). */
  private throughGate(gate: GateRt, world: World, out: TickInput): TickInput {
    if (this.gate !== gate) {
      this.gate = gate;
      const leave = gate.plan.leave;
      if (leave === undefined) this.door = this.policy(gate.plan, { hp: world.health.hp, shield: world.health.shield });
      else {
        const st = this.game.modes.runner.state as SweepState;
        const score = this.game.modes.runner.stats.score;
        const pick = this.overtimePolicy({
          hp: world.health.hp, shield: world.health.shield, overtimeSectors: st.overtime, atRisk: atRisk(st, score), banked: st.banked,
        });
        this.door = pick === 'leave' ? leave : leave === 0 ? 1 : 0;
      }
    }
    const g = this.game.tunables.sweep.gate;
    const door = g.doors[this.door];
    // Aim past the commit line, down the door's alcove.
    const tx = door.x, tz = door.z - g.commitDepthM - 0.6;
    const p = world.player;
    const dx = tx - p.pos.x, dz = tz - p.pos.z;
    this.bot.yaw = yawOf(dx, dz);
    this.bot.pitch = 0;
    out.yaw = this.bot.yaw;
    out.pitch = 0;
    out.moveX = 0;
    out.moveZ = 1;
    out.fire = false;
    this.fought = false;
    this.sector = -1;
    return out;
  }

  /** The yaw towards the middle of the sector's approach lanes' starts: where the bot knows the map's arrivals come from. */
  private arrivalDirection(st: SweepState): number {
    const sp = currentSector(st);
    const src = sweepCatalog(this.game.tunables).find((x) => x.mapId === sp.mapId && x.id === sp.sectorId);
    const p = this.game.world.player.pos;
    if (!src || src.approaches.length === 0) return this.bot.yaw;
    let x = 0, z = 0;
    for (const a of src.approaches) { x += a.start.x; z += a.start.z; }
    x /= src.approaches.length; z /= src.approaches.length;
    return yawOf(x - p.x, z - p.z);
  }

  /** The route to the sector's exit (straight, or along the nav graph), from its entry or from where the player stands. */
  private plan(st: SweepState, fromEntry: boolean): void {
    this.sector = sectorKey(st);
    const sp = currentSector(st);
    const map = this.game.modes.currentMap;
    this.path = navRoute(map, fromEntry ? sp.entry : this.game.world.player.pos, sp.exit);
    this.wp = 0;
    this.bestDist = Infinity;
    this.bestAt = this.game.world.tick;
  }
}
