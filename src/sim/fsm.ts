import type { EventSink } from '../core/eventBus';
import type { Rng } from '../core/rng';
import { secondsToTicks } from '../core/time';
import type { EnemySoundKind } from '../config/attribution';
import type { WeaponId } from '../config/weapon';
import type { BoxDef, FsmState, HitZone, PlayerState, SimEvents, TargetState } from './types';
import type { Tunables } from '../config/tunables';
import type { MindSystem } from './mind/system';

/**
 * Small finite-state-machine base for enemy behaviours (design §5.4). Advanced only by the fixed
 * tick; all randomness comes from the context's seeded `rng`; allocation-free once built.
 *
 * A behaviour is a static table of states. Each state may have:
 *  - `enter(t, ctx)`   - run once when the state is entered (typically starts a timer);
 *  - `update(t, ctx)`  - run every tick while in the state; may return the next state id;
 *  - `onTimer(t, ctx)` - run when the state timer set by `fsmSetTimer*` reaches zero; returns the next state id.
 * Handlers return `STAY` (-1) to remain in the current state. Handlers are plain functions
 * (no closures are created per tick).
 */

export const STAY = -1;

/**
 * What the moving, shooting Echoes need from the world (design §5.3): where the player is, what
 * blocks sight, whether enemies may fire at all, and the one entry point that hurts the player.
 * `World` implements it; tests pass a stub.
 */
export interface EnemyWorld {
  /** Enemies may shoot (a mode that fires back sets it). */
  readonly firing: boolean;
  readonly player: PlayerState;
  readonly boxes: readonly BoxDef[];
  /** The weapon the Echoes carry in this fight (the economy decides). */
  readonly enemyWeapon: WeaponId;
  /** The player is above the accuracy deadzone of the equipped weapon, or airborne (design §5.3: x0.5). */
  playerMoving(): boolean;
  /** Whether a sound of this kind made at (`x`, `z`) reaches the player: the `audibleToPlayer` an enemy sound event carries (fight-attribution F1). */
  soundAudible(kind: EnemySoundKind, x: number, z: number): boolean;
  /** The enemy mind's perception, nav graph and team facts (#91): what mind-driven Echoes use. Absent in worlds without minds (test stubs). */
  readonly minds?: MindSystem;
  /** A bullet of `weapon` hits the player in `zone` from (`sx`, `sy`, `sz`). */
  hitPlayer(
    weapon: WeaponId, zone: HitZone, sx: number, sy: number, sz: number, sourceId: number,
    events: EventSink<SimEvents>,
  ): boolean;
}

/** Everything a behaviour may touch. Built once by the world and reused. */
export interface BehaviourContext {
  /** The tick being simulated (already incremented for this step). */
  tick: number;
  rng: Rng;
  tunables: Tunables;
  events: EventSink<SimEvents>;
  world: EnemyWorld;
}

export interface BehaviourState {
  readonly name: string;
  /** In a body-driven behaviour, this state moves `t.pos` itself and the body does not step (an arrival walking its route in). */
  readonly kinematic?: boolean;
  enter?(t: TargetState, ctx: BehaviourContext): void;
  update?(t: TargetState, ctx: BehaviourContext): number;
  onTimer?(t: TargetState, ctx: BehaviourContext): number;
}

export interface Behaviour {
  readonly name: string;
  readonly states: readonly BehaviourState[];
  /** State id entered by `fsmStart`. */
  readonly initial: number;
  /** The state an arriving Echo starts in (it walks its route in first, `sim/arrival.ts`); absent: the behaviour has no arrival. */
  readonly arrive?: number;
  /**
   * The behaviour plays through the shared body (#87, `sim/enemyBody.ts`): its states write
   * `t.body.cmd`, and the target registry steps the body through the player's movement and weapon
   * code right after the FSM, every tick (except in a `kinematic` state). Absent: the behaviour
   * moves `t.pos` itself.
   */
  readonly drivesBody?: boolean;
  /** Called after the body stepped: read the moved body back into the behaviour's own state. */
  readonly bodyMoved?: (t: TargetState) => void;
}

export function createFsm(): FsmState {
  return { state: 0, enteredTick: 0, timerTicks: -1 };
}

/** Put the FSM into the behaviour's initial state (runs its `enter`). */
export function fsmStart(b: Behaviour, t: TargetState, ctx: BehaviourContext, state = b.initial): void {
  t.fsm.state = -1;
  fsmGoto(b, t, ctx, state);
}

/** Switch state now: stops any timer, records the tick, runs the new state's `enter`. */
export function fsmGoto(b: Behaviour, t: TargetState, ctx: BehaviourContext, next: number): void {
  const f = t.fsm;
  f.state = next;
  f.enteredTick = ctx.tick;
  f.timerTicks = -1;
  b.states[next]!.enter?.(t, ctx);
}

/** Start the state timer in ticks (minimum 1). */
export function fsmSetTimerTicks(t: TargetState, ticks: number): void {
  t.fsm.timerTicks = Math.max(1, Math.round(ticks));
}

/** Start the state timer in seconds. */
export function fsmSetTimer(t: TargetState, seconds: number): void {
  fsmSetTimerTicks(t, secondsToTicks(seconds));
}

/** Start the state timer with a seeded uniform duration in [minSec, maxSec). */
export function fsmSetTimerRange(t: TargetState, rng: Rng, minSec: number, maxSec: number): void {
  fsmSetTimer(t, rng.range(minSec, maxSec));
}

/** Ticks spent in the current state so far. */
export function fsmTicksInState(t: TargetState, tick: number): number {
  return tick - t.fsm.enteredTick;
}

/** Advance one fixed tick: timer first, then `update`. At most one transition per tick. */
export function fsmStep(b: Behaviour, t: TargetState, ctx: BehaviourContext): void {
  const f = t.fsm;
  const s = b.states[f.state]!;
  let next = STAY;
  if (f.timerTicks > 0) {
    f.timerTicks--;
    if (f.timerTicks === 0) {
      f.timerTicks = -1;
      if (s.onTimer) next = s.onTimer(t, ctx);
    }
  }
  if (next === STAY && s.update) next = s.update(t, ctx);
  if (next !== STAY) fsmGoto(b, t, ctx, next);
}
