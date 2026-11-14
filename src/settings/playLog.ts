import { SKILL_IDS, type SkillId } from '../config/dial';

/**
 * The play log of save version 1 (the #182 export file): the best score and the number of finished
 * runs per mode, and the skill the last results card flagged. The progress save (`progress/`, design
 * §14.5, #38) replaced the store that kept it; this file is what is left: the shape of the old data
 * (read by the v1 -> v2 migration in `progress/save.ts`) and the three reads the menu and Today's
 * session take (`PlayLogReads`, implemented by `ProgressStore`). There is no time-played counter
 * anywhere (design §2: nothing rewards time spent), only finished runs, which is the "favourite" signal.
 */
export interface PlayLogData {
  /** Best score per mode id. */
  bests: Record<string, number>;
  /** Finished runs per mode id. */
  plays: Record<string, number>;
  /** The skill of the last "one thing to fix", or null. */
  flaggedSkill: SkillId | null;
}

/** What the menu cards and the session planner read of the player's history. */
export interface PlayLogReads {
  /** Best score of a mode, or null if it has no finished run. */
  best(modeId: string): number | null;
  /** Finished runs of a mode. */
  plays(modeId: string): number;
  /** All counts, for the session planner. Read-only view of the live data. */
  readonly playCounts: Readonly<Record<string, number>>;
  readonly flaggedSkill: SkillId | null;
}

const MAX_MODES = 64;

function counts(raw: unknown, keep: (n: number) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const k of Object.keys(raw).slice(0, MAX_MODES)) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'number' && Number.isFinite(v) && keep(v)) out[k] = v;
  }
  return out;
}

/** Read a version-1 play log; anything unreadable is dropped. */
export function sanitizePlayLog(raw: unknown): PlayLogData {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const flagged = r.flaggedSkill;
  return {
    bests: counts(r.bests, (n) => n > 0),
    plays: counts(r.plays, (n) => Number.isInteger(n) && n > 0),
    flaggedSkill: typeof flagged === 'string' && (SKILL_IDS as readonly string[]).includes(flagged) ? (flagged as SkillId) : null,
  };
}
