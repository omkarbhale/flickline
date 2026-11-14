import type { EventSink } from '../core/eventBus';
import { clamp, DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import type { PlayerTunables } from '../config/player';
import type { SweepTunables } from '../config/sweep';
import type { HitZone, PlayerHealth, PlayerState, SimEvents } from './types';

export function createPlayerHealth(maxHp: number): PlayerHealth {
  return {
    hp: maxHp, maxHp, alive: true, tagSince: Infinity, tagRise: 0, flinchDeg: 0,
    lastDamageTick: -1, damageTaken: 0, healed: 0,
  };
}

export function resetPlayerHealth(h: PlayerHealth, maxHp: number): void {
  h.hp = h.maxHp = maxHp;
  h.alive = true;
  h.tagSince = Infinity;
  h.tagRise = 0;
  h.flinchDeg = 0;
  h.lastDamageTick = -1;
  h.damageTaken = 0;
  h.healed = 0;
}

/** Seconds from the last tagging hit until the slow is gone: the ramp-in, then the release. */
export function tagTotalSec(tag: PlayerTunables['tag']): number {
  return tag.rampInSec + tag.releaseSec;
}

/**
 * The tagging slow as a speed multiplier (spec §4.3). A hit ramps the slow in over `tag.ramp_in`;
 * it is held at full while hits keep arriving (each hit restarts the release clock); `tag.release`
 * seconds after the ramp-in has completed the speed is fully back, in a straight line. So a stream
 * of hits sits exactly on the cap, and a single hit always reaches it (the slow then lasts
 * `ramp_in + release` in all). 1 = untagged, `tag.speed_scale` = fully tagged. Pure function of
 * the two timers: `tagSince` (seconds since the last hit) and `tagRise` (ramp-in progress 0..1).
 */
export function tagSpeedScale(tag: PlayerTunables['tag'], tagSince: number, tagRise: number): number {
  if (tagSince >= tagTotalSec(tag)) return 1;
  const releasing = Math.max(0, tagSince - tag.rampInSec);
  const strength = Math.min(tagRise, 1 - releasing / tag.releaseSec);
  return 1 - strength * (1 - tag.speedScale);
}

/** The flinch kick of one hit, degrees (spec §4.4), before the strength multiplier. */
export function flinchKickDeg(f: PlayerTunables['flinch'], zone: HitZone): number {
  return zone === 'head' ? f.pitchHeadDeg : zone === 'body' ? f.pitchBodyDeg : f.pitchLegDeg;
}

/**
 * The player's health system: damage with tagging and flinch, kill-heal, death. Owns the state
 * (`state`, plain data the world hashes) and the event payload objects, so a hit allocates
 * nothing. All numbers come from `PlayerTunables` / `SweepTunables`.
 */
export class PlayerHealthSystem {
  readonly state: PlayerHealth;
  private readonly dmgEv: SimEvents['playerDamaged'] = {
    tick: 0, t: 0, amount: 0, hp: 0, maxHp: 0, zone: 'body', dir: vec3(0, 0, -1), yaw: 0, sourceId: -1, killed: false,
  };
  private readonly slowEv: SimEvents['playerSlowed'] = { tick: 0, t: 0, factor: 1, durationMs: 0 };
  private readonly deathEv: SimEvents['playerDied'] = { tick: 0, t: 0, sourceId: -1 };
  private readonly healEv: SimEvents['playerHealed'] = { tick: 0, t: 0, amount: 0, hp: 0, maxHp: 0, source: 'kill' };

  constructor(
    private readonly cfg: PlayerTunables,
    private readonly sweepCfg: SweepTunables,
  ) {
    this.state = createPlayerHealth(cfg.health.max);
  }

  reset(p: PlayerState): void {
    resetPlayerHealth(this.state, this.cfg.health.max);
    p.tagScale = 1;
    p.aimPunch = 0;
  }

  /** Advance the tag and flinch timers one tick and publish their effect on the player. Call before movement. */
  step(p: PlayerState, dt: number = TICK_DT): void {
    const h = this.state;
    const tag = this.cfg.tag;
    if (h.tagSince < tagTotalSec(tag)) {
      h.tagSince += dt;
      h.tagRise = Math.min(1, h.tagRise + dt / tag.rampInSec);
      if (h.tagSince >= tagTotalSec(tag)) {
        h.tagSince = Infinity;
        h.tagRise = 0;
      }
    }
    p.tagScale = tagSpeedScale(tag, h.tagSince, h.tagRise);

    if (h.flinchDeg > 0) {
      h.flinchDeg = Math.max(0, h.flinchDeg - (this.cfg.flinch.pitchHeadDeg / this.cfg.flinch.recoverySec) * dt);
    }
    p.aimPunch = h.flinchDeg * DEG2RAD;
  }

  /**
   * The player is hit for `amount` HP in `zone` by a shooter at (`sx`, `sy`, `sz`) (the point the
   * bullet came from; `sourceId` is the enemy's id or -1). Emits `playerDamaged`, `playerSlowed`
   * and, at 0 HP, `playerDied`. Ignored once dead. Returns whether it killed.
   */
  damage(
    p: PlayerState, amount: number, zone: HitZone, sx: number, sy: number, sz: number, sourceId: number,
    tick: number, events: EventSink<SimEvents>,
  ): boolean {
    const h = this.state;
    if (!h.alive || !(amount > 0)) return false;
    const t = tick * TICK_DT;
    const lost = Math.min(amount, h.hp);
    h.hp -= lost;
    h.damageTaken += lost;
    h.lastDamageTick = tick;
    const killed = h.hp <= 0;
    if (killed) {
      h.hp = 0;
      h.alive = false;
    }

    // Tagging (spec §4.3): every hit refreshes the release timer; the ramp-in restarts only from untagged.
    const tag = this.cfg.tag;
    h.tagSince = 0;
    // Aim punch (spec §4.4): zone-dependent pitch kick, scaled by the user's strength (0 disables).
    const f = this.cfg.flinch;
    if (f.strength > 0) {
      h.flinchDeg = clamp(h.flinchDeg + flinchKickDeg(f, zone) * f.strength, 0, f.maxDeg);
    }

    const e = this.dmgEv;
    e.tick = tick; e.t = t; e.amount = lost; e.hp = h.hp; e.maxHp = h.maxHp; e.zone = zone;
    e.yaw = p.yaw; e.sourceId = sourceId; e.killed = killed;
    yawFrameDirection(e.dir, p, sx, sy, sz);
    events.emit('playerDamaged', e);

    const s = this.slowEv;
    s.tick = tick; s.t = t; s.factor = tag.speedScale; s.durationMs = tagTotalSec(tag) * 1000;
    events.emit('playerSlowed', s);

    if (killed) {
      const d = this.deathEv;
      d.tick = tick; d.t = t; d.sourceId = sourceId;
      events.emit('playerDied', d);
    }
    return killed;
  }

  /** Restore up to `amount` HP (never above max). Returns what was added; emits `playerHealed` when > 0. */
  heal(amount: number, tick: number, events: EventSink<SimEvents>): number {
    const h = this.state;
    if (!h.alive || !(amount > 0)) return 0;
    const added = Math.min(amount, h.maxHp - h.hp);
    if (added <= 0) return 0;
    h.hp += added;
    h.healed += added;
    const e = this.healEv;
    e.tick = tick; e.t = tick * TICK_DT; e.amount = added; e.hp = h.hp; e.maxHp = h.maxHp;
    events.emit('playerHealed', e);
    return added;
  }

  /** The kill-heal for a kill in `zone` (design §4.8; `tunables.sweep.killHeal`): head kill 10, any other 5. */
  healForKill(zone: HitZone, tick: number, events: EventSink<SimEvents>): number {
    const k = this.sweepCfg.killHeal;
    return this.heal(zone === 'head' ? k.head : k.body, tick, events);
  }
}

/**
 * Unit direction from the player's eye to a point, in the player's yaw frame (camera-local: +X
 * right, +Y up, -Z ahead; pitch is ignored). A point on top of the eye points straight ahead.
 */
export function yawFrameDirection(out: { x: number; y: number; z: number }, p: PlayerState, x: number, y: number, z: number): void {
  const dx = x - p.pos.x;
  const dy = y - (p.pos.y + p.eyeHeight);
  const dz = z - p.pos.z;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // right = (cos, 0, -sin), forward = (-sin, 0, -cos)
  const right = dx * cos - dz * sin;
  const ahead = -dx * sin - dz * cos;
  const len = Math.sqrt(right * right + dy * dy + ahead * ahead);
  if (len < 1e-9) {
    out.x = 0; out.y = 0; out.z = -1;
    return;
  }
  out.x = right / len;
  out.y = dy / len;
  out.z = -ahead / len;
}
