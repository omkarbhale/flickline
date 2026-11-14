import type { EventSink } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_DT } from '../core/time';
import { copy, vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import type { BehaviourContext } from './fsm';
import { TargetField, type SpawnOptions } from './targets';
import { levelTargetsReset } from './targetsInit';
import { zoneDamage } from './damage';
import { PlayerHealthSystem } from './playerHealth';
import { createProbeState, resetProbe, stepRunProbe, type ProbeState } from './runProbe';
import type { WeaponId } from '../config/weapon';
import {
  createWeaponScratch,
  createWeaponState,
  resetWeaponState,
  selectWeapon,
  stepWeapon,
  type WeaponScratch,
  type WeaponWorld,
} from './weapon';
import { validateLoadout, type LoadoutRequest, type LoadoutResult } from './loadout';
import { stepPlayer } from './movement';
import {
  createTickInput,
  type HitZone, type LevelDef, type PlayerHealth, type PlayerState, type SimEvents, type TargetKind, type TargetState, type TickInput, type WeaponState,
} from './types';

const NULL_SINK: EventSink<SimEvents> = { emit() {} };

/**
 * Forwards every event to the real sink, and turns the player's kills into kill-heal (design
 * §4.8) so the heal is part of the simulation, not of whoever happens to listen. One instance per
 * world; `target` is swapped in per step. Allocates nothing.
 */
class KillHealRelay implements EventSink<SimEvents> {
  target: EventSink<SimEvents> = NULL_SINK;
  constructor(private readonly health: PlayerHealthSystem) {}

  emit<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
    this.target.emit(type, payload);
    if (type === 'targetKilled') {
      const k = payload as SimEvents['targetKilled'];
      this.health.healForKill(k.zone, k.tick, this.target);
    }
  }
}

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
  /**
   * A mode may lock the player in place (Orbit, design §4.2): movement keys, jump, crouch and walk
   * are ignored; look angles, fire, reload and weapon switching still work. Not reset by `reset()`
   * (it belongs to the run); the mode host sets and clears it.
   */
  movementLocked = false;
  /**
   * A mode that has no loadout ignores the swap keys (design §4: `1`/`2` swap only where a loadout
   * makes sense, i.e. Sweep). Like `movementLocked` it belongs to the run: the mode host sets and
   * clears it, `reset()` leaves it. Free play (no mode) can always swap.
   */
  get swapLocked(): boolean {
    return this.weaponWorld.swapLocked;
  }
  set swapLocked(v: boolean) {
    this.weaponWorld.swapLocked = v;
  }
  readonly player: PlayerState;
  /** The target registry (see `sim/targets.ts`). */
  readonly targetField: TargetField;
  /** Registry slots: fixed capacity, a slot holds a target when `alive`. Same array as the field's. */
  readonly targets: TargetState[];
  /** Weapons by slot (primary, sidearm); changed only through `setLoadout`. */
  readonly loadout: readonly WeaponId[];
  private readonly loadoutSlots: WeaponId[];
  readonly weapon: WeaponState;
  /** The player's HP and the tag / flinch timers (spec §4); damage goes through `damagePlayer`. */
  readonly health: PlayerHealth;
  private readonly healthSys: PlayerHealthSystem;
  private readonly relay: KillHealRelay;
  /**
   * Whether targets and the weapon are live. The run controller clears it during `ready` (movement
   * only) and sets it when a self-driven run goes `live`; free play and mode runs keep it true.
   */
  live = true;
  readonly probe: ProbeState = createProbeState();
  private readonly weaponWorld: WeaponWorld;
  private readonly weaponScratch: WeaponScratch = createWeaponScratch();
  private readonly lockedInput = createTickInput();
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
    this.loadoutSlots = [...(opts.loadout ?? opts.tunables.weaponRules.defaultLoadout)];
    this.loadout = this.loadoutSlots;
    this.weapon = createWeaponState(this.loadout, opts.tunables.weapon);
    this.healthSys = new PlayerHealthSystem(opts.tunables.player, opts.tunables.sweep);
    this.health = this.healthSys.state;
    this.relay = new KillHealRelay(this.healthSys);
    this.weaponWorld = {
      boxes: this.level.boxes,
      field: this.targetField,
      table: opts.tunables.weapon,
      rules: opts.tunables.weaponRules,
      rng: this.rng,
      swapLocked: false,
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
      tagScale: 1,
      aimPunch: 0,
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
    this.healthSys.reset(p);
    resetWeaponState(this.weapon, this.loadout, this.tunables.weapon);
    this.live = true;
    resetProbe(this.probe);
    this.behaviourCtx.tick = 0;
    this.behaviourCtx.events = NULL_SINK;
    levelTargetsReset(this.targetField, this.level, this.behaviourCtx);
  }

  /**
   * Advance exactly one tick (1/TICK_RATE s). A dead player freezes the world (nothing advances,
   * not even the tick counter) until `reset()`: the frame the results card is drawn over.
   */
  step(input: TickInput, events: EventSink<SimEvents>): void {
    if (!this.health.alive) return;
    this.tick++;
    const t = this.tunables;
    // Everything that can emit a kill runs through the relay (kill-heal); the rest uses the plain sink.
    const relay = this.relay;
    relay.target = events;
    this.healthSys.step(this.player);
    let moveInput = input;
    if (this.movementLocked) {
      const l = this.lockedInput;
      l.yaw = input.yaw;
      l.pitch = input.pitch;
      moveInput = l;
    }
    stepPlayer(this.player, moveInput, this.level.boxes, t.movement, TICK_DT, this.tick, events);
    if (!this.live) {
      relay.target = NULL_SINK;
      return;
    }
    this.targetField.updateVisibility(this.player, this.level.boxes, this.tick, events);
    stepWeapon(this.weapon, input, this.player, this.weaponWorld, this.tick, relay, this.weaponScratch);
    this.stepTargets(relay);
    relay.target = NULL_SINK;
    stepRunProbe(this.probe, this.player, this.weapon, this.targetField, input, t, this.tick, events, this.level);
  }

  /**
   * Equip both sides with shields (spec §4.1; `config/economy.ts` says how much): the player now and
   * on every later `reset()`, and every humanoid Echo spawned from now on (orbs never get one).
   * 0 = none, the default and what drills use. Not cleared by `reset()`; the mode host sets it for
   * the run and clears it when the run stops.
   */
  setShields(player: number, enemy: number): void {
    this.healthSys.setShield(player);
    this.targetField.enemyShield = Math.max(0, enemy);
  }

  /**
   * The player takes `amount` of damage to `zone` from a shooter whose muzzle is at (`sx`, `sy`,
   * `sz`) (`sourceId` = the enemy id, or -1). Applies tagging, flinch and death and emits
   * `playerDamaged` / `playerSlowed` / `playerDied`. This is the one entry point enemy fire (#32,
   * #33) and the debug hook use. Returns whether the hit killed the player.
   */
  damagePlayer(
    amount: number, zone: HitZone, sx: number, sy: number, sz: number, sourceId: number,
    events: EventSink<SimEvents>,
  ): boolean {
    return this.healthSys.damage(this.player, amount, zone, sx, sy, sz, sourceId, this.tick, events);
  }

  /**
   * A bullet of `weapon` hits the player in `zone` from the shooter at (`sx`, `sy`, `sz`): the
   * damage is that weapon's band for the zone at the hit distance (spec §3.2 / §7.4), then as
   * `damagePlayer`. Returns whether it killed the player.
   */
  hitPlayer(
    weapon: WeaponId, zone: HitZone, sx: number, sy: number, sz: number, sourceId: number,
    events: EventSink<SimEvents>,
  ): boolean {
    const p = this.player;
    const distance = Math.hypot(sx - p.pos.x, sy - (p.pos.y + p.eyeHeight), sz - p.pos.z);
    const amount = zoneDamage(this.tunables.weapon[weapon].damageBands, zone, distance);
    return this.damagePlayer(amount, zone, sx, sy, sz, sourceId, events);
  }

  /**
   * A self-driven run went `live`: announce every living target (`targetSpawned`) so the stat
   * tracker opens its engagements, forget earlier sightings, and start measuring from a clean
   * probe state.
   */
  beginLive(events: EventSink<SimEvents>): void {
    this.live = true;
    resetProbe(this.probe);
    this.targetField.announceAll(this.tick, events);
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

  /** Stand the player at a feet position, at rest, facing `yaw` (radians), level. */
  placePlayer(x: number, y: number, z: number, yaw: number): void {
    const p = this.player;
    p.pos.x = p.prevPos.x = x;
    p.pos.y = p.prevPos.y = y;
    p.pos.z = p.prevPos.z = z;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = yaw;
    p.pitch = 0;
    p.grounded = false;
  }

  /**
   * Choose the loadout (design §4.8): `primary` goes in slot 0 and `sidearm` in slot 1. An invalid
   * request (unknown id, or a weapon in the wrong slot class) changes nothing and says why. On
   * success the weapon state is rebuilt: full magazines and reserves, the primary in hand,
   * a fresh spray. It survives `reset()`, so a restarted run keeps the player's pick. Call it
   * between runs (the mode host and the menu do), not mid-fight.
   */
  setLoadout(req: LoadoutRequest): LoadoutResult {
    const r = validateLoadout(this.tunables.weapon, req);
    if (!r.ok) return r;
    this.loadoutSlots.length = 0;
    this.loadoutSlots.push(r.slots[0], r.slots[1]);
    resetWeaponState(this.weapon, this.loadoutSlots, this.tunables.weapon);
    return r;
  }

  /** Put a loadout weapon in hand at once (see `selectWeapon`). */
  equipWeapon(id: WeaponId): boolean {
    return selectWeapon(this.weapon, id);
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
    const hp = this.health;
    mix(hp.hp); mix(hp.shield); mix(hp.alive ? 1 : 0); mix(Number.isFinite(hp.tagSince) ? hp.tagSince : -1);
    mix(hp.tagRise); mix(hp.flinchDeg);
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
