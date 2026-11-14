import { describe, expect, it } from 'vitest';
import { coldOpener } from '../config/coldOpener';
import { COLD_POOL } from '../config/coldOpenerPool';
import { cloneTunables } from '../config/tunables';
import { coldPoolSource, generateColdPool } from './coldOpenerGen';
import { sweepCatalog } from './sweep';
import { hiddenSpots } from './sweepDirector';

/** FNV-1a (32 bit) over the canonical text of the pool: any change to any number changes it. */
function hashPool(): string {
  let h = 0x811c9dc5;
  const text = JSON.stringify(COLD_POOL);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The hash of the stored pool of each cold-opener version, frozen. Changing the pool (or the maps, the
 * placement rules or the dial axes, so that it is regenerated differently) without bumping
 * `coldOpener.version` fails here; a bump needs its new hash added below. Old versions stay listed:
 * their series on the profile still refer to them (design §8.5 guards, transfer.md §5.8). Version 1 was
 * the Range item lists of the retired Daily Baseline run, never shipped as a measurement.
 */
const FROZEN: Readonly<Record<number, string>> = {
  1: '9869152a',
  2: '0ef0c25d',
};

describe('cold opener content version', () => {
  it('has a frozen hash for the current version, and the stored pool still matches it', () => {
    const expected = FROZEN[coldOpener.version];
    expect(expected, `coldOpener.version ${coldOpener.version} has no frozen hash: add it to FROZEN (the current pool hashes to ${hashPool()})`).toBeDefined();
    expect(hashPool(), 'the stored cold-opener pool changed without a coldOpener.version bump: bump it in config/coldOpener.ts and freeze the new hash').toBe(expected);
  });

  it('versions are whole numbers counting up from 1, each frozen once', () => {
    const versions = Object.keys(FROZEN).map(Number);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(Number.isInteger(coldOpener.version) && coldOpener.version >= 1).toBe(true);
  });

  it('the stored pool is what the generator writes today (maps, placement rules and dial axes unchanged)', () => {
    const t = cloneTunables();
    const pool = generateColdPool(t, sweepCatalog(t));
    expect(pool, 'the pool the generator writes today differs from config/coldOpenerPool.ts: run npm run cold:pool and bump coldOpener.version').toEqual(COLD_POOL);
    expect(coldPoolSource(pool, t)).toContain('export const COLD_POOL');
  });
});

describe('the pool', () => {
  const t = cloneTunables();
  const catalog = sweepCatalog(t);

  it('has every level, each with one list of variants per slot of the configured cards', () => {
    for (const level of coldOpener.levels) {
      const lp = COLD_POOL[level]!;
      expect(lp.slots).toHaveLength(coldOpener.slots.length);
      lp.slots.forEach((variants, s) => {
        expect(variants).toHaveLength(coldOpener.variants);
        for (const c of variants) expect(c.card).toBe(coldOpener.slots[s]);
      });
    }
    // About 30 opener contacts per level (design §8.5).
    expect(coldOpener.slots.length * coldOpener.variants).toBeGreaterThanOrEqual(30);
  });

  it('stores contacts only in take sectors, on anchors hidden from the entry, never a crossfire', () => {
    for (const level of coldOpener.levels) {
      for (const variants of COLD_POOL[level]!.slots) {
        for (const c of variants) {
          const s = catalog.find((x) => x.mapId === c.map && x.id === c.sector)!;
          expect(s.roles).toContain('take');
          const hidden = new Set(hiddenSpots(s, t.movement).map((p) => p.id));
          for (const id of c.spots) expect(hidden.has(id)).toBe(true);
          expect(c.card).not.toBe('crossfire');
          expect(coldOpener.excludeSectors).not.toContain(`${c.map}/${c.sector}`);
          expect(c.echoes.length).toBe(1);
        }
      }
    }
  });

  it('profiles get harder level by level', () => {
    const ls = coldOpener.levels;
    for (let i = 1; i < ls.length; i++) {
      const a = COLD_POOL[ls[i - 1]!]!.profile, b = COLD_POOL[ls[i]!]!.profile;
      expect(b.reactionSec).toBeLessThan(a.reactionSec);
      expect(b.hitChance).toBeGreaterThan(a.hitChance);
    }
  });
});
