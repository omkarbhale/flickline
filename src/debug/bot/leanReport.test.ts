import { describe, expect, it } from 'vitest';
import { formatLeanAb, leanAb, type LeanAbOptions } from './sweepReport';

/** A small A/B (#210): the harness that backs `npm run bot -- --lean-report`. */
const small: LeanAbOptions = { skill: 50, runs: 4, players: 2, firstSeed: 1, startShare: 0.7, practice: 0.04, engine: 'planted' };

describe('the lean A/B (bot harness, #210)', () => {
  const ab = leanAb(small);

  it('plays the same seeds in both arms, with no lean in the first run and none at all when off', () => {
    expect(ab.off.players).toHaveLength(2);
    ab.off.players.forEach((runs, p) => {
      expect(runs.map((r) => r.seed)).toEqual(ab.on.players[p]!.map((r) => r.seed));
      for (const r of runs) expect(r.lean).toEqual([]);
    });
    for (const runs of ab.on.players) {
      expect(runs[0]!.lean).toEqual([]); // the lean follows a finding: nothing before the first run
      for (const r of runs.slice(1)) expect(r.lean).toEqual(['meet', 'take-expected']);
    }
  });

  it('a planted weakness shows in the shots (moving share) and wears down with practice', () => {
    const first = ab.off.players[0]![0]!;
    expect(first.share).toBe(0.7);
    for (const arm of [ab.off, ab.on]) for (const runs of arm.players) expect(runs[runs.length - 1]!.share).toBeLessThanOrEqual(0.7);
    expect(ab.rows).toHaveLength(2);
    for (const r of ab.rows) {
      expect(r.weaknessLeft).toBeGreaterThan(0);
      expect(r.weaknessLeft).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and prints a table', () => {
    expect(leanAb(small).rows).toEqual(ab.rows);
    const t = formatLeanAb(ab.rows);
    expect(t).toHaveLength(4);
    expect(t[2]).toMatch(/^\| off \|/);
    expect(t[3]).toMatch(/^\| on \|/);
  }, 30_000);

  it('with no weakness planted the bot stops in every fight, as every earlier report assumed', () => {
    const clean = leanAb({ ...small, startShare: 0, players: 1, runs: 3 });
    for (const r of clean.off.players[0]!) expect(r.movingShots).toBe(0);
  });
});
