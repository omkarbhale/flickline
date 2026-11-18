import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import { sweep as sweepCfg } from '../config/sweep';
import type { RunPaceSource } from '../feedback/ghostPace';
import type { RunEndReason } from '../sim/runEvents';
import { bandOf } from './bests';
import type { BandRecords, ContactRecord, ProgressData, RouteTile, RunBest } from './save';

/**
 * # Run records and situation records (design §8.4, §7.2, §14.5)
 *
 * Progress is the run's long arc: the best run per dial band, how deep it got, the Finales cleared, the Daily
 * Route's best of the day, and how the player does in each *situation* (scenario card). Three pieces, all pure:
 *
 *  - `RunRecorder` folds the run's events (design §14.3: `sectorEntered`, `sectorEnded`, `contactSettled` with its
 *    card, `medalAwarded`, `runEnded`) into one `RunRecord`: the route strip, the score at the end of each sector
 *    and the settled contacts. It reads the event facts only, through the few methods below, so the seam to the run
 *    director (#201, #204) is these payloads and nothing else.
 *  - `applyRunRecord` / `recordContacts` write a record into the save (`ProgressData`).
 *  - `RunPace` answers the pace bar: the live run against the best run's total at the same sector.
 *
 * Nothing here reads a clock, and nothing scores time: a slow run and a fast run that reach the same sector with
 * the same fights record the same (principle 10).
 */

/** The facts the recorder reads (a subset of the run events, so the bus or a log can feed it). */
export interface SectorEnteredFact {
  /** 0-based position in the run, as `sectorEntered` carries it; the strip prints it 1-based. */
  index: number;
  /** One of a new profile's placing Opener's contact sectors (all index 0): to the records they are one sector. */
  opener?: boolean;
  role: string;
  condition: string;
  stake: string;
}
export interface SectorEndedFact {
  cleared: boolean;
}
export interface ContactFact {
  outcome: 'cleared' | 'disengaged' | 'avoided' | 'died';
  kept: number;
  card?: string;
}

/** One settled contact, as the situation records keep it. */
export interface SettledContact {
  card: string;
  won: boolean;
  kept: number;
}

/** A finished run, ready to be written into the save. */
export interface RunRecord {
  seed: number;
  dial: number;
  /** The banked score (what the results card shows as the run score). */
  score: number;
  /** The deepest sector reached (1-based; 0 = none was entered) and the sectors cleared. */
  depth: number;
  cleared: number;
  /** The Finale was cleared (design §4.1). */
  finaleCleared: boolean;
  strip: RouteTile[];
  /** The run's total at the end of each sector (`pace[0]` after sector 1). */
  pace: number[];
  contacts: SettledContact[];
}

export class RunRecorder {
  private seed = 0;
  private dial = 0;
  private total = 0;
  private strip: RouteTile[] = [];
  private pace: number[] = [];
  private contacts: SettledContact[] = [];
  /** The tile of the sector being played (or just ended: it stays open for a late medal until the next sector or the end). */
  private open: RouteTile | null = null;
  private openEnded = false;
  /** The open tile is the placing Opener's and has been ended `openStages` times so far (its contact sectors are folded into it). */
  private openOpener = false;
  private openStages = 0;

  /**
   * `health` reads the player's health plus shield now (the strip prints it at each sector's entry and exit);
   * it is a getter so the recorder never has to guess the starting health.
   */
  constructor(private readonly health: () => number, private readonly finaleSector: number = sweepCfg.finaleSector) {}

  /** A new run (`runReady`). */
  begin(seed: number, dial: number): void {
    this.seed = seed;
    this.dial = dial;
    this.total = 0;
    this.strip = [];
    this.pace = [];
    this.contacts = [];
    this.open = null;
    this.openEnded = false;
    this.openOpener = false;
    this.openStages = 0;
  }

  /** The run's score is `total` (every `scoreAwarded` carries the running total). */
  scored(total: number): void {
    this.total = total;
  }

  /** Sectors finished so far, and the run's total at the end of the last of them (`pace()` reads both). */
  get sectorsDone(): number {
    return this.pace.length;
  }

  paceAt(k: number): number {
    return this.pace[k - 1] ?? 0;
  }

  sectorEntered(e: SectorEnteredFact): void {
    // The placing Opener's contact sectors are one sector of the run (design §8.5, §9.2): the tile and the pace
    // entry of the stage before are taken back and the next stage carries on in them.
    if (e.opener === true && this.open !== null && this.openOpener) {
      if (this.openEnded) this.pace.pop();
      this.openEnded = false;
      return;
    }
    this.closeOpen();
    this.openOpener = e.opener === true;
    this.openStages = 0;
    this.open = {
      index: e.index + 1, role: e.role, condition: e.condition, stake: e.stake,
      won: 0, lost: 0, hpIn: Math.round(this.health()), hpOut: 0, cleared: false, flawless: false,
    };
    this.openEnded = false;
  }

  sectorEnded(e: SectorEndedFact): void {
    const t = this.open;
    if (t === null || this.openEnded) return;
    t.cleared = e.cleared && (this.openStages === 0 || t.cleared);
    this.openStages++;
    t.hpOut = Math.round(this.health());
    this.openEnded = true;
    this.pace.push(Math.round(this.total));
  }

  contactSettled(e: ContactFact): void {
    // A contact nobody contested (the player left without a fight) says nothing about winning one.
    if (e.outcome === 'avoided') return;
    const won = e.outcome === 'cleared';
    const t = this.open;
    if (t !== null) {
      if (won) t.won++;
      else t.lost++;
    }
    if (e.card !== undefined && e.card !== '') this.contacts.push({ card: e.card, won, kept: e.kept });
  }

  /** A medal came in: Flawless, awarded when the sector ends, gives the sector its gold mark. */
  medal(id: string): void {
    if (id === 'flawless' && this.open !== null) this.open.flawless = true;
  }

  /** The run is over: its record, with the banked `score`. The sector in progress (death) is closed at the health it ended with. */
  finish(score: number): RunRecord {
    this.closeOpen();
    let depth = 0;
    let cleared = 0;
    let finaleCleared = false;
    for (const t of this.strip) {
      if (t.index > depth) depth = t.index;
      if (t.cleared) cleared++;
      if (t.cleared && t.index === this.finaleSector) finaleCleared = true;
    }
    return {
      seed: this.seed, dial: this.dial, score: Math.max(0, Math.round(score)), depth, cleared, finaleCleared,
      strip: this.strip, pace: this.pace, contacts: this.contacts,
    };
  }

  private closeOpen(): void {
    const t = this.open;
    if (t === null) return;
    if (!this.openEnded) t.hpOut = Math.round(this.health());
    this.strip.push(t);
    this.open = null;
  }
}

// ---------------------------------------------------------------- writing a record into the save

export interface ApplyResult {
  /** The run is the best of its band (the first on the band counts). */
  newBest: boolean;
  /** The best it replaced, or null when there was none. */
  previousBest: number | null;
  /** The run reached further than any before on its band. */
  newDeepest: boolean;
  /** The run cleared the Finale. */
  finaleCleared: boolean;
  /** The run is the Daily Route's best for its date (only when a date was given). */
  newDailyBest: boolean;
}

function toBest(rec: RunRecord, date: string): RunBest {
  return {
    score: rec.score, depth: Math.max(1, rec.depth), cleared: rec.cleared, seed: rec.seed, date, dial: rec.dial,
    strip: rec.strip.map((t) => ({ ...t })), pace: rec.pace.slice(),
  };
}

/** Is `a` further along than `b`: deeper, then more sectors cleared, then the higher score. */
export function isDeeper(a: { depth: number; cleared: number; score: number }, b: { depth: number; cleared: number; score: number } | null): boolean {
  if (b === null) return true;
  if (a.depth !== b.depth) return a.depth > b.depth;
  if (a.cleared !== b.cleared) return a.cleared > b.cleared;
  return a.score > b.score;
}

/**
 * Write a finished run into the run records: the band's best and deepest, the Finales cleared, and, when `dailyKey`
 * (a local `YYYY-MM-DD`) is given, the Daily Route's best for that date. A run that scored nothing or entered no
 * sector sets nothing. `date` is an ISO date-time the caller read from its clock.
 */
export function applyRunRecord(data: ProgressData, rec: RunRecord, date: string, dailyKey: string | null, cfg: ProgressTunables = progressCfg): ApplyResult {
  const out: ApplyResult = { newBest: false, previousBest: null, newDeepest: false, finaleCleared: false, newDailyBest: false };
  if (rec.depth < 1) return out;
  const band = bandOf(rec.dial, cfg);
  const recs: BandRecords = (data.runBests[band] ??= { best: null, deepest: null, finalesCleared: 0 });
  out.previousBest = recs.best?.score ?? null;
  out.finaleCleared = rec.finaleCleared;
  if (out.finaleCleared) recs.finalesCleared++;
  if (rec.score > 0) {
    if (recs.best === null || rec.score > recs.best.score) {
      recs.best = toBest(rec, date);
      out.newBest = true;
    }
    if (dailyKey !== null) {
      const day = data.dailyBests[dailyKey];
      if (day === undefined || rec.score > day.score) {
        data.dailyBests[dailyKey] = toBest(rec, date);
        out.newDailyBest = true;
        const keys = Object.keys(data.dailyBests).sort();
        for (let i = 0; i < keys.length - cfg.maxDailyBests; i++) delete data.dailyBests[keys[i]!];
      }
    }
  }
  if (isDeeper(rec, recs.deepest)) {
    recs.deepest = toBest(rec, date);
    out.newDeepest = true;
  }
  return out;
}

/** Add settled contacts to the situation records, keeping the last `situationWindow` per card. */
export function recordContacts(data: ProgressData, contacts: readonly SettledContact[], cfg: ProgressTunables = progressCfg): void {
  for (const c of contacts) {
    let list = data.situations[c.card];
    if (list === undefined) {
      if (Object.keys(data.situations).length >= cfg.maxCards) continue;
      list = data.situations[c.card] = [];
    }
    list.push({ won: c.won, kept: Math.round(Math.min(1, Math.max(0, c.kept)) * 100) / 100 });
    if (list.length > cfg.situationWindow) list.splice(0, list.length - cfg.situationWindow);
  }
}

/** A card's record over its last `last` contacts (default: all kept): how many, the win rate and the mean health kept; null where there is no sample. */
export interface SituationStats {
  contacts: number;
  wins: number;
  winRate: number | null;
  keptMean: number | null;
}

export function situationStats(list: readonly ContactRecord[] | undefined, last: number = Infinity): SituationStats {
  if (list === undefined || list.length === 0) return { contacts: 0, wins: 0, winRate: null, keptMean: null };
  const from = Math.max(0, list.length - last);
  let wins = 0;
  let kept = 0;
  for (let i = from; i < list.length; i++) {
    if (list[i]!.won) wins++;
    kept += list[i]!.kept;
  }
  const n = list.length - from;
  return { contacts: n, wins, winRate: wins / n, keptMean: kept / n };
}

// ---------------------------------------------------------------- the pace bar

/**
 * The pace bar's source (design §7.2): the best run of the run's band, compared at the same sector. Armed at
 * `runReady` with the best as it stood before the run; reads the recorder for the sectors done and the run's total
 * then. Before the first sector is done, or with no best run, there is no pace.
 */
export class RunPace implements RunPaceSource {
  private best: RunBest | null = null;
  private readonly out = { score: 0, reference: 0 };

  constructor(private readonly recorder: RunRecorder) {}

  arm(best: RunBest | null): void {
    this.best = best !== null && best.pace.length > 0 ? best : null;
  }

  clear(): void {
    this.best = null;
  }

  get armed(): boolean {
    return this.best !== null;
  }

  pace(): { score: number; reference: number } | null {
    const best = this.best;
    const k = this.recorder.sectorsDone;
    if (best === null || k === 0) return null;
    // Past the end of the best run's route the reference is the score it finished on.
    this.out.reference = k <= best.pace.length ? best.pace[k - 1]! : best.score;
    this.out.score = this.recorder.paceAt(k);
    return this.out;
  }
}

/** Does this end reason finish a run for the records (a quit is not a finished run)? */
export function recordsRun(reason: RunEndReason): boolean {
  return reason !== 'quit';
}
