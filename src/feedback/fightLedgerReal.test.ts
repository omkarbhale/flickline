import { describe, expect, it } from 'vitest';
import { HeadlessGame } from '../debug/bot/headless';
import { playMode } from '../debug/bot/play';
import { buildFights, FightLedger } from './fightLedger';

/**
 * The ledger against real Sweep runs (#201): the bot plays seeded runs through the real sim, and the ledger built from
 * the run's own event log is checked against facts the log states outright (kills, damage taken, the settled cards).
 */
describe('the fight ledger matches real Sweep runs', () => {
  for (const [skill, seed] of [[30, 6], [50, 4], [70, 5]] as const) {
    it(`skill ${skill}, seed ${seed}`, () => {
      const g = new HeadlessGame({ seed });
      const report = playMode(g, { mode: 'sweep', skill, seed, pinDial: 50 });
      expect(report.finished).toBe(true);
      const log = g.run.log;
      const f = buildFights(log, new FightLedger());

      let kills = 0, damage = 0, settled = 0, cards = 0;
      for (const ev of log.events) {
        if (ev.type === 'targetKilled') kills++;
        else if (ev.type === 'playerDamaged') damage += ev.data.amount;
        else if (ev.type === 'contactSettled') { settled++; if (ev.data.card) cards++; }
      }
      expect(kills).toBeGreaterThan(0);
      expect(f.overflow).toBe(false);
      expect(f.contactCount).toBeGreaterThan(0);

      // Every kill and every point of damage is in exactly one duel / damage instance.
      let duelKills = 0, duelHp = 0, contactHp = 0, contactKills = 0, dmgHp = 0, duels = 0, dmgs = 0;
      for (let i = 0; i < f.duelCount; i++) { duelKills += f.duels[i]!.killedByPlayer ? 1 : 0; duelHp += f.duels[i]!.hpLost; }
      for (let i = 0; i < f.damageCount; i++) dmgHp += f.damages[i]!.amount;
      let prevEnd = -1;
      for (let i = 0; i < f.contactCount; i++) {
        const c = f.contacts[i]!;
        contactHp += c.hpLost; contactKills += c.kills; duels += c.duelCount; dmgs += c.damageCount;
        expect(c.end).not.toBe('open');
        expect(c.endTick).toBeGreaterThanOrEqual(c.startTick);
        expect(c.startTick).toBeGreaterThanOrEqual(prevEnd); // contacts never overlap
        prevEnd = c.endTick;
        expect(c.firstDuel + c.duelCount).toBeLessThanOrEqual(f.duelCount);
        for (let d = c.firstDuel; d < c.firstDuel + c.duelCount; d++) expect(f.duels[d]!.contact).toBe(c.index);
      }
      expect(duelKills).toBe(kills);
      expect(contactKills).toBe(kills);
      expect(duels).toBe(f.duelCount);
      expect(dmgs).toBe(f.damageCount);
      expect(duelHp).toBeCloseTo(damage, 6);
      expect(contactHp).toBeCloseTo(damage, 6);
      expect(dmgHp).toBeCloseTo(damage, 6);
      // Every duel is over and consistent in itself.
      for (let i = 0; i < f.duelCount; i++) {
        const d = f.duels[i]!;
        expect(d.end).not.toBe('open');
        expect(d.endTick).toBeGreaterThanOrEqual(d.startTick);
        expect(d.hitShots + d.aimMissShots + d.spreadMissShots).toBe(d.shots);
        if (d.firstDamageTick >= 0) expect(d.windowSec).not.toBeNaN();
      }
      // Cards come from the settles: no more than they named, and a settle always names one in Sweep.
      let withCard = 0;
      for (let i = 0; i < f.contactCount; i++) if (f.contacts[i]!.card !== '') withCard++;
      expect(withCard).toBeLessThanOrEqual(cards);
      expect(settled).toBeGreaterThanOrEqual(cards);
    });
  }
});
