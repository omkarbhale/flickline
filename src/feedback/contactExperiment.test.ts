import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { runDial, type DialRow, type ModelTunables, type PolicyId, type PolicyStats } from './contactExperiment';

/**
 * The settling experiment of #132 (docs/research/survival-rewards.md): over 1,000 seeded contacts
 * per dial, the reward table must rank "isolate and disengage" above "always swing", and "back off
 * at the first hit" below both, at every dial. Runs in about a second.
 *
 * `REWARD_TABLE_OUT=path npm run reward-experiment` also writes the full results as a markdown table
 * (matched player plus the under- and over-matched checks) for the research doc.
 */
const T = cloneTunables();
const cfg: ModelTunables = { scoring: T.scoring, dial: T.dial, player: T.player, sweep: T.sweep, weapon: T.weapon.kestrel };
const DIALS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const out = process.env['REWARD_TABLE_OUT'];

const rows = new Map<number, DialRow[]>();
function grid(win: number): DialRow[] {
  let g = rows.get(win);
  if (!g) {
    g = DIALS.map((d) => runDial(d, cfg, 1000, win));
    rows.set(win, g);
  }
  return g;
}

const MATCHED = T.dial.modes['sweep']!.targetSuccess;

describe('settling experiment (#132): isolate and disengage beats always swing', () => {
  it.each(DIALS)('dial %i, matched player: per contact and per Sweep run', (dial) => {
    const p = grid(MATCHED).find((r) => r.dial === dial)!.policies;
    expect(p.isolate.perContactProposed).toBeGreaterThan(p.swing.perContactProposed);
    expect(p.isolate.perRunProposed).toBeGreaterThan(p.swing.perRunProposed);
    // Passivity is not the answer: leaving at the first hit earns least.
    expect(p.isolate.perContactProposed).toBeGreaterThan(p.backOff.perContactProposed);
    expect(p.isolate.perRunProposed).toBeGreaterThan(p.backOff.perRunProposed);
    expect(p.swing.perContactProposed).toBeGreaterThan(p.backOff.perContactProposed);
  });

  it.runIf(out)('under- and over-matched players rank the same way (report run)', () => {
    for (const win of [0.55, 0.85]) {
      for (const r of grid(win)) {
        expect(r.policies.isolate.perContactProposed).toBeGreaterThan(r.policies.swing.perContactProposed);
        expect(r.policies.isolate.perRunProposed).toBeGreaterThan(r.policies.backOff.perRunProposed);
      }
    }
  });

  it.runIf(out)('writes the results table', () => {
    writeFileSync(out!, report());
  });
});

function pct(a: number, b: number): string {
  const v = (a / b - 1) * 100;
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}

function report(): string {
  const f = (x: number): string => Math.round(x).toLocaleString('en-US');
  const s = (p: PolicyStats): string => `${(p.winRate * 100).toFixed(0)} / ${(p.disengageRate * 100).toFixed(0)} / ${(p.deathRate * 100).toFixed(0)}`;
  const lines: string[] = [];
  for (const win of [MATCHED, 0.55, 0.85]) {
    lines.push(`#### Player wins an isolated 1v1 untouched ${Math.round(win * 100)}% of the time${win === MATCHED ? ' (matched)' : ''}`, '');
    lines.push('| Dial | Today, per contact: isolate vs swing | Proposed, per contact | Today, per run | Proposed, per run | Proposed, isolate vs back off (contact / run) | Clear / disengage / death % (swing · isolate · back off) | Swing kills in a crossfire | Contacts per run (swing · isolate) |');
    lines.push('|---:|---:|---:|---:|---:|---:|---|---:|---:|');
    for (const r of grid(win)) {
      const p: Record<PolicyId, PolicyStats> = r.policies;
      lines.push(`| ${r.dial} | ${f(p.isolate.perContactNow)} vs ${f(p.swing.perContactNow)} (${pct(p.isolate.perContactNow, p.swing.perContactNow)}) | ${f(p.isolate.perContactProposed)} vs ${f(p.swing.perContactProposed)} (${pct(p.isolate.perContactProposed, p.swing.perContactProposed)}) | ${pct(p.isolate.perRunNow, p.swing.perRunNow)} | ${pct(p.isolate.perRunProposed, p.swing.perRunProposed)} | ${pct(p.isolate.perContactProposed, p.backOff.perContactProposed)} / ${pct(p.isolate.perRunProposed, p.backOff.perRunProposed)} | ${s(p.swing)} · ${s(p.isolate)} · ${s(p.backOff)} | ${(p.swing.crossfireKillShare * 100).toFixed(0)}% | ${p.swing.contactsPerRun.toFixed(1)} · ${p.isolate.contactsPerRun.toFixed(1)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
