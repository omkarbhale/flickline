import { describe, expect, it } from 'vitest';
import { DEG2RAD } from '../core/math';
import { TICK_RATE } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import type { WeaponId } from '../config/weapon';
import type { Expectation } from '../sim/enemyTiming';
import type { RunEvents } from '../sim/runEvents';
import type { SimEvents } from '../sim/types';
import type { LoggedEvent, RunLog } from './eventLog';
import { buildFights, FightLedger } from './fightLedger';

type All = SimEvents & RunEvents;

/** Seconds to the tick of a synthetic log. */
const T = (sec: number): number => Math.round(sec * TICK_RATE);

/**
 * A hand-written log: one method per event, with the payload fields the ledger reads and neutral defaults for the rest.
 * Events are appended in call order; `at` is in seconds.
 */
class L {
  events: LoggedEvent[] = [];
  private shot = 0;

  add<K extends keyof All>(type: K, data: All[K]): this {
    this.events.push({ type, data } as LoggedEvent);
    return this;
  }

  seen(at: number, id: number, p: { preAimDeg?: number; initiator?: 'player' | 'enemy'; dYawDeg?: number; dPitchDeg?: number } = {}): this {
    return this.add('targetVisible', {
      tick: T(at), t: at, targetId: id, preAim: (p.preAimDeg ?? 10) * DEG2RAD, dYaw: (p.dYawDeg ?? 10) * DEG2RAD,
      dPitch: (p.dPitchDeg ?? 0) * DEG2RAD, initiator: p.initiator ?? 'player',
    });
  }

  enemySaw(at: number, id: number, initiator: 'player' | 'enemy' = 'enemy'): this {
    return this.add('enemySawPlayer', { tick: T(at), t: at, targetId: id, initiator });
  }

  perceiverSaw(at: number, id: number, contact: Expectation = 'unaware', distance = 15): this {
    return this.add('perceiverSaw', { tick: T(at), t: at, id, contact, inAttention: true, visibleMask: 1, distance });
  }

  perceiverLost(at: number, id: number): this {
    return this.add('perceiverLostSight', { tick: T(at), t: at, id });
  }

  heard(at: number, id: number, distance = 20, kind: 'enemyFootstep' | 'enemyLanded' | 'enemyReloadStarted' = 'enemyFootstep', audible = true): this {
    return this.add(kind, { tick: T(at), t: at, id, pos: vec3(), distance, audibleToPlayer: audible });
  }

  tell(at: number, id: number, ms = 200): this {
    return this.add('enemyTell', { tick: T(at), id, durationMs: ms });
  }

  enemyFired(at: number, id: number, hit = true, audible = true): this {
    return this.add('enemyFired', { tick: T(at), id, hit, dir: vec3(0, 0, -1), audibleToPlayer: audible });
  }

  playerStep(at: number, walking = false): this {
    return this.add('footstep', { tick: T(at), crouching: false, walking });
  }

  /**
   * A shot. `aim` is the angle from the view ray to the head centre (degrees; the enemy is at +yaw), `aimOff` the angle from the aim ray
   * (before spread) to the head: default = the view ray itself, i.e. `aim`. `target` -1 = no enemy near.
   */
  fire(at: number, p: { target?: number; aimDeg?: number; aimRayErrDeg?: number; moving?: boolean; weapon?: WeaponId; x?: number; z?: number } = {}): this {
    const target = p.target ?? -1;
    const aim = (p.aimDeg ?? 0) * DEG2RAD;
    // View: yaw 0, pitch 0, the head is `aim` to the left (yaw +). The aim ray is `aimRayErrDeg` from the head, measured on the same axis.
    const rayErr = p.aimRayErrDeg ?? p.aimDeg ?? 0;
    const aimDir: Vec3 = directionFromAngles(vec3(), (aim - rayErr * DEG2RAD), 0);
    return this.add('shotFired', {
      tick: T(at), t: at, shotId: ++this.shot, weapon: p.weapon ?? 'pace', origin: vec3(p.x ?? 0, 1.6, p.z ?? 0), dir: aimDir, aimDir,
      moving: p.moving ?? false, speed: p.moving ? 4 : 0, airborne: false, crouching: false, spreadDeg: 0.3, recoilIndex: 0,
      recoilPitchDeg: 0, recoilYawDeg: 0, ammo: 20, yaw: 0, pitch: 0, aimTargetId: target, aimErr: aim, aimDYaw: aim, aimDPitch: 0,
    });
  }

  /** The impact of the latest shot. */
  impact(at: number, p: { target?: number; hit?: boolean; distance?: number } = {}): this {
    const hit = p.hit ?? (p.target ?? -1) >= 0;
    return this.add('shotImpact', {
      tick: T(at), t: at, shotId: this.shot, result: hit ? 'hit' : 'miss', targetId: p.target ?? -1, zone: hit ? 'body' : null,
      damage: hit ? 40 : 0, killed: false, point: vec3(), normal: vec3(0, 1, 0), onTarget: hit, distance: p.distance ?? 15,
    });
  }

  kill(at: number, id: number): this {
    return this.add('targetKilled', {
      tick: T(at), t: at, targetId: id, kind: 'peeker', zone: 'head', point: vec3(), distance: 15, ttkMs: 0, rtMs: 300,
      firstBullet: true, bullets: 1, shield: 0, clean: true,
    });
  }

  expire(at: number, id: number): this {
    return this.add('targetExpired', { tick: T(at), t: at, targetId: id, kind: 'peeker' });
  }

  hurt(at: number, source: number, p: { amount?: number; hp?: number; exposedTo?: number; x?: number; z?: number; killed?: boolean; distance?: number } = {}): this {
    return this.add('playerDamaged', {
      tick: T(at), t: at, amount: p.amount ?? 20, absorbed: 0, hp: p.hp ?? 80, maxHp: 100, shield: 0, maxShield: 0, zone: 'body',
      dir: vec3(0, 0, -1), yaw: 0, sourceId: source, killed: p.killed ?? false, exposedTo: p.exposedTo ?? 1,
      x: p.x ?? 0, z: p.z ?? 0, distance: p.distance ?? 15,
    });
  }

  aim(at: number, id: number, on: boolean): this {
    return this.add('aimOnTarget', { tick: T(at), on, id });
  }

  settle(at: number, p: { contactId?: number; card?: string; outcome?: RunEvents['contactSettled']['outcome'] } = {}): this {
    return this.add('contactSettled', {
      tick: T(at), t: at, contactId: p.contactId ?? 0, outcome: p.outcome ?? 'cleared', kept: 1, enemies: 1, points: 0, card: p.card,
    });
  }

  reloadStart(at: number, sec = 2): this {
    return this.add('reloadStarted', { tick: T(at), weapon: 'pace', durationSec: sec });
  }

  slowed(at: number, ms = 500): this {
    return this.add('playerSlowed', { tick: T(at), t: at, factor: 0.5, durationMs: ms });
  }

  log(): RunLog {
    return { mode: 'sweep', seed: 1, dial: 50, events: this.events, truncated: false };
  }
}

const own = (): FightLedger => new FightLedger();
const build = (l: L): FightLedger => buildFights(l.log(), own());

describe('contacts (§3.1)', () => {
  it('opens at the first information and closes when every enemy in it is dead', () => {
    const f = build(new L().heard(1, 7).seen(2, 7).fire(2.3, { target: 7 }).impact(2.3, { target: 7 }).kill(2.3, 7));
    expect(f.contactCount).toBe(1);
    const c = f.contacts[0]!;
    expect(c.startTick).toBe(T(1));
    expect(c.endTick).toBe(T(2.3));
    expect(c.end).toBe('cleared');
    expect(c.enemies).toBe(1);
    expect(c.kills).toBe(1);
    expect(f.duelCount).toBe(1);
    expect(f.duels[0]!.end).toBe('killed');
  });

  it('keeps a contact open across a re-peek inside the 2 s no-contact rule', () => {
    const l = new L().seen(1, 7).enemySaw(1.1, 7).perceiverLost(1.5, 7).perceiverSaw(3.2, 7).kill(3.5, 7);
    const f = build(l);
    expect(f.contactCount).toBe(1);
    expect(f.contacts[0]!.end).toBe('cleared');
    // 1.7 s of broken sight: longer than the 1 s duel rule, shorter than the 2 s contact rule: one contact, two duels of the same enemy.
    expect(f.contacts[0]!.duelCount).toBe(2);
    expect(f.duels[0]!.end).toBe('broken');
    expect(f.duels[1]!.prevDuel).toBe(0);
  });

  it('ends a contact 2 s after the last sight and starts the next one separately', () => {
    const l = new L().seen(1, 7).tell(1.5, 7).seen(6, 8).fire(6.2, { target: 8 }).impact(6.2, { target: 8 }).kill(6.2, 8);
    const f = build(l);
    expect(f.contactCount).toBe(2);
    const [a, b] = [f.contacts[0]!, f.contacts[1]!];
    expect(a.end).toBe('lost');
    expect(a.endTick).toBe(T(1.5)); // at the last sight, not 2 s after it
    expect(a.alive).toBe(1);
    expect(b.end).toBe('cleared');
    expect(b.firstDuel).toBe(1);
    expect(f.duels[a.firstDuel]!.end).toBe('lost');
  });

  it('a contact opened by a sound alone closes 2 s later when nobody sees anybody', () => {
    const f = build(new L().heard(1, 7).seen(10, 9));
    expect(f.contactCount).toBe(2);
    expect(f.contacts[0]!.end).toBe('lost');
    expect(f.contacts[0]!.endTick).toBe(T(1));
    expect(f.duels[0]!.playerSaw).toBe(false);
  });

  it('holds a contact open while an enemy mind sees the player or the aim ray is on an enemy', () => {
    const f1 = build(new L().perceiverSaw(1, 7).perceiverLost(6, 7).seen(9, 9));
    expect(f1.contactCount).toBe(2);
    expect(f1.contacts[0]!.endTick).toBe(T(6));
    const f2 = build(new L().seen(1, 7).aim(1.1, 7, true).aim(5, 7, false).seen(5.5, 7));
    expect(f2.contactCount).toBe(1);
  });

  it('keeps two enemies in one contact until both are dead', () => {
    const l = new L().seen(1, 7).seen(1.2, 8).kill(1.5, 7).kill(2.5, 8);
    const f = build(l);
    expect(f.contactCount).toBe(1);
    expect(f.contacts[0]!.enemies).toBe(2);
    expect(f.contacts[0]!.endTick).toBe(T(2.5));
    expect(f.contacts[0]!.kills).toBe(2);
    expect(f.contacts[0]!.duelCount).toBe(2);
  });

  it('closes the contact at the player\'s death and at the end of the run, and ends open duels', () => {
    const l = new L().seen(1, 7).hurt(1.5, 7, { hp: 0, killed: true });
    l.add('playerDied', { tick: T(1.5), t: 1.5, sourceId: 7 });
    const f = build(l);
    expect(f.contacts[0]!.end).toBe('died');
    expect(f.duels[0]!.end).toBe('died');
    const g = build(new L().seen(1, 7).add('runEnded', { tick: T(3), t: 3, reason: 'timer' }));
    expect(g.contacts[0]!.end).toBe('runEnded');
    expect(g.contacts[0]!.endTick).toBe(T(3));
    const h = build(new L().seen(1, 7));
    expect(h.contacts[0]!.end).toBe('runEnded');
  });

  it('counts an enemy that expired as gone', () => {
    const f = build(new L().seen(1, 7).expire(2, 7));
    expect(f.contacts[0]!.end).toBe('cleared');
    expect(f.duels[0]!.end).toBe('expired');
    expect(f.contacts[0]!.kills).toBe(0);
  });

  it('ignores sounds the player could not hear', () => {
    const f = build(new L().heard(1, 7, 90, 'enemyFootstep', false));
    expect(f.contactCount).toBe(0);
  });

  it('records the sector a contact happened in', () => {
    const l = new L();
    l.add('sectorEntered', {
      tick: T(0), t: 0, sectorId: 's', mapId: 'm', index: 3, opener: false, of: 5, role: 'take', condition: 'full', stake: 'plain', arms: '',
      dial: 50, depth: 1, contacts: 1, echoes: 1,
    });
    l.seen(1, 7);
    expect(build(l).contacts[0]!.sector).toBe(3);
    expect(build(new L().seen(1, 7)).contacts[0]!.sector).toBe(-1);
  });
});

describe('duels (§3.1)', () => {
  it('keeps one duel while an enemy keeps shooting at the player, even with more than a second between its shots', () => {
    const f = build(new L().enemyFired(1, 7).hurt(1, 7).enemyFired(2.4, 7).hurt(2.4, 7).enemyFired(3.8, 7).hurt(3.8, 7));
    expect(f.contactCount).toBe(1);
    expect(f.duelCount).toBe(1);
    expect(f.duels[0]!.damageCount).toBe(3);
  });
  it('splits the duel when the line of sight is broken for more than a second with nothing to hold it', () => {
    const f = build(new L().seen(1, 7).aim(1.1, 7, true).aim(1.3, 7, false).seen(2.6, 7));
    expect(f.duelCount).toBe(2);
    expect(f.duels[0]!.end).toBe('broken');
    expect(f.contactCount).toBe(1);
  });
});

describe('F1 who perceived whom first, and how', () => {
  it('names the channel the player learned of the enemy by, and who saw first', () => {
    const l = new L().heard(1, 7, 20, 'enemyLanded').seen(2, 7).enemySaw(2.25, 7);
    const d = build(l).duels[0]!;
    expect(d.playerChannel).toBe('landing');
    expect(d.playerInfoTick).toBe(T(1));
    expect(d.playerSawTick).toBe(T(2));
    expect(d.enemySawTick).toBe(T(2.25));
    expect(d.firstSaw).toBe('player');
    expect(d.sightLeadSec).toBeCloseTo(0.25, 5);
  });

  it('reads the enemy side from its mind: channel, expectation, attention', () => {
    const l = new L().add('perceiverHeard', { tick: T(1), t: 1, id: 7, sound: 'footstep', x: 0, y: 0, z: 0, errorM: 2, distance: 12 })
      .perceiverSaw(1.6, 7, 'prepared').seen(1.7, 7);
    const d = build(l).duels[0]!;
    expect(d.enemyChannel).toBe('sound');
    expect(d.enemyInfoTick).toBe(T(1));
    expect(d.enemySawTick).toBe(T(1.6));
    expect(d.enemyContact).toBe('prepared');
    expect(d.enemyInAttention).toBe(true);
    expect(d.firstSaw).toBe('enemy');
    expect(d.sightLeadSec).toBeCloseTo(-0.1, 1);
  });

  it('marks a shared sighting as the enemy channel and says who saw when only one side did', () => {
    const l = new L().add('perceiverGotShared', { tick: T(1), t: 1, id: 7, fromId: 3, x: 0, y: 0, z: 0, delaySec: 0.3, adopted: true });
    const a = build(l).duels[0]!;
    expect(a.enemyChannel).toBe('shared');
    expect(a.firstSaw).toBe('none');
    expect(a.sightLeadSec).toBeNaN();
    const b = build(new L().seen(1, 7)).duels[0]!;
    expect(b.firstSaw).toBe('player');
    expect(b.sightLeadSec).toBe(Infinity);
    const c = build(new L().enemySaw(1, 7)).duels[0]!;
    expect(c.firstSaw).toBe('enemy');
    expect(c.sightLeadSec).toBe(-Infinity);
  });

  it('says "same" when both saw on one tick', () => {
    expect(build(new L().seen(1, 7).enemySaw(1, 7)).duels[0]!.firstSaw).toBe('same');
  });
});

describe('F2 information lead and time to shot', () => {
  it('measures how long the player knew before seeing, and from sight to the first shot', () => {
    const l = new L().heard(1, 7).seen(1.5, 7).fire(1.9, { target: 7, aimDeg: 2 }).impact(1.9, { target: 7 }).kill(1.9, 7);
    const d = build(l).duels[0]!;
    expect(d.infoLeadSec).toBeCloseTo(0.5, 5);
    expect(d.timeToShotSec).toBeCloseTo(0.4, 2);
    expect(d.firstShotTick).toBe(T(1.9));
  });
  it('has no time to shot without a shot and no info lead when the sight was the first information', () => {
    const d = build(new L().seen(1, 7).tell(1.2, 7)).duels[0]!;
    expect(d.timeToShotSec).toBeNaN();
    expect(d.infoLeadSec).toBe(0);
  });
});

describe('F3 pre-aim error at first sight', () => {
  it('copies the pre-aim angle and its yaw and pitch parts in degrees', () => {
    const d = build(new L().seen(1, 7, { preAimDeg: 12, dYawDeg: 9, dPitchDeg: -8 })).duels[0]!;
    expect(d.preAimDeg).toBeCloseTo(12, 5);
    expect(d.preAimYawDeg).toBeCloseTo(9, 5);
    expect(d.preAimPitchDeg).toBeCloseTo(-8, 5);
  });
  it('is NaN when the player never saw it', () => {
    expect(build(new L().enemySaw(1, 7)).duels[0]!.preAimDeg).toBeNaN();
  });
});

describe('F4 moving when firing', () => {
  it('counts the shots at the enemy and the moving ones, and whether the first one was moving', () => {
    const l = new L().seen(1, 7)
      .fire(1.3, { target: 7, aimDeg: 1, moving: true }).impact(1.3, { hit: false })
      .fire(1.4, { target: 7, aimDeg: 1 }).impact(1.4, { target: 7 })
      .fire(1.5, { target: 7, aimDeg: 1, moving: true }).impact(1.5, { target: 7 });
    const d = build(l).duels[0]!;
    expect(d.shots).toBe(3);
    expect(d.movingShots).toBe(2);
    expect(d.firstShotMoving).toBe(true);
  });
  it('does not count a shot aimed at nobody near', () => {
    const d = build(new L().seen(1, 7).fire(1.3, { target: 7, aimDeg: 30, aimRayErrDeg: 30 })).duels[0]!;
    expect(d.shots).toBe(0);
  });
});

describe('F5 exposure to several enemies', () => {
  it('splits two enemies\' damage and marks the one the player was not aiming at as off-target', () => {
    const l = new L().seen(1, 7).seen(1.1, 8).aim(1.2, 7, true)
      .hurt(1.4, 7, { amount: 20, hp: 80, exposedTo: 2 })
      .hurt(1.5, 8, { amount: 30, hp: 50, exposedTo: 2 });
    const f = build(l);
    const [a, b] = [f.duels[0]!, f.duels[1]!];
    expect(f.contacts[0]!.hpLost).toBe(50);
    expect(f.damageCount).toBe(2);
    expect(f.damages[0]!.duel).toBe(0);
    expect(f.damages[1]!.duel).toBe(1);
    expect(f.damages[0]!.offTarget).toBe(false);
    expect(f.damages[1]!.offTarget).toBe(true);
    expect(f.damages[1]!.aimedId).toBe(7);
    expect(a.offTargetDamage).toBe(0);
    expect(b.offTargetDamage).toBe(30);
    expect(b.offTargetHits).toBe(1);
    expect(a.maxExposed).toBe(2);
    expect(f.contacts[0]!.maxExposed).toBe(2);
    expect(a.hpLost).toBe(20);
    expect(b.hpLost).toBe(30);
    expect(f.contacts[0]!.damageCount).toBe(2);
  });

  it('knows the aim target from a recent shot within 5° when no aim-on edge is open, and forgets it after the memory', () => {
    const l = new L().seen(1, 7).seen(1.1, 8).fire(1.2, { target: 7, aimDeg: 4 }).hurt(1.4, 8, { exposedTo: 2 }).hurt(2.5, 8, { exposedTo: 2 });
    const f = build(l);
    expect(f.damages[0]!.offTarget).toBe(true);
    expect(f.damages[1]!.aimedId).toBe(-1);
    expect(f.damages[1]!.offTarget).toBe(false);
  });

  it('damage from the enemy being aimed at is on-target', () => {
    const l = new L().seen(1, 7).aim(1.1, 7, true).hurt(1.3, 7);
    expect(build(l).damages[0]!.offTarget).toBe(false);
  });
});

describe('F6 angle advantage', () => {
  it('records who created the first line of sight, from whichever side saw first', () => {
    expect(build(new L().seen(1, 7, { initiator: 'player' })).duels[0]!.initiator).toBe('player');
    expect(build(new L().seen(1, 7, { initiator: 'enemy' })).duels[0]!.initiator).toBe('enemy');
    expect(build(new L().enemySaw(1, 7, 'player').seen(1.1, 7, { initiator: 'enemy' })).duels[0]!.initiator).toBe('player');
    expect(build(new L().tell(1, 7)).duels[0]!.initiator).toBe('none');
  });
});

describe('F7 distance against weapon role', () => {
  it('takes the impact distance of a first shot that hit, and is out of role when the first-shot cone exceeds the head', () => {
    const near = build(new L().seen(1, 7).fire(1.2, { target: 7, aimDeg: 1, weapon: 'pace' }).impact(1.2, { target: 7, distance: 8 }).kill(1.2, 7)).duels[0]!;
    expect(near.distanceM).toBe(8);
    expect(near.distanceFromShot).toBe(true);
    expect(near.weapon).toBe('pace');
    expect(near.outOfRole).toBe(false);
    expect(near.headHitProb).toBe(1);
    const far = build(new L().seen(1, 7).fire(1.2, { target: 7, aimDeg: 1, weapon: 'pace' }).impact(1.2, { target: 7, distance: 50 }).kill(1.2, 7)).duels[0]!;
    expect(far.outOfRole).toBe(true);
    expect(far.headHitProb).toBeLessThan(0.5);
  });
  it('falls back to the nearest known distance when the first shot missed', () => {
    const d = build(new L().heard(1, 7, 33).seen(1.4, 7).fire(1.6, { target: 7, aimDeg: 1 }).impact(1.6, { hit: false, distance: 5 })).duels[0]!;
    expect(d.distanceM).toBe(33);
    expect(d.distanceFromShot).toBe(false);
  });
});

describe('F8 shots against the ideal', () => {
  it('tells a spread miss (the aim ray was on the head, the bullet was not) from an aim miss (the aim ray was off)', () => {
    const l = new L().seen(1, 7)
      // Aim ray on the head (0.5° off), the bullet missed: spread miss.
      .fire(1.2, { target: 7, aimDeg: 3, aimRayErrDeg: 0.5 }).impact(1.2, { hit: false })
      // Aim ray 6° off the head: aim miss.
      .fire(1.3, { target: 7, aimDeg: 7, aimRayErrDeg: 6 }).impact(1.3, { hit: false })
      // And a hit.
      .fire(1.4, { target: 7, aimDeg: 1, aimRayErrDeg: 0.2 }).impact(1.4, { target: 7 });
    const d = build(l).duels[0]!;
    expect(d.spreadMissShots).toBe(1);
    expect(d.aimMissShots).toBe(1);
    expect(d.hitShots).toBe(1);
    expect(d.shots).toBe(3);
    expect(d.firstShotClass).toBe('spreadMiss');
    expect(d.firstShotAimErrDeg).toBeCloseTo(0.5, 3);
  });

  it('classifies a first shot that was off by a flick as an aim miss, with its error', () => {
    const d = build(new L().seen(1, 7).fire(1.2, { target: 7, aimDeg: 5, aimRayErrDeg: 5 }).impact(1.2, { hit: false })).duels[0]!;
    expect(d.firstShotClass).toBe('aimMiss');
    expect(d.firstShotAimErrDeg).toBeCloseTo(5, 3);
  });

  it('turns the provisional miss into a hit when the impact lands on the enemy', () => {
    const d = build(new L().seen(1, 7).fire(1.2, { target: 7, aimDeg: 1, aimRayErrDeg: 0.3 }).impact(1.2, { target: 7 })).duels[0]!;
    expect(d.hitShots).toBe(1);
    expect(d.spreadMissShots).toBe(0);
    expect(d.aimMissShots).toBe(0);
    expect(d.firstShotClass).toBe('hit');
  });

  it('credits a bullet that hit an enemy the player was aiming past to that enemy, and counts the miss on the aimed one', () => {
    const l = new L().seen(1, 7).seen(1.1, 8)
      .fire(1.3, { target: 7, aimDeg: 4, aimRayErrDeg: 4 }).impact(1.3, { target: 8 });
    const f = build(l);
    expect(f.duels[0]!.aimMissShots).toBe(1);
    expect(f.duels[1]!.hitShots).toBe(1);
    expect(f.duels[1]!.shots).toBe(1);
  });
});

describe('F9 time available before damage', () => {
  it('is the time from first sight to the first hit on the player, and from the tell', () => {
    const l = new L().seen(1, 7).tell(1.1, 7, 300).enemyFired(1.5, 7).hurt(1.5, 7);
    const d = build(l).duels[0]!;
    expect(d.firstDamageTick).toBe(T(1.5));
    expect(d.windowSec).toBeCloseTo(0.5, 5);
    expect(d.windowFromTellSec).toBeCloseTo(0.4, 1);
    expect(d.tellMs).toBe(300);
    expect(d.playerSaw).toBe(true);
  });

  it('is negative when the player never saw the shooter, and negative-infinite as a number it cannot be', () => {
    const l = new L().hurt(2, 7, { exposedTo: 1 });
    const f = build(l);
    const d = f.duels[0]!;
    expect(d.playerSaw).toBe(false);
    expect(d.playerChannel).toBe('damage');
    expect(d.windowSec).toBeLessThan(0);
    expect(d.windowSec).toBe(-Infinity);
    expect(f.damages[0]!.duel).toBe(0);
  });

  it('is negative when the player only saw the enemy after it hurt him', () => {
    const l = new L().hurt(2, 7).seen(2.4, 7);
    const d = build(l).duels[0]!;
    expect(d.playerSaw).toBe(true);
    expect(d.windowSec).toBeCloseTo(-0.4, 1);
  });

  it('is NaN when the enemy never hurt the player', () => {
    expect(build(new L().seen(1, 7)).duels[0]!.windowSec).toBeNaN();
  });
});

describe('F10 the enemy\'s side', () => {
  it('counts its shots and hits, its tell and the first shot', () => {
    const l = new L().seen(1, 7).tell(1.2, 7, 250).enemyFired(1.5, 7, true).enemyFired(1.6, 7, false).hurt(1.5, 7);
    const d = build(l).duels[0]!;
    expect(d.enemyShots).toBe(2);
    expect(d.enemyHits).toBe(1);
    expect(d.enemyFirstShotTick).toBe(T(1.5));
    expect(d.tellTick).toBe(T(1.2));
  });
  it('treats a shot the player could hear as information', () => {
    expect(build(new L().enemyFired(1.5, 7, true, true)).duels[0]!.playerChannel).toBe('shot');
    expect(build(new L().enemyFired(1.5, 7, true, false)).duels[0]!.playerChannel).toBe('none');
  });
});

describe('F11 the player\'s state', () => {
  it('records HP at the duel start, reloading at the enemy\'s first sight and at damage, tagged shots and running footsteps', () => {
    const l = new L().hurt(0.5, 3, { hp: 60 })
      .playerStep(1.0).playerStep(1.3).playerStep(1.6, true).playerStep(1.8)
      .reloadStart(1.9, 2)
      .seen(2.0, 7).enemySaw(2.1, 7).hurt(2.3, 7, { hp: 40 })
      .slowed(2.3, 600).fire(2.5, { target: 7, aimDeg: 1 }).impact(2.5, { hit: false });
    const f = build(l);
    const d = f.duels[f.duelCount - 1]!;
    expect(d.enemyId).toBe(7);
    expect(d.hpAtStart).toBe(60);
    expect(d.reloadingAtEnemySaw).toBe(true);
    expect(d.reloadingAtDamage).toBe(true);
    expect(d.footstepsBefore).toBe(3); // the silent walk step is not counted
    expect(d.taggedShots).toBe(1);
  });
  it('is not reloading after the reload completed and has no HP before any is logged', () => {
    const l = new L().reloadStart(1, 1).add('reloadCompleted', { tick: T(2), weapon: 'pace', ammo: 20, reserve: 40 }).seen(3, 7).enemySaw(3, 7);
    const d = build(l).duels[0]!;
    expect(d.reloadingAtEnemySaw).toBe(false);
    expect(d.hpAtStart).toBeNaN();
  });
});

describe('F12 repetition and trades', () => {
  const peek = (gap: number, x2: number): L => new L()
    .seen(1, 7).fire(1.1, { target: 7, aimDeg: 1, x: 5, z: 2 }).impact(1.1, { hit: false })
    .perceiverSaw(1.2, 7).perceiverLost(1.5, 7)
    .perceiverSaw(1.5 + gap, 7).fire(1.6 + gap, { target: 7, aimDeg: 1, x: x2, z: 2 }).impact(1.6 + gap, { hit: false });

  it('flags the same peek: the same enemy re-exposed from within 1 m within 4 s of breaking sight', () => {
    const f = build(peek(1.5, 5.4));
    expect(f.duelCount).toBe(2);
    expect(f.duels[1]!.samePeek).toBe(true);
    expect(f.duels[0]!.samePeek).toBe(false);
  });

  it('is not the same peek from another spot, nor after more than 4 s', () => {
    expect(build(peek(1.5, 7)).duels[1]!.samePeek).toBe(false);
    const late = build(peek(4.5, 5));
    expect(late.contactCount).toBe(2); // beyond the 2 s contact rule too
    expect(late.duels[1]!.prevDuel).toBe(0);
    expect(late.duels[1]!.samePeek).toBe(false);
  });

  it('finds a same peek across the contact boundary (2 to 4 s)', () => {
    const f = build(peek(3, 5));
    expect(f.contactCount).toBe(2);
    expect(f.duels[1]!.samePeek).toBe(true);
  });

  it('is not a same peek when the first duel ended in the enemy\'s death', () => {
    const l = new L().seen(1, 7).fire(1.1, { target: 7, aimDeg: 1 }).impact(1.1, { target: 7 }).kill(1.1, 7);
    expect(build(l).duels.slice(0, 1).every((d) => !d.samePeek)).toBe(true);
  });

  it('flags a trade: hit within 3 s of a kill while still at the kill spot', () => {
    const l = new L().seen(1, 7).perceiverSaw(1.1, 8)
      .fire(1.5, { target: 7, aimDeg: 1, x: 4, z: 4 }).impact(1.5, { target: 7 }).kill(1.5, 7)
      .enemyFired(2.8, 8).hurt(2.8, 8, { x: 4.3, z: 4 });
    const f = build(l);
    expect(f.damages[0]!.trade).toBe(true);
    expect(f.duels[1]!.trade).toBe(true);
    expect(f.duels[0]!.trade).toBe(false);
  });

  it('is not a trade past 3 s, from another spot, or from the enemy that was just killed', () => {
    const base = (hurtAt: number, x: number): L => new L().seen(1, 7).seen(1.1, 8)
      .fire(1.5, { target: 7, aimDeg: 1, x: 4, z: 4 }).impact(1.5, { target: 7 }).kill(1.5, 7).seen(1.6, 8)
      .tell(hurtAt - 0.1, 8).hurt(hurtAt, 8, { x, z: 4 });
    expect(build(base(4.6, 4)).damages[0]!.trade).toBe(false); // 3.1 s after the kill
    expect(build(base(2.5, 6)).damages[0]!.trade).toBe(false); // moved 2 m
    expect(build(base(2.5, 4)).damages[0]!.trade).toBe(true);
  });
});

describe('the scenario card (#97)', () => {
  it('attaches the card of the settle that ends the contact', () => {
    const l = new L().seen(1, 7).fire(1.2, { target: 7, aimDeg: 1 }).impact(1.2, { target: 7 }).kill(1.2, 7).settle(1.2, { contactId: 4, card: 'take-held', outcome: 'cleared' });
    const c = build(l).contacts[0]!;
    expect(c.card).toBe('take-held');
    expect(c.contactId).toBe(4);
    expect(c.settledOutcome).toBe('cleared');
  });
  it('attaches the card to an open contact, and handles an absent card and a missing settle', () => {
    const open = build(new L().seen(1, 7).settle(1.5, { card: 'meet' })).contacts[0]!;
    expect(open.card).toBe('meet');
    const none = build(new L().seen(1, 7).kill(1.2, 7).settle(1.3, { contactId: 2 })).contacts[0]!;
    expect(none.card).toBe('');
    expect(none.contactId).toBe(2);
    const missing = build(new L().seen(1, 7).kill(1.2, 7)).contacts[0]!;
    expect(missing.card).toBe('');
    expect(missing.contactId).toBe(-1);
    expect(missing.settledOutcome).toBe('');
  });
  it('does not attach a settle that came long after the contact ended, nor a second settle', () => {
    const l = new L().seen(1, 7).kill(1.2, 7).settle(30, { card: 'x' });
    expect(build(l).contacts[0]!.card).toBe('');
    const two = new L().seen(1, 7).settle(1.3, { card: 'a', contactId: 1 }).settle(1.4, { card: 'b', contactId: 2 });
    expect(build(two).contacts[0]!.card).toBe('a');
  });
  it('gives each of two contacts its own card', () => {
    const l = new L().seen(1, 7).kill(1.2, 7).settle(1.2, { card: 'a', contactId: 0 })
      .seen(8, 9).kill(8.4, 9).settle(8.4, { card: 'b', contactId: 1 });
    const f = build(l);
    expect(f.contacts[0]!.card).toBe('a');
    expect(f.contacts[1]!.card).toBe('b');
  });
});

describe('purity, determinism and reuse', () => {
  const sample = (): L => new L().heard(1, 7).seen(1.5, 7).enemySaw(1.6, 7).fire(1.8, { target: 7, aimDeg: 2 }).impact(1.8, { hit: false })
    .hurt(2, 7, { hp: 70 }).fire(2.1, { target: 7, aimDeg: 1 }).impact(2.1, { target: 7 }).kill(2.1, 7).settle(2.1, { card: 'c' });

  it('returns the same records for the same log and does not touch the log', () => {
    const log = sample().log();
    const before = JSON.stringify(log.events);
    const a = JSON.stringify(buildFights(log, own()));
    const b = JSON.stringify(buildFights(log, own()));
    expect(a).toBe(b);
    expect(JSON.stringify(log.events)).toBe(before);
  });

  it('rebuilding the same log into the same ledger gives identical records', () => {
    const log = sample().log();
    const f = own();
    const first = JSON.stringify(buildFights(log, f));
    buildFights(new L().seen(1, 7).seen(2, 7).log(), f); // a different run in between, reusing enemy 7
    expect(JSON.stringify(buildFights(log, f))).toBe(first);
  });

  it('refills one ledger: a second build leaves nothing of the first behind', () => {
    const f = own();
    buildFights(new L().seen(1, 7).hurt(1.2, 7).seen(8, 9).log(), f);
    expect(f.contactCount).toBe(2);
    expect(f.damageCount).toBe(1);
    buildFights(new L().seen(1, 5).log(), f);
    expect(f.contactCount).toBe(1);
    expect(f.duelCount).toBe(1);
    expect(f.damageCount).toBe(0);
    expect(f.duels[0]!.enemyId).toBe(5);
    expect(f.duels[0]!.hpLost).toBe(0);
    expect(f.contacts[0]!.card).toBe('');
    buildFights({ mode: 'x', seed: 1, dial: 1, events: [], truncated: true }, f);
    expect(f.contactCount).toBe(0);
    expect(f.truncated).toBe(true);
  });

  it('the default call reuses one module ledger', () => {
    const a = buildFights(sample().log());
    const b = buildFights(new L().log());
    expect(a).toBe(b);
    expect(b.contactCount).toBe(0);
  });

  it('copes with an empty log and with damage that has no source', () => {
    expect(build(new L()).contactCount).toBe(0);
    const f = build(new L().hurt(1, -1, { amount: 5 }));
    expect(f.contactCount).toBe(1);
    expect(f.duels[0]!.enemyId).toBe(-1);
    expect(f.contacts[0]!.hpLost).toBe(5);
  });

  it('flags an overflow instead of allocating when a capacity is exceeded', () => {
    const l = new L();
    for (let i = 0; i < 600; i++) l.seen(i * 5, i);
    const f = build(l);
    expect(f.overflow).toBe(true);
    expect(f.duelCount).toBe(512);
  });
});

describe('speed and allocation on a 5-minute Sweep log', () => {
  /** About what a 5-minute Sweep logs: 22 contacts of 1–4 enemies, footsteps, samples, shots, damage. */
  function sweepLog(): RunLog {
    const l = new L();
    let id = 0;
    for (let s = 0; s < 300; s += 0.125) l.add('headHeightSampled', { tick: T(s), err: 0.01 });
    for (let s = 0; s < 300; s += 0.35) l.playerStep(s);
    for (let c = 0; c < 22; c++) {
      const t0 = 5 + c * 13;
      const n = 1 + (c % 4);
      for (let k = 0; k < n; k++) {
        const e = id++;
        const t = t0 + k * 0.4;
        l.heard(t - 0.5, e, 20).seen(t, e).perceiverSaw(t + 0.1, e, 'attending').aim(t + 0.15, e, true).tell(t + 0.3, e);
        for (let i = 0; i < 4; i++) l.fire(t + 0.35 + i * 0.1, { target: e, aimDeg: 2, aimRayErrDeg: i % 2 === 0 ? 0.4 : 4 }).impact(t + 0.35 + i * 0.1, { target: i === 3 ? e : -1 });
        l.enemyFired(t + 0.6, e).hurt(t + 0.6, e, { exposedTo: n }).aim(t + 0.9, e, false).kill(t + 1, e);
        for (let i = 0; i < 40; i++) l.heard(t + 0.01 * i, e, 20, 'enemyFootstep', i % 3 === 0);
      }
      l.settle(t0 + 3, { contactId: c, card: 'take-held' });
    }
    // Events are logged in time order.
    l.events.sort((a, b) => (a.data as { tick: number }).tick - (b.data as { tick: number }).tick);
    return l.log();
  }

  it('builds in well under the 2 ms budget (generous bound here; the PR reports the real number)', () => {
    const log = sweepLog();
    const f = own();
    for (let i = 0; i < 50; i++) buildFights(log, f); // warm up
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      buildFights(log, f);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(f.contactCount).toBe(22);
    // The median, so a loaded CI machine's GC pause does not fail it.
    expect(times[100]!).toBeLessThan(2);
  });

  it('allocates nothing per event in steady state', () => {
    const log = sweepLog();
    const f = own();
    for (let i = 0; i < 100; i++) buildFights(log, f);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300; i++) buildFights(log, f);
    const grown = process.memoryUsage().heapUsed - before;
    // 300 builds x ~9k events: even a 16-byte allocation per event would be ~40 MB.
    expect(grown).toBeLessThan(8 * 1024 * 1024);
  });
});
