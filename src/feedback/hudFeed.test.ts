import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/eventBus';
import { hud } from '../config/hud';
import type { ModeEvents } from '../modes/contracts';
import type { SimEvents } from '../sim/types';
import { EdgeMeter } from './edgeMeter';
import { NO_PACE, paceFraction } from './ghostPace';
import { TrackerHudStats } from './hudStats';
import type { RunStats } from './statTracker';

type Ev = SimEvents & ModeEvents;

const trial = (success: boolean) => ({ success }) as unknown as ModeEvents['skillTrial'];

describe('TrackerHudStats (the stat strip source)', () => {
  const stats = (over: Partial<RunStats> = {}): RunStats => ({
    shots: 0, hits: 0, movingShots: 0, accuracy: null, headshotRate: null, medianRtMs: null, medianTtkMs: null, ...over,
  }) as RunStats;

  it('maps the tracker\'s null (no data) to NaN so the HUD shows a dash', () => {
    const h = new TrackerHudStats({ liveStats: () => stats() });
    expect(h.accuracy).toBeNaN();
    expect(h.headshotRate).toBeNaN();
    expect(h.medianRtMs).toBeNaN();
    expect(h.medianTtkMs).toBeNaN();
    expect(h.shots).toBe(0);
  });

  it('passes the tracker figures through unchanged (no stat is computed here)', () => {
    const h = new TrackerHudStats({ liveStats: () => stats({ shots: 4, movingShots: 1, accuracy: 0.75, headshotRate: 2 / 3, medianRtMs: 210, medianTtkMs: 410 }) });
    expect(h.shots).toBe(4);
    expect(h.movingShots).toBe(1);
    expect(h.accuracy).toBe(0.75);
    expect(h.headshotRate).toBeCloseTo(2 / 3);
    expect(h.medianRtMs).toBe(210);
    expect(h.medianTtkMs).toBe(410);
  });

  it('takes one snapshot per batch of events, however many figures are read', () => {
    let calls = 0;
    const bus = new EventBus<Ev>();
    const h = new TrackerHudStats({ liveStats: () => { calls++; return stats({ shots: calls }); } });
    h.attach(bus as never);
    void h.accuracy; void h.medianRtMs; void h.shots;
    expect(calls).toBe(1);
    bus.emit('shotFired', {} as never);
    void h.accuracy; void h.medianRtMs;
    expect(calls).toBe(2);
    bus.emit('targetKilled', {} as never);
    bus.emit('runReady', { tick: 0, mode: 'test', seed: 1, dial: 50 });
    void h.shots;
    expect(calls).toBe(3);
    h.invalidate();
    void h.shots;
    expect(calls).toBe(4);
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
  it('in a contact mode (Sweep) it is the rolling contact win rate, across runs (#203)', () => {
    const bus = new EventBus<Ev>();
    const m = new EdgeMeter(hud);
    m.attach(bus);
    const settled = (outcome: 'cleared' | 'disengaged' | 'avoided' | 'died') =>
      bus.emit('contactSettled', { tick: 0, t: 0, contactId: 0, outcome, kept: 1, enemies: 1, points: 0 });
    bus.emit('runReady', { tick: 0, mode: 'sweep', seed: 1, dial: 50 });
    expect(m.source).toBe('contacts');
    bus.emit('skillTrial', trial(false)); // trials do not move it
    expect(m.rate).toBeNaN();
    settled('cleared');
    settled('cleared');
    settled('avoided'); // not a fight
    settled('died');
    expect(m.count).toBe(3);
    expect(m.rate).toBeCloseTo(2 / 3);
    bus.emit('runReady', { tick: 0, mode: 'sweep', seed: 2, dial: 50 });
    expect(m.rate).toBeCloseTo(2 / 3); // the window rolls across runs
    settled('disengaged');
    expect(m.rate).toBeCloseTo(0.5);
    bus.emit('runReady', { tick: 0, mode: 'test', seed: 1, dial: 50 });
    expect(m.source).toBe('trials');
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
    expect(NO_PACE.pace()?.reference ?? null).toBeNull();
    expect(paceFraction(500, NO_PACE.pace()?.reference ?? null, hud)).toBeNaN();
  });
  it('is signed and clamped to ±1 at the full-scale fraction of the best run', () => {
    expect(paceFraction(1000, 1000, hud)).toBe(0);
    expect(paceFraction(1125, 1000, hud)).toBeCloseTo(0.5);
    expect(paceFraction(875, 1000, hud)).toBeCloseTo(-0.5);
    expect(paceFraction(5000, 1000, hud)).toBe(1);
    expect(paceFraction(0, 1000, hud)).toBe(-1);
  });
  it('a reference too small to compare against is treated as none', () => {
    expect(paceFraction(100, hud.ghostMinPbScore - 1, hud)).toBeNaN();
    expect(paceFraction(100, 0, hud)).toBeNaN();
  });
});
