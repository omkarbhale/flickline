import type { EventSink } from '../core/eventBus';
import type { Rng } from '../core/rng';
import { secondsToTicks } from '../core/time';
import type { FsmState, SimEvents, TargetState } from './types';
import type { Tunables } from '../config/tunables';

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

/** Everything a behaviour may touch. Built once by the world and reused. */
export interface BehaviourContext {
  /** The tick being simulated (already incremented for this step). */
  tick: number;
  rng: Rng;
  tunables: Tunables;
  events: EventSink<SimEvents>;
}

export interface BehaviourState {
  readonly name: string;
  enter?(t: TargetState, ctx: BehaviourContext): void;
  update?(t: TargetState, ctx: BehaviourContext): number;
  onTimer?(t: TargetState, ctx: BehaviourContext): number;
}

export interface Behaviour {
  readonly name: string;
  readonly states: readonly BehaviourState[];
  /** State id entered by `fsmStart`. */
  readonly initial: number;
}

export function createFsm(): FsmState {
  return { state: 0, enteredTick: 0, timerTicks: -1 };
}

/** Put the FSM into the behaviour's initial state (runs its `enter`). */
export function fsmStart(b: Behaviour, t: TargetState, ctx: BehaviourContext): void {
  t.fsm.state = -1;
  fsmGoto(b, t, ctx, b.initial);
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
