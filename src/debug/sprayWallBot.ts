import { DEG2RAD } from '../core/math';
import type { Vec3 } from '../core/vec3';
import type { World } from '../sim/world';

/**
 * A scripted Spray Wall player for the tests and playtests: it aims at one point of the Post,
 * holds the trigger for the whole burst and reloads when the spray is judged. The only thing it
 * varies is how much of the recoil it pulls out of its view:
 *
 *   control 1  reads the weapon's recoil offset every tick and pulls the view down by exactly
 *              that: a player who has learned the pattern perfectly (the ideal trace)
 *   control 0  holds the crosshair still on the aim point: a player who never pulls
 *
 * `plan` is called each tick with the world and returns where the view should point (yaw/pitch in
 * radians) and whether to fire / reload; the caller feeds it into `World.step`. No randomness of
 * its own: the sim's seeded spread is the only noise.
 */
export interface SprayBotInput {
  yaw: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
}

export interface SprayBotOptions {
  /** 0 = never pulls, 1 = pulls the recoil out exactly. */
  control: number;
  /** Height above the Post's feet to aim at, metres. */
  aimY: number;
  /** Extra seconds to hold fire before the first bullet (settle time). */
  settleTicks?: number;
}

export class SprayBot {
  private seen = -1;
  private firstSeenTick = 0;
  private readonly aim: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly o: SprayBotOptions) {}

  /**
   * `out` is filled and returned. `shooting` = the mode has a spray open (a Post is up and the
   * burst is not yet complete); the bot only holds the trigger then.
   */
  plan(world: World, shooting: boolean, out: SprayBotInput): SprayBotInput {
    out.fire = false;
    out.reload = false;
    const w = world.weapon;
    const slot = w.slots[w.active]!;
    let target = null;
    for (let i = 0; i < world.targets.length; i++) {
      if (world.targets[i]!.alive) {
        target = world.targets[i]!;
        break;
      }
    }
    if (!target) {
      this.seen = -1;
      // Nothing to shoot at: top the magazine up (the mode waits for it).
      out.reload = w.reloadLeft <= 0 && slot.mag < world.tunables.weapon[slot.id].magazine;
      out.yaw = world.player.yaw;
      out.pitch = world.player.pitch;
      return out;
    }
    if (target.id !== this.seen) {
      this.seen = target.id;
      this.firstSeenTick = world.tick;
    }
    const p = world.player;
    this.aim.x = target.pos.x;
    this.aim.y = target.pos.y + this.o.aimY;
    this.aim.z = target.pos.z;
    const dx = this.aim.x - p.pos.x;
    const dy = this.aim.y - (p.pos.y + p.eyeHeight);
    const dz = this.aim.z - p.pos.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    // Recoil is an aim offset: pitch + is up, yaw + is to the right (a smaller view yaw).
    out.yaw = yaw + w.recoilYaw * DEG2RAD * this.o.control;
    out.pitch = pitch - w.recoilPitch * DEG2RAD * this.o.control;
    out.fire = shooting && world.tick - this.firstSeenTick >= (this.o.settleTicks ?? 0);
    return out;
  }
}
