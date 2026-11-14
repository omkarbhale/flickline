import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { cloneTunables } from '../config/tunables';
import { retainedHeapBytes } from './heapProbe';
import { BIAS_FLOATS, DEAD_BIRTH, KILL_FLOATS, SEED_FLOATS, ShardRing } from './shardRing';

const cfg = cloneTunables().echo.shatter;
function make(): ShardRing {
  const rng = new Rng(7);
  return new ShardRing(cfg.killCapacity, cfg.shardsPerKill, () => rng.next());
}

describe('kill shatter pool', () => {
  it('reserves 12 shards per kill (issue #18)', () => {
    expect(cfg.shardsPerKill).toBe(12);
    const r = make();
    expect(r.instances).toBe(cfg.killCapacity * 12);
  });

  it('a kill launches exactly 12 shards from the hit point at the given time', () => {
    const r = make();
    const slot = r.spawn(1, 2, 3, 5, 0, 0, -1, 12);
    let flying = 0;
    for (let s = 0; s < 12; s++) {
      const i = slot * 12 + s;
      expect(r.kill[i * KILL_FLOATS]).toBe(1);
      expect(r.kill[i * KILL_FLOATS + 1]).toBe(2);
      expect(r.kill[i * KILL_FLOATS + 2]).toBe(3);
      if (r.kill[i * KILL_FLOATS + 3] === 5) flying++;
      expect(r.bias[i * BIAS_FLOATS + 2]).toBe(-1);
    }
    expect(flying).toBe(12);
  });

  it('a lower quality launches fewer shards; the rest stay dead', () => {
    const r = make();
    const slot = r.spawn(0, 1, 0, 2, 0, 0, -1, 6);
    let flying = 0;
    for (let s = 0; s < 12; s++) if (r.kill[(slot * 12 + s) * KILL_FLOATS + 3] === 2) flying++;
    expect(flying).toBe(6);
    expect(r.kill[(slot * 12 + 11) * KILL_FLOATS + 3]).toBe(DEAD_BIRTH);
  });

  it('shard directions are unit vectors (seeded, so identical runs look identical)', () => {
    const r = make();
    for (let i = 0; i < r.instances; i++) {
      const o = i * SEED_FLOATS;
      expect(Math.hypot(r.seed[o]!, r.seed[o + 1]!, r.seed[o + 2]!)).toBeCloseTo(1, 5);
    }
    expect(Array.from(make().seed)).toEqual(Array.from(r.seed));
  });

  it('recycles the oldest kill when the pool is full', () => {
    const r = make();
    const slots: number[] = [];
    for (let k = 0; k < cfg.killCapacity + 2; k++) slots.push(r.spawn(k, 0, 0, k, 0, 0, 1, 12));
    expect(slots[cfg.killCapacity]).toBe(slots[0]);
    expect(r.kill[slots[0]! * 12 * KILL_FLOATS]).toBe(cfg.killCapacity); // overwritten by the newer kill
  });

  it('is active for one shard lifetime after the newest kill, then quiet', () => {
    const r = make();
    expect(r.active(0, cfg.lifeSec)).toBe(false);
    r.spawn(0, 0, 0, 10, 0, 0, 1, 12);
    expect(r.active(10.3, cfg.lifeSec)).toBe(true);
    expect(r.active(10 + cfg.lifeSec + 0.01, cfg.lifeSec)).toBe(false);
  });

  it('allocates nothing per kill: same buffers, and no retained heap over 200k kills', () => {
    const r = make();
    const buffers = [r.kill, r.bias, r.seed];
    const lengths = buffers.map((b) => b.length);
    let i = 0;
    const retained = retainedHeapBytes(() => { r.spawn(i, 1, 2, i * 0.01, 0, 1, 0, 12); i++; }, 200_000);
    expect([r.kill, r.bias, r.seed]).toEqual(buffers);
    expect(buffers.map((b) => b.length)).toEqual(lengths);
    expect(retained).toBeLessThan(256 * 1024);
    expect(r.total).toBeGreaterThanOrEqual(200_000);
  });
});
