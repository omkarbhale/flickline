import type { Subscribable } from '../core/eventBus';
import { clamp } from '../core/math';
import { displayRating, tier as tierOf, createTierInfo } from '../adaptive/dial';
import type { SkillId } from '../config/dial';
import { results as defaultResults, type FixCopy, type MetricId, type ResultsTunables } from '../config/results';
import { tunables } from '../config/tunables';
import type { RunEndReason } from '../sim/runEvents';
import type { RunLog } from './eventLog';
import type { RunStory, SectorTile, SituationRow } from './runStory';
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
  /** The player's first rating (the Placement run): there is no "before" worth showing, only the prior it started from. */
  first: boolean;
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

/** A route-strip tile, formatted. */
export interface RouteTileView {
  number: number;
  role: string;
  roleId: string;
  /** Condition and stake words; empty when the sector had none (a full-shield, plain sector). */
  condition: string;
  stake: string;
  /** `won` and `lost` contacts, e.g. "2 won · 1 lost"; "no fights" when the sector had none. */
  fights: string;
  won: number;
  lost: number;
  hpIn: number;
  hpOut: number;
  /** "82 → 61". */
  hp: string;
  hpTone: Tone;
  flawless: boolean;
  overtime: boolean;
  /** `cleared` (every Echo dead), `left` (walked out with Echoes alive), `fell` (the run ended in it, by death or quitting). */
  outcome: 'cleared' | 'left' | 'fell';
  /** One sentence for a screen reader. */
  label: string;
}

/** A "fights by situation" row, formatted. */
export interface SituationView {
  id: string;
  label: string;
  played: number;
  won: number;
  lost: number;
  /** "2 of 3 won", or "avoided" when none was fought. */
  summary: string;
  /** Win-rate share this run, 0..1 (null when nothing was fought). */
  rate: number | null;
  /** The running win rate over recent contacts ("67% over 18"), empty when the history is not known. */
  recent: string;
  tone: Tone;
}

export interface CardModel {
  mode: string;
  modeLabel: string;
  seed: number;
  endReason: RunEndReason | null;
  endLabel: string;
  /** No shots were fired: the card says so instead of showing a wall of dashes as if it were a result. */
  empty: boolean;
  /**
   * A clean run (design §7.4): played with no coaching cues and a reference-like HUD, so this result
   * is the closest thing to a reference-game score. The card says so.
   */
  clean: boolean;
  score: string;
  scoreValue: number | null;
  /** The score against the best it had to beat ("+345"); `—` without a personal best. */
  pbText: string;
  pbTone: Tone;
  /** Whether this run set a personal best: the first on the board (`first`), beat the old one (`beat`), or neither. */
  pbKind: 'first' | 'beat' | 'none';
  /** The line the card prints under the score ("New personal best", "−655 vs personal best"); empty when there is nothing to say. */
  pbLabel: string;
  /** Header (design §8.2 section 1): how deep the run got ("Sector 5 of 6", "Finale cleared", "Overtime 2"); empty without sectors. */
  depth: string;
  /** The death cause line (#123) when the run ended in a death and one is known, else null. */
  deathLine: string | null;
  /** Overtime points shown apart from the score (#206); null when the run never entered Overtime. */
  overtime: { points: string; state: 'banked' | 'lost' } | null;
  /** The route strip (design §8.2 section 2): one tile per sector entered; empty for a run without sectors. */
  route: RouteTileView[];
  /** Fights by situation (design §8.2 section 3): the scenario cards fought this run; empty without cards. */
  situations: SituationView[];
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
  rating: { skill: RatedSkill; before: number; after: number; first?: boolean } | null;
  /** Personal best score for this mode and dial band before this run, or null. */
  pb: number | null;
  medals: readonly string[];
  /** The sector run's story (route strip, fights by situation); omitted for a run without sectors. */
  story?: RunStory;
  /** The death cause line (#123), when known. */
  deathCause?: string | null;
  /** The player's recent win rate per scenario card (#104/#217), or null when unknown. */
  situationHistory?(card: string): { won: number; played: number } | null;
  /** The run was a clean run (default false). */
  clean?: boolean;
  /** Whether the mode keeps personal bests at all (default true; the Placement run does not). */
  keepsBest?: boolean;
}

/** Where the card gets a personal best from (#38 provides the real one). */
export interface PbSource {
  /** The best the run had to beat: as it stood BEFORE the run, whether or not the run has been recorded yet. */
  best(mode: string, dial: number): number | null;
  /** Whether the mode keeps personal bests (default true). */
  keepsBest?(mode: string): boolean;
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
    case 'leadError': {
      // + = the crosshair ran ahead of the Strafer (leading), - = behind it (lagging); design §3, §4.3.
      const b = s.leadErrorBiasDeg;
      const value = b === null ? DASH : `${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(1)}°`;
      const hint = b === null ? '' : Math.abs(b) < 0.5 ? 'on the line' : b > 0 ? 'you lead the target' : 'you lag behind';
      return { id, label: 'Lead error', value, hint };
    }
    case 'timeOnTarget':
      return { id, label: 'Time on target', value: formatPercent(s.timeOnTarget), hint: 'of the run' };
    case 'stopLatency':
      return { id, label: 'Stop latency', value: formatMs(s.medianStopLatencyMs), hint: s.stopCount > 0 ? `${s.stopCount} stops` : '' };
    case 'headHeight':
      return { id, label: 'Head height', value: formatDeg(s.headHeightDisciplineDeg), hint: 'off head level, lower is better' };
    case 'bestChain':
      return { id, label: 'Best chain', value: s.kills === 0 ? DASH : String(s.maxChain), hint: 'kills in a row, 1.5 s apart' };
    case 'cleanStreak':
      return { id, label: 'Clean streak', value: s.kills === 0 ? DASH : String(s.maxCleanStreak), hint: 'kills in a row, no miss' };
    case 'cleanKills':
      return { id, label: 'Clean kills', value: s.kills === 0 ? DASH : String(s.cleanKills), hint: s.kills > 0 ? `of ${s.kills} kills` : '' };
    case 'depth':
      return {
        id, label: 'Depth', value: s.sectorsTotal > 0 ? `${s.sectorsReached} / ${s.sectorsTotal}` : DASH,
        hint: s.sectorsTotal > 0 ? `${s.sectorsCleared} sector${s.sectorsCleared === 1 ? '' : 's'} cleared` : '',
      };
    case 'contacts': {
      const n = s.contactsWon + s.contactsLost;
      return { id, label: 'Fights won', value: n > 0 ? `${s.contactsWon} – ${s.contactsLost}` : DASH, hint: n > 0 ? `won – lost, of ${n} fights` : '' };
    }
  }
}

/** Median time to kill is meaningless when kills are one bullet (first shot to death rounds to 0 ms, #175). */
function ttkCell(s: RunStats, cfg: ResultsTunables): StatCell {
  const oneBullet = cfg.oneBulletModes.includes(s.mode) || (s.medianTtkMs !== null && Math.round(s.medianTtkMs) <= 0);
  return oneBullet ? metricCell(cfg.oneBulletTile, s) : { id: 'ttk', label: 'Time to kill', value: formatMs(s.medianTtkMs), hint: 'median' };
}

/**
 * The headline stats of design §8.2 section 5, then (drill modes) the mode's two key metrics (design §4). A sector
 * run shows exactly the design's six (`cfg.run.headline`): Accuracy, HS rate, median time to shot, median TTK,
 * moving shots and stop latency.
 */
export function statCells(s: RunStats, cfg: ResultsTunables = defaultResults): StatCell[] {
  const keys = cfg.keyMetrics[s.mode] ?? cfg.defaultKeyMetrics;
  const movingShare = s.shots > 0 ? s.movingShots / s.shots : null;
  const accuracy: StatCell = { id: 'accuracy', label: 'Accuracy', value: formatPercent(s.accuracy), hint: s.shots > 0 ? `${s.hits} of ${s.shots} shots` : 'no shots' };
  const headshotRate: StatCell = { id: 'headshotRate', label: 'HS rate', value: formatPercent(s.headshotRate), hint: s.hits > 0 ? `${s.headHits} of ${s.hits} hits` : '' };
  // Research P1 (docs/research/human-performance.md): this is visible-to-shot, which includes the aim movement,
  // so the player-facing name is "time to shot", never "reaction time".
  const timeToShot: StatCell = { id: 'timeToShot', label: 'Time to shot', value: formatMs(s.medianRtMs), hint: 'median' };
  const movingShots: StatCell = { id: 'movingShots', label: 'Moving shots', value: s.shots > 0 ? String(s.movingShots) : DASH, hint: movingShare === null ? '' : `${formatPercent(movingShare)} of shots` };
  if (cfg.run.modes.includes(s.mode)) {
    const byId: Record<string, StatCell> = { accuracy, headshotRate, timeToShot, ttk: ttkCell(s, cfg), movingShots, stopLatency: metricCell('stopLatency', s) };
    return cfg.run.headline.map((id) => byId[id] ?? metricCell(id as MetricId, s));
  }
  return [
    accuracy,
    headshotRate,
    timeToShot,
    ttkCell(s, cfg),
    movingShots,
    { id: 'kills', label: 'Kills', value: String(s.kills), hint: s.kills > 0 ? `${s.cleanKills} clean` : '' },
    metricCell(keys[0], s),
    metricCell(keys[1], s),
  ];
}

// ---------------------------------------------------------------- the route and the fights (design §8.2 sections 1-3)

function word(map: Readonly<Record<string, string>>, id: string): string {
  return id in map ? map[id]! : titleCase(id);
}

/** The header's depth line for a story ("Sector 5 of 6", "Finale cleared", "Overtime 2"); empty without sectors. */
export function depthLabel(story: RunStory, endReason: string | null, cfg: ResultsTunables = defaultResults): string {
  const n = story.sectors.length;
  if (n === 0) return '';
  const c = cfg.depthCopy;
  const finale = cfg.run.routeSectors;
  if (n > finale) return fill(c.overtime, { k: n - finale });
  const last = story.sectors[n - 1]!;
  // A route as long as the design's (six sectors, the last the Finale) is told in the design's words; a shorter
  // one (the run director's first version) is "n of total", and leaving at its end is clearing it.
  const total = story.total ?? finale;
  if (total >= finale) {
    if (n === finale) return endReason === 'death' ? c.finaleDied : last.cleared || endReason === 'left' ? c.finale : fill(c.sector, { n, total });
    return fill(c.sector, { n, total });
  }
  if (endReason === 'left' && n >= total) return fill(c.routeDone, { n });
  return fill(c.sector, { n, total });
}

function tileView(t: SectorTile, cfg: ResultsTunables): RouteTileView {
  const role = word(cfg.roleLabels, t.role);
  const condition = word(cfg.conditionLabels, t.condition);
  const stake = word(cfg.stakeLabels, t.stake);
  const fights = t.won + t.lost === 0 ? 'no fights' : `${t.won} won · ${t.lost} lost`;
  const dHp = Math.round(t.hpOut) - Math.round(t.hpIn);
  const hpIn = Math.round(t.hpIn);
  const hpOut = Math.round(t.hpOut);
  return {
    number: t.number,
    role,
    roleId: t.role,
    condition: t.condition in cfg.conditionLabels || t.condition === '' ? condition : titleCase(t.condition),
    stake,
    fights,
    won: t.won,
    lost: t.lost,
    hpIn,
    hpOut,
    hp: `${hpIn} → ${hpOut}`,
    hpTone: dHp > 0 ? 'good' : dHp <= -cfg.run.hurtHp ? 'bad' : 'even',
    flawless: t.flawless,
    overtime: t.overtime,
    outcome: t.fell ? 'fell' : t.cleared ? 'cleared' : 'left',
    label:
      `Sector ${t.number}${t.overtime ? ' (Overtime)' : ''}: ${role}${condition ? `, ${condition}` : ''}${stake ? `, ${stake}` : ''}. ` +
      `${fights}. Health ${hpIn} to ${hpOut}.${t.flawless ? ' Flawless.' : ''}`,
  };
}

function situationView(r: SituationRow, history: ResultsInput['situationHistory'], cfg: ResultsTunables): SituationView {
  const fought = r.won + r.lost;
  const recent = history?.(r.card) ?? null;
  return {
    id: r.card,
    label: word(cfg.cardLabels, r.card),
    played: r.played,
    won: r.won,
    lost: r.lost,
    summary: fought === 0 ? 'avoided' : `${r.won} of ${fought} won`,
    rate: fought === 0 ? null : r.won / fought,
    recent: recent && recent.played > 0 ? `${formatPercent(recent.won / recent.played)} over ${recent.played}` : '',
    tone: fought === 0 ? 'none' : r.won * 2 > fought ? 'good' : r.won * 2 < fought ? 'bad' : 'even',
  };
}

// ---------------------------------------------------------------- the card

function ratingView(r: NonNullable<ResultsInput['rating']>, cfg: ResultsTunables): RatingView {
  const before = displayRating(r.before);
  const after = displayRating(r.after);
  const tb = tierOf(r.before);
  const ta = tierOf(r.after, createTierInfo());
  const delta = after - before;
  const top = ta.index === tunables.dial.tiers.length - 1;
  const first = r.first === true;
  return {
    skill: cfg.skillLabels[r.skill] ?? titleCase(r.skill),
    before,
    after,
    delta,
    deltaText: first ? '' : formatDelta(delta),
    tone: first ? 'none' : toneOf(delta),
    beforeTier: tb.label,
    afterTier: ta.label,
    tierIndex: ta.index,
    first,
    tierShift: first ? 'same' : ta.index > tb.index || (ta.index === tb.index && ta.division > tb.division) ? 'up'
      : ta.index < tb.index || (ta.index === tb.index && ta.division < tb.division) ? 'down' : 'same',
    progress: ta.progress,
    progressText: top && ta.division === 0 ? 'Top tier' : `${Math.round(ta.progress * 100)}% to the next division`,
  };
}

/**
 * The personal-best line. A run sets a best when it scores above the old one (or there is none), mirroring
 * the run records (a new best is a higher score on its band); a run quit early is not recorded, so it never claims one. The first score on a board is a reward
 * moment of its own (design §7.3), so it says so instead of a dash (#175).
 */
function pbView(input: ResultsInput, endReason: string | null, noun: string): Pick<CardModel, 'pbText' | 'pbTone' | 'pbKind' | 'pbLabel'> {
  const none = { pbText: DASH, pbTone: 'none' as Tone, pbKind: 'none' as const, pbLabel: '' };
  if (input.score === null || input.keepsBest === false) return none;
  const recorded = endReason !== 'quit' && Math.round(input.score) > 0;
  if (input.pb === null) {
    return recorded ? { pbText: DASH, pbTone: 'good', pbKind: 'first', pbLabel: `New ${noun}` } : none;
  }
  const d = input.score - input.pb;
  const text = formatDelta(d);
  if (recorded && Math.round(input.score) > input.pb) return { pbText: text, pbTone: 'good', pbKind: 'beat', pbLabel: `New ${noun} ${text}` };
  return { pbText: text, pbTone: toneOf(d), pbKind: 'none', pbLabel: `${text} vs ${noun}` };
}

export function buildCard(rawInput: ResultsInput, cfg: ResultsTunables = defaultResults): CardModel {
  const s = rawInput.stats;
  // A sector run always scores: with nothing earned yet (no kill, settle or clear paid) it scored 0, not "no score".
  const input = rawInput.score === null && cfg.run.modes.includes(s.mode) ? { ...rawInput, score: 0 } : rawInput;
  const medals = new Map<string, MedalView>();
  for (const id of input.medals) {
    const m = medals.get(id);
    if (m) m.count++;
    else medals.set(id, { id, label: cfg.medalLabels[id] ?? titleCase(id), count: 1 });
  }

  const isRun = cfg.run.modes.includes(s.mode);
  const story = input.story ?? null;
  const pb = pbView(input, s.endReason, isRun ? 'best run' : 'personal best');
  const reason: string | null = s.endReason;
  const overtimeTiles = story ? story.sectors.filter((t) => t.overtime) : [];
  const overtimePoints = overtimeTiles.reduce((n, t) => n + t.points, 0);

  return {
    mode: s.mode,
    modeLabel: cfg.modeLabels[s.mode] ?? titleCase(s.mode || 'run'),
    seed: s.seed,
    endReason: s.endReason,
    endLabel: reason ? (cfg.endLabels[reason] ?? titleCase(reason)) : '',
    empty: s.shots === 0,
    clean: input.clean === true,
    score: input.score === null ? DASH : formatThousands(input.score),
    scoreValue: input.score,
    ...pb,
    depth: story ? depthLabel(story, reason, cfg) : '',
    deathLine: reason === 'death' ? (input.deathCause ?? null) : null,
    overtime:
      overtimeTiles.length === 0
        ? null
        : { points: formatThousands(overtimePoints), state: reason === 'death' ? 'lost' : 'banked' },
    route: story ? story.sectors.map((t) => tileView(t, cfg)) : [],
    situations: story ? story.situations.map((r) => situationView(r, input.situationHistory, cfg)) : [],
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
  /** Whether the run that just started is a clean run (read at `runEnded`). */
  isClean?(): boolean;
  /** True for a mode whose result is the player's first rating (the Placement run): shown without a delta. */
  firstRating?(mode: string): boolean;
  /** The run's story (`RunStoryTracker`): route strip and fights by situation. Omit for a run without sectors. */
  story?: { snapshot(): RunStory };
  /** The death cause line (#123) for the run that just ended, if the attribution engine has one. */
  deathCause?(): string | null;
  /** The player's recent win rate per scenario card (#104 / #217), if the progress record has one. */
  situationHistory?(card: string): { won: number; played: number } | null;
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
  private first = false;
  private score: number | null = null;
  private medals: string[] = [];
  private readonly pbSource: PbSource;
  private readonly cfg: ResultsTunables;

  constructor(private readonly deps: ResultsRecorderDeps) {
    this.cfg = deps.cfg ?? defaultResults;
    this.pbSource = deps.pb ?? NO_PB;
    deps.bus.on('runReady', (e) => {
      this.skill = deps.skillOf(e.mode);
      this.before = this.skill === null ? 0 : deps.ratings.rating(this.skill);
      this.first = deps.firstRating?.(e.mode) === true;
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

  private finish(): void {
    const { run, ratings } = this.deps;
    const stats = run.liveStats();
    const rating = this.skill === null ? null : { skill: this.skill, before: this.before, after: ratings.rating(this.skill), first: this.first };
    const card = buildCard(
      {
        stats,
        split: shotSplit(run.log),
        score: this.score,
        rating,
        pb: this.pbSource.best(stats.mode, stats.dial),
        keepsBest: this.pbSource.keepsBest?.(stats.mode) !== false,
        medals: this.medals,
        story: this.deps.story?.snapshot(),
        deathCause: this.deps.deathCause?.() ?? null,
        situationHistory: this.deps.situationHistory,
        clean: this.deps.isClean?.() === true,
      },
      this.cfg,
    );
    this.last = card;
    this.deps.onCard(card);
  }
}
