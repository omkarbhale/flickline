import { describe, expect, it } from 'vitest';
import { EventBus } from './eventBus';
import { FixedStepper } from './fixedStep';
import { Pool } from './pool';
import { Rng } from './rng';
import { cmPer360, degreesPerCount, sensitivityFromCmPer360 } from './sensitivity';
import { TICK_DT, TICK_RATE, secondsToTicks } from './time';
import { REFERENCE_ASPECT, horizontalFovDeg, verticalFovDeg } from './view';
import { directionFromAngles, vec3 } from './vec3';
import { moveTowards } from './math';

describe('FixedStepper', () => {
  it('runs the right number of ticks and keeps the remainder as alpha', () => {
    const s = new FixedStepper(TICK_DT);
    expect(s.advance(TICK_DT * 2.5)).toBe(2);
    expect(s.alpha).toBeCloseTo(0.5, 6);
    expect(s.advance(TICK_DT * 0.5)).toBe(1);
    expect(s.alpha).toBeCloseTo(0, 6);
  });
  it('averages the tick rate over many uneven frames', () => {
    const s = new FixedStepper(TICK_DT);
    let ticks = 0;
    for (let i = 0; i < 1440; i++) ticks += s.advance(1 / 144); // 10 s at 144 fps
    expect(ticks).toBeGreaterThanOrEqual(TICK_RATE * 10 - 1);
    expect(ticks).toBeLessThanOrEqual(TICK_RATE * 10);
  });
  it('drops time beyond the catch-up cap (no spiral of death)', () => {
    const s = new FixedStepper(TICK_DT, 8);
    expect(s.advance(5)).toBe(8);
    expect(s.droppedTicks).toBeGreaterThan(0);
    expect(s.alpha).toBeLessThan(1);
  });
  it('ignores negative frame time', () => {
    const s = new FixedStepper(TICK_DT);
    expect(s.advance(-1)).toBe(0);
  });
});

describe('time', () => {
  it('uses a power-of-two tick so accumulation is exact', () => {
    expect(TICK_DT * TICK_RATE).toBe(1);
    expect(secondsToTicks(0.1)).toBe(13);
    expect(secondsToTicks(0)).toBe(1);
  });
});

describe('EventBus', () => {
  interface E { a: { n: number }; b: { s: string } }
  it('delivers typed payloads and unsubscribes', () => {
    const bus = new EventBus<E>();
    const got: number[] = [];
    const off = bus.on('a', (p) => got.push(p.n));
    bus.emit('a', { n: 1 });
    off();
    bus.emit('a', { n: 2 });
    expect(got).toEqual([1]);
  });
  it('is safe to subscribe and unsubscribe during dispatch', () => {
    const bus = new EventBus<E>();
    const got: string[] = [];
    let off2 = (): void => {};
    bus.on('b', () => {
      got.push('first');
      off2();
      bus.on('b', () => got.push('late'));
    });
    off2 = bus.on('b', () => got.push('second'));
    bus.emit('b', { s: '' });
    expect(got).toEqual(['first', 'second']);
    bus.emit('b', { s: '' });
    expect(got).toContain('late');
  });
});

describe('Rng', () => {
  it('is deterministic per seed and stays in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('can save and restore its state', () => {
    const r = new Rng(7);
    r.next();
    const s = r.getState();
    const x = r.next();
    r.setState(s);
    expect(r.next()).toBe(x);
  });
});

describe('sensitivity', () => {
  it('matches the reference scale: 0.4 @ 800 DPI = 40.8 cm/360', () => {
    expect(cmPer360(0.4, 800)).toBeCloseTo(40.8, 1);
  });
  it('round-trips through cm/360', () => {
    expect(sensitivityFromCmPer360(cmPer360(0.55, 1600), 1600)).toBeCloseTo(0.55, 9);
  });
  it('turns 0.028 degrees per count at sens 0.4', () => {
    expect(degreesPerCount(0.4)).toBeCloseTo(0.028, 9);
  });
});

describe('field of view', () => {
  it('derives 70.53 deg vertical from 103 deg horizontal at 16:9', () => {
    expect(verticalFovDeg(103, REFERENCE_ASPECT)).toBeCloseTo(70.53, 2);
  });
  it('round-trips and widens with aspect (Hor+)', () => {
    const v = verticalFovDeg(103, REFERENCE_ASPECT);
    expect(horizontalFovDeg(v, REFERENCE_ASPECT)).toBeCloseTo(103, 6);
    expect(horizontalFovDeg(v, 4 / 3)).toBeCloseTo(86.6, 1);
    expect(horizontalFovDeg(v, 21 / 9)).toBeGreaterThan(110);
  });
});

describe('vec3 / math', () => {
  it('yaw 0 looks down -Z and positive yaw turns left', () => {
    const d = directionFromAngles(vec3(), 0, 0);
    expect(d.z).toBeCloseTo(-1, 9);
    const l = directionFromAngles(vec3(), Math.PI / 2, 0);
    expect(l.x).toBeCloseTo(-1, 9);
    expect(directionFromAngles(vec3(), 0, Math.PI / 2).y).toBeCloseTo(1, 9);
  });
  it('moveTowards never overshoots', () => {
    expect(moveTowards(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(moveTowards(0.9, 1, 0.3)).toBe(1);
    expect(moveTowards(1, 0, 0.3)).toBeCloseTo(0.7);
  });
});

describe('Pool', () => {
  it('hands out up to capacity and recycles', () => {
    const p = new Pool(2, () => ({ n: 0 }));
    const a = p.acquire();
    const b = p.acquire();
    expect(a && b).toBeTruthy();
    expect(p.acquire()).toBeNull();
    p.release(a!);
    expect(p.acquire()).toBe(a);
  });
});
