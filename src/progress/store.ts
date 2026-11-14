import type { EventSink } from '../core/eventBus';
import type { SkillId } from '../config/dial';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import type { SkillSnapshot } from '../adaptive/skillModel';
import type { StorageLike } from '../settings/settings';
import { bandOf } from './bests';
import { JournalWriter, type PlayJournal } from './journal';
import type { ColdLevelState, ColdOpenerRecord } from './coldOpeners';
import { stepRank } from './ranks';
import { applyRunRecord, recordContacts, situationStats, type ApplyResult, type RunRecord, type SituationStats } from './runRecords';
import type { RunEndReason } from '../sim/runEvents';
import { defaultProgress, readProgress, sanitizeProgress, SAVE_VERSION, toSave, type BandRecords, type ProgressData, type RunBest, type RunSummary } from './save';

/**
 * The progress save behind an injected storage (design §14.5): load with migration, in-memory fallback,
 * size-capped history, write-through.
 *
 * Failure policy (the player never loses the game to storage):
 *  - no storage, or `getItem`/`setItem` throws (blocked, private mode, quota): the data lives in memory for this
 *    page load and `persistence` says why it is not being written;
 *  - the stored text is not a valid save: it is copied to `<key>.bak` before the first write replaces it, and the
 *    store starts fresh;
 *  - the stored save is from a *newer* build: it is left exactly as it is and nothing is written (`persistence` is
 *    `newer`), so going back to an old build never destroys newer progress.
 */
export type Persistence = 'ok' | 'memory' | 'failed' | 'newer';

export interface ProgressEvents {
  /** Something in the save changed. `modeId` names the mode a run was recorded for, else null. */
  progressChanged: { modeId: string | null };
}

declare module '../core/gameEvents' {
  interface GameEvents extends ProgressEvents {}
}

/** What `recordRun` made of a finished run (all false/null for a drill: it keeps a history entry and a count, nothing else). */
export type RecordResult = ApplyResult;

const NO_RESULT: RecordResult = { newBest: false, previousBest: null, newDeepest: false, finaleCleared: false, newDailyBest: false };

export class ProgressStore {
  private data: ProgressData = defaultProgress();
  private journalWriter: JournalWriter;
  private state: Persistence;
  private dirty = false;
  private batching = 0;

  constructor(
    private readonly events: EventSink<ProgressEvents> | null,
    private readonly storage: StorageLike | null,
    private readonly cfg: ProgressTunables = progressCfg,
  ) {
    this.state = storage === null ? 'memory' : 'ok';
    this.journalWriter = new JournalWriter(this.data.journal, cfg.journal);
    if (storage === null) return;
    let text: string | null = null;
    try {
      text = storage.getItem(cfg.storageKey);
    } catch {
      this.state = 'memory';
      return;
    }
    if (text === null) return;
    const r = readProgress(text, cfg);
    if (r.ok) {
      this.data = r.data;
      this.journalWriter = new JournalWriter(this.data.journal, cfg.journal);
      if (r.from < SAVE_VERSION) this.dirty = true; // migrated: written back in the current version on the next commit
    } else if (r.newer) {
      this.state = 'newer';
    } else {
      this.backUp(text);
    }
  }

  get persistence(): Persistence {
    return this.state;
  }

  /** The live data (read-only view; the store is the only writer). */
  get snapshot(): Readonly<ProgressData> {
    return this.data;
  }

  // ---- reads (the menu's three: best, plays, flaggedSkill) -------------------------------------

  /**
   * The best score of a mode over every band, or null if it has none: the best run for a run mode, the (read-only)
   * drill best of version 2 for a drill.
   */
  best(modeId: string): number | null {
    let best: number | null = null;
    if (this.cfg.runModes.includes(modeId)) {
      for (const id of Object.keys(this.data.runBests)) {
        const b = this.data.runBests[id]!.best;
        if (b !== null && (best === null || b.score > best)) best = b.score;
      }
      return best;
    }
    const bands = this.data.drillBests[modeId];
    if (!bands) return null;
    for (const id of Object.keys(bands)) if (best === null || bands[id]!.score > best) best = bands[id]!.score;
    return best;
  }

  /** The run records of the band `dial` falls in (design §8.4), or null before the first run there. */
  bandRecords(dial: number): BandRecords | null {
    return this.data.runBests[bandOf(dial, this.cfg)] ?? null;
  }

  /** The best run in the band of `dial`: the run the pace bar and the results card compare against. */
  bestRun(dial: number): RunBest | null {
    return this.bandRecords(dial)?.best ?? null;
  }

  /** The Daily Route's best for a local date (`YYYY-MM-DD`). */
  dailyBest(dateKey: string): RunBest | null {
    return this.data.dailyBests[dateKey] ?? null;
  }

  /** A scenario card's record over its last `last` contacts (default: the whole window of 50). */
  situation(card: string, last: number = Infinity): SituationStats {
    return situationStats(this.data.situations[card], last);
  }

  /** The scenario cards that have a record. */
  get situationCards(): string[] {
    return Object.keys(this.data.situations);
  }

  plays(modeId: string): number {
    return this.data.plays[modeId] ?? 0;
  }

  get playCounts(): Readonly<Record<string, number>> {
    return this.data.plays;
  }

  get flaggedSkill(): SkillId | null {
    return this.data.flaggedSkill;
  }

  /** The primary picked last on the Sweep `ready` screen, or '' before the first pick (design §4.1). */
  get lastPrimary(): string {
    return this.data.lastPrimary;
  }

  /** The play journal (read-only view; `journalReady` and the other journal writes are the only writers). */
  get journal(): Readonly<PlayJournal> {
    return this.data.journal;
  }

  medalCount(id: string): number {
    return this.data.medals[id]?.count ?? 0;
  }

  // ---- writes ----------------------------------------------------------------------------------

  /** Run several writes as one persisted change. */
  batch(fn: () => void): void {
    this.batching++;
    try {
      fn();
    } finally {
      this.batching--;
      if (this.batching === 0) this.commit();
    }
  }

  /**
   * A finished run: the history and the run count always; for a run mode, with its `record` (the route, the pace and
   * the settled contacts), also the run records of its band and the situation records. Drills keep no bests (design
   * §4.10). `dailyKey` is the local date when the run was the Daily Route.
   */
  recordRun(run: RunSummary, record: RunRecord | null, dailyKey: string | null = null): RecordResult {
    const d = this.data;
    d.plays[run.mode] = (d.plays[run.mode] ?? 0) + 1;
    d.history.push(run);
    if (d.history.length > this.cfg.historyMax) d.history.splice(0, d.history.length - this.cfg.historyMax);
    let result = NO_RESULT;
    if (record !== null && this.cfg.runModes.includes(run.mode)) {
      result = applyRunRecord(d, record, run.date, dailyKey, this.cfg);
      recordContacts(d, record.contacts, this.cfg);
    }
    this.changed(run.mode);
    return result;
  }

  /**
   * A run that ended without finishing (a quit): its settled contacts still say how the player fights, so they join the
   * situation records; nothing else is recorded.
   */
  recordContactsOnly(record: RunRecord): void {
    if (record.contacts.length === 0) return;
    recordContacts(this.data, record.contacts, this.cfg);
    this.changed(null);
  }

  /** The skill posterior after a run. */
  setRatings(snapshot: SkillSnapshot | null): void {
    this.data.ratings = snapshot;
    this.changed(null);
  }

  /**
   * Feed each rated skill's current sub-tier to its rank entry (design §8.4's buffer). Returns true when a skill
   * committed a sub-tier above its peak (the Ascent medal).
   */
  updateRanks(subs: ReadonlyArray<{ key: string; sub: number }>): boolean {
    let ascent = false;
    for (const { key, sub } of subs) {
      const step = stepRank(this.data.ranks[key] ?? null, sub, this.cfg);
      this.data.ranks[key] = step.entry;
      if (step.ascent) ascent = true;
    }
    this.changed(null);
    return ascent;
  }

  /** A medal was earned. Deferred by default (a mid-run award must not write storage in the middle of a fight): `commit()` writes it. */
  addMedal(id: string, date: string): void {
    const m = this.data.medals[id];
    this.data.medals[id] = { count: (m?.count ?? 0) + 1, last: date };
    this.dirty = true;
    this.events?.emit('progressChanged', { modeId: null });
  }

  /**
   * A cold opener ended for real (design §8.5): its record joins the list (capped, oldest dropped) and the level
   * state is replaced. Deferred like a medal (it ends mid-run, at the move into sector 2): `commit()` writes it.
   */
  addColdOpener(record: ColdOpenerRecord, level: ColdLevelState): void {
    const d = this.data;
    d.coldOpeners.push({ ...record } as unknown as Record<string, unknown>);
    if (d.coldOpeners.length > this.cfg.maxColdOpeners) d.coldOpeners.splice(0, d.coldOpeners.length - this.cfg.maxColdOpeners);
    d.coldOpenerLevels = { ...level, moves: level.moves.map((m) => ({ ...m })) } as unknown as Record<string, unknown>;
    this.dirty = true;
    this.events?.emit('progressChanged', { modeId: null });
  }

  /** Replace the cold opener's level state (after a warm answer changed what counted). */
  setColdOpenerLevel(level: ColdLevelState): void {
    this.data.coldOpenerLevels = { ...level, moves: level.moves.map((m) => ({ ...m })) } as unknown as Record<string, unknown>;
    this.changed(null);
  }

  /** The newest cold opener's answer to "Aimed in any game in the last hour?" (design §8.5); false when there is none. */
  setColdOpenerWarm(warm: boolean): boolean {
    const list = this.data.coldOpeners;
    const last = list[list.length - 1];
    if (!last) return false;
    if (last.warm === warm) return true;
    last.warm = warm;
    this.changed(null);
    return true;
  }

  // ---- the play journal (#251): all deferred, like a medal: a run's events must not write storage in the middle of a
  //      fight, so `commit()` (the run's end, `pagehide`) writes them ---------------------------------------------------

  /** A run was readied at `nowMs` (epoch ms). */
  journalReady(nowMs: number): void {
    this.journalWriter.ready(nowMs);
    this.dirty = true;
  }

  /** The run went live. */
  journalStarted(nowMs: number): void {
    this.journalWriter.started(nowMs);
    this.dirty = true;
  }

  /** A sector was entered (0-based `index`): the run's depth. */
  journalSector(index: number): void {
    this.journalWriter.sector(index);
  }

  /** The run ended after `liveSec` seconds live. */
  journalEnded(nowMs: number, liveSec: number, reason: RunEndReason): void {
    this.journalWriter.ended(nowMs, liveSec, reason);
    this.dirty = true;
  }

  setFlaggedSkill(skill: SkillId | null): void {
    if (this.data.flaggedSkill === skill) return;
    this.data.flaggedSkill = skill;
    this.changed(null);
  }

  /** The player picked a primary on the Sweep `ready` screen: it is the default of the next run. */
  setLastPrimary(id: string): void {
    if (this.data.lastPrimary === id) return;
    this.data.lastPrimary = id;
    this.changed(null);
  }

  /** Replace everything with `data` (an imported save, already through `readProgress`), persisted. */
  replace(data: ProgressData): void {
    this.data = sanitizeProgress(JSON.parse(JSON.stringify(data)), this.cfg);
    this.journalWriter = new JournalWriter(this.data.journal, this.cfg.journal);
    this.state = this.storage === null ? 'memory' : 'ok'; // an explicit import may overwrite a newer build's save
    this.changed(null);
  }

  /** Back to a fresh save. */
  reset(): void {
    this.replace(defaultProgress());
  }

  /** The data as a deep copy, for the export file. */
  exportData(): ProgressData {
    return sanitizeProgress(JSON.parse(JSON.stringify(this.data)), this.cfg);
  }

  /** Write the save if anything changed since the last write. Never throws. */
  commit(): void {
    if (!this.dirty || this.batching > 0) return;
    if (this.storage === null || this.state === 'newer') {
      this.dirty = false;
      return;
    }
    try {
      let text = JSON.stringify(toSave(this.data));
      // Over the cap: the oldest runs go first (they are the least useful and the biggest part).
      while (text.length > this.cfg.maxSaveBytes && this.data.history.length > 0) {
        this.data.history.splice(0, Math.max(1, this.data.history.length >> 2));
        text = JSON.stringify(toSave(this.data));
      }
      this.storage.setItem(this.cfg.storageKey, text);
      this.state = 'ok';
    } catch {
      this.state = 'failed';
    }
    this.dirty = false;
  }

  private changed(modeId: string | null): void {
    this.dirty = true;
    this.events?.emit('progressChanged', { modeId });
    if (this.batching === 0) this.commit();
  }

  private backUp(text: string): void {
    try {
      this.storage?.setItem(`${this.cfg.storageKey}.bak`, text);
    } catch {
      /* nothing more to do */
    }
  }
}
