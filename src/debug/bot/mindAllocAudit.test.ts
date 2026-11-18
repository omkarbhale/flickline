import { describe, expect, it } from 'vitest';
import { auditMinds } from './allocAudit';

// Its own file (so its own worker), like the other audits: the JIT state of other tests must not leak in.
describe('allocation audit: the enemy mind (#91)', () => {
  it('four mind-driven Echoes holding, duelling, disengaging and re-peeking stay under the per-tick ceiling', () => {
    const a = auditMinds({ ticks: 10_000, warmupTicks: 40_000 });
    expect(a.bytesPerTick, JSON.stringify(a.sites.slice(0, 4))).toBeLessThanOrEqual(a.ceilingBytesPerTick);
  }, 60_000);
});
