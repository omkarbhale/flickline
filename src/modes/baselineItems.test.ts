import { describe, expect, it } from 'vitest';
import { baseline } from '../config/baseline';
import { BASELINE_ITEMS } from '../config/baselineItems';

/** FNV-1a (32 bit) over the canonical text of the stored lists: any change to any number changes it. */
function hashItems(): string {
  let h = 0x811c9dc5;
  const text = JSON.stringify(BASELINE_ITEMS);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The hash of the stored item lists of each Baseline version, frozen. Changing a stored list (or
 * the generator, the dial axes or a trial engine so that the file is regenerated differently)
 * without bumping `baseline.version` fails here; a bump needs its new hash added below. Old
 * versions stay listed: their series on the profile still refer to them (design §8.5, transfer.md §5.8).
 */
const FROZEN: Readonly<Record<number, string>> = {
  1: '9869152a',
};

describe('Baseline content version', () => {
  it('has a frozen hash for the current version, and the stored lists still match it', () => {
    const expected = FROZEN[baseline.version];
    expect(expected, `baseline.version ${baseline.version} has no frozen hash: add it to FROZEN (current lists hash to ${hashItems()})`).toBeDefined();
    expect(
      hashItems(),
      'the stored Baseline item lists changed without a baseline.version bump: bump it in config/baseline.ts and freeze the new hash',
    ).toBe(expected);
  });

  it('versions are whole numbers counting up from 1, each frozen once', () => {
    const versions = Object.keys(FROZEN).map(Number);
    expect(versions).toEqual(versions.map((_, i) => i + 1));
    expect(Number.isInteger(baseline.version) && baseline.version >= 1).toBe(true);
  });
});
