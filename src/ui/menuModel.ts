import type { SkillId } from '../config/dial';
import type { MenuTunables } from '../config/menu';

/** A registered mode as the menu sees it: the id and the skill it trains (`line` = all of them, Sweep). */
export interface RegisteredMode {
  readonly id: string;
  readonly skill: SkillId | 'line';
}

/** What a card needs from the rest of the game; the app adapts the skill model and the play log to this. */
export interface CardSources {
  /** Best score of a mode, or null when it has no finished run. */
  bestScore(modeId: string): number | null;
  /** The dial the mode would be matched at right now (design 9.3), or null when unknown. */
  matchedDial(modeId: string): number | null;
  /** Tier label for a dial value, e.g. "Cobalt II". */
  tierLabel(dial: number): string;
}

/** Everything a mode card shows, as plain text. */
export interface CardModel {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly skill: SkillId | 'line';
  readonly skillLabel: string;
  readonly best: number | null;
  /** "12,340" or an em dash when there is no run yet. */
  readonly bestText: string;
  /** "Matched to you: Cobalt II · dial 51", or '' when the mode has no dial. */
  readonly matchedText: string;
}

/** `coldStart` -> `Cold Start`, for a registered mode nobody has written card copy for yet. */
export function titleFromId(id: string): string {
  const spaced = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? id : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Thousands separators, no decimals: 12340 -> "12,340". */
export function formatScore(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The cards for the mode registry: only listed modes, in the table's order (modes without an entry
 * come last, alphabetically). Pure: the registry is the source of which cards exist.
 */
export function buildCards(modes: readonly RegisteredMode[], cfg: MenuTunables, src: CardSources): CardModel[] {
  const rows: { mode: RegisteredMode; order: number }[] = [];
  for (const mode of modes) {
    const info = cfg.modeCards[mode.id];
    if (info?.listed === false) continue;
    rows.push({ mode, order: info?.order ?? Number.POSITIVE_INFINITY });
  }
  rows.sort((a, b) => a.order - b.order || (a.mode.id < b.mode.id ? -1 : a.mode.id > b.mode.id ? 1 : 0));
  return rows.map(({ mode }) => {
    const info = cfg.modeCards[mode.id];
    const best = src.bestScore(mode.id);
    const dial = src.matchedDial(mode.id);
    return {
      id: mode.id,
      name: info?.name ?? titleFromId(mode.id),
      blurb: info?.blurb ?? '',
      skill: mode.skill,
      skillLabel: cfg.skillLabels[mode.skill],
      best,
      bestText: best === null ? '—' : formatScore(best),
      matchedText: dial === null ? '' : `Matched to you: ${src.tierLabel(dial)} · dial ${Math.round(dial)}`,
    };
  });
}

/** One step of Today's session as the menu shows it. */
export interface SessionStepView {
  readonly modeId: string;
  readonly name: string;
  /** Why it is in the plan ("your lowest-rated skill"). */
  readonly reason: string;
  readonly state: 'done' | 'current' | 'next';
}

export interface SessionView {
  /** The player is partway through a session (steps before `index` are done or skipped). */
  readonly active: boolean;
  readonly steps: readonly SessionStepView[];
  /** "Run 2 of 4" while active, '' before it starts. */
  readonly progressText: string;
}

/** The session strip: the plan, with the current step marked. Pure; wording of reasons is passed in. */
export function buildSessionView(
  steps: readonly { modeId: string; role: string }[],
  index: number,
  active: boolean,
  nameOf: (modeId: string) => string,
  reasonOf: (role: string) => string,
): SessionView {
  const out: SessionStepView[] = steps.map((s, i) => ({
    modeId: s.modeId,
    name: nameOf(s.modeId),
    reason: reasonOf(s.role),
    state: !active ? 'next' : i < index ? 'done' : i === index ? 'current' : 'next',
  }));
  const shown = Math.min(index + 1, steps.length);
  return { active, steps: out, progressText: active && steps.length > 0 ? `Run ${shown} of ${steps.length}` : '' };
}
