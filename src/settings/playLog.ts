import type { EventSink } from '../core/eventBus';
import { SKILL_IDS, type SkillId } from '../config/dial';
import type { StorageLike } from './settings';

/**
 * What the menu needs to remember about past runs: the best score and the number of finished runs
 * per mode (cards and "a favourite" in Today's session), and the skill the last results card
 * flagged. Tiny and local, with the same failure policy as `SettingsStore`.
 *
 * STAND-IN: the versioned save object (design 14.5, #38) owns bests per (mode, dial band), the
 * history and the medals. When it lands it replaces this store behind the same three reads
 * (`best`, `plays`, `flaggedSkill`); there is no time-played counter anywhere (design 2: nothing
 * rewards time spent), only finished runs, which is the "favourite" signal.
 */
export interface PlayLogData {
  /** Best score per mode id. */
  bests: Record<string, number>;
  /** Finished runs per mode id. */
  plays: Record<string, number>;
  /** The skill of the last "one thing to fix", or null. */
  flaggedSkill: SkillId | null;
}

export interface PlayLogEvents {
  playLogChanged: { modeId: string | null };
}

declare module '../core/gameEvents' {
  interface GameEvents extends PlayLogEvents {}
}

export const PLAY_LOG_KEY = 'flickline.playlog.v1';

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

export function sanitizePlayLog(raw: unknown): PlayLogData {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const flagged = r.flaggedSkill;
  return {
    bests: counts(r.bests, (n) => n > 0),
    plays: counts(r.plays, (n) => Number.isInteger(n) && n > 0),
    flaggedSkill: typeof flagged === 'string' && (SKILL_IDS as readonly string[]).includes(flagged) ? (flagged as SkillId) : null,
  };
}

export class PlayLog {
  private data: PlayLogData;

  constructor(
    private readonly events: EventSink<PlayLogEvents>,
    private readonly storage: StorageLike | null,
  ) {
    let raw: unknown = null;
    try {
      const s = storage?.getItem(PLAY_LOG_KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.data = sanitizePlayLog(raw);
  }

  /** Replace everything with `data` (an imported save, or a reset to `sanitizePlayLog(null)`), persisted. */
  replace(data: PlayLogData): void {
    this.data = sanitizePlayLog(data);
    this.save();
    this.events.emit('playLogChanged', { modeId: null });
  }

  /** A copy of the data, for the save export. */
  snapshot(): PlayLogData {
    return sanitizePlayLog(this.data);
  }

  /** Best score for a mode, or null if it has no finished run. */
  best(modeId: string): number | null {
    return this.data.bests[modeId] ?? null;
  }

  /** Finished runs of a mode. */
  plays(modeId: string): number {
    return this.data.plays[modeId] ?? 0;
  }

  /** All counts, for the session planner. Read-only view of the live data. */
  get playCounts(): Readonly<Record<string, number>> {
    return this.data.plays;
  }

  get flaggedSkill(): SkillId | null {
    return this.data.flaggedSkill;
  }

  /** A run of `modeId` finished (any end but quitting) with `score`. Returns true if it is a new best. */
  recordRun(modeId: string, score: number): boolean {
    if (!Number.isFinite(score) || score < 0) score = 0;
    this.data.plays[modeId] = (this.data.plays[modeId] ?? 0) + 1;
    const prev = this.data.bests[modeId];
    const isBest = score > 0 && (prev === undefined || score > prev);
    if (isBest) this.data.bests[modeId] = Math.round(score);
    this.save();
    this.events.emit('playLogChanged', { modeId });
    return isBest;
  }

  /** The results card names the skill to work on next. */
  setFlaggedSkill(skill: SkillId | null): void {
    if (this.data.flaggedSkill === skill) return;
    this.data.flaggedSkill = skill;
    this.save();
    this.events.emit('playLogChanged', { modeId: null });
  }

  private save(): void {
    try {
      this.storage?.setItem(PLAY_LOG_KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }
}
