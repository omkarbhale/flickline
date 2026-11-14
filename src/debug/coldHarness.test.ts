import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { coldHarness, coldLevelStep, runColdBot } from './coldHarness';

/**
 * The cold opener's bot harness in CI (design 8.5, transfer.md H2-H5, replay-not-drills.md R5, #209). The
 * figures are reported on #209; these guards keep the measurement from getting worse unnoticed and
 * check the rules a bot can break: warm and repeat days never count, and a verdict needs enough days.
 */
describe('cold opener bot harness', () => {
  const t = cloneTunables();
  const report = coldHarness(t, 60, 0xc0ffee);

  it('one cold opener is good to about ±11 dial points at the classifier\'s trial yield (the figure on #209)', () => {
    expect(report.se).toBeGreaterThan(5);
    expect(report.se).toBeLessThan(13);
  });

  it('H3: a warm-up-only player is told "Improved" on at most 5% of its verdict days (R5)', () => {
    expect(report.h3DaysFalseImproved).toBeLessThanOrEqual(0.05);
  });

  it('H4: a player who learns a dial point a day is told "Improved" within 30 days in most months', () => {
    expect(report.h4By30).toBeGreaterThanOrEqual(0.6);
  });

  it('warm days and second openers of a day never enter the series; no verdict before 8 valid days', () => {
    const days = runColdBot(t, { theta: () => 50, matched: 56, warmDays: [2, 4], repeatDays: [1, 3, 5] }, 12, 7);
    // Days 2 and 4 are warm: 10 valid days by day 12, so the first verdict (8 valid, confirmed on the 9th) is late.
    expect(days.slice(0, 9).every((d) => d.verdict === 'none')).toBe(true);
    expect(days.length).toBe(12);
  });

  it('a level change puts a step of about 4 dial points in the series, inside the band (transfer.md H4)', () => {
    expect(coldLevelStep(t, 150, 11)).toBeLessThan(6);
  });
});
