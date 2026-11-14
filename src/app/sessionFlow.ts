import type { Subscribable } from '../core/eventBus';
import { SKILL_IDS, type DialTunables, type SkillId } from '../config/dial';
import type { MenuTunables } from '../config/menu';
import type { RunEndReason } from '../modes/contracts';
import { planSession, SessionQueue, stepReason, type SessionCandidate, type SessionStep } from '../modes/todaysSession';
import type { PlayLog } from '../settings/playLog';
import type { SkillState } from '../adaptive/skillModel';
import { buildSessionView, titleFromId, type RegisteredMode, type SessionView } from '../ui/menuModel';

/** The slice of the mode host the flow reads: the registry and the mode in progress. */
export interface SessionModes {
  readonly registry: Readonly<Record<string, { readonly id: string; readonly skills: readonly SkillId[] }>>;
  readonly skills: SkillState;
  readonly modeId: string | null;
}

/** Events the flow listens to. */
export type SessionBus = Subscribable<{ runEnded: { tick: number; t: number; reason: RunEndReason } }>;

/** The registered modes as the menu and the planner see them: id and the skill each trains. */
export function registeredModes(registry: SessionModes['registry'], dial: DialTunables): RegisteredMode[] {
  return Object.keys(registry).map((id) => ({ id, skill: dial.modes[id]?.skill ?? registry[id]!.skills[0] ?? 'precision' }));
}

/**
 * Today's session as the app runs it (design section 2): builds the plan from the skill model,
 * the play log and the registry, and walks it as runs finish. It only decides *which mode is next*;
 * the game launches it. A finished run (any end but quitting) moves the session on; skipping, or
 * starting a mode from a card, is always allowed.
 */
export class SessionFlow {
  private queue: SessionQueue | null = null;

  constructor(
    bus: SessionBus,
    private readonly modes: SessionModes,
    private readonly playLog: PlayLog,
    private readonly menu: MenuTunables,
    private readonly dial: DialTunables,
  ) {
    bus.on('runEnded', (e) => {
      const q = this.queue;
      if (e.reason === 'quit' || q === null || q.finished) return;
      if (this.modes.modeId === q.current?.modeId) q.advance();
    });
  }

  /** A session is under way with steps left. */
  get active(): boolean {
    return this.queue !== null && !this.queue.finished;
  }

  /** The plan a new session would have right now. */
  plan(): SessionStep[] {
    const finale = this.menu.session.finaleMode;
    const registered = registeredModes(this.modes.registry, this.dial);
    const candidates: SessionCandidate[] = [];
    for (const m of registered) {
      if (m.id === finale || this.menu.modeCards[m.id]?.listed === false || m.skill === 'line') continue;
      candidates.push({ id: m.id, skill: m.skill });
    }
    candidates.sort((a, b) => (this.menu.modeCards[a.id]?.order ?? Infinity) - (this.menu.modeCards[b.id]?.order ?? Infinity));
    const ratings = {} as Record<SkillId, number>;
    for (const s of SKILL_IDS) ratings[s] = this.modes.skills.rating(s);
    return planSession({
      candidates,
      finaleId: this.modes.registry[finale] ? finale : null,
      ratings,
      flaggedSkill: this.playLog.flaggedSkill,
      plays: this.playLog.playCounts,
    });
  }

  /** The plan, or the progress through it, as the menu shows it. */
  view(): SessionView {
    const nameOf = (id: string): string => this.menu.modeCards[id]?.name ?? titleFromId(id);
    if (this.active) return buildSessionView(this.queue!.steps, this.queue!.index, true, nameOf, (r) => stepReason(r as SessionStep['role']));
    return buildSessionView(this.plan(), 0, false, nameOf, (r) => stepReason(r as SessionStep['role']));
  }

  /** Play pressed: the current step of a session under way, else a new session. Null: nothing to play (no modes). */
  start(): string | null {
    if (!this.active) {
      const q = new SessionQueue(this.plan());
      this.queue = q.finished ? null : q;
    }
    return this.queue?.current?.modeId ?? null;
  }

  /** The player skipped the step. Null when the session is over. */
  skip(): string | null {
    const next = this.queue?.skip() ?? null;
    return next?.modeId ?? null;
  }

  /** The mode to start after a finished run: the session's next step; null when there is none. */
  next(): string | null {
    return this.queue?.current?.modeId ?? null;
  }

  /** Drop the session (the player picked a mode of their own, or left). */
  abandon(): void {
    this.queue?.end();
    this.queue = null;
  }
}
