import type { EventSink } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT, secondsToTicks } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { createAimInfo, measureAim, yawOf, type AimInfo } from './aim';
import { rayBox } from './collision';
import { BEHAVIOURS } from './enemies';
import { fsmStart, fsmStep, createFsm, type BehaviourContext } from './fsm';
import { createZoneHit, traceTarget, zoneCentre, type ZoneHit } from './hitZones';
import type { BoxDef, HitZone, PlayerState, SimEvents, TargetKind, TargetState } from './types';

/** Events the target registry emits (part of `SimEvents`). */
export interface TargetEvents {
  /** A target was added to the field (spawn call, level placement or respawn). */
  targetSpawned: { tick: number; t: number; targetId: number; kind: TargetKind; pos: Vec3; tags: readonly string[] };
  /** First tick the target is in the view frustum and unoccluded from the eye. Once per spawn. */
  targetVisible: {
    tick: number;
    t: number;
    targetId: number;
    /** Angle between the view ray and the target's head centre at that tick, radians (pre-aim error). */
    preAim: number;
    /** Head-centre angles minus view angles at that tick, radians: the flick vector. */
    dYaw: number;
    dPitch: number;
  };
  targetHit: {
    tick: number;
    t: number;
    targetId: number;
    kind: TargetKind;
    zone: HitZone;
    point: Vec3;
    damage: number;
    hpLeft: number;
    distance: number;
    killed: boolean;
  };
  targetKilled: {
    tick: number;
    t: number;
    targetId: number;
    kind: TargetKind;
    zone: HitZone;
    point: Vec3;
    distance: number;
    /** First shot at the target to its death, ms. 0 when the first bullet killed it. */
    ttkMs: number;
    /** From the target becoming visible to the first shot aimed within 5 degrees of it, ms. */
    rtMs: number;
    /** The very first bullet fired at it killed it. */
    firstBullet: boolean;
    /** Bullets fired at it, including the killing one. */
    bullets: number;
    /** No missed shot at it and no moving shot at it. */
    clean: boolean;
  };
  /** A target left the field without being killed (lifetime ran out, or despawned by the mode). */
  targetExpired: { tick: number; t: number; targetId: number; kind: TargetKind };
  /** A level-placed target came back after a kill. Also announced by `targetSpawned`. */
  targetRespawned: { tick: number; targetId: number };
}

declare module './types' {
  interface SimEvents extends TargetEvents {}
}

/** A level-placed target: it respawns after being killed or expiring. */
export interface SpawnerState {
  kind: TargetKind;
  crouched: boolean;
  home: Vec3;
  /** Tick at which the next respawn happens, or -1 while its target is alive. */
  respawnTick: number;
}

export interface SpawnOptions {
  /** Crouched humanoid pose (hit zones follow it). Default false. */
  crouched?: boolean;
  /** Seconds until the target expires (`targetExpired`). Default: never. */
  lifetimeSec?: number;
}

function createSlot(): TargetState {
  return {
    id: -1,
    kind: 'beacon',
    spawner: -1,
    home: vec3(),
    pos: vec3(),
    crouched: false,
    radius: 0,
    boundsY: 0,
    hp: 0,
    maxHp: 0,
    alive: false,
    lastHitTick: -1,
    spawnTick: 0,
    expireTick: -1,
    sway: 0,
    prevSway: 0,
    swayTarget: 0,
    fsm: createFsm(),
    visibleTick: -1,
    firstShotTick: -1,
    reactionShotTick: -1,
    bullets: 0,
    missedShot: false,
    movingShot: false,
  };
}

// Event payloads are reused (valid only during the callback; see the architecture's event rules).
const spawnedPayload = { tick: 0, t: 0, targetId: 0, kind: 'beacon' as TargetKind, pos: vec3(), tags: [] as readonly string[] };
const visiblePayload = { tick: 0, t: 0, targetId: 0, preAim: 0, dYaw: 0, dPitch: 0 };
const hitPayload = {
  tick: 0, t: 0, targetId: 0, kind: 'beacon' as TargetKind, zone: 'head' as HitZone,
  point: vec3(), damage: 0, hpLeft: 0, distance: 0, killed: false,
};
const killedPayload = {
  tick: 0, t: 0, targetId: 0, kind: 'beacon' as TargetKind, zone: 'head' as HitZone,
  point: vec3(), distance: 0, ttkMs: 0, rtMs: 0, firstBullet: false, bullets: 0, clean: false,
};
const expiredPayload = { tick: 0, t: 0, targetId: 0, kind: 'beacon' as TargetKind };
const respawnedPayload = { tick: 0, targetId: 0 };

const scratchA = vec3();
const scratchB = vec3();
const scratchC = vec3();
const scratchAim: AimInfo = createAimInfo();

/**
 * The target registry. A fixed set of preallocated slots (no allocation in the tick), unique
 * monotonic ids, level spawn points with respawn, and per-target bookkeeping for the kill event.
 * Plain data plus methods; owned by the World, ticked by `World.step`.
 */
export class TargetField {
  /** Fixed capacity; a slot holds a target when `alive`. Index = slot, not id. */
  readonly slots: TargetState[] = [];
  readonly spawners: SpawnerState[] = [];
  private nextId = 0;
  private readonly zoneHit: ZoneHit = createZoneHit();

  constructor(readonly tunables: Tunables) {
    for (let i = 0; i < tunables.targets.maxTargets; i++) this.slots.push(createSlot());
  }

  /** Remove every target and forget the level's spawn points. */
  clear(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.alive = false;
      this.slots[i]!.id = -1;
    }
    this.spawners.length = 0;
    this.nextId = 0;
  }

  get aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]!.alive) n++;
    return n;
  }

  /** The live target with this id, or null. */
  byId(id: number): TargetState | null {
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (t.alive && t.id === id) return t;
    }
    return null;
  }

  /**
   * Add a target at a position (humanoid: feet centre; orb: centre). Returns its id, or -1 when
   * the registry is full. `events` may be null for silent placement (level load / reset).
   */
  spawn(
    kind: TargetKind, x: number, y: number, z: number,
    ctx: BehaviourContext, events: EventSink<SimEvents> | null,
    opts?: SpawnOptions, spawner = -1,
  ): number {
    let t: TargetState | null = null;
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]!.alive) { t = this.slots[i]!; break; }
    }
    if (!t) return -1;
    const tt = this.tunables.targets;
    const def = tt.kinds[kind];
    t.id = this.nextId++;
    t.kind = kind;
    t.spawner = spawner;
    t.home.x = t.pos.x = x;
    t.home.y = t.pos.y = y;
    t.home.z = t.pos.z = z;
    t.crouched = def.shape === 'humanoid' && (opts?.crouched ?? false);
    if (def.shape === 'orb') {
      t.radius = def.orbRadius;
      t.boundsY = 0;
    } else {
      const h = tt.hit;
      const top = h.headCentreStand + h.headRadius;
      t.boundsY = top / 2;
      t.radius = Math.hypot(top / 2, h.torsoWidth / 2) + 0.05;
    }
    t.hp = t.maxHp = tt.maxHp;
    t.alive = true;
    t.lastHitTick = -1;
    t.spawnTick = ctx.tick;
    t.expireTick = opts?.lifetimeSec !== undefined ? ctx.tick + secondsToTicks(opts.lifetimeSec) : -1;
    t.sway = t.prevSway = t.swayTarget = 0;
    t.visibleTick = -1;
    t.firstShotTick = -1;
    t.reactionShotTick = -1;
    t.bullets = 0;
    t.missedShot = false;
    t.movingShot = false;
    fsmStart(BEHAVIOURS[def.behaviour], t, ctx);
    if (events) {
      const p = spawnedPayload;
      p.tick = ctx.tick;
      p.t = ctx.tick * TICK_DT;
      p.targetId = t.id;
      p.kind = kind;
      p.pos = t.pos;
      p.tags = def.tags;
      events.emit('targetSpawned', p);
    }
    return t.id;
  }

  /** Remove a target without a kill (a mode ending its lifetime early). Emits `targetExpired`. */
  despawn(id: number, tick: number, events: EventSink<SimEvents>): boolean {
    const t = this.byId(id);
    if (!t) return false;
    this.expire(t, tick, events);
    return true;
  }

  /**
   * Announce every living target with `targetSpawned` (the run went live: level-placed targets
   * are placed silently on reset, so the run layer announces them) and forget any earlier sighting.
   */
  announceAll(tick: number, events: EventSink<SimEvents>): void {
    const tt = this.tunables.targets;
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (!t.alive) continue;
      t.visibleTick = -1;
      const p = spawnedPayload;
      p.tick = tick;
      p.t = tick * TICK_DT;
      p.targetId = t.id;
      p.kind = t.kind;
      p.pos = t.pos;
      p.tags = tt.kinds[t.kind].tags;
      events.emit('targetSpawned', p);
    }
  }

  /** Place a level's spawn points and spawn their targets silently (reset / load). */
  placeLevel(spawns: readonly { pos: Vec3; kind?: TargetKind; crouched?: boolean }[], ctx: BehaviourContext): void {
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const sp: SpawnerState = { kind: s.kind ?? 'beacon', crouched: s.crouched ?? false, home: vec3(s.pos.x, s.pos.y, s.pos.z), respawnTick: -1 };
      this.spawners.push(sp);
      this.spawn(sp.kind, s.pos.x, s.pos.y, s.pos.z, ctx, null, { crouched: sp.crouched }, this.spawners.length - 1);
    }
  }

  /** One fixed tick: sway interpolation state, lifetimes, behaviours, level respawns. */
  step(ctx: BehaviourContext): void {
    const tick = ctx.tick;
    const tt = this.tunables.targets;
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (!t.alive) continue;
      t.prevSway = t.sway;
      if (t.expireTick >= 0 && tick >= t.expireTick) {
        this.expire(t, tick, ctx.events);
        continue;
      }
      fsmStep(BEHAVIOURS[tt.kinds[t.kind].behaviour], t, ctx);
    }
    for (let i = 0; i < this.spawners.length; i++) {
      const sp = this.spawners[i]!;
      if (sp.respawnTick < 0 || tick < sp.respawnTick) continue;
      // Always draw both jitter numbers so the stream does not depend on the kind.
      const jx = ctx.rng.range(-tt.respawnJitter, tt.respawnJitter);
      const jy = ctx.rng.range(-tt.respawnJitter, tt.respawnJitter) * 0.5;
      const orb = tt.kinds[sp.kind].shape === 'orb';
      const id = this.spawn(sp.kind, sp.home.x + jx, sp.home.y + (orb ? jy : 0), sp.home.z, ctx, ctx.events, { crouched: sp.crouched }, i);
      if (id >= 0) {
        sp.respawnTick = -1;
        respawnedPayload.tick = tick;
        respawnedPayload.targetId = id;
        ctx.events.emit('targetRespawned', respawnedPayload);
      }
    }
  }

  private expire(t: TargetState, tick: number, events: EventSink<SimEvents>): void {
    const p = expiredPayload;
    p.tick = tick;
    p.t = tick * TICK_DT;
    p.targetId = t.id;
    p.kind = t.kind;
    this.free(t, tick);
    events.emit('targetExpired', p);
  }

  /** Release a slot; level-placed targets schedule their comeback. */
  private free(t: TargetState, tick: number): void {
    t.alive = false;
    if (t.spawner >= 0) this.spawners[t.spawner]!.respawnTick = tick + secondsToTicks(this.tunables.targets.respawnSec);
  }

  // ---------------------------------------------------------------------------------------------
  // Sight, shots and damage
  // ---------------------------------------------------------------------------------------------

  /**
   * Emit `targetVisible` for every target that, this tick, is in the view frustum and unoccluded
   * from the eye for the first time. The frustum uses `view.hfovDeg` at `visibilityAspect`
   * (the sim does not know the window). Cheap: only not-yet-visible targets are tested, and
   * only until they are seen.
   */
  updateVisibility(p: PlayerState, boxes: readonly BoxDef[], tick: number, events: EventSink<SimEvents>): void {
    const tt = this.tunables.targets;
    const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    // Camera basis: forward, right, up (architecture §6 conventions).
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const rx = cy, rz = -sy;
    const ux = sy * sp, uy = cp, uz = cy * sp;
    const tanH = Math.tan((this.tunables.view.hfovDeg * DEG2RAD) / 2);
    const tanV = tanH / tt.visibilityAspect;

    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (!t.alive || t.visibleTick >= 0) continue;
      const def = tt.kinds[t.kind];
      const samples = def.shape === 'orb' ? 1 : 2;
      for (let s = 0; s < samples; s++) {
        const c = zoneCentre(scratchA, t, tt.hit, def, s === 0 ? 'head' : 'body');
        const vx = c.x - ex, vy = c.y - ey, vz = c.z - ez;
        const depth = vx * fx + vy * fy + vz * fz;
        if (depth <= 0) continue;
        if (Math.abs(vx * rx + vz * rz) > depth * tanH) continue;
        if (Math.abs(vx * ux + vy * uy + vz * uz) > depth * tanV) continue;
        const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const inv = 1 / dist;
        if (this.lineBlocked(boxes, ex, ey, ez, vx * inv, vy * inv, vz * inv, dist)) continue;
        this.markVisible(t, tick, ex, ey, ez, p.yaw, p.pitch, fx, fy, fz, events);
        break;
      }
    }
  }

  private lineBlocked(
    boxes: readonly BoxDef[],
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number,
  ): boolean {
    const limit = dist - 0.001;
    for (let i = 0; i < boxes.length; i++) {
      const hit = rayBox(ox, oy, oz, dx, dy, dz, boxes[i]!, limit, scratchB);
      if (hit >= 0 && hit < limit) return true;
    }
    return false;
  }

  /**
   * Announce a target as visible, with how well the player was pre-aimed: the angle to its head
   * centre (an orb's centre) and the head-centre angles minus the view angles (the flick vector).
   */
  private markVisible(
    t: TargetState, tick: number,
    ox: number, oy: number, oz: number, yaw: number, pitch: number, dx: number, dy: number, dz: number,
    events: EventSink<SimEvents>,
  ): void {
    t.visibleTick = tick;
    const tt = this.tunables.targets;
    const h = zoneCentre(scratchC, t, tt.hit, tt.kinds[t.kind], 'head');
    measureAim(ox, oy, oz, yaw, pitch, dx, dy, dz, h.x, h.y, h.z, scratchAim);
    const p = visiblePayload;
    p.tick = tick;
    p.t = tick * TICK_DT;
    p.targetId = t.id;
    p.preAim = scratchAim.err;
    p.dYaw = scratchAim.dYaw;
    p.dPitch = scratchAim.dPitch;
    events.emit('targetVisible', p);
  }

  /**
   * Nearest target struck by a ray, no further than `maxDist`. Fills `outZone`; returns the slot
   * index or -1. `out` shares its distance semantics with `ZoneHit`.
   */
  traceNearest(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    maxDist: number, outZone: ZoneHit,
  ): number {
    const tt = this.tunables.targets;
    let best = -1;
    let bestDist = maxDist;
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (!t.alive) continue;
      // Bounding sphere early-out (perpendicular distance from the ray line to the centre).
      const lx = t.pos.x - ox, ly = t.pos.y + t.boundsY - oy, lz = t.pos.z - oz;
      const tca = lx * dx + ly * dy + lz * dz;
      if (tca < -t.radius) continue;
      if (lx * lx + ly * ly + lz * lz - tca * tca > t.radius * t.radius) continue;
      if (!traceTarget(t, tt.hit, tt.kinds[t.kind], ox, oy, oz, dx, dy, dz, bestDist, this.zoneHit)) continue;
      if (this.zoneHit.distance < bestDist) {
        bestDist = this.zoneHit.distance;
        best = i;
        outZone.zone = this.zoneHit.zone;
        outZone.distance = this.zoneHit.distance;
        outZone.nx = this.zoneHit.nx;
        outZone.ny = this.zoneHit.ny;
        outZone.nz = this.zoneHit.nz;
      }
    }
    return best;
  }

  /**
   * Book-keep one fired shot against every visible target: which ones it was "at" (hit, or
   * landed within `shotAtDeg`), whether it missed them, whether it was a moving shot, and the
   * first shot aimed within `reactionAimDeg` (reaction time). `hitId` is the target struck or -1.
   * A hit on a target that has not been announced visible announces it first.
   */
  registerShot(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    hitId: number, moving: boolean, tick: number, events: EventSink<SimEvents>,
  ): void {
    const tt = this.tunables.targets;
    const cosAt = Math.cos(tt.shotAtDeg * DEG2RAD);
    const cosReact = Math.cos(tt.reactionAimDeg * DEG2RAD);
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      if (!t.alive) continue;
      const isHit = t.id === hitId;
      if (isHit && t.visibleTick < 0) {
        this.markVisible(t, tick, ox, oy, oz, yawOf(dx, dz), Math.asin(dy), dx, dy, dz, events);
      }
      if (t.visibleTick < 0) continue;
      const def = tt.kinds[t.kind];
      // Best (largest) cosine to any zone centre: a shot near any part of it is "at" it.
      let cosBest = isHit ? 1 : -1;
      if (!isHit) {
        const zones: readonly HitZone[] = def.shape === 'orb' ? ORB_ZONES : HUMANOID_ZONES;
        for (let z = 0; z < zones.length; z++) {
          const c = zoneCentre(scratchA, t, tt.hit, def, zones[z]!);
          const vx = c.x - ox, vy = c.y - oy, vz = c.z - oz;
          const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (len < 1e-6) continue;
          const cs = (vx * dx + vy * dy + vz * dz) / len;
          if (cs > cosBest) cosBest = cs;
        }
      }
      if (cosBest >= cosAt) {
        t.bullets++;
        if (t.firstShotTick < 0) t.firstShotTick = tick;
        if (!isHit) t.missedShot = true;
        if (moving) t.movingShot = true;
      }
      if (cosBest >= cosReact && t.reactionShotTick < 0) t.reactionShotTick = tick;
    }
  }

  /**
   * Apply one bullet's damage to the target in `slot`, emit `targetHit` (and `targetKilled`
   * when it dies; the slot is then released, and level-placed targets schedule their respawn).
   */
  applyHit(
    slot: number, zone: HitZone, point: Vec3, distance: number, damage: number,
    tick: number, events: EventSink<SimEvents>,
  ): void {
    const t = this.slots[slot]!;
    t.hp -= damage;
    t.lastHitTick = tick;
    const killed = t.hp <= 0;
    const hp = this.hitPayload(t, zone, point, distance, damage, killed, tick);
    events.emit('targetHit', hp);
    if (!killed) return;

    const k = killedPayload;
    k.tick = tick;
    k.t = tick * TICK_DT;
    k.targetId = t.id;
    k.kind = t.kind;
    k.zone = zone;
    k.point = point;
    k.distance = distance;
    k.ttkMs = t.firstShotTick >= 0 ? (tick - t.firstShotTick) * TICK_DT * 1000 : 0;
    k.rtMs = t.reactionShotTick >= 0 && t.visibleTick >= 0 ? (t.reactionShotTick - t.visibleTick) * TICK_DT * 1000 : 0;
    k.bullets = t.bullets;
    k.firstBullet = t.bullets <= 1;
    k.clean = !t.missedShot && !t.movingShot;
    this.free(t, tick);
    events.emit('targetKilled', k);
  }

  private hitPayload(t: TargetState, zone: HitZone, point: Vec3, distance: number, damage: number, killed: boolean, tick: number): typeof hitPayload {
    const p = hitPayload;
    p.tick = tick;
    p.t = tick * TICK_DT;
    p.targetId = t.id;
    p.kind = t.kind;
    p.zone = zone;
    p.point = point;
    p.damage = damage;
    p.hpLeft = Math.max(0, t.hp);
    p.distance = distance;
    p.killed = killed;
    return p;
  }

  /** Fold the registry into a hash accumulator (determinism fingerprint). */
  hashInto(mix: (v: number) => void): void {
    mix(this.nextId);
    for (let i = 0; i < this.slots.length; i++) {
      const t = this.slots[i]!;
      mix(t.alive ? 1 : 0);
      if (!t.alive) continue;
      mix(t.id); mix(t.hp); mix(t.pos.x); mix(t.pos.y); mix(t.pos.z); mix(t.sway);
      mix(t.fsm.state); mix(t.fsm.timerTicks);
    }
    for (let i = 0; i < this.spawners.length; i++) mix(this.spawners[i]!.respawnTick);
  }
}

const HUMANOID_ZONES: readonly HitZone[] = ['head', 'body', 'leg'];
const ORB_ZONES: readonly HitZone[] = ['head'];
