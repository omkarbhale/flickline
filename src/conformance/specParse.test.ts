import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanCell, expandKeys, extractSnapshot, parseValue, snapshotText, tableAfter } from './specParse';

const repo = join(import.meta.dirname, '..', '..');
const specText = readFileSync(join(repo, 'docs', 'mechanics-spec.md'), 'utf8');
const snapshotFile = readFileSync(join(import.meta.dirname, 'specSnapshot.json'), 'utf8');

describe('the spec snapshot', () => {
  it('matches docs/mechanics-spec.md (a spec edit must be followed by `npm run conformance`)', () => {
    const fresh = extractSnapshot(specText);
    expect(JSON.parse(snapshotFile), 'src/conformance/specSnapshot.json is stale: run `npm run conformance`').toEqual(fresh);
    expect(snapshotFile).toBe(snapshotText(fresh));
  });

  it('carries the §7 tables: 7.1 global keys, 7.2 handling, 7.3 spread, 7.4 bands', () => {
    const s = JSON.parse(snapshotFile) as ReturnType<typeof extractSnapshot>;
    const key = (k: string): unknown => s.global.find((g) => g.key === k)?.value;
    expect(key('sim.tick_hz')).toBe(128);
    expect(key('view.vfov_deg')).toBe(70.5328);
    expect(key('move.deadzone_fraction')).toBe(0.275);
    expect(key('hit.torso_range_stand')).toEqual([0.8, 1.52]);
    expect(key('hit.head_centre_crouch')).toBe(1.16);
    expect(key('input.scope_zoom_sniper_2')).toBe(5);
    expect(key('target.speed_fast')).toBe(5.4);
    expect(Object.keys(s.handling)).toEqual(['rifle_precise', 'rifle_spray', 'smg', 'pistol_light', 'pistol_accurate', 'pistol_heavy', 'sniper']);
    expect(s.handling['rifle_spray']).toMatchObject({ fire_rate_hz: 11, mag: 30, reload_s: 2.5, equip_s: 1, run_speed_mps: 5.4, reserve: 60, mode: 'auto' });
    expect(s.spread['rifle_precise']).toMatchObject({ spread_first_deg: 0.25, recovery_s: 0.375, tap_eff: 6, deadzone: 0.275 });
    expect(s.spread['sniper_unscoped']).toMatchObject({ spread_first_deg: 5, deadzone: 0.15 });
    expect(s.damage['smg']).toEqual([
      { upToM: 15, head: 78, body: 26, leg: 22.1 },
      { upToM: 30, head: 66, body: 22, leg: 18.7 },
      { upToM: 50, head: 60, body: 20, leg: 17 },
    ]);
    expect(s.penetration).toMatchObject({ rifle_precise: 'M', smg: 'L', sniper: 'H' });
    expect(s.ttk).toHaveLength(39);
    expect(s.ttk.find((r) => r.archetype === 'rifle_spray' && r.fromM === 20 && r.zone === 'head')?.bullets).toEqual([1, 1, 2]);
  });
});

describe('spec table parsing', () => {
  it('splits slash lists of keys and values', () => {
    expect(expandKeys('`hit.head_centre_stand` / `_crouch`')).toEqual(['hit.head_centre_stand', 'hit.head_centre_crouch']);
    expect(expandKeys('`flinch.pitch_head` / `_body` / `_leg`')).toEqual(['flinch.pitch_head', 'flinch.pitch_body', 'flinch.pitch_leg']);
    expect(expandKeys('`armor.light` / `armor.heavy`')).toEqual(['armor.light', 'armor.heavy']);
    expect(expandKeys('`move.gravity`')).toEqual(['move.gravity']);
  });

  it('reads numbers, ranges, flags, words and trailing notes', () => {
    expect(parseValue('128')).toEqual({ value: 128, note: '' });
    expect(parseValue('0.80 to 1.52')).toEqual({ value: [0.8, 1.52], note: '' });
    expect(parseValue('39 (scaled by max/5.4)')).toEqual({ value: 39, note: '(scaled by max/5.4)' });
    expect(parseValue('true')).toEqual({ value: true, note: '' });
    expect(parseValue('`angle_div`')).toEqual({ value: 'angle_div', note: '' });
    expect(cleanCell('**0.20 s**')).toBe('0.20 s');
  });

  it('fails loudly when the spec is restructured instead of yielding an empty snapshot', () => {
    expect(() => tableAfter(['# nothing here'], '### 7.1')).toThrow(/heading not found/);
    expect(() => tableAfter(['### 7.1 Global', 'no table'], '### 7.1')).toThrow(/no table/);
    expect(() => extractSnapshot('# empty')).toThrow();
  });
});
