import { Rng } from '../../core/rng';
import { secondsToTicks } from '../../core/time';
import type { StopAndPopTrial } from '../../modes/stopAndPop';
import type { TickInput } from '../../sim/types';
import type { World } from '../../sim/world';
import type { Bot, BotStats } from './bot';
import type { BotGame } from './headless';

/** Turn round when this far from the middle of the lane (the Lane is 6 m wide), metres. */
const TURN_AT_X = 1.8;
/** The bot lets go of the opposite key (and may shoot) once its speed is this share of the accuracy threshold. */
const STOPPED_SHARE = 0.85;

/**
 * The bot's feet for Stop & Pop (design §4.4): it plays the drill the way the drill asks. It
 * strafes along the Lane (which arms it), and when a target appears it waits its reaction time,
 * taps the opposite key until its speed is under the accuracy threshold, lets go, takes the
 * stance of the ring (crouch for a blue one) and only then lets the aiming bot pull the trigger.
 * Aim and trigger are the wrapped `Bot`'s; this adds the movement keys and a gate on the trigger.
 *
 * It reads the world (speed, stance) and the ring the way a person reads the screen; it never
 * writes sim state. A weak bot reacts slowly, so it has less of the exposure left to aim in.
 */
export class FootworkBot {
  private readonly rng: Rng;
  private dir = 1;
  /** Tick the current target was first seen, or -1. */
  private noticedAt = -1;
  private reactTicks = 0;

  constructor(
    private readonly bot: Bot,
    private readonly game: BotGame,
    seed: number,
  ) {
    this.rng = new Rng((seed ^ 0x51ed270b) >>> 0 || 1);
  }

  get stats(): BotStats {
    return this.bot.stats;
  }

  step(world: World, out: TickInput): TickInput {
    this.bot.step(world, out);
    const p = world.player;
    if (!world.health.alive || !world.live) return out;

    const def = this.game.tunables.weapon[world.weapon.slots[world.weapon.active]!.id];
    const threshold = def.deadzoneFraction * def.runSpeedMps;
    const vx = p.vel.x * Math.cos(p.yaw) - p.vel.z * Math.sin(p.yaw); // speed along the view's right axis
    const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);

    let up = false;
    for (let i = 0; i < world.targets.length; i++) if (world.targets[i]!.alive) up = true;

    if (!up) {
      // Strafe along the lane; the lane arms and a target appears.
      this.noticedAt = -1;
      if (p.pos.x * this.dir > TURN_AT_X) this.dir = -this.dir;
      out.moveX = this.dir;
      out.fire = false;
      return out;
    }

    const now = world.tick;
    if (this.noticedAt < 0) {
      this.noticedAt = now;
      const params = this.bot.params;
      const noise = Math.sqrt(-2 * Math.log(1 - this.rng.next())) * Math.cos(2 * Math.PI * this.rng.next());
      this.reactTicks = secondsToTicks(Math.max(0.1, params.reactionMeanSec + noise * params.reactionSdSec));
    }
    const crouch = this.ringCrouch();
    if (now < this.noticedAt + this.reactTicks) {
      // Still reacting: keep strafing.
      if (p.pos.x * this.dir > TURN_AT_X) this.dir = -this.dir;
      out.moveX = this.dir;
      out.fire = false;
      return out;
    }
    // Counter-strafe: the opposite key until the speed is under the gate, then let go.
    out.moveX = speed > threshold * STOPPED_SHARE ? (vx > 0 ? -1 : 1) : 0;
    out.crouch = crouch;
    out.fire = out.fire && speed <= threshold * STOPPED_SHARE && p.crouching === crouch;
    return out;
  }

  /** Whether the ring of the (first) live target asks for a crouch, read from the mode the way the player reads the ring. */
  private ringCrouch(): boolean {
    const st = this.game.modes.runner.state as { trial?: StopAndPopTrial } | undefined;
    const slots = st?.trial?.slots;
    if (!slots) return false;
    for (let i = 0; i < slots.length; i++) if (slots[i]!.active) return slots[i]!.crouch;
    return false;
  }
}
