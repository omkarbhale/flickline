import { describe, expect, it } from 'vitest';
import { tunables } from '../../config/tunables';
import { HeadlessGame } from './headless';
import { playMode } from './play';

/**
 * Cold Start's settled success band and failure mix (#170, design §9.3.1, §9.6): a matched player
 * must land in the 60-80 % flow band, and a failed trial must be a precision miss, not "the Post left
 * before I fired". Small on purpose (one short session per skill) so it stays in the seconds budget;
 * the full ten-minute, many-seed table lives in docs/playtests.
 */
const SETTLE_RUNS = 2; // runs played before counting, so the posterior has settled
const COUNTED_RUNS = 4;

function settledSession(skill: number): { success: number; timeoutShare: number; failures: number } {
  const game = new HeadlessGame({ seed: 1 });
  let timedOut = 0;
  game.bus.on('skillTrial', (e) => {
    if (e.extra?.timedOut) timedOut++;
  });
  let trials = 0;
  let won = 0;
  let timeouts = 0;
  for (let r = 1; r <= SETTLE_RUNS + COUNTED_RUNS; r++) {
    timedOut = 0;
    const rep = playMode(game, { mode: 'coldStart', skill, seed: 1000 + r, botSeed: 7 + r });
    if (r <= SETTLE_RUNS || !rep.modeRun) continue;
    trials += rep.modeRun.trials;
    won += rep.modeRun.trialsWon;
    timeouts += timedOut;
  }
  const failures = trials - won;
  return { success: won / trials, timeoutShare: failures ? timeouts / failures : 0, failures };
}

describe('Cold Start balance (#170)', () => {
  it('every mode targets a success rate inside the 60-80 % flow band', () => {
    for (const [id, def] of Object.entries(tunables.dial.modes)) {
      expect(def.targetSuccess, id).toBeGreaterThanOrEqual(0.6);
      expect(def.targetSuccess, id).toBeLessThanOrEqual(0.8);
    }
  });

  it('exposure leaves clear room above the minimum feasible time at every dial', () => {
    const { axes, floors } = tunables.dial;
    // 1.25x the floor: a player who needs the whole minimum feasible time still fires before the Post leaves
    expect(axes.coldStartExposureSec.at100).toBeGreaterThanOrEqual(floors.coldStartExposureSec * 1.25);
  });

  it.each([30, 50])('a settled skill-%i bot succeeds in the flow band and mostly fails by missing, not by timing out', (skill) => {
    const s = settledSession(skill);
    expect(s.success).toBeGreaterThanOrEqual(0.6);
    expect(s.success).toBeLessThanOrEqual(0.85);
    expect(s.failures).toBeGreaterThan(10); // enough failures for the share to mean something
    expect(s.timeoutShare).toBeLessThanOrEqual(0.25);
  });
});
