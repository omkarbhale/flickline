import { sanitizePlayLog, type PlayLogData } from './playLog';
import { sanitizeProfile, type Profile } from './profile';
import { sanitizeSettings, type Settings } from './settings';

/**
 * The save file of the settings menu's Data group (design §13.3: "Export/import save (JSON), reset
 * progress"): the settings, the profile and the play log as one JSON document, so a player can move
 * between browsers or back up their progress. Pure: the caller passes the data in and applies what
 * comes out, through the same stores that persist it. (The versioned `flickline.save.v1` object of
 * design §14.5 absorbs these parts when it lands; this file's `version` is that file's migration hook.)
 */
export const SAVE_FORMAT = 'flickline-save';
export const SAVE_VERSION = 1;
/** A save larger than this is not ours (a few kilobytes in practice). */
export const MAX_SAVE_BYTES = 1_000_000;

export interface SaveParts {
  settings?: Settings;
  profile?: Profile;
  playLog?: PlayLogData;
}

/** The pretty-printed JSON of a save. `exportedAt` is an ISO date the caller reads from its clock. */
export function buildSave(parts: Required<SaveParts>, exportedAt: string): string {
  return JSON.stringify(
    { format: SAVE_FORMAT, version: SAVE_VERSION, exportedAt, settings: parts.settings, profile: parts.profile, playLog: parts.playLog },
    null,
    2,
  );
}

export type ParseResult = { ok: true; parts: SaveParts } | { ok: false; error: string };

/**
 * Read a save file. Every part is validated and clamped (`sanitize*`), so a hand-edited file can not
 * put the game in a state it could not have reached; a part that is missing stays missing (the
 * import leaves that part as it is). Refuses anything that is not a Flickline save, a newer version
 * than this build knows, and files that are too large.
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
  const r = raw as Record<string, unknown>;
  if (typeof r.version !== 'number' || !Number.isInteger(r.version) || r.version < 1) {
    return { ok: false, error: 'That save has no valid version.' };
  }
  if (r.version > SAVE_VERSION) {
    return { ok: false, error: `That save is from a newer version of Flickline (v${r.version}); this one reads up to v${SAVE_VERSION}.` };
  }
  const parts: SaveParts = {};
  if (r.settings !== undefined) parts.settings = sanitizeSettings(r.settings);
  if (r.profile !== undefined) parts.profile = sanitizeProfile(r.profile);
  if (r.playLog !== undefined) parts.playLog = sanitizePlayLog(r.playLog);
  if (parts.settings === undefined && parts.profile === undefined && parts.playLog === undefined) {
    return { ok: false, error: 'That save has nothing in it.' };
  }
  return { ok: true, parts };
}
