import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../core/math';
import { TICK_RATE } from '../core/time';
import { trials as trialCfg } from '../config/trials';
import { barAt, ContactTrials } from './contactTrials';
import type { SkillId } from './contracts';

/**
 * The trial classifier's rules (#203), each on a scripted event log: the facts a contact's fight
 * produces, in the order the sim emits them, and the trials that come out.
 */

interface Out {
  contact: number;
  skill: SkillId;
  difficulty: number;
  success: boolean;
  card: string;
  target: number;
  extra: Record<string, number>;
}

/** One scripted fact. Angles in degrees here (the classifier takes radians, as the sim emits them). */
type Fact =
  | { at: number; type: 'sighted'; id: number; preAimDeg: number; dYawDeg?: number; dPitchDeg?: number }
  | { at: number; type: 'shot'; aimId: number; aimErrDeg: number; hit?: number; zone?: 'head' | 'body' | 'leg'; moving?: boolean; aimDYawDeg?: number }
  | { at: number; type: 'aimOn'; id: number }
  | { at: number; type: 'aimOff' }
  | { at: number; type: 'killed'; id: number }
  | { at: number; type: 'settle'; contact: number; lost: boolean }
  | { at: number; type: 'sight'; id: number; on: boolean };

/** A sector with contacts and Echoes, a sight table the log can switch, and a player for the log. */
function sector(contacts: { card: string; difficulty: number; take?: boolean; echoes: { id: number; strafing?: boolean }[] }[]) {
  const out: Out[] = [];
  const sight = new Set<number>();
  const ct = new ContactTrials(
    trialCfg,
    5,
    {
      trial(contact, skill, difficulty, success, card, target, extra) {
        out.push({ contact, skill, difficulty, success, card, target, extra: { ...extra } });
      },
    },
    { inSight: (id) => sight.has(id) },
  );
  for (const c of contacts) {
    const i = ct.addContact(c.card, c.difficulty, c.take ?? true);
    for (const e of c.echoes) ct.addEcho(i, e.id, e.strafing ?? false);
  }
  let shotId = 0;
  /** Play the log; `at` is seconds; the classifier steps every tick in between, as the mode does. */
  function play(log: Fact[], untilSec?: number): void {
    const end = Math.round((untilSec ?? Math.max(0, ...log.map((f) => f.at)) + 0.01) * TICK_RATE);
    let k = 0;
    const sorted = [...log].sort((a, b) => a.at - b.at);
    for (let tick = 0; tick <= end; tick++) {
      while (k < sorted.length && Math.round(sorted[k]!.at * TICK_RATE) === tick) {
        const f = sorted[k++]!;
        switch (f.type) {
          case 'sighted':
            ct.sighted(tick, f.id, f.preAimDeg * DEG2RAD, (f.dYawDeg ?? f.preAimDeg) * DEG2RAD, (f.dPitchDeg ?? 0) * DEG2RAD);
            break;
          case 'shot':
            shotId++;
            ct.fired(tick, shotId, f.aimId, f.aimErrDeg * DEG2RAD, f.moving ?? false, (f.aimDYawDeg ?? 0) * DEG2RAD, 0);
            if (f.hit !== undefined) ct.impact(shotId, f.hit, f.hit >= 0 ? (f.zone ?? 'body') : null);
            break;
          case 'aimOn':
            ct.aimOn(true, f.id);
            break;
          case 'aimOff':
            ct.aimOn(false, -1);
            break;
          case 'killed':
            ct.killed(tick, f.id);
            break;
          case 'settle':
            ct.settle(f.contact, f.lost);
            break;
          case 'sight':
            if (f.on) sight.add(f.id);
            else sight.delete(f.id);
            break;
        }
      }
      ct.step(tick);
    }
  }
  return { ct, out, play, of: (s: SkillId) => out.filter((o) => o.skill === s) };
}

describe('precision: the first shot at an Echo seen near the crosshair (Cold Start rule)', () => {
  it('a first bullet on the head wins, on the body loses, and only the first shot counts', () => {
    const s = sector([{ card: 'take-expected', difficulty: 40, echoes: [{ id: 1 }, { id: 2 }] }]);
    s.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 1.5 },
      { at: 0.4, type: 'shot', aimId: 1, aimErrDeg: 0.3, hit: 1, zone: 'head' },
      { at: 0.5, type: 'shot', aimId: 1, aimErrDeg: 0.3, hit: 1, zone: 'body' },
      { at: 1.0, type: 'sighted', id: 2, preAimDeg: 12 },
      { at: 1.3, type: 'shot', aimId: 2, aimErrDeg: 0.8, hit: 2, zone: 'body' },
    ]);
    const p = s.of('precision');
    expect(p.map((t) => [t.target, t.success])).toEqual([[1, true], [2, false]]);
    expect(p[0]!.extra.preAimed).toBe(1); // within 2°: the pre-aimed trial type of §9.1
    expect(p[1]!.extra.preAimed).toBe(0);
    expect(p[0]!.extra.timeSec).toBeCloseTo(0.3, 2);
    expect(p[0]!.difficulty).toBe(40);
    expect(p[0]!.card).toBe('take-expected');
  });

  it('a miss aimed near it is its first shot; a miss far from it is not a shot at it', () => {
    const s = sector([{ card: 'clear', difficulty: 40, echoes: [{ id: 1 }] }]);
    s.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 6 },
      { at: 0.3, type: 'shot', aimId: 1, aimErrDeg: 9, hit: -1 }, // 9° off: not at it
      { at: 0.5, type: 'shot', aimId: 1, aimErrDeg: 1, hit: -1 }, // at it, missed
      { at: 0.6, type: 'shot', aimId: 1, aimErrDeg: 0.2, hit: 1, zone: 'head' },
    ]);
    expect(s.of('precision').map((t) => t.success)).toEqual([false]);
  });

  it('a shot into the open (no impact) is settled at the end of the tick', () => {
    const s = sector([{ card: 'clear', difficulty: 40, echoes: [{ id: 1 }] }]);
    s.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 3 },
      { at: 0.3, type: 'shot', aimId: 1, aimErrDeg: 2 },
    ]);
    expect(s.of('precision').map((t) => t.success)).toEqual([false]);
  });
});

describe('flick: the first shot at an Echo first seen more than 20° away (Orbit rule)', () => {
  it('a hit inside the feasible time wins; a slow hit or a miss loses; overshoot is signed along the flick', () => {
    const d = 50;
    const limit = (trialCfg.flick.baseSec + trialCfg.flick.perDegSec * 45) * barAt(trialCfg.flick.slack, d);
    const s = sector([{ card: 'take-unaware', difficulty: d, echoes: [{ id: 1 }, { id: 2 }, { id: 3 }] }]);
    s.play([
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 45 },
      { at: limit - 0.1, type: 'shot', aimId: 1, aimErrDeg: 0.4, hit: 1, aimDYawDeg: -0.4 }, // went 0.4° past
      { at: 2.0, type: 'sighted', id: 2, preAimDeg: 45 },
      { at: 2.0 + limit + 0.1, type: 'shot', aimId: 2, aimErrDeg: 0.4, hit: 2 },
      { at: 4.0, type: 'sighted', id: 3, preAimDeg: 30 },
      { at: 4.5, type: 'shot', aimId: 3, aimErrDeg: 2, hit: -1 },
    ]);
    const f = s.of('flick');
    expect(f.map((t) => [t.target, t.success])).toEqual([[1, true], [2, false], [3, false]]);
    expect(f[0]!.extra.overshootDeg).toBeCloseTo(0.4, 3);
    expect(f[0]!.extra.limitSec).toBeCloseTo(limit, 6);
  });

  it('the bar tightens as the dial rises', () => {
    const at = (d: number): number => (trialCfg.flick.baseSec + trialCfg.flick.perDegSec * 60) * barAt(trialCfg.flick.slack, d);
    expect(at(80)).toBeLessThan(at(20));
  });
});

describe('the first-shot item of an Echo never shot at', () => {
  it('fails when the contact was lost, and is dropped when it was not', () => {
    const lost = sector([{ card: 'take-expected', difficulty: 40, echoes: [{ id: 1 }] }]);
    lost.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 30 },
      { at: 0.8, type: 'settle', contact: 0, lost: true },
    ]);
    expect(lost.of('flick').map((t) => [t.success, t.extra.timeSec])).toEqual([[false, -1]]);

    const left = sector([{ card: 'take-expected', difficulty: 40, echoes: [{ id: 1 }] }]);
    left.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 30 },
      { at: 0.8, type: 'settle', contact: 0, lost: false },
    ]);
    expect(left.of('flick')).toEqual([]);
  });
});

describe('angles: crosshair placement at a take contact’s first sight', () => {
  it('pre-aim and head height inside the bars win, outside lose; once per contact', () => {
    const d = 50;
    const s = sector([
      { card: 'take-expected', difficulty: d, echoes: [{ id: 1 }, { id: 2 }] },
      { card: 'take-unaware', difficulty: d, echoes: [{ id: 3 }] },
      { card: 'clear', difficulty: d, echoes: [{ id: 4 }] },
    ]);
    const maxPre = barAt(trialCfg.angles.maxPreAimDeg, d);
    s.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: maxPre - 1, dPitchDeg: 0.5 },
      { at: 0.2, type: 'sighted', id: 2, preAimDeg: 40 }, // same contact: no second item
      { at: 1.0, type: 'sighted', id: 3, preAimDeg: maxPre + 1 },
      { at: 2.0, type: 'sighted', id: 4, preAimDeg: 2, dPitchDeg: barAt(trialCfg.angles.maxHeadDeg, d) + 1 },
    ]);
    expect(s.of('angles').map((t) => [t.contact, t.success])).toEqual([[0, true], [1, false], [2, false]]);
  });

  it('a take contact settled without the player ever seeing an Echo fails it; a non-take contact has none', () => {
    const s = sector([
      { card: 'take-expected', difficulty: 40, echoes: [{ id: 1 }] },
      { card: 'take-expected', difficulty: 40, take: false, echoes: [{ id: 2 }] },
    ]);
    s.play([
      { at: 0.5, type: 'settle', contact: 0, lost: true },
      { at: 0.6, type: 'sighted', id: 2, preAimDeg: 1 },
      { at: 0.7, type: 'settle', contact: 1, lost: false },
    ]);
    const a = s.of('angles');
    expect(a.map((t) => [t.contact, t.success, t.extra.seen])).toEqual([[0, false, 0]]);
  });

  it('every take contact that settles has produced at least one trial', () => {
    const s = sector([
      { card: 'take-unaware', difficulty: 30, echoes: [{ id: 1 }] },
      { card: 'clear', difficulty: 30, echoes: [{ id: 2 }] },
      { card: 'crossfire', difficulty: 30, echoes: [{ id: 3 }, { id: 4 }] },
    ]);
    s.play([
      { at: 0.1, type: 'sighted', id: 1, preAimDeg: 50 },
      { at: 0.5, type: 'settle', contact: 0, lost: false },
      { at: 1.0, type: 'settle', contact: 1, lost: false },
      { at: 2.0, type: 'settle', contact: 2, lost: true },
    ]);
    for (const c of [0, 1, 2]) expect(s.out.some((t) => t.contact === c), `contact ${c}`).toBe(true);
  });
});

describe('track: time on a strafing Echo through a duel', () => {
  const d = 50;
  const need = barAt(trialCfg.track.onTargetShare, d);

  it('aim on it for more than the bar wins; less loses; settled when it dies', () => {
    const s = sector([{ card: 'take-unaware', difficulty: d, echoes: [{ id: 1, strafing: true }, { id: 2, strafing: true }] }]);
    s.play([
      { at: 0.0, type: 'sight', id: 1, on: true },
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 10 },
      { at: 0.2, type: 'aimOn', id: 1 },
      { at: 0.2 + (need + 0.1), type: 'aimOff' }, // on for need + 0.1 of a 1 s duel
      { at: 1.0, type: 'killed', id: 1 },
      { at: 1.0, type: 'sight', id: 2, on: true },
      { at: 1.0, type: 'sighted', id: 2, preAimDeg: 10 },
      { at: 1.1, type: 'aimOn', id: 2 },
      { at: 1.1 + (need - 0.15), type: 'aimOff' },
      { at: 2.0, type: 'killed', id: 2 },
    ]);
    const t = s.of('track');
    expect(t.map((x) => [x.target, x.success])).toEqual([[1, true], [2, false]]);
    expect(t[0]!.extra.duelSec).toBeCloseTo(1, 1);
  });

  it('a short duel, a standing Echo or one out of sight gives no item', () => {
    const s = sector([{ card: 'clear', difficulty: d, echoes: [{ id: 1, strafing: true }, { id: 2, strafing: false }, { id: 3, strafing: true }] }]);
    s.play([
      { at: 0.0, type: 'sight', id: 1, on: true },
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 5 },
      { at: 0.2, type: 'killed', id: 1 }, // 0.2 s of duel: under the minimum
      { at: 0.3, type: 'sight', id: 2, on: true },
      { at: 0.3, type: 'sighted', id: 2, preAimDeg: 5 },
      { at: 1.5, type: 'killed', id: 2 }, // standing still
      { at: 1.6, type: 'sighted', id: 3, preAimDeg: 5 }, // never in mutual sight
      { at: 3.0, type: 'killed', id: 3 },
    ]);
    expect(s.of('track')).toEqual([]);
  });
});

describe('footwork: shots from a stop while an Echo has the player in sight', () => {
  it('no moving shot wins; one moving shot loses; shots while it cannot see the player do not count', () => {
    const s = sector([{ card: 'take-expected', difficulty: 40, echoes: [{ id: 1 }, { id: 2 }, { id: 3 }] }]);
    s.play([
      { at: 0.0, type: 'sight', id: 1, on: true },
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 5 },
      { at: 0.3, type: 'shot', aimId: 1, aimErrDeg: 0.5, hit: 1 },
      { at: 0.4, type: 'shot', aimId: 1, aimErrDeg: 0.5, hit: 1 },
      { at: 0.5, type: 'killed', id: 1 },
      { at: 1.0, type: 'sight', id: 2, on: true },
      { at: 1.0, type: 'sighted', id: 2, preAimDeg: 5 },
      { at: 1.3, type: 'shot', aimId: 2, aimErrDeg: 0.5, hit: 2 },
      { at: 1.4, type: 'shot', aimId: 2, aimErrDeg: 0.5, hit: 2, moving: true },
      { at: 1.5, type: 'killed', id: 2 },
      { at: 2.0, type: 'sighted', id: 3, preAimDeg: 5 }, // it never sees the player
      { at: 2.3, type: 'shot', aimId: 3, aimErrDeg: 0.5, hit: 3, moving: true },
      { at: 2.5, type: 'killed', id: 3 },
    ]);
    const f = s.of('footwork');
    expect(f.map((x) => [x.target, x.success, x.extra.shots, x.extra.movingShots])).toEqual([[1, true, 2, 0], [2, false, 2, 1]]);
  });
});

describe('spray: bursts of five bullets or more', () => {
  const d = 50;
  const burst = (start: number, hits: number, n: number, id: number): Fact[] =>
    Array.from({ length: n }, (_, i) => ({ at: start + i * 0.1, type: 'shot' as const, aimId: id, aimErrDeg: 1, hit: i < hits ? id : -1 }));

  it('a burst hitting the bar wins, under it loses; four bullets are not a spray; a gap splits bursts', () => {
    const need = barAt(trialCfg.spray.hitShare, d);
    const s = sector([{ card: 'crossfire', difficulty: d, echoes: [{ id: 1 }] }]);
    s.play([
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 3 },
      ...burst(0.2, Math.ceil(need * 6), 6, 1),
      ...burst(1.5, Math.floor(need * 6) - 1, 6, 1),
      ...burst(3.0, 4, 4, 1),
      ...burst(4.0, 3, 3, 1), // 3 then a 0.5 s gap then 3: two bursts of three
      ...burst(4.8, 3, 3, 1),
    ], 6);
    expect(s.of('spray').map((x) => [x.success, x.extra.bullets])).toEqual([[true, 6], [false, 6]]);
  });

  it('the bar rises with the dial', () => {
    expect(barAt(trialCfg.spray.hitShare, 80)).toBeGreaterThan(barAt(trialCfg.spray.hitShare, 20));
  });
});

describe('switch: from a kill to the next enemy of the contact', () => {
  const d = 50;
  const limit = barAt(trialCfg.switch.maxSec, d);

  it('a hit on the next seen Echo inside the time wins; a late or missed one loses; an unseen one starts nothing', () => {
    const s = sector([
      { card: 'crossfire', difficulty: d, echoes: [{ id: 1 }, { id: 2 }] },
      { card: 'crossfire', difficulty: d, echoes: [{ id: 3 }, { id: 4 }] },
      { card: 'crossfire', difficulty: d, echoes: [{ id: 5 }, { id: 6 }] },
    ]);
    s.play([
      { at: 0.0, type: 'sight', id: 1, on: true },
      { at: 0.0, type: 'sight', id: 2, on: true },
      { at: 0.0, type: 'sighted', id: 1, preAimDeg: 3 },
      { at: 0.0, type: 'sighted', id: 2, preAimDeg: 30 },
      { at: 0.4, type: 'killed', id: 1 },
      { at: 0.4 + limit - 0.2, type: 'shot', aimId: 2, aimErrDeg: 0.4, hit: 2 },
      // Contact 1: the next shot comes too late.
      { at: 3.0, type: 'sight', id: 3, on: true },
      { at: 3.0, type: 'sight', id: 4, on: true },
      { at: 3.0, type: 'sighted', id: 3, preAimDeg: 3 },
      { at: 3.0, type: 'sighted', id: 4, preAimDeg: 30 },
      { at: 3.4, type: 'killed', id: 3 },
      { at: 3.4 + limit + 0.3, type: 'shot', aimId: 4, aimErrDeg: 0.4, hit: 4 },
      // Contact 2: the other Echo was never seen: no item.
      { at: 6.0, type: 'sight', id: 5, on: true },
      { at: 6.0, type: 'sighted', id: 5, preAimDeg: 3 },
      { at: 6.4, type: 'killed', id: 5 },
    ], 8);
    const sw = s.of('switch');
    expect(sw.map((x) => [x.contact, x.success, x.extra.timedOut])).toEqual([[0, true, 0], [1, false, 1]]);
  });
});

describe('the classifier allocates nothing per fact', () => {
  it('reuses its extra records between trials of a skill', () => {
    const seen: Readonly<Record<string, number>>[] = [];
    const ct = new ContactTrials(trialCfg, 5, { trial: (_c, _s, _d, _ok, _card, _t, extra) => seen.push(extra) }, { inSight: () => false });
    const c = ct.addContact('clear', 40, true);
    ct.addEcho(c, 1, false);
    ct.addEcho(c, 2, false);
    ct.sighted(0, 1, 0.01, 0.01, 0);
    ct.settle(c, false);
    const c2 = ct.addContact('clear', 40, true);
    ct.addEcho(c2, 3, false);
    ct.sighted(1, 3, 0.01, 0.01, 0);
    expect(seen.length).toBe(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
