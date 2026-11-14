import type { EventSink } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { EnemySoundKind } from '../config/attribution';
import type { Tunables } from '../config/tunables';
import { targetAimPoint, wrapPi, yawOf } from './aim';
import { lineBlocked } from './collision';
import { initiatorOf, type FirstSightInitiator, type TargetField } from './targets';
import type { BoxDef, PlayerState, SimEvents, TargetState } from './types';

/**
 * The facts the fight-attribution model needs from the simulation (#119; `docs/research/
 * fight-attribution.md` §3.2, facts F1, F5, F6 and F8). Everything here is a value the simulation
 * already knows, computed at the moment of an event and never per tick:
 *
 *  - F1 / F5: whether the player could hear an enemy sound (`audibleToPlayer` on the enemy sound
 *    events), and how many enemies see the player when he is hit (`playerDamaged.exposedTo`).
 *  - F6: who created the first line of sight, per side (`targetVisible.initiator`, and
 *    `enemySawPlayer.initiator` here).
 *  - F8 (`shotFired.aimDir`) lives with the weapon that fires the shot.
 *
 * It owns no gameplay state: nothing here feeds back into the simulation, so the world's `hash()`
 * is unchanged. No full enemy mind exists yet (#89): until it does, `World` installs the sight rule
 * the shooting Echoes already use (`enemyFire.seesPlayer`: range and an unoccluded line from the
 * muzzle to the player's eye, no field-of-view test) for enemies that fire, and drill targets that
 * never fire are never "exposed". The enemy body (#87) and #99 call the sound emitters below when
 * an enemy steps, lands or reloads, stamping each sound with `audibleToPlayer`; `enemyFired`
 * already carries it.
 */

/**
 * What the enemy mind (#89) answers about the player, the one contract this module codes against.
 * A mind-less target (drill posts, beacons) is never reported as seeing him.
 */
export interface PerceptionQueries {
  /**
   * The enemy sees the player right now: an unoccluded ray from its eye to a sample on his head or
   * upper body, with him inside its horizontal field of view (player-like-enemies §5.3, rule F1).
   */
  seesPlayer(enemy: TargetState): boolean;
}

/** Where and how far away an enemy sound was, and whether the player could hear it. */
export interface EnemySoundEvent {
  tick: number;
  t: number;
  /** The enemy that made it. */
  id: number;
  /** Where it came from (feet centre). */
  pos: Vec3;
  /** Horizontal distance to the player, metres. */
  distance: number;
  /** Within the sound's radius (`attribution.soundRadiusM`), the same radius the enemy hears the player at. */
  audibleToPlayer: boolean;
}

export interface AttributionEvents {
  /** An enemy took a step (it is moving above the silent walk threshold). */
  enemyFootstep: EnemySoundEvent;
  /** An enemy landed from a jump or a drop. */
  enemyLanded: EnemySoundEvent;
  /** An enemy started a reload. (Its shot is `enemyFired`, which carries `audibleToPlayer` too.) */
  enemyReloadStarted: EnemySoundEvent;
  /**
   * The enemy first got the player in its sight (line of sight and him inside its field of view),
   * once per enemy and spawn: the enemy's half of the first-sight pair (`targetVisible` is the
   * player's). `initiator` is as `targetVisible.initiator`: who created that line of sight.
   */
  enemySawPlayer: { tick: number; t: number; targetId: number; initiator: FirstSightInitiator };
}

declare module './types' {
  interface SimEvents extends AttributionEvents {}
}

/** A horizontal facing for the stand-in perception: the enemy's view yaw, radians (architecture §6 convention). */
export type FacingFn = (enemy: TargetState) => number;

export class AttributionFacts {
  /** The enemy mind's perception queries (#89), or none: then no enemy sees the player. */
  perception: PerceptionQueries | null = null;

  private readonly sighted: Int32Array;
  private readonly sound: Record<'enemyFootstep' | 'enemyLanded' | 'enemyReloadStarted', EnemySoundEvent> = {
    enemyFootstep: createSound(),
    enemyLanded: createSound(),
    enemyReloadStarted: createSound(),
  };
  private readonly sawEv: SimEvents['enemySawPlayer'] = { tick: 0, t: 0, targetId: 0, initiator: 'enemy' };

  constructor(
    private readonly tunables: Tunables,
    private readonly boxes: readonly BoxDef[],
    private readonly field: TargetField,
    private readonly player: PlayerState,
  ) {
    this.sighted = new Int32Array(field.slots.length).fill(-1);
  }

  /** Forget which enemies have seen the player (a world reset or a run going live). */
  reset(): void {
    this.sighted.fill(-1);
  }

  /** Horizontal distance from the player to (`x`, `z`), metres. */
  distanceTo(x: number, z: number): number {
    const dx = x - this.player.pos.x, dz = z - this.player.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Whether a sound of this kind at (`x`, `z`) reaches the player: within its radius, the edge included. */
  audible(kind: EnemySoundKind, x: number, z: number): boolean {
    return this.distanceTo(x, z) <= this.tunables.attribution.soundRadiusM[kind];
  }

  /** Emit `enemyFootstep` for enemy `id` stepping at feet position (`x`, `y`, `z`). */
  footstep(events: EventSink<SimEvents>, tick: number, id: number, x: number, y: number, z: number): void {
    events.emit('enemyFootstep', this.fill(this.sound.enemyFootstep, 'footstep', tick, id, x, y, z));
  }

  /** Emit `enemyLanded`. */
  landed(events: EventSink<SimEvents>, tick: number, id: number, x: number, y: number, z: number): void {
    events.emit('enemyLanded', this.fill(this.sound.enemyLanded, 'landing', tick, id, x, y, z));
  }

  /** Emit `enemyReloadStarted`. */
  reloadStarted(events: EventSink<SimEvents>, tick: number, id: number, x: number, y: number, z: number): void {
    events.emit('enemyReloadStarted', this.fill(this.sound.enemyReloadStarted, 'reload', tick, id, x, y, z));
  }

  private fill(e: EnemySoundEvent, kind: EnemySoundKind, tick: number, id: number, x: number, y: number, z: number): EnemySoundEvent {
    e.tick = tick;
    e.t = tick * TICK_DT;
    e.id = id;
    e.pos.x = x; e.pos.y = y; e.pos.z = z;
    e.distance = this.distanceTo(x, z);
    e.audibleToPlayer = e.distance <= this.tunables.attribution.soundRadiusM[kind];
    return e;
  }

  /** How many living enemies see the player right now (F5): the `exposedTo` of a `playerDamaged`. */
  countExposed(): number {
    const q = this.perception;
    if (q === null) return 0;
    const slots = this.field.slots;
    let n = 0;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      if (t.alive && q.seesPlayer(t)) n++;
    }
    return n;
  }

  /**
   * Announce, once per enemy, the tick it first sees the player (after the targets have moved).
   * Cheap: only enemies that have not seen him yet are asked, and only while a perception is
   * installed. The initiator is the one-ray test of F6: re-cast the sight ray from the player's
   * eye at the previous tick; if the line is blocked there the player's movement opened it.
   */
  step(tick: number, events: EventSink<SimEvents>): void {
    const q = this.perception;
    if (q === null) return;
    const slots = this.field.slots;
    const p = this.player;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      if (!t.alive || this.sighted[i] === t.id || !q.seesPlayer(t)) continue;
      this.sighted[i] = t.id;
      const e = this.sawEv;
      e.tick = tick;
      e.t = tick * TICK_DT;
      e.targetId = t.id;
      e.initiator = initiatorOf(this.field.hasLineOfSightFrom(t, p.prevPos.x, p.prevPos.y + p.prevEyeHeight, p.prevPos.z, this.boxes));
      events.emit('enemySawPlayer', e);
    }
  }
}

function createSound(): EnemySoundEvent {
  return { tick: 0, t: 0, id: -1, pos: vec3(), distance: 0, audibleToPlayer: false };
}

const eyeScratch = vec3();

/** No box between (`ox`, `oy`, `oz`) and the point offset by (`vx`, `vy`, `vz`) from it. */
function lineOpen(boxes: readonly BoxDef[], ox: number, oy: number, oz: number, vx: number, vy: number, vz: number): boolean {
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (dist < 1e-6) return true;
  const inv = 1 / dist;
  return !lineBlocked(boxes, ox, oy, oz, vx * inv, vy * inv, vz * inv, dist);
}

/**
 * A stand-in for the mind's perception (#89 replaces it): an enemy sees the player when its eye
 * (the head centre of its body) has an unoccluded line to the player's eye or upper body and he is
 * inside its horizontal field of view (`view.hfovDeg`, the player's own, so both sides share one
 * rule). `facing` gives each enemy's view yaw; by default it looks at the player, so only line of
 * sight matters. Allocates nothing per call.
 */
export function createSightPerception(
  tunables: Tunables, boxes: readonly BoxDef[], player: PlayerState, facing?: FacingFn,
): PerceptionQueries {
  const halfFov = (tunables.view.hfovDeg * DEG2RAD) / 2;
  return {
    seesPlayer(enemy: TargetState): boolean {
      const eye = targetAimPoint(enemy, tunables.targets, eyeScratch);
      const ex = eye.x, ey = eye.y, ez = eye.z;
      const dx = player.pos.x - ex, dz = player.pos.z - ez;
      if (facing !== undefined && Math.abs(wrapPi(yawOf(dx, dz) - facing(enemy))) > halfFov) return false;
      return lineOpen(boxes, ex, ey, ez, dx, player.pos.y + player.eyeHeight - ey, dz) ||
        lineOpen(boxes, ex, ey, ez, dx, player.pos.y + player.height * tunables.attribution.upperBodyFrac - ey, dz);
    },
  };
}
