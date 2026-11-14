import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { Rng } from '../core/rng';
import { TICK_RATE } from '../core/time';
import {
  fsmGoto, fsmSetTimer, fsmSetTimerRange, fsmStart, fsmStep, fsmTicksInState, STAY,
  type Behaviour, type BehaviourContext,
} from './fsm';
import { TargetField } from './targets';
import type { SimEvents, TargetState } from './types';
import { World } from './world';
import { testRoom } from './levels';

const tun = cloneTunables();

function rig(seed = 1) {
  const field = new TargetField(tun);
  const ctx: BehaviourContext = { tick: 0, rng: new Rng(seed), tunables: tun, events: new EventBus<SimEvents>() };
  field.spawn('post', 0, 0, -10, ctx, null);
  const t: TargetState = field.slots[0]!;
  return { t, ctx };
}

describe('FSM base', () => {
  const log: string[] = [];
  const b: Behaviour = {
    name: 'test',
    initial: 0,
    states: [
      { name: 'a', enter: () => log.push('enter a'), onTimer: () => 1 },
      {
        name: 'b',
        enter: (t, ctx) => { log.push('enter b'); fsmSetTimerRange(t, ctx.rng, 0.5, 1); },
        update: (t, ctx) => (fsmTicksInState(t, ctx.tick) >= 3 ? 2 : STAY),
        onTimer: () => 0,
      },
      { name: 'c', enter: () => log.push('enter c') },
    ],
  };

  it('runs enter on start, fires the timer after exactly N ticks, then moves on', () => {
    const { t, ctx } = rig();
    log.length = 0;
    fsmStart(b, t, ctx);
    fsmSetTimer(t, 10 / TICK_RATE); // 10 ticks
    expect(t.fsm.state).toBe(0);
    for (let i = 1; i <= 9; i++) {
      ctx.tick = i;
      fsmStep(b, t, ctx);
      expect(t.fsm.state).toBe(0);
    }
    ctx.tick = 10;
    fsmStep(b, t, ctx);
    expect(t.fsm.state).toBe(1);
    expect(log).toEqual(['enter a', 'enter b']);
    expect(t.fsm.enteredTick).toBe(10);
  });

  it('update can transition; the timer is cleared on a state change', () => {
    const { t, ctx } = rig();
    fsmStart(b, t, ctx);
    fsmGoto(b, t, ctx, 1);
    expect(t.fsm.timerTicks).toBeGreaterThan(0); // seeded range timer was started
    ctx.tick = 3; // 3 ticks in state (entered at tick 0)
    fsmStep(b, t, ctx);
    expect(t.fsm.state).toBe(2);
    expect(t.fsm.timerTicks).toBe(-1);
  });

  it('seeded randomness: same seed => same timers, different seed => different', () => {
    const timers = (seed: number): number[] => {
      const { t, ctx } = rig(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        fsmGoto(b, t, ctx, 1);
        out.push(t.fsm.timerTicks);
      }
      return out;
    };
    expect(timers(7)).toEqual(timers(7));
    expect(timers(7)).not.toEqual(timers(8));
  });
});

describe('Post behaviour', () => {
  it('idles then sways; the lean stays within its amplitude and is replayable from the seed', () => {
    const trace = (seed: number): number[] => {
      const w = new World({ level: { ...testRoom, targets: [{ kind: 'post', pos: { x: 0, y: 0, z: -10 } }] }, tunables: cloneTunables(), seed });
      const bus = new EventBus<SimEvents>();
      const input = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false, walk: false, fire: false, reload: false, switchTo: -1 };
      const out: number[] = [];
      for (let i = 0; i < TICK_RATE * 20; i++) {
        w.step(input, bus);
        out.push(w.targets[0]!.sway);
      }
      return out;
    };
    const a = trace(5);
    const amp = tun.targets.sway.amplitude;
    expect(Math.max(...a)).toBeGreaterThan(0.2 * amp);
    expect(Math.min(...a)).toBeLessThan(-0.2 * amp);
    expect(a.every((v) => Math.abs(v) <= amp + 1e-12)).toBe(true);
    expect(trace(5)).toEqual(a);
    expect(trace(6)).not.toEqual(a);
  });

  it('the hit zones do not move with the sway', () => {
    const { t } = rig();
    t.sway = 0.02;
    expect(t.pos.x).toBe(0);
  });
});
