import { describe, expect, it } from 'vitest';
import { heapFloorGrowth, lowFps } from './perfHarness';

describe('perf harness statistics', () => {
  it('1 % low is the average fps of the slowest 1 % of frames', () => {
    const frames = [...new Array<number>(99).fill(5), 50]; // 99 fast frames and one 50 ms hitch
    expect(lowFps(frames, 0.01)).toBeCloseTo(20, 6);
    expect(lowFps(frames, 0.02)).toBeCloseTo(1000 / 27.5, 6);
    expect(lowFps([], 0.01)).toBe(0);
    expect(lowFps([4], 0.01)).toBe(250);
  });

  it('heap growth reads the floor of the sawtooth: garbage is not growth, a leak is', () => {
    const saw = (leakPerWindow: number): number[] => {
      const out: number[] = [];
      for (let w = 0; w < 20; w++) for (let i = 0; i < 10; i++) out.push(1_000_000 + w * leakPerWindow + i * 50_000);
      return out;
    };
    expect(heapFloorGrowth(saw(0), 10)).toBeCloseTo(0, 3);
    expect(heapFloorGrowth(saw(10_000), 10)).toBeCloseTo(190_000, 0);
    expect(heapFloorGrowth([1, 2, 3], 10)).toBe(0);
  });
});
