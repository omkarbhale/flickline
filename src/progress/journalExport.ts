import { progress as progressCfg, type JournalTunables } from '../config/progress';
import { isDateKey } from '../modes/dailyRoute';
import { dayOf, sanitizeJournal, type PlayJournal } from './journal';
import { SAVE_VERSION } from './save';

/**
 * The play journal as a file or a paste (#251): the small text a tester puts on the repeat-enjoyment playtest (#214), and
 * the reader that takes either that text or a whole save export (which carries the same `journal` key). Pure.
 */
export const JOURNAL_FORMAT = 'flickline-journal';

/**
 * The journal alone, as compact JSON (a few kilobytes a week of play). `nowMs` is the caller's clock; `day` is the local
 * calendar day it was written down, which the reader cannot work out from the UTC `exportedAt` without the tester's time zone.
 */
export function buildJournalExport(journal: PlayJournal, nowMs: number): string {
  return JSON.stringify({ format: JOURNAL_FORMAT, version: SAVE_VERSION, exportedAt: new Date(nowMs).toISOString(), day: dayOf(Math.floor(nowMs / 1000)), journal });
}

export type JournalRead = { ok: true; journal: PlayJournal; exportedAt: string | null; asOfDay: string | null } | { ok: false; error: string };

/** Read a journal export or a save export: the journal, and the local day it was written down (decides which returns are testable yet). */
export function readJournalExport(text: string, cfg: JournalTunables = progressCfg.journal): JournalRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'not a Flickline export' };
  const r = raw as Record<string, unknown>;
  if (r.format !== JOURNAL_FORMAT && r.format !== 'flickline-save') return { ok: false, error: 'not a Flickline export' };
  if (typeof r.version === 'number' && r.version > SAVE_VERSION) return { ok: false, error: `from a newer version (v${r.version})` };
  if (typeof r.journal !== 'object' || r.journal === null) return { ok: false, error: 'has no play journal (a save from before v4)' };
  const at = typeof r.exportedAt === 'string' ? Date.parse(r.exportedAt) : NaN;
  return {
    ok: true,
    journal: sanitizeJournal(r.journal, cfg),
    exportedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
    asOfDay: typeof r.day === 'string' && isDateKey(r.day) ? r.day : Number.isFinite(at) ? dayOf(Math.floor(at / 1000)) : null,
  };
}
