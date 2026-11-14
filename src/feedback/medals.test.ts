import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../core/math';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, vec3 } from '../core/vec3';
import { medals as cfg, MEDAL_IDS, type MedalId } from '../config/medals';
import { bulletAngleToHeadDeg, endOfRunMedals, MedalEngine, medalsOfLog, type EndOfRunInput, type TargetMotion } from './medals';
import type { LoggedEvent, RunLog } from './eventLog';

const FINALE = 6;

/** Drives an engine with hand-built events and records awards. Echoes in `moving` move, those in `strafing` strafe. */
class Feed {
  awards: { id: MedalId; tick: number }[] = [];
  readonly moving = new Set<number>();
  readonly strafing = new Set<number>();
  readonly motion: TargetMotion = {
    speed: (id) => (this.moving.has(id) || this.strafing.has(id) ? 3 : 0),
    strafing: (id) => this.strafing.has(id),
  };
  readonly engine = new MedalEngine((id, tick) => this.awards.push({ id, tick }), cfg, 1, FINALE, this.motion);
  tick = 100;
  private shotId = 0;

  /** `focus`: report only this medal (the others fire on the same hand-built events). */
  constructor(private readonly focus: MedalId | null = null) {
    this.engine.begin('sweep');
    this.engine.observe('runStarted', { tick: this.tick });
  }

  ids(): MedalId[] {
    return this.awards.filter((a) => this.focus === null || a.id === this.focus).map((a) => a.id);
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

  aim(on: boolean, id = 1): void {
    this.engine.observe('aimOnTarget', { tick: this.tick, on, id: on ? id : -1 });
  }

  contact(o: { outcome?: 'cleared' | 'disengaged' | 'avoided' | 'died'; kept?: number; enemies?: number }): void {
    this.engine.observe('contactSettled', { tick: this.tick, outcome: o.outcome ?? 'cleared', kept: o.kept ?? 1, enemies: o.enemies ?? 1 });
  }

  /** Sector `n` (1-based, as the design numbers them); the event carries it 0-based. */
  enter(n: number): void {
    this.engine.observe('sectorEntered', { tick: this.tick, index: n - 1 });
  }

  end(cleared = true): void {
    this.engine.observe('sectorEnded', { tick: this.tick, cleared });
  }

  banked(points: number, overtimeSectors: number): void {
    this.engine.observe('runBanked', { tick: this.tick, points, overtimeSectors });
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
});

describe('Needle: 5 first-bullet headshots in a row', () => {
  it('awards on the fifth', () => {
    const f = new Feed('needle');
    for (let i = 1; i <= 4; i++) f.shot({ at: i });
    expect(f.ids()).toEqual([]);
    f.shot({ at: 5 });
    expect(f.ids()).toEqual(['needle']);
  });

  it('a body hit, a miss or a second bullet at the same target breaks it', () => {
    for (const breaker of [() => 'body', () => 'miss', () => 'again'] as const) {
      const f = new Feed('needle');
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
    const f = new Feed('needle');
    for (let i = 1; i <= 10; i++) f.shot({ at: i });
    expect(f.ids()).toEqual(['needle', 'needle']);
  });
});

describe('Cold Open: 5 first-bullet kills in a row', () => {
  it('awards on the fifth; a later-bullet kill or an unkilled target breaks it', () => {
    const f = new Feed('coldOpen');
    for (let i = 1; i <= 4; i++) f.kill(i, true);
    f.kill(5, true);
    expect(f.ids()).toEqual(['coldOpen']);

    const g = new Feed('coldOpen');
    for (let i = 1; i <= 4; i++) g.kill(i, true);
    g.kill(5, false);
    g.kill(6, true);
    expect(g.ids()).toEqual([]);

    const h = new Feed('coldOpen');
    for (let i = 1; i <= 4; i++) h.kill(i, true);
    h.expire(5);
    h.kill(6, true);
    expect(h.ids()).toEqual([]);
  });
});

describe('Planted: 10 kills in a run with no moving shot', () => {
  it('awards on the tenth kill', () => {
    const f = new Feed('planted');
    for (let i = 1; i <= 9; i++) f.kill(i, true);
    expect(f.ids()).toEqual([]);
    f.kill(10, true);
    expect(f.ids()).toEqual(['planted']);
  });

  it('a moving shot anywhere in the streak resets it', () => {
    const f = new Feed('planted');
    for (let i = 1; i <= 9; i++) f.kill(i, true);
    f.shot({ at: 99, zone: null, moving: true, engaged: false });
    f.kill(10, true);
    expect(f.ids()).toEqual([]);
    for (let i = 11; i <= 19; i++) f.kill(i, true);
    expect(f.ids()).toEqual(['planted']);
  });
});

describe('Hairline: a first-bullet headshot within 0.15 degrees of the head centre of a moving Echo', () => {
  it('awards at 0.149 and 0.15, not at 0.16', () => {
    for (const [deg, expected] of [[0, true], [0.149, true], [0.1499, true], [0.16, false], [0.4, false]] as const) {
      const f = new Feed('hairline');
      f.moving.add(1);
      f.shot({ headDeg: deg });
      expect(f.ids(), `${deg}`).toEqual(expected ? ['hairline'] : []);
    }
  });

  it('needs the Echo to be moving: the same shot at one standing still earns nothing', () => {
    const still = new Feed('hairline');
    still.shot({ headDeg: 0 });
    expect(still.ids()).toEqual([]);
    const walker = new Feed('hairline');
    walker.moving.add(1);
    walker.shot({ headDeg: 0 });
    expect(walker.ids()).toEqual(['hairline']);
    const strafer = new Feed('hairline');
    strafer.strafing.add(1);
    strafer.shot({ headDeg: 0 });
    expect(strafer.ids()).toEqual(['hairline']);
  });

  it('needs the first bullet at that Echo, and a head hit on the Echo the aim was nearest', () => {
    const second = new Feed('hairline');
    second.moving.add(1);
    second.shot({ zone: 'body', headDeg: 1 });
    second.shot({ headDeg: 0 }); // a head hit, but the second bullet at the Echo
    expect(second.ids()).toEqual([]);
    const body = new Feed('hairline');
    body.moving.add(1);
    body.shot({ zone: 'body', headDeg: 0 });
    expect(body.ids()).toEqual([]);
  });

  it('reads the Echo\'s motion when the shot leaves, so a killing shot still counts', () => {
    const f = new Feed('hairline');
    f.moving.add(1);
    f.engine.observe('shotFired', {
      tick: f.tick, shotId: 1, moving: false, recoilIndex: 0, dir: directionFromAngles(vec3(), 0, 0), yaw: 0, pitch: 0,
      aimTargetId: 1, aimErr: 0, aimDYaw: 0, aimDPitch: 0,
    });
    f.moving.delete(1); // the kill removes the Echo before the impact is heard
    f.strafing.delete(1);
    f.engine.observe('shotImpact', { tick: f.tick, shotId: 1, result: 'hit', targetId: 1, zone: 'head' });
    expect(f.ids()).toEqual(['hairline']);
  });
});

describe('Pendulum: 85% on target for 2 seconds against a strafing Echo', () => {
  /** On target for `onSec` of every 2 s window: off for the first `2 - onSec`, then on. */
  const run = (onSec: number, strafing = true): MedalId[] => {
    const f = new Feed('pendulum');
    if (strafing) f.strafing.add(1);
    f.aim(false);
    f.advance(secondsToTicks(2 - onSec));
    f.aim(true);
    for (let i = 0; i < secondsToTicks(onSec); i++) f.advance(1);
    return f.ids();
  };

  it('awards at 1.8 s of 2 (90%) and not at 1.6 s (80%)', () => {
    expect(run(1.8)).toEqual(['pendulum']);
    expect(run(1.6)).toEqual([]);
  });

  it('counts only time on a strafing Echo', () => {
    expect(run(1.95, false)).toEqual([]);
  });

  it('time on an Echo that stops to stand does not count, and counts again when it strafes on', () => {
    const f = new Feed('pendulum');
    f.strafing.add(1);
    f.aim(true);
    f.advance(secondsToTicks(1)); // 1 s on a strafing Echo
    f.strafing.delete(1);
    f.advance(secondsToTicks(0.6)); // it stands: not counted
    f.strafing.add(1);
    f.advance(secondsToTicks(0.5)); // strafing again
    expect(f.ids()).toEqual([]); // 1.5 s of 2.1 s on: under 85% of the window
    f.advance(secondsToTicks(1.5));
    expect(f.ids()).toEqual(['pendulum']);
  });

  it('needs a full window inside the run, and a fresh one for the next award', () => {
    const f = new Feed('pendulum');
    f.strafing.add(1);
    f.aim(true);
    for (let i = 0; i < secondsToTicks(1.9); i++) f.advance(1);
    expect(f.ids()).toEqual([]); // only 1.9 s of the run has passed: no full window yet
    for (let i = 0; i < secondsToTicks(0.3); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum']);
    for (let i = 0; i < secondsToTicks(1.8); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum']); // still on, but the next window is not full yet
    for (let i = 0; i < secondsToTicks(0.3); i++) f.advance(1);
    expect(f.ids()).toEqual(['pendulum', 'pendulum']);
  });

  it('a gap in the middle that costs more than 15% of the window prevents it', () => {
    const f = new Feed('pendulum');
    f.strafing.add(1);
    f.aim(true);
    f.advance(secondsToTicks(0.85));
    f.aim(false);
    f.advance(secondsToTicks(0.35)); // 0.35 s off = 17.5% of 2 s
    f.aim(true);
    f.advance(secondsToTicks(0.8));
    expect(f.ids()).toEqual([]);
  });
});

describe('Thread: a spray of 8+ bullets in a fight, every bullet after the 3rd in the body or head', () => {
  const spray = (n: number, landed: (i: number) => boolean): MedalId[] => {
    const f = new Feed('thread');
    for (let i = 0; i < n; i++) f.shot({ idx: i, zone: landed(i) ? (i % 2 ? 'head' : 'body') : null, engaged: false, at: 1 });
    return f.ids();
  };

  it('awards when an 8-bullet spray lands every bullet after the 3rd', () => {
    expect(spray(8, () => true)).toEqual(['thread']);
    expect(spray(10, (i) => i >= 3)).toEqual(['thread']); // the first three may go anywhere
  });

  it('a miss on the 4th bullet, or a leg hit, breaks it; a shorter spray is not enough', () => {
    expect(spray(10, (i) => i !== 3)).toEqual([]);
    expect(spray(10, (i) => i !== 6)).toEqual([]);
    expect(spray(7, () => true)).toEqual([]);
    const legs = new Feed('thread');
    for (let i = 0; i < 10; i++) legs.shot({ idx: i, zone: i === 5 ? 'leg' : 'body' });
    expect(legs.ids()).toEqual([]);
  });

  it('a spray belongs to one fight: the contact ending starts the next spray afresh', () => {
    const f = new Feed('thread');
    for (let i = 0; i < 5; i++) f.shot({ idx: i, zone: 'body' }); // five good bullets, then the fight ends
    f.contact({});
    for (let i = 5; i < 8; i++) f.shot({ idx: i, zone: 'body' }); // a continuing index must not complete the old spray
    expect(f.ids()).toEqual([]);
    for (let i = 0; i < 8; i++) f.shot({ idx: i, zone: 'body' });
    expect(f.ids()).toEqual(['thread']);
  });

  it('the next spray starts afresh', () => {
    const f = new Feed('thread');
    for (let i = 0; i < 10; i++) f.shot({ idx: i, zone: i === 5 ? null : 'body', engaged: false });
    for (let i = 0; i < 10; i++) f.shot({ idx: i, zone: 'body' });
    expect(f.ids()).toEqual(['thread']);
  });
});

describe('Clean Corner: 5 contacts in a run cleared with no damage', () => {
  it('counts only undamaged clears', () => {
    const f = new Feed('cleanCorner');
    for (let i = 0; i < 4; i++) f.contact({});
    f.contact({ kept: 0.9 }); // cleared but hurt
    f.contact({ outcome: 'disengaged' });
    f.contact({ outcome: 'died', kept: 1 });
    expect(f.ids()).toEqual([]);
    f.contact({});
    expect(f.ids()).toEqual(['cleanCorner']);
  });
});

describe('Untouched: a contact of 3+ Echoes cleared without damage', () => {
  it('awards for 3 enemies untouched; not for 2, damage, or leaving', () => {
    for (const [c, expected] of [
      [{ enemies: 3 }, true], [{ enemies: 4, kept: 1 }, true],
      [{ enemies: 2 }, false], [{ enemies: 3, kept: 0.95 }, false], [{ enemies: 3, outcome: 'disengaged' as const }, false],
    ] as const) {
      const f = new Feed('untouched');
      f.contact(c);
      expect(f.ids(), JSON.stringify(c)).toEqual(expected ? ['untouched'] : []);
    }
  });
});

describe('Flawless: a sector with no miss and no moving shot', () => {
  /** A cleared sector of `hits` head hits; `extra` adds one more shot before it ends. */
  const sector = (extra?: (f: Feed) => void, hits = 4, index = 1): MedalId[] => {
    const f = new Feed('flawless');
    f.enter(index);
    for (let i = 0; i < hits; i++) f.shot({ at: i + 1, zone: 'body' });
    extra?.(f);
    f.end(true);
    return f.ids();
  };

  it('awards for a cleared sector where every shot hit and none was fired moving', () => {
    expect(sector()).toEqual(['flawless']);
  });

  it('a single miss, a moving shot, a thin sector or a sector not cleared does not', () => {
    expect(sector((f) => f.shot({ zone: null, engaged: false }))).toEqual([]);
    expect(sector((f) => f.shot({ zone: 'body', moving: true }))).toEqual([]);
    expect(sector(undefined, cfg.flawlessSectorMinHits - 1)).toEqual([]);
    const f = new Feed('flawless');
    f.enter(1);
    for (let i = 0; i < 4; i++) f.shot({ at: i + 1, zone: 'body' });
    f.end(false);
    expect(f.ids()).toEqual([]);
  });

  it('is judged per sector: a miss in sector 1 does not spoil sector 2, and each flawless sector earns it', () => {
    const f = new Feed('flawless');
    f.enter(1);
    f.shot({ zone: null, engaged: false });
    for (let i = 0; i < 3; i++) f.shot({ at: i + 1, zone: 'body' });
    f.end(true);
    f.enter(2);
    for (let i = 0; i < 3; i++) f.shot({ at: i + 1, zone: 'body' });
    f.end(true);
    f.enter(3);
    for (let i = 0; i < 3; i++) f.shot({ at: i + 1, zone: 'body' });
    f.end(true);
    expect(f.ids()).toEqual(['flawless', 'flawless']);
  });

  it('the last bullet of the sector counts as a miss when it never landed', () => {
    const f = new Feed('flawless');
    f.enter(1);
    for (let i = 0; i < 4; i++) f.shot({ at: i + 1, zone: 'body' });
    // a bullet that left the range: shotFired with no impact event
    f.engine.observe('shotFired', {
      tick: f.tick, shotId: 99, moving: false, recoilIndex: 0, dir: directionFromAngles(vec3(), 0, 0), yaw: 0, pitch: 0,
      aimTargetId: -1, aimErr: 1, aimDYaw: 0, aimDPitch: 0,
    });
    f.end(true);
    expect(f.ids()).toEqual([]);
  });
});

describe('Closer: the Finale cleared', () => {
  it('awards when sector 6 ends cleared, not an earlier sector, not an uncleared Finale', () => {
    const f = new Feed('closer');
    for (let i = 1; i <= 5; i++) {
      f.enter(i);
      f.end(true);
    }
    expect(f.ids()).toEqual([]);
    f.enter(6);
    f.end(false);
    expect(f.ids()).toEqual([]);
    const g = new Feed('closer');
    g.enter(6);
    g.end(true);
    expect(g.ids()).toEqual(['closer']);
  });

  it('an Overtime sector is not the Finale', () => {
    const f = new Feed('closer');
    f.enter(7);
    f.end(true);
    expect(f.ids()).toEqual([]);
  });
});

describe('Cashed: left Overtime alive with points banked', () => {
  it('awards on a Leave gate in Overtime with points; not at the Finale\'s gate and not with nothing banked', () => {
    const a = new Feed('cashed');
    a.banked(1200, 2);
    expect(a.ids()).toEqual(['cashed']);
    const finale = new Feed('cashed');
    finale.banked(5000, 0); // left at the Finale's gate: nothing was at risk
    expect(finale.ids()).toEqual([]);
    const nothing = new Feed('cashed');
    nothing.banked(0, 1);
    expect(nothing.ids()).toEqual([]);
  });
});

describe('the medal list', () => {
  it('is the revised list of design §8.4: Closer and Cashed in, Metronome retired', () => {
    expect(MEDAL_IDS).toContain('closer');
    expect(MEDAL_IDS).toContain('cashed');
    expect(MEDAL_IDS as readonly string[]).not.toContain('metronome');
  });

  it('never awards twice for one fact: a replayed scripted run gives the same awards every time', () => {
    const play = (): MedalId[] => {
      const f = new Feed();
      f.moving.add(1);
      for (let i = 1; i <= 6; i++) {
        f.enter(i);
        for (let k = 0; k < 4; k++) f.shot({ at: 10 * i + k + 1, zone: 'body' });
        f.contact({ enemies: 3 });
        f.end(true);
      }
      f.banked(900, 1);
      return f.awards.map((a) => a.id);
    };
    const first = play();
    expect(first).toEqual(play());
    expect(first).toContain('closer');
    expect(first).toContain('cashed');
    expect(first.filter((id) => id === 'flawless')).toHaveLength(6);
    expect(first.filter((id) => id === 'untouched')).toHaveLength(6);
    expect(first.filter((id) => id === 'cleanCorner')).toHaveLength(1);
  });
});

const run: EndOfRunInput = {
  medianRtMs: 500, timedTargets: 30, previousMedianRtMs: [600, 610, 590, 600, 605, 595],
};

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
    const f = new Feed();
    f.moving.add(1);
    const events: LoggedEvent[] = [{ type: 'runStarted', data: { tick: 100 } }];
    for (let i = 1; i <= 5; i++) {
      const shotId = i;
      events.push(
        { type: 'shotFired', data: { tick: 100 + i, shotId, moving: false, recoilIndex: 0, dir: { x: 0, y: 0, z: -1 }, yaw: 0, pitch: 0, aimTargetId: i, aimErr: 0, aimDYaw: 0, aimDPitch: 0 } as never },
        { type: 'shotImpact', data: { tick: 100 + i, shotId, result: 'hit', targetId: i, zone: 'head' } as never },
      );
      f.shot({ at: i });
    }
    const log: RunLog = { mode: 'sweep', seed: 1, dial: 50, events, truncated: false };
    const replayed = medalsOfLog(log, cfg, 1, FINALE, f.motion).map((a) => a.id);
    expect(replayed).toEqual(f.ids());
    expect(replayed).toContain('needle');
    expect(replayed).toContain('hairline');
  });
});
