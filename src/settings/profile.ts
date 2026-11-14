import type { EventSink } from '../core/eventBus';
import { dial as dialTunables, type DialTunables } from '../config/dial';
import { HINT_IDS, type HintId } from '../config/hints';
import { SELF_REPORTS, type SelfReport } from '../config/profile';
import type { StorageLike } from './settings';

/** Who the player says they are, plus whether the first-run flow has been completed. */
export interface Profile {
  /** The chip picked in the first-run panel; null = skipped. */
  selfReport: SelfReport | null;
  /** True once the player has started their first run from the first-run panel (a "save is present"). */
  firstRunDone: boolean;
  /** Scored runs (not quit early) the player has completed, ever; the clean run waits for a few (design §7.4). */
  runsCompleted: number;
  /** The one-time hints already shown (design §13.4), so each shows once, ever; part of the save. */
  hintsSeen: HintId[];
}

export const DEFAULT_PROFILE: Profile = { selfReport: null, firstRunDone: false, runsCompleted: 0, hintsSeen: [] };

export interface ProfileEvents {
  profileChanged: { profile: Readonly<Profile>; changed: readonly (keyof Profile)[] };
}

declare module '../core/gameEvents' {
  interface GameEvents extends ProfileEvents {}
}

/** Separate from the settings key; the progress save (design 14.5) absorbs it when it lands. */
export const PROFILE_KEY = 'flickline.profile.v1';

export function sanitizeProfile(raw: unknown): Profile {
  const out: Profile = { ...DEFAULT_PROFILE };
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.selfReport === 'string' && (SELF_REPORTS as readonly string[]).includes(r.selfReport)) {
    out.selfReport = r.selfReport as SelfReport;
  }
  out.firstRunDone = r.firstRunDone === true;
  if (typeof r.runsCompleted === 'number' && Number.isFinite(r.runsCompleted)) {
    out.runsCompleted = Math.min(1_000_000, Math.max(0, Math.floor(r.runsCompleted)));
  }
  out.hintsSeen = [];
  if (Array.isArray(r.hintsSeen)) out.hintsSeen = HINT_IDS.filter((id) => (r.hintsSeen as unknown[]).includes(id));
  return out;
}

/** Whether two profile fields hold the same value (the hint list compares by content). */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** The skill prior (mean and standard deviation on the 0..100 dial) a self-report sets; numbers come from `config/dial.ts`. */
export interface SkillPrior {
  mean: number;
  sd: number;
}

export function skillPrior(selfReport: SelfReport | null, cfg: DialTunables = dialTunables): SkillPrior {
  return { mean: cfg.priorMean[selfReport ?? 'skip'], sd: cfg.priorSd };
}

/** Tiny persisted profile store, same failure policy as SettingsStore. */
export class ProfileStore {
  private current: Profile;

  constructor(
    private readonly events: EventSink<ProfileEvents>,
    private readonly storage: StorageLike | null,
  ) {
    let raw: unknown = null;
    try {
      const s = storage?.getItem(PROFILE_KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.current = sanitizeProfile(raw);
  }

  get(): Readonly<Profile> {
    return this.current;
  }

  /** The prior implied by the current self-report. */
  prior(cfg: DialTunables = dialTunables): SkillPrior {
    return skillPrior(this.current.selfReport, cfg);
  }

  set(patch: Partial<Profile>): void {
    const next = sanitizeProfile({ ...this.current, ...patch });
    const changed = (Object.keys(next) as (keyof Profile)[]).filter((k) => !sameValue(next[k], this.current[k]));
    if (changed.length === 0) return;
    this.current = next;
    try {
      this.storage?.setItem(PROFILE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    this.events.emit('profileChanged', { profile: next, changed });
  }
}
