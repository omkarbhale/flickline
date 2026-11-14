import type { EventSink } from '../core/eventBus';
import { Rng } from '../core/rng';
import { secondsToTicks, TICK_DT } from '../core/time';
import { copy, vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { levelTargetsReset } from './targetsInit';
import { createProbeState, resetProbe, stepRunProbe, type ProbeState } from './runProbe';
import type { RunEvents } from './runEvents';
import { createTraceResult, stepWeapon, type TraceResult } from './weapon';
import { stepPlayer } from './movement';
import type { LevelDef, PlayerState, SimEvents, TargetState, TickInput, WeaponState } from './types';

const NO_TAGS: readonly string[] = [];

export interface WorldOptions {
  level: LevelDef;
  tunables: Tunables;
  seed?: number;
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
  readonly targets: TargetState[] = [];
  readonly weapon: WeaponState = { cooldown: 0, shots: 0, lastShotTick: -1, burstIndex: 0 };
  /**
   * Whether targets and the weapon are live. The run controller clears it during `ready` (movement
   * only) and sets it when the run goes `live`; free-play (no run) keeps it true.
   */
  live = true;
  readonly probe: ProbeState = createProbeState();
  private readonly trace: TraceResult = createTraceResult();

  constructor(opts: WorldOptions) {
    this.level = opts.level;
    this.tunables = opts.tunables;
    this.seed = opts.seed ?? 1;
    this.rng = new Rng(this.seed);
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
    this.weapon.cooldown = 0;
    this.weapon.shots = 0;
    this.weapon.lastShotTick = -1;
    this.weapon.burstIndex = 0;
    this.live = true;
    resetProbe(this.probe);
    levelTargetsReset(this.targets, this.level, this.tunables.targets);
  }

  /** Advance exactly one tick (1/TICK_RATE s). */
  step(input: TickInput, events: EventSink<SimEvents & RunEvents>): void {
    this.tick++;
    const t = this.tunables;
    stepPlayer(this.player, input, this.level.boxes, t.movement, TICK_DT, this.tick, events);
    stepWeapon(
      this.weapon, input.fire && this.live, this.player, this.level.boxes, this.targets,
      t.weapon, t.targets, t.movement, this.tick, events, this.trace,
    );
    if (!this.live) return;
    this.stepTargets(events);
    stepRunProbe(
      this.probe, this.player, this.targets, this.level.boxes, input,
      t.movement, t.weapon, t.view, t.run, this.tick, events,
    );
  }

  /**
   * Make targets and the weapon live (the run went `live`): announce every living target so the
   * stat tracker opens its engagement, and start measuring from a clean probe state.
   */
  beginLive(events: EventSink<RunEvents>): void {
    this.live = true;
    resetProbe(this.probe);
    for (let i = 0; i < this.targets.length; i++) {
      const tg = this.targets[i]!;
      tg.visible = false;
      if (tg.alive) this.announceSpawn(tg, events);
    }
  }

  /** A target left without being killed (exposure ran out): it goes down and `targetExpired` fires. */
  expireTarget(id: number, events: EventSink<RunEvents>): void {
    const tg = this.targets[id];
    if (!tg || !tg.alive) return;
    tg.alive = false;
    tg.visible = false;
    tg.respawnTick = this.tick + secondsToTicks(this.tunables.targets.respawnSec);
    events.emit('targetExpired', { tick: this.tick, id });
  }

  private announceSpawn(tg: TargetState, events: EventSink<RunEvents>): void {
    events.emit('targetSpawned', { tick: this.tick, id: tg.id, kind: tg.kind, pos: tg.pos, tags: NO_TAGS });
  }

  private stepTargets(events: EventSink<SimEvents & RunEvents>): void {
    const tt = this.tunables.targets;
    for (let i = 0; i < this.targets.length; i++) {
      const tg = this.targets[i]!;
      if (!tg.alive && this.tick >= tg.respawnTick) {
        tg.alive = true;
        tg.hp = tg.maxHp;
        tg.pos.x = tg.home.x + this.rng.range(-tt.respawnJitter, tt.respawnJitter);
        tg.pos.y = tg.home.y + this.rng.range(-tt.respawnJitter, tt.respawnJitter) * 0.5;
        tg.pos.z = tg.home.z;
        tg.visible = false;
        events.emit('targetRespawned', { tick: this.tick, targetId: tg.id });
        this.announceSpawn(tg, events);
      }
    }
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
    mix(this.weapon.shots);
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i]!;
      mix(t.hp); mix(t.alive ? 1 : 0); mix(t.pos.x); mix(t.pos.y);
    }
    mix(this.rng.getState());
    return h >>> 0;
  }
}
