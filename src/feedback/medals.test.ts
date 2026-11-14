import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../core/math';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import { medals as cfg, type MedalId } from '../config/medals';
import { bulletAngleToHeadDeg, endOfRunMedals, isMetronome, MedalEngine, medalsOfLog, type EndOfRunInput } from './medals';
import type { LoggedEvent, RunLog } from './eventLog';

/** Drives an engine with hand-built events and records awards. */
class Feed {
  awards: { id: MedalId; tick: number }[] = [];
  readonly engine = new MedalEngine((id, tick) => this.awards.push({ id, tick }), cfg, 1);
  tick = 100;
  private shotId = 0;
  readonly events: LoggedEvent[] = [];

  /** `focus`: report only this medal (the others fire on the same hand-built events). */
  constructor(mode: string, private readonly focus: MedalId | null = null) {
    this.engine.begin(mode);
    this.start();
  }

  ids(): MedalId[] {
    return this.awards.filter((a) => this.focus === null || a.id === this.focus).map((a) => a.id);
  }

  private start(): void {
    this.engine.observe('runStarted', { tick: this.tick });
  }

  advance(ticks: number): void {
    this.tick += ticks;
    this.engine.advance(this.tick);
  }

  /**
   * One bullet. `headDeg` = how far (degrees) the bullet passes from the head centre of the nearest target `at`;
   * `zone` null = it hit nothing. `first` is not needed: the engine counts bullets per target itself.
   */
  shot(o: { at?: number; zone?: 'head' | 'body' | 'leg' | null; moving?: boolean; idx?: number; headDeg?: number; engaged?: boolean }): void {
    const at = o.at ?? 1;
    const zone = o.zone === undefined ? 'head' : o.zone;
    const headDeg = o.headDeg ?? 0;
    const id = ++this.shotId;
    // head centre `headDeg` to the left of the (straight ahead) bullet; the view ray is on the bullet
    this.engine.observe('shotFired', {
      tick: this.tick, shotId: id, moving: o.moving ?? false, recoilIndex: o.idx ?? 0,
      dir: directionFromAngles(vec3(), 0, 0), yaw: 0, pitch: 0,
      aimTargetId: at, aimErr: o.engaged === false ? 1 : headDeg * DEG2RAD, aimDYaw: headDeg * DEG2RAD, aimDPitch: 0,
    });
    this.engine.observe('shotImpact', { tick: this.tick, shotId: id, result: zone === null ? 'miss' : 'hit', targetId: zone === null ? -1 : at, zone });
  }

  kill(at: number, firstBullet: boolean): void {
    this.engine.observe('targetKilled', { tick: this.tick, targetId: at, firstBullet });
  }

  expire(at: number): void {
    this.engine.observe('targetExpired', { tick: this.tick, targetId: at });
  }

  aim(on: boolean): void {
    this.engine.observe('aimOnTarget', { tick: this.tick, on });
  }

  contact(o: { outcome?: 'cleared' | 'disengaged' | 'avoided' | 'died'; kept?: number; enemies?: number }): void {
    this.engine.observe('contactSettled', { tick: this.tick, outcome: o.outcome ?? 'cleared', kept: o.kept ?? 1, enemies: o.enemies ?? 1 });
  }
}

describe('geometry', () => {
  it('measures the angle between a bullet and the head centre', () => {
    const dir = directionFromAngles(vec3(), 0, 0);
    expect(bulletAngleToHeadDeg(dir, 0, 0, 0.16 * DEG2RAD, 0)).toBeCloseTo(0.16, 4);
    expect(bulletAngleToHeadDeg(dir, 0, 0, 0, -0.1 * DEG2RAD)).toBeCloseTo(0.1, 4);
    // looking up 60 degrees, a head 0.2 degrees of yaw to the side is only 0.1 degrees away (cos 60)
    const up = directionFromAngles(vec3(), 0, 60 * DEG2RAD);
    expect(bulletAngleToHeadDeg(up, 0, 60 * DEG2RAD, 0.2 * DEG2RAD, 0)).toBeCloseTo(0.1, 3);
  });

  it('judges metronome rhythm by the gaps around their mean', () => {
    expect(isMetronome([0, 1, 2, 3, 4, 5], 6, 0.12, 0.35)).toBe(true);
    expect(isMetronome([0, 1, 2.1, 3, 4, 5.1], 6, 0.12, 0.35)).toBe(true); // gaps 1, 1.1, .9, 1, 1.1: all within 12% of 1.02
    expect(isMetronome([0, 1, 2, 3, 4, 5.3], 6, 0.12, 0.35)).toBe(false); // a 1.3 gap against a mean of 1.06
    expect(isMetronome([0, 0.1, 0.2, 0.3, 0.4, 0.5], 6, 0.12, 0.35)).toBe(false); // too fast to be a rhythm
  });
});

describe('Needle: 5 first-bullet headshots in a row', () => {
  it('awards on the fifth', () => {
    const f = new Feed('coldStart', 'needle');
    for (let i = 1; i <= 4; i++) f.shot({ at: i });
    expect(f.ids()).toEqual([]);
    f.shot({ at: 5 });
    expect(f.ids()).toEqual(['needle']);
  });

  it('a body hit, a miss or a second bullet at the same target breaks it', () => {
    for (const breaker of [() => 'body', () => 'miss', () => 'again'] as const) {
      const f = new Feed('coldStart', 'needle');
      for (let i = 1; i <= 4; i++) f.shot({ at: i });
      const which = breaker();
      if (which === 'body') f.shot({ at: 5, zone: 'body' });
      else if (which === 'miss') f.shot({ at: 5, zone: null, engaged: false });
      else f.shot({ at: 4 }); // a head hit, but not the first bullet at target 4
      f.shot({ at: 6 });
      expect(f.ids(), which).toEqual([]);
    }
  });

  it('counts again from zero after an award', () => {
    const f = new Feed('orbit', 'needle');
    for (let i = 1; i <= 10; i++) f.shot({ at: i });
    expect(f.ids()).toEqual(['needle', 'needle']);
  });
});

describe('Cold Open: 5 first-bullet kills in a row', () => {
  it('awards on the fifth; a later-bullet kill or an unkilled target breaks it', () => {
    const f = new Feed('coldStart', 'coldOpen');
    for (let i = 1; i <= 4; i++) f.kill(i, true);
    f.kill(5, true);
    expect(f.ids()).toEqual(['coldOpen']);

    const g = new Feed('coldStart', 'coldOpen');
    for (let i = 1; i <= 4; i++) g.kill(i, true);
    g.kill(5, false);
    g.kill(6, true);
    expect(g.ids()).toEqual([]);

    const h = new Feed('coldStart', 'coldOpen');
    for (let i = 1; i <= 4; i++) h.kill(i, true);
    h.expire(5);
    h.kill(6, true);
    expect(h.ids()).toEqual([]);
  });
});

describe('Planted: 10 kills with no moving shot', () => {
  it('awards on the tenth kill', () => {
    const f = new Feed('stopAndPop', 'planted');
    for (let i = 1; i <= 9; i++) f.kill(i, true);
    expect(f.ids()).toEqual([]);
    f.kill(10, true);
    expect(f.ids()).toEqual(['planted']);
  });

  it('a moving shot anywhere in the streak resets it', () => {
    const f = new Feed('stopAndPop', 'planted');
    for (let i = 1; i <= 9; i++) f.kill(i, true);
    f.shot({ at: 99, zone: null, moving: true, engaged: false });
    f.kill(10, true);
    expect(f.ids()).toEqual([]);
    for (let i = 11; i <= 19; i++) f.kill(i, true);
    expect(f.ids()).toEqual(['planted']);
  });
});

describe('Hairline: a headshot within 0.15 degrees of the head centre', () => {
  it('awards at 0.149 and 0.15, not at 0.16', () => {
    for (const [deg, expected] of [[0, true], [0.149, true], [0.1499, true], [0.16, false], [0.4, false]] as const) {
      const f = new Feed('coldStart', 'hairline');
      f.shot({ headDeg: deg });
      expect(f.ids(), `${deg}`).toEqual(expected ? ['hairline'] : []);
    }
  });

  it('needs a head hit on the target the aim was nearest, in Cold Start or Orbit', () => {
    const body = new Feed('orbit', 'hairline');
    body.shot({ zone: 'body', headDeg: 0 });
    expect(body.ids()).toEqual([]);
    const sweep = new Feed('sweep', 'hairline');
    sweep.shot({ headDeg: 0 });
    expect(sweep.ids()).toEqual([]);
  });
});

describe('Metronome: 6 kills at an even rhythm', () => {
  const killsAt = (f: Feed, secs: number[]): void => {
    let prev = 0;
    secs.forEach((s, i) => {
      f.advance(secondsToTicks(s - prev));
      prev = s;
      f.kill(i + 1, true);
    });
  };

  it('awards for gaps within 12% of each other', () => {
    const f = new Feed('coldStart', 'metronome');
    killsAt(f, [1, 2, 3.1, 4.0, 5.0, 6.1]);
    expect(f.ids()).toEqual(['metronome']);
  });

  it('does not for one gap 20% off, and slides past an early outlier', () => {
    const f = new Feed('coldStart', 'metronome');
    killsAt(f, [1, 2, 3, 4, 5, 6.3]);
    expect(f.ids()).toEqual([]);
    const g = new Feed('coldStart', 'metronome');
    killsAt(g, [1, 4, 5, 6, 7, 8, 9]); // the long first gap leaves the window of six kills
    expect(g.ids()).toEqual(['metronome']);
  });
});

describe('Pendulum: 85% on target for 4 seconds (Strafe Track)', () => {
  /** On target for `onSec` of every 4 s window: off for the first `4 - onSec`, then on. */
  const run = (onSec: number, mode = 'strafeTrack'): MedalId[] => {
    const f = new Feed(mode, 'pendulum');
    f.aim(false);
    const off = 4 - onSec;
    f.advance(secondsToTicks(off));
    f.aim(true);
    for (let i = 0; i < secondsToTicks(onSec); i++) f.advance(1);
    return f.ids();
  };

  it('awards at 3.5 s of 4 (87.5%) and not at 3.3 s (82.5%)', () => {
    expect(run(3.5)).toEqual(['pendulum']);
    expect(run(3.3)).toEqual([]);
  });

  it('counts only in Strafe Track', () => {
    expect(run(3.9, 'orbit')).toEqual([]);
  });

  it('needs a full window inside the run, and a fresh one for the next award', () => {
    const f = new Feed('strafeTrack', 'pendulum');
    f.aim(true);
    for (let i = 0; i < secondsToTicks(3.5); i++) f.advance(1);
    expect(f.ids()).toEqual([]); // only 3.5 s of the run has passed: no full window yet
    for (let i = 0; i < secondsToTicks(0.6); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum']);
    for (let i = 0; i < secondsToTicks(3.8); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum']); // still on, but the next window is not full yet
    for (let i = 0; i < secondsToTicks(0.3); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum', 'pendulum']);
  });

  it('a gap in the middle that costs more than 15% of the window prevents it', () => {
    const f = new Feed('strafeTrack', 'pendulum');
    f.aim(true);
    f.advance(secondsToTicks(1.7));
    f.aim(false);
    f.advance(secondsToTicks(0.7)); // 0.7 s off = 17.5% of 4 s
    f.aim(true);
    f.advance(secondsToTicks(1.6));
    expect(f.ids()).toEqual([]);
  });
});

describe('Thread: a full spray, every bullet after the 3rd in the body or head', () => {
  const spray = (n: number, landed: (i: number) => boolean, mode = 'sprayWall'): MedalId[] => {
    const f = new Feed(mode, 'thread');
    for (let i = 0; i < n; i++) f.shot({ idx: i, zone: landed(i) ? (i % 2 ? 'head' : 'body') : null, engaged: false, at: 1 });
    return f.ids();
  };

  it('awards when a 20-bullet spray lands every bullet after the 3rd', () => {
    expect(spray(25, () => true)).toEqual(['thread']);
    expect(spray(25, (i) => i >= 3)).toEqual(['thread']); // the first three may go anywhere
  });

  it('a miss on the 4th bullet, or a leg hit, breaks it; a short spray is not full', () => {
    expect(spray(25, (i) => i !== 3)).toEqual([]);
    expect(spray(25, (i) => i !== 17)).toEqual([]);
    expect(spray(19, () => true)).toEqual([]);
    const legs = new Feed('sprayWall', 'thread');
    for (let i = 0; i < 25; i++) legs.shot({ idx: i, zone: i === 10 ? 'leg' : 'body' });
    expect(legs.ids()).toEqual([]);
  });

  it('counts only in Spray Wall, and the next spray starts afresh', () => {
    expect(spray(25, () => true, 'sweep')).toEqual([]);
    const f = new Feed('sprayWall', 'thread');
    for (let i = 0; i < 25; i++) f.shot({ idx: i, zone: i === 8 ? null : 'body', engaged: false });
    for (let i = 0; i < 25; i++) f.shot({ idx: i, zone: 'body' });
    expect(f.ids()).toEqual(['thread']);
  });
});

describe('Clean Corner: 5 angles cleared with no damage', () => {
  it('counts only undamaged clears, in Corner Clear or Sweep', () => {
    const f = new Feed('cornerClear', 'cleanCorner');
    for (let i = 0; i < 4; i++) f.contact({});
    f.contact({ kept: 0.9 }); // cleared but hurt
    f.contact({ outcome: 'disengaged' });
    expect(f.ids()).toEqual([]);
    f.contact({});
    expect(f.ids()).toEqual(['cleanCorner']);
    const o = new Feed('orbit', 'cleanCorner');
    for (let i = 0; i < 5; i++) o.contact({});
    expect(o.ids()).toEqual([]);
  });
});

describe('Untouched: a Sweep contact of 3+ enemies cleared without damage', () => {
  it('awards for 3 enemies untouched; not for 2, damage, or leaving', () => {
    for (const [c, expected] of [
      [{ enemies: 3 }, true], [{ enemies: 4, kept: 1 }, true],
      [{ enemies: 2 }, false], [{ enemies: 3, kept: 0.95 }, false], [{ enemies: 3, outcome: 'disengaged' as const }, false],
    ] as const) {
      const f = new Feed('sweep', 'untouched');
      f.contact(c);
      expect(f.ids(), JSON.stringify(c)).toEqual(expected ? ['untouched'] : []);
    }
    const o = new Feed('cornerClear', 'untouched');
    o.contact({ enemies: 3 });
    expect(o.ids()).toEqual([]);
  });
});

const run: EndOfRunInput = {
  mode: 'orbit', fullRun: true, hits: 40, misses: 0, movingShots: 0,
  medianRtMs: 500, timedTargets: 30, previousMedianRtMs: [600, 610, 590, 600, 605, 595],
};

describe('Flawless: no miss and no moving shot in a full run', () => {
  it('awards, and a single miss or moving shot, a quit or a thin run does not', () => {
    expect(endOfRunMedals(run)).toContain('flawless');
    expect(endOfRunMedals({ ...run, misses: 1 })).not.toContain('flawless');
    expect(endOfRunMedals({ ...run, movingShots: 1 })).not.toContain('flawless');
    expect(endOfRunMedals({ ...run, fullRun: false })).not.toContain('flawless');
    expect(endOfRunMedals({ ...run, hits: 9 })).not.toContain('flawless');
  });
});

describe('Quick Study: median time to shot 10% under your 20-run median', () => {
  const prev = (v: number, n = 20): number[] => Array.from({ length: n }, () => v);

  it('awards at 10% under, not at 9%', () => {
    expect(endOfRunMedals({ ...run, medianRtMs: 539, previousMedianRtMs: prev(600) })).toContain('quickStudy');
    expect(endOfRunMedals({ ...run, medianRtMs: 546, previousMedianRtMs: prev(600) })).not.toContain('quickStudy');
    expect(endOfRunMedals({ ...run, medianRtMs: 540, previousMedianRtMs: prev(600) })).not.toContain('quickStudy'); // exactly 10% is not "lower by 10%"
  });

  it('uses the last 20 runs only, needs a baseline and a real sample', () => {
    // the 30 old slow runs fall out of the 20-run window
    const history = [...prev(900, 30), ...prev(600, 20)];
    expect(endOfRunMedals({ ...run, medianRtMs: 700, previousMedianRtMs: history })).not.toContain('quickStudy');
    expect(endOfRunMedals({ ...run, medianRtMs: 500, previousMedianRtMs: prev(600, 4) })).not.toContain('quickStudy');
    expect(endOfRunMedals({ ...run, medianRtMs: 500, timedTargets: 7 })).not.toContain('quickStudy');
    expect(endOfRunMedals({ ...run, medianRtMs: null })).not.toContain('quickStudy');
  });
});

describe('replay', () => {
  it('a recorded log awards what the live engine did', () => {
    const f = new Feed('coldStart');
    const events: LoggedEvent[] = [{ type: 'runStarted', data: { tick: 100 } }];
    for (let i = 1; i <= 5; i++) {
      const shotId = i;
      events.push(
        { type: 'shotFired', data: { tick: 100 + i, shotId, moving: false, recoilIndex: 0, dir: { x: 0, y: 0, z: -1 }, yaw: 0, pitch: 0, aimTargetId: i, aimErr: 0, aimDYaw: 0, aimDPitch: 0 } as never },
        { type: 'shotImpact', data: { tick: 100 + i, shotId, result: 'hit', targetId: i, zone: 'head' } as never },
      );
      f.shot({ at: i });
    }
    const log: RunLog = { mode: 'coldStart', seed: 1, dial: 50, events, truncated: false };
    const replayed = medalsOfLog(log, cfg, 1).map((a) => a.id);
    expect(replayed).toEqual(f.ids());
    expect(replayed).toContain('needle');
    expect(replayed).toContain('hairline');
  });
});
