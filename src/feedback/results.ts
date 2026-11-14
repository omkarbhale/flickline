import type { Subscribable } from '../core/eventBus';
import { clamp } from '../core/math';
import { displayRating, tier as tierOf, createTierInfo } from '../adaptive/dial';
import type { SkillId } from '../config/dial';
import { results as defaultResults, type FixCopy, type MetricId, type ResultsTunables } from '../config/results';
import { tunables } from '../config/tunables';
import type { RunEndReason } from '../sim/runEvents';
import type { RunLog } from './eventLog';
import type { RunStats } from './statTracker';

/**
 * # End-of-run results card model (design §8.2 sections 1-5)
 *
 * Pure: turns a finished run's `RunStats` (`computeStats` / the live tracker), the mode's score,
 * the skill rating before and after, an optional personal best and the medals earned into the
 * plain data the card renders. Every number is already formatted to the text the player reads
 * ("—" when a stat is undefined for this run: never a fake zero). The DOM lives in
 * `ui/resultsCard.ts`; `ResultsRecorder` below listens to the run's events and hands a finished
 * card to it within the same frame as `runEnded`.
 *
 * Out of scope here: medals (#38 awards them; this lists what arrives as `medalAwarded`), personal
 * bests (#38 computes them; this takes a `PbSource`), and the detail panels and the ranked fix
 * engine (#39; the one-thing-to-fix here is the stub of issue #26).
 */

export const DASH = '—';

/** A skill whose rating the mode moves, or `line` (Sweep: all seven). */
export type RatedSkill = SkillId | 'line';

export interface StatCell {
  id: string;
  label: string;
  /** Formatted value, or `—`. */
  value: string;
  /** Small second line (counts, units), may be empty. */
  hint: string;
}

export type Tone = 'good' | 'bad' | 'even' | 'none';

export interface RatingView {
  skill: string;
  /** Display ratings (0-3000). */
  before: number;
  after: number;
  delta: number;
  deltaText: string;
  tone: Tone;
  beforeTier: string;
  afterTier: string;
  /** Index into the tier table of the rating after the run (for the badge colour). */
  tierIndex: number;
  tierShift: 'up' | 'down' | 'same';
  /** Progress 0..1 through the current sub-tier. */
  progress: number;
  progressText: string;
}

export type FixKind = 'movingShots' | 'slowTimeToShot' | 'placeholder';

export interface FixView {
  kind: FixKind;
  title: string;
  evidence: string;
  action: string;
}

export interface MedalView {
  id: string;
  label: string;
  count: number;
}

export interface CardModel {
  mode: string;
  modeLabel: string;
  seed: number;
  endReason: RunEndReason | null;
  endLabel: string;
  /** No shots were fired: the card says so instead of showing a wall of dashes as if it were a result. */
  empty: boolean;
  score: string;
  scoreValue: number | null;
  /** `—` without a personal best. */
  pbText: string;
  pbTone: Tone;
  /** Null when the run does not move a rating (a plain run). */
  rating: RatingView | null;
  stats: StatCell[];
  medals: MedalView[];
  fix: FixView;
}

/** How the run's shots split by movement state, from the event log. */
export interface ShotSplit {
  movingShots: number;
  movingHits: number;
  stoppedShots: number;
  stoppedHits: number;
}

export interface ResultsInput {
  stats: RunStats;
  split: ShotSplit | null;
  /** The mode's score; null for a run that does not score. */
  score: number | null;
  /** Dial-scale ratings (0-100) before and after, for the skill the run moves; null if none. */
  rating: { skill: RatedSkill; before: number; after: number } | null;
  /** Personal best score for this mode and dial band before this run, or null. */
  pb: number | null;
  medals: readonly string[];
}

/** Where the card gets a personal best from (#38 provides the real one). */
export interface PbSource {
  best(mode: string, dial: number): number | null;
}

/** The skill model's side: `SkillState` satisfies it. */
export interface RatingSource {
  rating(skill: RatedSkill): number;
}

const NO_PB: PbSource = { best: () => null };
export const noPb = NO_PB;

// ---------------------------------------------------------------- formatting

export function formatThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPercent(v: number | null): string {
  return v === null ? DASH : `${Math.round(v * 100)}%`;
}

export function formatMs(v: number | null): string {
  return v === null ? DASH : `${Math.round(v)} ms`;
}

export function formatDeg(v: number | null): string {
  return v === null ? DASH : `${v.toFixed(1)}°`;
}

/** "+14", "−3" (a true minus sign), "±0". */
export function formatDelta(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '±0';
  return r > 0 ? `+${formatThousands(r)}` : `−${formatThousands(-r)}`;
}

function toneOf(delta: number): Tone {
  const r = Math.round(delta);
  return r > 0 ? 'good' : r < 0 ? 'bad' : 'even';
}

function titleCase(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Replace `{name}` placeholders; an unknown name is left as is so a copy typo is visible, not silent. */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------- seeds

/** The seed of the run after `seed`: a fixed LCG step, so "play again" is a fresh layout and replayable. */
export function nextSeed(seed: number, cfg: ResultsTunables = defaultResults): number {
  return (Math.imul(seed >>> 0, cfg.nextSeed.mul) + cfg.nextSeed.add) >>> 0;
}

// ---------------------------------------------------------------- shots by movement state

/** Count shots and hits by movement state (`shotFired.moving`, flagged at fire time) from the run's log. */
export function shotSplit(log: RunLog): ShotSplit {
  const out: ShotSplit = { movingShots: 0, movingHits: 0, stoppedShots: 0, stoppedHits: 0 };
  const moving = new Map<number, boolean>();
  for (const e of log.events) {
    if (e.type === 'shotFired') {
      moving.set(e.data.shotId, e.data.moving);
      if (e.data.moving) out.movingShots++;
      else out.stoppedShots++;
    } else if (e.type === 'shotImpact' && e.data.result === 'hit') {
      const m = moving.get(e.data.shotId);
      if (m === undefined) continue;
      if (m) out.movingHits++;
      else out.stoppedHits++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- one thing to fix (stub)

/** Expected median time to shot (ms) at a dial, per `slowTimeToShot` (linear between its two ends). */
export function timeToShotBaselineMs(dial: number, cfg: ResultsTunables = defaultResults): number {
  const s = cfg.slowTimeToShot;
  return s.dial0Ms + (s.dial100Ms - s.dial0Ms) * (clamp(dial, 0, 100) / 100);
}

function fixView(kind: FixKind, copy: FixCopy, vars: Readonly<Record<string, string | number>> = {}): FixView {
  return { kind, title: copy.title, evidence: fill(copy.evidence, vars), action: fill(copy.action, vars) };
}

/**
 * The stub of design §8.3 for issue #26: one sentence of evidence and one of advice for the
 * clearest of two weaknesses (moving shots, slow time to shot), else a placeholder "Play again".
 * Deterministic, and copy comes from `config/results.ts`. #39 replaces it with the ranked engine.
 */
export function pickFix(stats: RunStats, split: ShotSplit | null, cfg: ResultsTunables = defaultResults): FixView {
  const c = cfg.copy;
  if (stats.shots === 0) return fixView('placeholder', c.empty);
  if (stats.shots < cfg.minShotsForFix) return fixView('placeholder', c.placeholder);

  const share = stats.movingShots / stats.shots;
  const sevMoving = share > cfg.movingShotShare ? share / cfg.movingShotShare : 0;

  let sevSlow = 0;
  const timed = stats.targets.reduce((n, t) => n + (t.rtMs !== null ? 1 : 0), 0);
  const baseline = timeToShotBaselineMs(stats.dial, cfg);
  const limit = baseline * cfg.slowTimeToShot.slackFactor;
  const rt = stats.medianRtMs;
  if (rt !== null && timed >= cfg.minTimedTargets && rt > limit) sevSlow = rt / limit;

  if (sevMoving === 0 && sevSlow === 0) return fixView('placeholder', c.placeholder);

  if (sevMoving >= sevSlow) {
    const vars = { share: formatPercent(share), moving: stats.movingShots, shots: stats.shots };
    if (split && split.movingShots > 0 && split.stoppedShots > 0) {
      return fixView('movingShots', c.movingShots, {
        ...vars,
        movingAcc: formatPercent(split.movingHits / split.movingShots),
        stoppedAcc: formatPercent(split.stoppedHits / split.stoppedShots),
      });
    }
    return fixView('movingShots', c.movingShotsNoSplit, vars);
  }
  return fixView('slowTimeToShot', c.slowTimeToShot, {
    rt: formatMs(rt),
    over: formatMs((rt as number) - baseline),
    baseline: formatMs(baseline),
  });
}

// ---------------------------------------------------------------- stats cells

function firstShotRate(stats: RunStats): { value: number; of: number } | null {
  let engaged = 0;
  let firstKills = 0;
  for (const t of stats.targets) {
    if (t.bullets === 0) continue;
    engaged++;
    if (t.killed && t.firstBullet) firstKills++;
  }
  return engaged === 0 ? null : { value: firstKills / engaged, of: engaged };
}

function metricCell(id: MetricId, s: RunStats): StatCell {
  switch (id) {
    case 'firstShotRate': {
      const f = firstShotRate(s);
      return { id, label: 'First-shot kills', value: f ? formatPercent(f.value) : DASH, hint: f ? `of ${f.of} targets` : '' };
    }
    case 'preAimError':
      return { id, label: 'Pre-aim error', value: formatDeg(s.preAimErrorDeg), hint: 'median, lower is better' };
    case 'flickBias': {
      const b = s.flickErrorBiasDeg;
      const value = b === null ? DASH : `${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(1)}°`;
      const hint = b === null ? '' : Math.abs(b) < 0.5 ? 'on the mark' : b > 0 ? 'you overshoot' : 'you undershoot';
      return { id, label: 'Flick bias', value, hint };
    }
    case 'flickError':
      return { id, label: 'Flick error', value: formatDeg(s.flickErrorMeanAbsDeg), hint: s.flickCount > 0 ? `${s.flickCount} flicks` : '' };
    case 'timeOnTarget':
      return { id, label: 'Time on target', value: formatPercent(s.timeOnTarget), hint: 'of the run' };
    case 'stopLatency':
      return { id, label: 'Stop latency', value: formatMs(s.medianStopLatencyMs), hint: s.stopCount > 0 ? `${s.stopCount} stops` : '' };
    case 'headHeight':
      return { id, label: 'Head height', value: formatDeg(s.headHeightDisciplineDeg), hint: 'off head level, lower is better' };
    case 'bestChain':
      return { id, label: 'Best chain', value: s.kills === 0 ? DASH : String(s.maxChain), hint: 'kills in a row, 1.5 s apart' };
    case 'cleanKills':
      return { id, label: 'Clean kills', value: s.kills === 0 ? DASH : String(s.cleanKills), hint: s.kills > 0 ? `of ${s.kills} kills` : '' };
  }
}

/** The headline stats of design §8.2 section 3, then the mode's two key metrics (design §4). */
export function statCells(s: RunStats, cfg: ResultsTunables = defaultResults): StatCell[] {
  const keys = cfg.keyMetrics[s.mode] ?? cfg.defaultKeyMetrics;
  const movingShare = s.shots > 0 ? s.movingShots / s.shots : null;
  return [
    { id: 'accuracy', label: 'Accuracy', value: formatPercent(s.accuracy), hint: s.shots > 0 ? `${s.hits} of ${s.shots} shots` : 'no shots' },
    { id: 'headshotRate', label: 'Headshots', value: formatPercent(s.headshotRate), hint: s.hits > 0 ? `${s.headHits} of ${s.hits} hits` : '' },
    // Research P1 (docs/research/human-performance.md): this is visible-to-shot, which includes the aim movement,
    // so the player-facing name is "time to shot", never "reaction time".
    { id: 'timeToShot', label: 'Time to shot', value: formatMs(s.medianRtMs), hint: 'median' },
    { id: 'ttk', label: 'Time to kill', value: formatMs(s.medianTtkMs), hint: 'median' },
    { id: 'movingShots', label: 'Moving shots', value: s.shots > 0 ? String(s.movingShots) : DASH, hint: movingShare === null ? '' : `${formatPercent(movingShare)} of shots` },
    { id: 'kills', label: 'Kills', value: String(s.kills), hint: s.kills > 0 ? `${s.cleanKills} clean` : '' },
    metricCell(keys[0], s),
    metricCell(keys[1], s),
  ];
}

// ---------------------------------------------------------------- the card

function ratingView(r: NonNullable<ResultsInput['rating']>, cfg: ResultsTunables): RatingView {
  const before = displayRating(r.before);
  const after = displayRating(r.after);
  const tb = tierOf(r.before);
  const ta = tierOf(r.after, createTierInfo());
  const delta = after - before;
  const top = ta.index === tunables.dial.tiers.length - 1;
  return {
    skill: cfg.skillLabels[r.skill] ?? titleCase(r.skill),
    before,
    after,
    delta,
    deltaText: formatDelta(delta),
    tone: toneOf(delta),
    beforeTier: tb.label,
    afterTier: ta.label,
    tierIndex: ta.index,
    tierShift: ta.index > tb.index || (ta.index === tb.index && ta.division > tb.division) ? 'up'
      : ta.index < tb.index || (ta.index === tb.index && ta.division < tb.division) ? 'down' : 'same',
    progress: ta.progress,
    progressText: top && ta.division === 0 ? 'Top tier' : `${Math.round(ta.progress * 100)}% to the next division`,
  };
}

export function buildCard(input: ResultsInput, cfg: ResultsTunables = defaultResults): CardModel {
  const s = input.stats;
  const medals = new Map<string, MedalView>();
  for (const id of input.medals) {
    const m = medals.get(id);
    if (m) m.count++;
    else medals.set(id, { id, label: cfg.medalLabels[id] ?? titleCase(id), count: 1 });
  }

  let pbText = DASH;
  let pbTone: Tone = 'none';
  if (input.score !== null && input.pb !== null) {
    const d = input.score - input.pb;
    pbText = formatDelta(d);
    pbTone = toneOf(d);
  }

  return {
    mode: s.mode,
    modeLabel: cfg.modeLabels[s.mode] ?? titleCase(s.mode || 'run'),
    seed: s.seed,
    endReason: s.endReason,
    endLabel: s.endReason ? cfg.endLabels[s.endReason] : '',
    empty: s.shots === 0,
    score: input.score === null ? DASH : formatThousands(input.score),
    scoreValue: input.score,
    pbText,
    pbTone,
    rating: input.rating ? ratingView(input.rating, cfg) : null,
    stats: statCells(s, cfg),
    medals: Array.from(medals.values()),
    fix: pickFix(s, input.split, cfg),
  };
}

// ---------------------------------------------------------------- recorder

/** The events the recorder reads (a subset of the game bus's). */
export interface ResultsEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runEnded: { tick: number; t: number; reason: RunEndReason };
  scoreAwarded: { total: number };
  medalAwarded: { tick: number; id: string };
}

/** The run the recorder reads: `RunController` satisfies it. */
export interface RunReader {
  readonly log: RunLog;
  liveStats(): RunStats;
}

export interface ResultsRecorderDeps {
  bus: Subscribable<ResultsEvents>;
  run: RunReader;
  ratings: RatingSource;
  /** The skill a mode moves (or `line`), null for a run that does not move a rating. */
  skillOf(mode: string): RatedSkill | null;
  pb?: PbSource;
  cfg?: ResultsTunables;
  /** Called synchronously inside the `runEnded` dispatch with the finished card. */
  onCard(card: CardModel): void;
  /** Called on `runReady`: the previous card is stale. */
  onNewRun?(): void;
}

/**
 * Collects what the card needs while a run plays (score, medals, the rating before) and builds the
 * card at `runEnded`. Subscribe it after the `RunController` so the controller's own `runEnded`
 * handler (which freezes the stats) has run first.
 */
export class ResultsRecorder {
  last: CardModel | null = null;
  private skill: RatedSkill | null = null;
  private before = 0;
  private score: number | null = null;
  private medals: string[] = [];
  private pbSource: PbSource;
  private readonly cfg: ResultsTunables;

  constructor(private readonly deps: ResultsRecorderDeps) {
    this.cfg = deps.cfg ?? defaultResults;
    this.pbSource = deps.pb ?? NO_PB;
    deps.bus.on('runReady', (e) => {
      this.skill = deps.skillOf(e.mode);
      this.before = this.skill === null ? 0 : deps.ratings.rating(this.skill);
      this.score = null;
      this.medals = [];
      this.last = null;
      deps.onNewRun?.();
    });
    deps.bus.on('scoreAwarded', (e) => {
      this.score = e.total;
    });
    deps.bus.on('medalAwarded', (e) => this.medals.push(e.id));
    deps.bus.on('runEnded', () => this.finish());
  }

  /** Swap the personal-best provider (the debug hook and #38). */
  setPbSource(pb: PbSource | null): void {
    this.pbSource = pb ?? NO_PB;
  }

  private finish(): void {
    const { run, ratings } = this.deps;
    const stats = run.liveStats();
    const rating = this.skill === null ? null : { skill: this.skill, before: this.before, after: ratings.rating(this.skill) };
    const card = buildCard(
      {
        stats,
        split: shotSplit(run.log),
        score: this.score,
        rating,
        pb: this.pbSource.best(stats.mode, stats.dial),
        medals: this.medals,
      },
      this.cfg,
    );
    this.last = card;
    this.deps.onCard(card);
  }
}
