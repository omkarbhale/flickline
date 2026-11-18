import { describe, expect, it } from 'vitest';
import { auditEnemyBodies } from './allocAudit';

// Its own file (so its own worker), like the free-play audit: the JIT state of other tests must not leak in.
describe('allocation audit: Echoes on the shared body (#87)', () => {
  it('eight bodies strafing, stopping, crouching, jumping and firing bursts stay under the per-tick ceiling', () => {
    const a = auditEnemyBodies({ ticks: 20_000, warmupTicks: 100_000 });
    expect(a.bytesPerTick, JSON.stringify(a.sites.slice(0, 4))).toBeLessThanOrEqual(a.ceilingBytesPerTick);
  }, 60_000);
});
