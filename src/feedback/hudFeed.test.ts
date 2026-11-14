import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { SortedSamples } from '../core/sortedSamples';
import { hud } from '../config/hud';
import type { ModeEvents } from '../modes/contracts';
import type { SimEvents } from '../sim/types';
import { EdgeMeter } from './edgeMeter';
import { NO_PERSONAL_BEST, paceFraction } from './ghostPace';
import { LiveStats } from './liveStats';

type Ev = SimEvents & ModeEvents;

const shot = (moving: boolean) => ({ moving }) as unknown as SimEvents['shotFired'];
const hit = (zone: 'head' | 'body' | 'leg') => ({ zone }) as unknown as SimEvents['targetHit'];
const kill = (rtMs: number, ttkMs: number) => ({ rtMs, ttkMs }) as unknown as SimEvents['targetKilled'];
const trial = (success: boolean) => ({ success }) as unknown as ModeEvents['skillTrial'];

describe('SortedSamples', () => {
  it('keeps samples ordered and reports the median (mean of the middle two when even)', () => {
    const s = new SortedSamples(8);
    expect(s.median()).toBeNaN();
    for (const v of [5, 1, 9, 3]) s.add(v);
    expect(s.count).toBe(4);
    expect(s.median()).toBe(4);
    s.add(7);
    expect(s.median()).toBe(5);
    s.clear();
    expect(s.count).toBe(0);
  });
  it('ignores NaN and anything past its capacity', () => {
    const s = new SortedSamples(2);
    s.add(NaN);
    s.add(10);
    s.add(20);
    s.add(1000);
    expect(s.count).toBe(2);
    expect(s.median()).toBe(15);
  });
  it('handles duplicates', () => {
    const s = new SortedSamples(8);
    for (const v of [2, 2, 2, 8]) s.add(v);
    expect(s.median()).toBe(2);
  });
});

describe('LiveStats (the stat strip source)', () => {
  function setup() {
    const bus = new EventBus<Ev>();
    const st = new LiveStats(hud);
    st.attach(bus);
    return { bus, st };
  }

  it('has no data before the first shot or kill', () => {
    const { st } = setup();
    expect(st.accuracy).toBe(0);
    expect(st.headshotRate).toBe(0);
    expect(st.medianRtMs).toBeNaN();
    expect(st.medianTtkMs).toBeNaN();
    expect(st.movingShots).toBe(0);
  });

  it('accuracy = hits / shots, headshot rate = head hits / hits, moving shots counted at fire time', () => {
    const { bus, st } = setup();
    for (const m of [false, false, true, false]) bus.emit('shotFired', shot(m));
    bus.emit('targetHit', hit('head'));
    bus.emit('targetHit', hit('body'));
    bus.emit('targetHit', hit('head'));
    expect(st.shots).toBe(4);
    expect(st.accuracy).toBeCloseTo(0.75);
    expect(st.headshotRate).toBeCloseTo(2 / 3);
    expect(st.movingShots).toBe(1);
  });

  it('medians come from kills; unmeasured (negative) reaction times are not samples', () => {
    const { bus, st } = setup();
    bus.emit('targetKilled', kill(180, 0));
    bus.emit('targetKilled', kill(-1, 410));
    bus.emit('targetKilled', kill(240, 820));
    expect(st.medianRtMs).toBe(210);
    expect(st.medianTtkMs).toBe(410);
  });

  it('resets when a run is readied', () => {
    const { bus, st } = setup();
    bus.emit('shotFired', shot(true));
    bus.emit('targetKilled', kill(200, 300));
    bus.emit('runReady', { tick: 0, mode: 'test', seed: 1, dial: 50 });
    expect(st.shots).toBe(0);
    expect(st.movingShots).toBe(0);
    expect(st.medianRtMs).toBeNaN();
  });
});

describe('EdgeMeter (rolling success over the last 20 trials)', () => {
  it('is NaN with no trials and counts up to the window', () => {
    const m = new EdgeMeter(hud);
    expect(m.rate).toBeNaN();
    for (let i = 0; i < 5; i++) m.record(i % 5 !== 0);
    expect(m.count).toBe(5);
    expect(m.rate).toBeCloseTo(0.8);
  });
  it('rolls: only the last 20 trials count', () => {
    const m = new EdgeMeter(hud);
    for (let i = 0; i < 20; i++) m.record(false);
    expect(m.rate).toBe(0);
    for (let i = 0; i < 20; i++) m.record(true);
    expect(m.count).toBe(20);
    expect(m.rate).toBe(1);
    for (let i = 0; i < 10; i++) m.record(false);
    expect(m.rate).toBeCloseTo(0.5);
  });
  it('is fed by skillTrial and cleared by runReady', () => {
    const bus = new EventBus<Ev>();
    const m = new EdgeMeter(hud);
    m.attach(bus);
    bus.emit('skillTrial', trial(true));
    bus.emit('skillTrial', trial(false));
    expect(m.rate).toBe(0.5);
    bus.emit('runReady', { tick: 0, mode: 'test', seed: 1, dial: 50 });
    expect(m.count).toBe(0);
  });
  it('the shaded zone is 60-80%', () => {
    expect(hud.edgeZoneLo).toBe(0.6);
    expect(hud.edgeZoneHi).toBe(0.8);
    expect(hud.edgeWindow).toBe(20);
  });
});

describe('ghost pace', () => {
  it('the stub provider has no personal best, so the pace is NaN (bar hidden)', () => {
    expect(NO_PERSONAL_BEST.scoreAt('test', 10)).toBeNull();
    expect(paceFraction(500, NO_PERSONAL_BEST.scoreAt('test', 10), hud)).toBeNaN();
  });
  it('is signed and clamped to ±1 at the full-scale fraction of the PB', () => {
    expect(paceFraction(1000, 1000, hud)).toBe(0);
    expect(paceFraction(1125, 1000, hud)).toBeCloseTo(0.5);
    expect(paceFraction(875, 1000, hud)).toBeCloseTo(-0.5);
    expect(paceFraction(5000, 1000, hud)).toBe(1);
    expect(paceFraction(0, 1000, hud)).toBe(-1);
  });
  it('a PB too small to compare against is treated as none', () => {
    expect(paceFraction(100, hud.ghostMinPbScore - 1, hud)).toBeNaN();
    expect(paceFraction(100, 0, hud)).toBeNaN();
  });
});
