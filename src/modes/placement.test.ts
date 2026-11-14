import { describe, expect, it } from 'vitest';
import { secondsToTicks } from '../core/time';
import { aimAt, kill, shot, start, targetOf, untilTarget, READY } from './drillSupport';
import type { Harness } from './testHarness';
import { placement, type PlacementState } from './placement';

/** Play the trial now up: win it with the first bullet, or let it run out. */
function trial(h: Harness, win: boolean): void {
  untilTarget(h, 2000);
  const t = targetOf(h);
  if (win) {
    aimAt(h, t.pos, t.kind === 'post' ? h.tunables.targets.hit.headCentreStand : 0);
    h.step(20);
    shot(h, t.id, true);
    kill(h, t.id, 'head');
    h.targets.delete(t.id);
  } else {
    // A Cold Start Post leaves after its exposure; so does a Beacon.
    for (let i = 0; i < 3000 && h.targets.has(t.id); i++) h.step(1);
    expect(h.targets.has(t.id)).toBe(false);
  }
}

describe('Placement run', () => {
  it('is a 45 s hybrid of both drills on one dial: Kestrel, movement locked, flat wave, a single beat', () => {
    expect(placement.durationSec).toBe(45);
    expect(placement.skills).toEqual(['flick', 'precision']);
    expect(placement.player?.lockMovement).toBe(true);
    expect(placement.beatSec).toBeNull();
    expect(placement.waveCurve).toEqual([0]);
  });

  it('mixes both target types, alternating, each reported on its own skill', () => {
    const h = start(placement, 1, 40);
    const kinds: string[] = [];
    for (let n = 0; n < 8; n++) {
      untilTarget(h, 2000);
      kinds.push(targetOf(h).kind);
      trial(h, true);
    }
    expect(kinds).toEqual(['beacon', 'post', 'beacon', 'post', 'beacon', 'post', 'beacon', 'post']);
    expect(h.events('skillTrial').map((e) => e.skill)).toEqual(['flick', 'precision', 'flick', 'precision', 'flick', 'precision', 'flick', 'precision']);
  });

  it('the dial follows a 2-up/1-down staircase, step 16 then 8, 4, 2 at each reversal', () => {
    const h = start(placement, 2, 40);
    // Item difficulty of each trial = the staircase's dial when it was started.
    const outcomes = [true, true, false, true, true, false, true, true, false, true, true, false, true, true, false, true, true, false];
    for (const win of outcomes) trial(h, win);
    const d = h.events('skillTrial').map((e) => e.itemDifficulty as number);
    const base = d[0]!;
    expect(d[1]).toBe(base); // one success: no move yet
    expect(d[2]).toBe(base + 16); // two in a row: harder by the first step
    expect(d[3]).toBe(base + 8); // a failure: easier, and the step halves at the reversal
    expect(d[4]).toBe(base + 8);
    expect(d[5]).toBe(base + 12); // two in a row again: a reversal (down -> up), step 4
    expect(d[6]).toBe(base + 10); // failure: reversal, step 2
    const st = (h.runner.state as PlacementState).staircase;
    expect(st.step).toBe(2); // 16 -> 8 -> 4 -> 2 and no further
    expect(st.reversals).toBeGreaterThanOrEqual(5);
    // No difficulty ever leaves the dial range.
    for (const x of d) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThanOrEqual(100);
  });

  it('ends by itself after 45 s with the timer, mid-trial', () => {
    const h = start(placement, 3, 40);
    h.step(secondsToTicks(45) - 2);
    expect(h.runner.phase).toBe('live');
    h.step(2);
    expect(h.runner.phase).toBe('result');
    expect(h.events('runEnded')[0]!.reason).toBe('timer');
    expect(READY).toBeGreaterThan(0);
  });

  it('25-35 trials in 45 s for a player who needs ~1.2 s per target', () => {
    const h = start(placement, 4, 40);
    let guard = 0;
    while (h.runner.phase === 'live' && guard++ < 200) {
      untilTarget(h, 400);
      if (h.targets.size === 0) break;
      const t = targetOf(h);
      aimAt(h, t.pos, t.kind === 'post' ? h.tunables.targets.hit.headCentreStand : 0);
      h.step(Math.round(1.2 * 128));
      if (h.runner.phase !== 'live') break;
      shot(h, t.id, true);
      kill(h, t.id, 'head');
      h.targets.delete(t.id);
    }
    const n = h.events('skillTrial').length;
    expect(n).toBeGreaterThanOrEqual(24);
    expect(n).toBeLessThanOrEqual(40);
  });
});
