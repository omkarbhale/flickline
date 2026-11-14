import { describe, expect, it } from 'vitest';
import { LatencyProbe, percentiles } from './latencyProbe';

describe('LatencyProbe', () => {
  it('times a click through its firing tick, the drawn frame and the next vsync', () => {
    const p = new LatencyProbe();
    p.event('fire', 100);
    p.shot(104); // the tick that fired it
    p.frameSampled(104.5, 1);
    p.frameDrawn(106);
    p.vsync(110);
    const s = p.summary().find((x) => x.kind === 'fire')!;
    expect(s.toConsumed.p50).toBe(4);
    expect(s.toDrawn.p50).toBe(6);
    expect(s.toVsync.p50).toBe(10);
    expect(p.samples[0]!.ticksInFrame).toBe(1);
  });

  it('counts a click the gun ignored as dropped instead of pairing it with a later shot', () => {
    const p = new LatencyProbe();
    p.event('fire', 100);
    p.frameSampled(105, 2); // ticks ran, no shot: the gun was cycling
    p.event('fire', 200);
    p.shot(203);
    p.frameSampled(203.5, 1);
    p.frameDrawn(205);
    p.vsync(208);
    expect(p.dropped).toBe(1);
    expect(p.samples).toHaveLength(1);
    expect(p.samples[0]!.eventAt).toBe(200);
  });

  it('coalesces mouse moves until a frame samples them, and keys wait for a tick', () => {
    const p = new LatencyProbe();
    p.event('look', 10);
    p.event('look', 12); // same frame: the oldest move counts
    p.event('key', 11);
    p.frameSampled(15, 0); // no tick this frame: the key is not consumed yet
    p.frameDrawn(16);
    p.vsync(20);
    p.tick(22);
    p.frameSampled(22.5, 1);
    p.frameDrawn(24);
    p.vsync(28);
    const look = p.summary().find((x) => x.kind === 'look')!;
    const key = p.summary().find((x) => x.kind === 'key')!;
    expect(look.toConsumed.n).toBe(1);
    expect(look.toVsync.p50).toBe(10);
    expect(key.toConsumed.p50).toBe(11);
    expect(key.toVsync.p50).toBe(17);
  });

  it('percentiles use nearest rank', () => {
    const q = percentiles([5, 1, 4, 2, 3]);
    expect([q.min, q.p50, q.p90, q.max, q.mean]).toEqual([1, 3, 5, 5, 3]);
    expect(percentiles([]).n).toBe(0);
  });
});
