import { Rng } from '../core/rng';
import { vec3 } from '../core/vec3';
import type { ContactOutcome } from '../feedback/runStory';

/**
 * A seeded scripted Sweep run in the event vocabulary of design §14.3 (sectors, contacts with their card, kills,
 * misses, damage and healing), for tests and for the `results.demo` debug command: it lets the results card be
 * driven and looked at without a playthrough. Pure and deterministic: the same seed gives the same events.
 * Returns the events (`runReady` ... `runEnded`) and what a correct card must say about them, counted here
 * independently of the card's own code.
 */

export type Ev = { type: string; data: Record<string, unknown> };

const ROLES = ['take', 'hold', 'meet'] as const;
const CONDS = ['full', 'full', 'light', 'eco'] as const;
const STAKES = ['plain', 'shield', 'arms', 'hot'] as const;
const CARDS = ['take-expected', 'take-unaware', 'clear', 'crossfire', 'hold'] as const;

/** What the scripted run says should be on the card, counted independently of the tracker. */
export interface Expect {
  sectors: { role: string; won: number; lost: number; avoided: number; kills: number; hpIn: number; hpOut: number; flawless: boolean }[];
  cards: Record<string, { played: number; won: number; lost: number }>;
  kills: number;
}

/**
 * A seeded scripted Sweep run in the vocabulary of design §14.3: sectors with contacts, kills, misses and damage.
 * Returns the event list and what the card must say about it.
 */
export function scriptedRun(seed: number, sectorCount: number, endReason: string, tickOffset = 0, damageScale = 1): { events: Ev[]; expect: Expect } {
  const rng = new Rng(seed);
  const events: Ev[] = [];
  const exp: Expect = { sectors: [], cards: {}, kills: 0 };
  let tick = tickOffset;
  let hp = 100;
  let targetId = 0;
  let shotId = 0;
  let contactId = 0;
  const push = (type: string, data: Record<string, unknown>): void => void events.push({ type, data: { tick, t: tick / 128, ...data } });

  const fire = (moving: boolean): void =>
    push('shotFired', {
      shotId: ++shotId, weapon: 'kestrel', origin: vec3(), dir: vec3(0, 0, -1), aimDir: vec3(0, 0, -1), yaw: 0, pitch: 0, moving, speed: 0,
      airborne: false, crouching: false, spreadDeg: 0, recoilIndex: 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: -1,
      aimTargetId: -1, aimErr: 0, aimDYaw: 0, aimDPitch: 0,
    });
  const impact = (result: 'hit' | 'miss', id: number): void =>
    push('shotImpact', {
      shotId, result, onTarget: id >= 0, targetId: id, zone: id >= 0 ? 'body' : null, damage: id >= 0 ? 150 : 0, killed: id >= 0,
      point: vec3(), normal: vec3(), distance: 10,
    });

  const hurt = (before: number, after: number): void =>
    push('playerDamaged', {
      amount: before - after, absorbed: 0, hp: after, maxHp: 100, shield: 0, maxShield: 0, zone: 'body', dir: vec3(0, 0, -1), yaw: 0,
      sourceId: -1, killed: after === 0, exposedTo: 1,
    });

  push('runReady', { mode: 'sweep', seed, dial: 50 });
  push('runStarted', {});
  for (let s = 0; s < sectorCount; s++) {
    tick += 100;
    const role = ROLES[rng.int(ROLES.length)]!;
    push('sectorEntered', {
      sectorId: `sector-${s}`, index: s, of: sectorCount, role, condition: CONDS[rng.int(CONDS.length)]!, stake: STAKES[rng.int(STAKES.length)]!, dial: 50,
    });
    const tile = { role, won: 0, lost: 0, avoided: 0, kills: 0, hpIn: hp, hpOut: hp, flawless: false };
    let shots = 0;
    let bad = 0;
    const contacts = 1 + rng.int(3);
    for (let c = 0; c < contacts && hp > 0; c++) {
      const card = CARDS[rng.int(CARDS.length)]!;
      const enemies = 1 + rng.int(2);
      let damaged = 0;
      for (let e = 0; e < enemies; e++) {
        tick += 30;
        const id = ++targetId;
        // 0-2 missed or moving shots, then a killing shot.
        const extra = rng.int(3);
        for (let k = 0; k < extra; k++) {
          tick += 8;
          const moving = rng.next() < 0.4;
          fire(moving);
          impact('miss', -1);
          shots++;
          bad++; // a miss, or a moving shot: either way the sector is not Flawless
        }
        tick += 8;
        fire(false);
        impact('hit', id);
        shots++;
        push('targetKilled', { targetId: id, kind: 'peeker', zone: 'body', point: vec3(), distance: 10, ttkMs: 100, rtMs: 300, firstBullet: true, bullets: 1, shield: 0, clean: true });
        tile.kills++;
        exp.kills++;
        if (rng.next() < 0.5) {
          const dmg = Math.round((5 + rng.int(30)) * damageScale);
          const before = hp;
          hp = Math.max(0, hp - dmg);
          damaged += before - hp;
          hurt(before, hp);
        }
        if (hp === 0) break;
      }
      const died = hp === 0;
      const outcome: ContactOutcome = died ? 'died' : damaged >= 30 ? 'disengaged' : 'cleared';
      push('contactSettled', { contactId: ++contactId, outcome, kept: hp / 100, enemies, points: 100, card });
      const won = outcome === 'cleared';
      const lost = outcome === 'died' || outcome === 'disengaged';
      if (won) tile.won++;
      else if (lost) tile.lost++;
      const row = (exp.cards[card] ??= { played: 0, won: 0, lost: 0 });
      row.played++;
      if (won) row.won++;
      if (lost) row.lost++;
      if (hp > 0 && rng.next() < 0.3) {
        const before = hp;
        hp = Math.min(100, hp + 5);
        push('playerHealed', { amount: hp - before, hp, maxHp: 100, source: 'kill' });
      }
    }
    tile.hpOut = hp;
    tile.flawless = shots > 0 && bad === 0;
    exp.sectors.push(tile);
    const fellHere = endReason === 'death' && (hp === 0 || s === sectorCount - 1);
    if (!fellHere) push('sectorEnded', { sectorId: `sector-${s}`, cleared: true, keptSector: 1, tempo: false, points: 250, reason: 'exit' });
    if (hp === 0) break;
  }
  tick += 20;
  if (endReason === 'death' && hp > 0) {
    // The run is scripted to end in a death: the last blow lands in the sector the run ended in.
    hurt(hp, 0);
    hp = 0;
    exp.sectors[exp.sectors.length - 1]!.hpOut = 0;
  }
  push('runEnded', { reason: endReason });
  return { events, expect: exp };
}

