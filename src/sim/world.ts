import type { EventSink } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/time';
import { copy, vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import type { BehaviourContext } from './fsm';
import { TargetField, type SpawnOptions } from './targets';
import { levelTargetsReset } from './targetsInit';
import type { WeaponId } from '../config/weapon';
import {
  createWeaponScratch,
  createWeaponState,
  resetWeaponState,
  stepWeapon,
  type WeaponScratch,
  type WeaponWorld,
} from './weapon';
import { stepPlayer } from './movement';
import type { LevelDef, PlayerState, SimEvents, TargetKind, TargetState, TickInput, WeaponState } from './types';

const NULL_SINK: EventSink<SimEvents> = { emit() {} };

export interface WorldOptions {
  level: LevelDef;
  tunables: Tunables;
  seed?: number;
  /** Weapons by slot (primary, sidearm). Default: `tunables.weaponRules.defaultLoadout`. */
  loadout?: WeaponId[];
}

/**
 * The whole game simulation. Pure and deterministic: no DOM, no three.js, no wall-clock, no
 * Math.random. Same (level, tunables, seed, input sequence) => identical state, always.
 * Everything advances only through step(). Emits SimEvents; presentation subscribes.
 */
export class World {
  readonly level: LevelDef;
  readonly tunables: Tunables;
  readonly rng: Rng;
  seed: number;
  tick = 0;
  readonly player: PlayerState;
  /** The target registry (see `sim/targets.ts`). */
  readonly targetField: TargetField;
  /** Registry slots: fixed capacity, a slot holds a target when `alive`. Same array as the field's. */
  readonly targets: TargetState[];
  readonly loadout: readonly WeaponId[];
  readonly weapon: WeaponState;
  private readonly weaponWorld: WeaponWorld;
  private readonly weaponScratch: WeaponScratch = createWeaponScratch();
  /** Reused every tick for target behaviours (`events` is swapped in per step). */
  private readonly behaviourCtx: BehaviourContext;

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.tunables = opts.tunables;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed);
    this.targetField = new TargetField(opts.tunables);
    this.targets = this.targetField.slots;
    this.behaviourCtx = { tick: 0, rng: this.rng, tunables: opts.tunables, events: NULL_SINK };
    this.loadout = [...(opts.loadout ?? opts.tunables.weaponRules.defaultLoadout)];
    this.weapon = createWeaponState(this.loadout, opts.tunables.weapon);
    this.weaponWorld = {
      boxes: this.level.boxes,
      field: this.targetField,
      table: opts.tunables.weapon,
      rules: opts.tunables.weaponRules,
      rng: this.rng,
    };
    const m = opts.tunables.movement;
    this.player = {
      pos: vec3(),
      prevPos: vec3(),
      vel: vec3(),
      yaw: 0,
      pitch: 0,
      grounded: false,
      crouching: false,
      height: m.standHeight,
      eyeHeight: m.standEyeHeight,
      prevEyeHeight: m.standEyeHeight,
      stepAccum: 0,
    };
    this.reset(this.seed);
  }

  /** Restore the initial state; optionally with a new seed. */
  reset(seed: number = this.seed): void {
    this.seed = seed;
    this.rng.setState(seed);
    this.tick = 0;
    const p = this.player;
    const m = this.tunables.movement;
    copy(p.pos, this.level.spawn.pos);
    copy(p.prevPos, p.pos);
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = this.level.spawn.yaw;
    p.pitch = 0;
    p.grounded = false;
    p.crouching = false;
    p.height = m.standHeight;
    p.eyeHeight = p.prevEyeHeight = m.standEyeHeight;
    p.stepAccum = 0;
    resetWeaponState(this.weapon, this.loadout, this.tunables.weapon);
    this.behaviourCtx.tick = 0;
    this.behaviourCtx.events = NULL_SINK;
    levelTargetsReset(this.targetField, this.level, this.behaviourCtx);
  }

  /** Advance exactly one tick (1/TICK_RATE s). */
  step(input: TickInput, events: EventSink<SimEvents>): void {
    this.tick++;
    const t = this.tunables;
    stepPlayer(this.player, input, this.level.boxes, t.movement, TICK_DT, this.tick, events);
    this.targetField.updateVisibility(this.player, this.level.boxes, this.tick, events);
    stepWeapon(this.weapon, input, this.player, this.weaponWorld, this.tick, events, this.weaponScratch);
    this.stepTargets(events);
  }

  /** Advance target behaviours, lifetimes and level respawns. */
  private stepTargets(events: EventSink<SimEvents>): void {
    const c = this.behaviourCtx;
    c.tick = this.tick;
    c.events = events;
    this.targetField.step(c);
  }

  /**
   * Add a target (kind per the roster in `config/targets.ts`) at a position: feet centre for a
   * humanoid (Post), centre for an orb (Beacon). Emits `targetSpawned`. Returns its id, or -1
   * when the registry is full. A mode removes it again with `despawnTarget`, or it dies.
   */
  spawnTarget(
    kind: TargetKind, x: number, y: number, z: number,
    events: EventSink<SimEvents>, opts?: SpawnOptions,
  ): number {
    const c = this.behaviourCtx;
    c.tick = this.tick;
    c.events = events;
    return this.targetField.spawn(kind, x, y, z, c, events, opts);
  }

  /** Remove a target without a kill; emits `targetExpired`. Returns whether it existed. */
  despawnTarget(id: number, events: EventSink<SimEvents>): boolean {
    return this.targetField.despawn(id, this.tick, events);
  }

  /** Simulation time in seconds. */
  get time(): number {
    return this.tick * TICK_DT;
  }

  /**
   * Cheap 32-bit fingerprint of the gameplay state, for determinism tests and desync checks.
   * Allocates nothing.
   */
  hash(): number {
    let h = 2166136261;
    const mix = (v: number): void => {
      h ^= Math.round(v * 1e5) | 0;
      h = Math.imul(h, 16777619);
    };
    const p = this.player;
    mix(this.tick);
    mix(p.pos.x); mix(p.pos.y); mix(p.pos.z);
    mix(p.vel.x); mix(p.vel.y); mix(p.vel.z);
    mix(p.yaw); mix(p.pitch);
    mix(p.grounded ? 1 : 0); mix(p.crouching ? 1 : 0); mix(p.eyeHeight);
    const w = this.weapon;
    mix(w.shots); mix(w.active); mix(w.cooldown); mix(w.equipLeft); mix(w.reloadLeft);
    mix(w.sprayCount); mix(w.recoilIndex); mix(w.recoilPitch); mix(w.recoilYaw); mix(w.yawSign);
    for (let i = 0; i < w.slots.length; i++) {
      mix(w.slots[i]!.mag); mix(w.slots[i]!.reserve);
    }
    this.targetField.hashInto(mix);
    mix(this.rng.getState());
    return h >>> 0;
  }
}
