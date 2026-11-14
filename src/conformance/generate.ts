import { cloneTunables } from '../config/tunables';
import { countRows, evaluate, type Counts } from './conformance';
import { deviations } from './deviations';
import { extractSnapshot, snapshotText } from './specParse';
import { renderTable } from './table';

/** Where the generated files live, relative to the repository root. */
export const SPEC_PATH = 'docs/mechanics-spec.md';
export const SNAPSHOT_PATH = 'src/conformance/specSnapshot.json';
export const TABLE_PATH = 'docs/conformance.md';

export interface Generated {
  /** Exact text of `specSnapshot.json`. */
  snapshot: string;
  /** Exact text of `docs/conformance.md`. */
  table: string;
  counts: Counts;
  /** One line per row that breaks a suite rule (an unexplained deviation, a stale reason). */
  problems: string[];
}

/**
 * Everything `npm run conformance` writes, from the spec text: re-extract the snapshot, run every
 * row against the live config and the real simulation, render the table. Pure and deterministic
 * (`scripts/conformance.mjs` does the file access).
 */
export function generate(specMarkdown: string): Generated {
  const snap = extractSnapshot(specMarkdown);
  const rows = evaluate(snap, cloneTunables(), deviations);
  return {
    snapshot: snapshotText(snap),
    table: renderTable(rows, snap),
    counts: countRows(rows),
    problems: rows.filter((r) => r.problem).map((r) => `${r.id}: ${r.problem}`),
  };
}
