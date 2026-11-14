import { progress as progressCfg } from '../config/progress';
import { migrateSave, sanitizeProgress, SaveError, SAVE_VERSION, toSave, type ProgressData } from '../progress/save';
import { sanitizeProfile, type Profile } from './profile';
import { sanitizeSettings, type Settings } from './settings';

/**
 * The export/import file of the settings menu's Data group (design §13.3, §14.5): the save object (the
 * progress in `progress/save.ts`) with the settings and the profile alongside, as one JSON document, so a
 * player can move between browsers or back up their progress. Pure: the caller passes the data in and applies
 * what comes out, through the same stores that persist it.
 *
 * Importing is all-or-nothing: the whole text is read, migrated and validated before anything is returned, so
 * a corrupt, truncated or hand-broken file is refused and the caller's current save is never touched.
 */
export const SAVE_FORMAT = 'flickline-save';
export { SAVE_VERSION };
/** A save larger than this is not ours (a few kilobytes in practice; a full history is under 100 kB). */
export const MAX_SAVE_BYTES = progressCfg.maxSaveBytes;

export interface SaveParts {
  settings?: Settings;
  profile?: Profile;
  progress?: ProgressData;
}

/** The pretty-printed JSON of a save. `exportedAt` is an ISO date the caller reads from its clock. */
export function buildSave(parts: Required<SaveParts>, exportedAt: string): string {
  return JSON.stringify(
    { format: SAVE_FORMAT, exportedAt, settings: parts.settings, profile: parts.profile, ...toSave(parts.progress) },
    null,
    2,
  );
}

export type ParseResult = { ok: true; parts: SaveParts } | { ok: false; error: string };

/** The save object's own keys: a file carries progress when it has any of them. */
const PROGRESS_KEYS = [
  'ratings', 'ranks', 'runBests', 'dailyBests', 'situations', 'drillBests', 'medals', 'history', 'plays', 'flaggedSkill',
  'coldOpeners', 'coldOpenerLevels', 'checkins', 'journal',
] as const;

/**
 * Read a save file. Every part is validated and clamped (`sanitize*`), so a hand-edited file can not
 * put the game in a state it could not have reached; a part that is missing stays missing (the
 * import leaves that part as it is). Refuses anything that is not a Flickline save, a newer version
 * than this build knows, a part with the wrong shape, and files that are too large. Older versions
 * are migrated (`progress/save.ts`).
 */
export function parseSave(text: string): ParseResult {
  if (text.length > MAX_SAVE_BYTES) return { ok: false, error: 'That file is too large to be a Flickline save.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not a Flickline save (it is not valid JSON).' };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== SAVE_FORMAT) {
    return { ok: false, error: 'That is not a Flickline save.' };
  }
  const m = migrateSave(raw);
  if (!m.ok) return { ok: false, error: m.error };
  const r = m.raw;
  const parts: SaveParts = {};
  try {
    if (r.settings !== undefined) parts.settings = sanitizeSettings(r.settings);
    if (r.profile !== undefined) parts.profile = sanitizeProfile(r.profile);
    if (PROGRESS_KEYS.some((k) => r[k] !== undefined)) parts.progress = sanitizeProgress(r, progressCfg);
  } catch (e) {
    if (e instanceof SaveError) return { ok: false, error: e.message };
    throw e;
  }
  if (parts.settings === undefined && parts.profile === undefined && parts.progress === undefined) {
    return { ok: false, error: 'That save has nothing in it.' };
  }
  return { ok: true, parts };
}
