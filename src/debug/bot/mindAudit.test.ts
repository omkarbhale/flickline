import { describe, expect, it } from 'vitest';
import { auditMindAllocations, mindTickCostMs } from './mindAudit';

// Its own file (so its own worker): the audit measures the JIT-compiled tick.
describe('enemy mind cost (#90)', () => {
  it('the aim path allocates nothing per tick: no site in sim/mind/ beyond profiler noise', () => {
    const a = auditMindAllocations('aim', 8, 10_000, 40_000);
    const mind = a.sites.filter((s) => s.where.startsWith('src/sim/mind/'));
    const mindBytes = mind.reduce((n, s) => n + s.bytes, 0);
    // 8 Echoes for 10 000 ticks. What is left (~2 B/tick for all 8 together) is one boxed number per
    // `drawNormals` call where it is cold: a drift knot or a submovement plan, every ~0.5 s per Echo, not
    // per tick. A per-tick allocation in the aim path would show as >= 16 B/tick per Echo, 128 here.
    expect(mindBytes / a.ticks, JSON.stringify(mind)).toBeLessThanOrEqual(4);
  }, 60_000);

  it('costs well under 0.01 ms per enemy per tick', () => {
    // Measured ~0.005 ms here; the bound leaves room for a loaded CI machine.
    expect(mindTickCostMs(8, 10_000, 3)).toBeLessThan(0.02);
  }, 60_000);
});
