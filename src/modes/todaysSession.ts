import type { SkillId } from '../config/dial';

/**
 * # Today's session (design section 2)
 *
 * The **Play** button starts a 3-run warm-up followed by one Sweep run: the lowest-rated skill
 * first, then the skill the last results card flagged, then a favourite. The player can ignore it
 * at any point (`SessionQueue.skip`, `end`). Pure: the caller passes what the skill model, the
 * play log and the mode registry say; nothing here reads a clock or a store.
 */

/** A drill the session may pick: one listed mode and the skill it trains. */
export interface SessionCandidate {
  readonly id: string;
  readonly skill: SkillId;
}

export interface SessionInput {
  /** Listed drills in menu order (the finale is not one of them). */
  readonly candidates: readonly SessionCandidate[];
  /** The closing run (Sweep), or null when it is not registered: the session is then the warm-ups alone. */
  readonly finaleId: string | null;
  /** Skill rating per skill on the dial scale (`SkillState.rating`). */
  readonly ratings: Readonly<Record<SkillId, number>>;
  /** The skill the last results card flagged ("the one thing to fix"), or null before there is one. */
  readonly flaggedSkill: SkillId | null;
  /** Finished runs per mode id; missing = never played. */
  readonly plays: Readonly<Record<string, number>>;
}

export type SessionRole = 'weakest' | 'flagged' | 'favourite' | 'finale';

export interface SessionStep {
  readonly modeId: string;
  readonly role: SessionRole;
}

/** Warm-up roles in order; the session always has this many warm-up runs when any drill exists. */
export const WARMUP_ROLES: readonly SessionRole[] = ['weakest', 'flagged', 'favourite'];

function rating(input: SessionInput, skill: SkillId): number {
  const r = input.ratings[skill];
  return Number.isFinite(r) ? r : 0;
}

/**
 * Lowest-rated skill first; ties by menu order (the earlier candidate). Candidates in `taken` are
 * skipped unless nothing else is left, so the warm-up covers different drills where it can.
 */
function weakest(input: SessionInput, taken: ReadonlySet<string>): SessionCandidate | null {
  let best: SessionCandidate | null = null;
  for (const c of input.candidates) {
    if (taken.has(c.id)) continue;
    if (best === null || rating(input, c.skill) < rating(input, best.skill)) best = c;
  }
  return best;
}

/** Most-played drill; with no history at all, the one trained by the highest-rated skill (end the warm-up on a strength). */
function favourite(input: SessionInput, taken: ReadonlySet<string>): SessionCandidate | null {
  let best: SessionCandidate | null = null;
  for (const c of input.candidates) {
    if (taken.has(c.id)) continue;
    if (best === null) {
      best = c;
      continue;
    }
    const dp = (input.plays[c.id] ?? 0) - (input.plays[best.id] ?? 0);
    if (dp > 0 || (dp === 0 && rating(input, c.skill) > rating(input, best.skill))) best = c;
  }
  return best;
}

/** Build the plan: three warm-up steps (if any drill exists) and the finale (if registered). */
export function planSession(input: SessionInput): SessionStep[] {
  const steps: SessionStep[] = [];
  const taken = new Set<string>();
  const none: ReadonlySet<string> = new Set();
  if (input.candidates.length > 0) {
    // 1. The lowest-rated skill.
    const first = weakest(input, none)!;
    steps.push({ modeId: first.id, role: 'weakest' });
    taken.add(first.id);

    // 2. The flagged skill; with nothing flagged (or it is already in), the next-weakest.
    let second: SessionCandidate | null = null;
    if (input.flaggedSkill !== null) {
      for (const c of input.candidates) {
        if (c.skill === input.flaggedSkill && !taken.has(c.id)) {
          second = c;
          break;
        }
      }
    }
    second ??= weakest(input, taken) ?? first;
    steps.push({ modeId: second.id, role: 'flagged' });
    taken.add(second.id);

    // 3. A favourite; when every drill is already in the plan, the most-played one again.
    const third = favourite(input, taken) ?? favourite(input, none)!;
    steps.push({ modeId: third.id, role: 'favourite' });
  }
  if (input.finaleId !== null) steps.push({ modeId: input.finaleId, role: 'finale' });
  return steps;
}

/** Which skill a plan step trains; used by the menu to word the step ("lowest-rated skill"). */
export function stepReason(role: SessionRole): string {
  switch (role) {
    case 'weakest':
      return 'your lowest-rated skill';
    case 'flagged':
      return 'what your last results card flagged';
    case 'favourite':
      return 'a favourite';
    case 'finale':
      return 'the finale';
  }
}

/** Where the player is in a plan. Every step can be skipped; the whole session can be dropped at any point. */
export class SessionQueue {
  private i = 0;
  private skippedCount = 0;

  constructor(readonly steps: readonly SessionStep[]) {}

  /** Index of the current step (`steps.length` once the session is over). */
  get index(): number {
    return this.i;
  }

  get current(): SessionStep | null {
    return this.steps[this.i] ?? null;
  }

  get finished(): boolean {
    return this.i >= this.steps.length;
  }

  get skipped(): number {
    return this.skippedCount;
  }

  /** The current run was played: move on. Returns the next step, or null when the session is over. */
  advance(): SessionStep | null {
    if (this.i < this.steps.length) this.i++;
    return this.current;
  }

  /** The player skipped the current step. Returns the next step, or null when the session is over. */
  skip(): SessionStep | null {
    if (this.i < this.steps.length) {
      this.i++;
      this.skippedCount++;
    }
    return this.current;
  }

  /** Drop the rest of the session. */
  end(): void {
    this.i = this.steps.length;
  }
}
