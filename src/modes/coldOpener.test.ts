import { describe, expect, it } from 'vitest';
import { coldOpener } from '../config/coldOpener';
import { COLD_POOL } from '../config/coldOpenerPool';
import { cloneTunables, tunables } from '../config/tunables';
import { coldItemStats, coldLegs, coldLevelFor, firstColdLevel, isColdOpenerDue, pickColdOpener } from './coldOpener';
import { sweepCatalog } from './sweep';
import { entryEye } from './sweepDirector';
import { mirroredMap } from '../sim/mapMirror';
import { MAPS } from '../sim/mapLoader';
import { sectorSources } from './sweepCatalog';

const HOUR = 3_600_000;

describe('isColdOpenerDue', () => {
  const now = 1_800_000_000_000;
  it('is due with no earlier run, or after 8 hours away, and not before', () => {
    expect(isColdOpenerDue(null, now)).toBe(true);
    expect(isColdOpenerDue(Number.NaN, now)).toBe(true);
    expect(isColdOpenerDue(now - 8 * HOUR + 1, now)).toBe(false);
    expect(isColdOpenerDue(now - 8 * HOUR, now)).toBe(true);
    expect(isColdOpenerDue(now - 30 * 60_000, now)).toBe(false);
  });
  it('takes the gap from the config, or an override', () => {
    expect(tunables.coldOpener.gapHours).toBe(8);
    expect(isColdOpenerDue(now - 5 * HOUR, now, 4)).toBe(true);
    expect(isColdOpenerDue(now - 5 * HOUR, now, 6)).toBe(false);
  });
  it('a last run in the future (the clock moved back) is not a gap', () => {
    expect(isColdOpenerDue(now + HOUR, now)).toBe(false);
  });
});

describe('levels', () => {
  it('at or below: the highest level not above the dial; the lowest below every level', () => {
    expect(coldLevelFor(44.9)).toBe(30);
    expect(coldLevelFor(45)).toBe(45);
    expect(coldLevelFor(3)).toBe(15);
    expect(coldLevelFor(100)).toBe(90);
  });
  it('nearest: the closest level, a tie to the easier one', () => {
    expect(coldLevelFor(52, undefined, 'nearest')).toBe(45);
    expect(coldLevelFor(53, undefined, 'nearest')).toBe(60);
    expect(coldLevelFor(37.5, undefined, 'nearest')).toBe(30);
  });
  it('the first level sits under the matched dial (rating − s·logit(0.7) ≈ rating − 7.6)', () => {
    expect(firstColdLevel(52.7)).toBe(45);
    expect(firstColdLevel(52.6)).toBe(30);
    expect(firstColdLevel(10)).toBe(15);
  });
});

describe('pickColdOpener', () => {
  it('plays one stored contact per slot, exactly half of them mirrored', () => {
    const p = pickColdOpener(1234, 45);
    expect(p.legs).toHaveLength(coldOpener.slots.length);
    expect(new Set(p.legs.map((l) => l.slot)).size).toBe(coldOpener.slots.length);
    expect(p.legs.filter((l) => l.mirrored)).toHaveLength(Math.floor(coldOpener.slots.length / 2));
    for (const l of p.legs) expect(l.contact).toBe(COLD_POOL[45]!.slots[l.slot]![l.variant]);
    expect(p.profile).toBe(COLD_POOL[45]!.profile);
  });

  it('is a function of the seed and level', () => {
    expect(pickColdOpener(77, 60)).toEqual(pickColdOpener(77, 60));
  });

  it('two days at the same level differ in order and mirroring, with identical item statistics (#209)', () => {
    for (const level of coldOpener.levels) {
      for (let d = 0; d < 20; d++) {
        const a = pickColdOpener(0x1000 + d, level);
        const b = pickColdOpener(0x2000 + d * 7, level);
        expect(coldItemStats(a)).toEqual(coldItemStats(b));
      }
    }
    let orderDiffers = 0, mirrorDiffers = 0, contentDiffers = 0;
    for (let d = 0; d < 30; d++) {
      const a = pickColdOpener(500 + d, 45), b = pickColdOpener(501 + d, 45);
      if (a.legs.map((l) => l.slot).join() !== b.legs.map((l) => l.slot).join()) orderDiffers++;
      if (a.legs.map((l) => l.mirrored).join() !== b.legs.map((l) => l.mirrored).join()) mirrorDiffers++;
      if (a.legs.map((l) => `${l.slot}.${l.variant}`).sort().join() !== b.legs.map((l) => `${l.slot}.${l.variant}`).sort().join()) contentDiffers++;
    }
    // Days rarely repeat (an order repeats 1 time in 720, a mirroring 1 in 20).
    expect(orderDiffers).toBeGreaterThanOrEqual(27);
    expect(mirrorDiffers).toBeGreaterThanOrEqual(24);
    expect(contentDiffers).toBeGreaterThanOrEqual(25);
  });

  it('never plays the same sector twice in a row when the pool allows it', () => {
    for (const level of coldOpener.levels) {
      for (let seed = 1; seed <= 200; seed++) {
        const legs = pickColdOpener(seed, level).legs;
        const counts = new Map<string, number>();
        for (const l of legs) counts.set(l.contact.sector, (counts.get(l.contact.sector) ?? 0) + 1);
        if (Math.max(...counts.values()) > Math.ceil(legs.length / 2)) continue; // no order can avoid a repeat
        for (let i = 1; i < legs.length; i++) expect(legs[i]!.contact.sector, `seed ${seed} level ${level}`).not.toBe(legs[i - 1]!.contact.sector);
      }
    }
  });

  it('throws for a level the pool does not have', () => {
    expect(() => pickColdOpener(1, 50)).toThrow(/no pool/);
  });
});

describe('coldLegs', () => {
  const t = cloneTunables();
  const catalog = sweepCatalog(t);

  it('plays each leg in its own take sector, mirrored legs on the mirrored map', () => {
    const pick = pickColdOpener(99, 30);
    const legs = coldLegs(pick, catalog);
    expect(legs).toHaveLength(pick.legs.length);
    legs.forEach((sp, i) => {
      const leg = pick.legs[i]!;
      expect(sp.mapId).toBe(leg.mirrored ? `${leg.contact.map}~m` : leg.contact.map);
      expect(sp.sectorId).toBe(leg.contact.sector);
      expect(sp.contacts).toHaveLength(1);
      expect(sp.contacts[0]!.card).toBe(leg.contact.card);
      expect(sp.contacts[0]!.index).toBe(i);
      const e = sp.contacts[0]!.echoes[0]!;
      const stored = leg.contact.echoes[0]!;
      expect(e.feet.x).toBe(leg.mirrored ? -stored.feet[0] : stored.feet[0]);
      expect(e.feet.z).toBe(stored.feet[2]);
    });
  });

  it('a mirrored leg keeps every Echo hidden from the mirrored entry, as the stored one is from the original', () => {
    const t2 = cloneTunables();
    for (const level of [15, 60]) {
      for (let seed = 1; seed < 6; seed++) {
        const pick = pickColdOpener(seed, level);
        const legs = coldLegs(pick, catalog);
        legs.forEach((sp, i) => {
          if (!pick.legs[i]!.mirrored) return;
          const src = sectorSources(mirroredMap(MAPS[pick.legs[i]!.contact.map]!), t2).find((s) => s.id === sp.sectorId)!;
          expect(src.entry).toEqual(sp.entry);
          const eye = entryEye(src, t2.movement);
          for (const e of sp.contacts[0]!.echoes) {
            expect(src.visible(eye, e.feet, e.crouched)).toBe(false);
            if (e.laneA && e.laneB) {
              expect(src.visible(eye, e.laneA, e.crouched)).toBe(false);
              expect(src.visible(eye, e.laneB, e.crouched)).toBe(false);
            }
          }
        });
      }
    }
  });
});
