import type { Tunables } from '../config/tunables';
import { buildRows, type RowDef, type Tag } from './rows';
import type { SpecSnapshot } from './specParse';

/**
 * Turns the raw row outcomes into the conformance table's statuses, using the written reasons in
 * `deviations.ts`. The rules:
 *
 *  - the implementation equals the spec          -> match (or match on an estimate / placeholder)
 *  - it differs and `deviations.ts` says why     -> deviation
 *  - it differs and nobody wrote why             -> a problem: the suite fails (unexplained)
 *  - it equals the spec but a reason is on file  -> a problem: the suite fails (stale reason)
 *  - there is nothing to compare yet             -> not implemented (never a failure)
 */

export type Status = 'match' | 'match-estimate' | 'match-placeholder' | 'deviation' | 'not-implemented';

export interface Row {
  id: string;
  area: string;
  section: string;
  spec: string;
  tag: Tag;
  via: string;
  /** What the implementation gave ("" for a row that is not implemented yet). */
  implemented: string;
  status: Status;
  /** The deviation's reason, or what is missing for a row that is not implemented. */
  note: string;
  /** Set when the row breaks a suite rule; the test for the row fails with this text. */
  problem?: string;
}

export type Deviations = Readonly<Record<string, string>>;

function classify(def: RowDef, reasons: Deviations): Row {
  const base = { id: def.id, area: def.area, section: def.section, spec: def.spec, tag: def.tag, via: def.via };
  const out = def.run();
  const reason = reasons[def.id];
  if (out.kind === 'absent') {
    return { ...base, implemented: '', status: 'not-implemented', note: out.note, ...(reason !== undefined ? { problem: `has a deviation reason but nothing to compare: "${out.note}"` } : {}) };
  }
  if (out.ok) {
    const status: Status = def.tag.kind === 'sourced' ? 'match' : def.tag.kind === 'estimate' ? 'match-estimate' : 'match-placeholder';
    return { ...base, implemented: out.value, status, note: '', ...(reason !== undefined ? { problem: 'matches the spec but deviations.ts still holds a reason for it: delete the entry' } : {}) };
  }
  if (reason === undefined) {
    return { ...base, implemented: out.value, status: 'deviation', note: '', problem: `implemented ${out.value}, spec ${def.spec}: no written reason in deviations.ts` };
  }
  if (reason.trim() === '') {
    return { ...base, implemented: out.value, status: 'deviation', note: '', problem: 'deviation reason is empty' };
  }
  return { ...base, implemented: out.value, status: 'deviation', note: reason };
}

/** Evaluate every row (or only those `only` accepts) against the live tunables. */
export function evaluate(snap: SpecSnapshot, t: Tunables, reasons: Deviations, only?: (id: string) => boolean): Row[] {
  const defs = buildRows(snap, t);
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) throw new Error(`conformance: duplicate row id ${d.id}`);
    seen.add(d.id);
  }
  return defs.filter((d) => !only || only(d.id)).map((d) => classify(d, reasons));
}

export interface Counts {
  total: number;
  match: number;
  matchEstimate: number;
  matchPlaceholder: number;
  deviation: number;
  notImplemented: number;
}

export function countRows(rows: readonly Row[]): Counts {
  const c: Counts = { total: rows.length, match: 0, matchEstimate: 0, matchPlaceholder: 0, deviation: 0, notImplemented: 0 };
  for (const r of rows) {
    if (r.status === 'match') c.match++;
    else if (r.status === 'match-estimate') c.matchEstimate++;
    else if (r.status === 'match-placeholder') c.matchPlaceholder++;
    else if (r.status === 'deviation') c.deviation++;
    else c.notImplemented++;
  }
  return c;
}
