import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../../config/tunables';
import { calibrate } from './aimCalibration';

/**
 * Signature S7 (issue #90, research §5.4): the headshot share of a mind-driven Echo's hits on the
 * standard moving bot lands within 5 points of its anchor's target. Deterministic (seeded); the
 * full report with more seeds is `npm run bot -- --aim-report`.
 */
describe('S7 headshot share of hits on the standard moving bot', () => {
  const tun = cloneTunables();
  const anchors = tun.mind.anchorSkills;
  for (let i = 0; i < anchors.length; i++) {
    const m = anchors[i]!;
    const target = tun.mind.anchors.calibrationHeadshotShare[i]!;
    it(`mind skill ${m}: ${(target * 100).toFixed(0)} % +- 5`, () => {
      let head = 0, hits = 0;
      for (const d of [10, 15, 20]) {
        const r = calibrate({ mindSkill: m, dial: m, distanceM: d, seconds: 45, seeds: 4, strafe: false });
        head += r.zones.head;
        hits += r.zones.head + r.zones.body + r.zones.leg;
      }
      expect(hits).toBeGreaterThan(100);
      expect(Math.abs(head / hits - target), `${((100 * head) / hits).toFixed(1)} % of ${hits} hits`).toBeLessThanOrEqual(0.05);
    }, 20_000);
  }
});
