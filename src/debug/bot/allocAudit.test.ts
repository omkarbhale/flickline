import { describe, expect, it } from 'vitest';
import { auditAllocations } from './allocAudit';

// Its own file (so its own worker): the audit measures the JIT-compiled sim tick, and runs of the
// movement-playing bots (Stop & Pop) in the same process change the types the tick has seen.
describe('allocation audit', () => {
  it('keeps the sim tick under its allocation ceiling and names the sources', () => {
    const a = auditAllocations({ ticks: 30_000, warmupTicks: 40_000 });
    expect(a.sites.length).toBeGreaterThan(0);
    expect(a.bytesPerTick, JSON.stringify(a.sites.slice(0, 4))).toBeLessThanOrEqual(a.ceilingBytesPerTick);
    // Profiling slows the sim a lot and the suite runs beside other test files: give it room.
  }, 60_000);
});
