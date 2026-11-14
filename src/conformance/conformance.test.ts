import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { countRows, evaluate, type Row } from './conformance';
import { deviations } from './deviations';
import type { SpecSnapshot } from './specParse';
import snapshotJson from './specSnapshot.json';
import { renderTable } from './table';

/**
 * The spec conformance suite (issue #64). Every row of `docs/conformance.md` is one test here:
 * it compares the live `config/` value, or a behaviour measured on the real simulation, with the
 * checked-in snapshot of `docs/mechanics-spec.md`. A row passes when it matches, when it is not
 * implemented yet, or when it differs and `deviations.ts` gives a written reason.
 */

const repo = join(import.meta.dirname, '..', '..');
const snapshot = snapshotJson as unknown as SpecSnapshot;
const rows: Row[] = evaluate(snapshot, cloneTunables(), deviations);

describe('spec conformance, one test per row', () => {
  for (const row of rows) {
    it(row.id, () => {
      expect(row.problem, `${row.id} (${row.via})`).toBeUndefined();
    });
  }
});

describe('the conformance table', () => {
  it('docs/conformance.md is up to date (run `npm run conformance`)', () => {
    const file = readFileSync(join(repo, 'docs', 'conformance.md'), 'utf8');
    expect(file).toBe(renderTable(rows, snapshot));
  });

  it('has a row for every spec value in the snapshot', () => {
    const ids = new Set(rows.map((r) => r.id));
    const missing: string[] = [];
    for (const g of snapshot.global) if (!ids.has(`7.1/${g.key}`)) missing.push(`7.1/${g.key}`);
    for (const [arch, h] of Object.entries(snapshot.handling)) {
      for (const [col, v] of Object.entries(h)) if (v !== null && !ids.has(`7.2/${arch}/${col}`)) missing.push(`7.2/${arch}/${col}`);
    }
    for (const [arch, h] of Object.entries(snapshot.spread)) {
      for (const [col, v] of Object.entries(h)) if (v !== null && !ids.has(`7.3/${arch}/${col}`)) missing.push(`7.3/${arch}/${col}`);
    }
    for (const [arch, bands] of Object.entries(snapshot.damage)) {
      bands.forEach((_, i) => {
        for (const f of ['up-to', 'head', 'body', 'leg']) if (!ids.has(`7.4/${arch}/band${i + 1}/${f}`)) missing.push(`7.4/${arch}/band${i + 1}/${f}`);
      });
      if (!ids.has(`7.4/${arch}/penetration`)) missing.push(`7.4/${arch}/penetration`);
    }
    for (const r of snapshot.ttk) if (!ids.has(`6/${r.archetype}/${r.fromM}-${r.toM}m/${r.zone}`)) missing.push(`6/${r.archetype}/${r.fromM}-${r.toM}m/${r.zone}`);
    expect(missing).toEqual([]);
  });

  it('has the behaviour rows the issue asks for, for every archetype where they apply', () => {
    const ids = rows.map((r) => r.id);
    const archetypes = Object.keys(snapshot.handling);
    for (const arch of archetypes) {
      for (const what of ['2.3/%/stop-time', '2.5/%/shot-error-zero-at-0.100s', '2.5/%/first-accurate-shot', '2.1/%/run-speed', '2.1/%/walk-speed',
        '2.1/%/crouch-speed', '2.4/%/deadzone-gate', '3.1/%/fire-rate-10s', '3.1/%/magazine-cycle', '3.1/%/equip-time', '3.3/%/first-shot']) {
        const id = what.replace('%', arch);
        if (arch === 'sniper' && (what.includes('deadzone-gate') || what.includes('first-shot'))) continue; // sniper rows come with the weapon
        expect(ids, id).toContain(id);
      }
    }
    for (const id of ['1.1/hfov/16:9', '1.2/cm360/800dpi-sens0.4', '1.4/stepper-128hz', '1.4/sim-clock', '2.3/counter-strafe-equals-release', '4.3/tag-ramp-in',
      '4.3/tag-release', '4.3/tag-speed-cap', '4.3/tag-hold-while-hit', '7.1/sim.tick_hz', '7.1/view.vfov_deg', '7.1/input.yaw_deg_per_count_at_sens1']) {
      expect(ids, id).toContain(id);
    }
  });

  it('every written reason belongs to a row that exists, and is not empty', () => {
    const ids = new Set(rows.map((r) => r.id));
    for (const [id, reason] of Object.entries(deviations)) {
      expect(ids.has(id), `deviations.ts has "${id}" but no such row exists`).toBe(true);
      expect(reason.trim().length, `reason for ${id} is empty`).toBeGreaterThan(0);
    }
  });

  it('counts add up, and every status is one of the five', () => {
    const c = countRows(rows);
    expect(c.match + c.matchEstimate + c.matchPlaceholder + c.deviation + c.notImplemented).toBe(rows.length);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it('flags estimates and placeholders separately from sourced matches', () => {
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    expect(byId.get('7.1/sim.tick_hz')?.status).toBe('match'); // H: sourced
    expect(byId.get('7.1/spread.center_bias_power_still')?.status).toBe('match-estimate'); // L
    expect(byId.get('7.1/input.pitch_limit_deg')?.status).toBe('match-placeholder'); // P
  });
});

describe('the suite fails when it should', () => {
  const only = (...ids: string[]) => (id: string) => ids.includes(id);
  const KEY = '3.1/rifle_spray/fire-rate-10s';

  it('a behaviour that differs from the spec with no written reason is a problem', () => {
    const t = cloneTunables();
    t.weapon.kestrel.fireRateHz = 12;
    const [row] = evaluate(snapshot, t, {}, only(KEY));
    expect(row?.status).toBe('deviation');
    expect(row?.problem).toMatch(/no written reason/);
  });

  it('a config value that differs from the snapshot with no written reason is a problem, with one it is a deviation', () => {
    const t = cloneTunables();
    t.weapon.kestrel.magazine = 31;
    const id = '7.2/rifle_spray/mag';
    expect(evaluate(snapshot, t, {}, only(id))[0]?.problem).toMatch(/no written reason/);
    const explained = evaluate(snapshot, t, { [id]: 'tuned for a test' }, only(id))[0];
    expect(explained).toMatchObject({ status: 'deviation', note: 'tuned for a test' });
    expect(explained?.problem).toBeUndefined();
  });

  it('an empty reason is a problem', () => {
    const t = cloneTunables();
    t.weapon.kestrel.reloadSec = 3;
    const id = '7.2/rifle_spray/reload_s';
    expect(evaluate(snapshot, t, { [id]: '   ' }, only(id))[0]?.problem).toMatch(/empty/);
  });

  it('a reason left behind for a row that now matches is a problem', () => {
    const id = '7.2/rifle_spray/mag';
    expect(evaluate(snapshot, cloneTunables(), { [id]: 'old reason' }, only(id))[0]?.problem).toMatch(/delete the entry/);
  });

  it('a weapon the config does not have is "not implemented", never a failure', () => {
    const row = evaluate(snapshot, cloneTunables(), {}, only('7.2/sniper/fire_rate_hz'))[0];
    expect(row).toMatchObject({ status: 'not-implemented' });
    expect(row?.problem).toBeUndefined();
  });

  it('measurements are deterministic', () => {
    const sample = (id: string): boolean => id.startsWith('3.3/') || id.startsWith('3.1/') || id === '7.1/spread.half_angle';
    const a = evaluate(snapshot, cloneTunables(), deviations, sample);
    const b = evaluate(snapshot, cloneTunables(), deviations, sample);
    expect(b).toEqual(a);
  });
});
