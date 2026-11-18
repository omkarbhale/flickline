import { SKILL_IDS, type SkillId } from '../../config/dial';
import { GATE_POLICIES, OVERTIME_POLICIES, type GatePolicy, type OvertimePolicy } from './gatePolicy';
import { cloneTunables, type Tunables } from '../../config/tunables';
import { pickFix, shotSplit } from '../../feedback/results';
import { dealableCards, leanView } from '../../modes/lean';
import { createFightPaceStats, FightPace, type FightPaceStats } from '../../feedback/fightPace';
import { HeadlessGame } from './headless';
import { playMode } from './play';

/**
 * The Sweep balance report (#201): the bot plays seeded runs at a few skills and the numbers a
 * balance pass reads come back per skill: contact win rate, sectors reached, health at each exit,
 * run length. No pass threshold (the balance pass #53 sets targets); `npm run bot -- --sweep-report`.
 */

export interface SweepRunFacts {
  seed: number;
  endReason: string | null;
  /** Sectors entered (1-based depth) and the run's sector count. */
  reached: number;
  sectors: number;
  /** Health + shield at each sector exit the player walked out of. */
  ehpAtExit: number[];
  contacts: { cleared: number; disengaged: number; avoided: number; died: number };
  /** Live seconds from `runStarted` to `runEnded`. */
  liveSec: number;
  score: number;
  kills: number;
  /** Cards dealt, in order. */
  cards: string[];
  /** Stakes of the sectors entered through a door, in order (design §4.5). */
  stakes: string[];
  /** The Finale was cleared (its exit walked out of: the run reached its Overtime gate, design §4.7, #206). */
  finaleCleared: boolean;
  /** Overtime sectors entered, and the Overtime points a Leave door banked or the end forfeited. */
  overtimeSectors: number;
  overtimeBanked: number;
  overtimeLost: number;
  /** Fight pace of the run (#248): fights per live minute, dead air, gates. */
  pace: FightPaceStats;
  /** Every first sighting (`enemySawPlayer`, once per Echo): horizontal distance player to Echo and the Echo's feet above the player's, metres (#249). */
  sights: FirstSight[];
}

/** One first sighting of an Echo (#249): how far, and how far up or down. */
export interface FirstSight {
  /** The sector the Echo was in (`map/sector`), for the per-sector table. */
  sector: string;
  distM: number;
  /** Echo feet minus player feet, metres: positive = the Echo is above. */
  dy: number;
}

export interface SweepSkillRow {
  skill: number;
  runs: number;
  /** Cleared ÷ (cleared + died + disengaged): fights won of fights fought (avoided contacts are not fights). */
  contactWinRate: number;
  /** Contacts that were fought at all, per run. */
  contactsPerRun: number;
  /** Mean depth reached and the share of runs that left through the last exit. */
  meanReached: number;
  finishedShare: number;
  /** Mean health+shield at the exit of sector 1, 2, ... (over the runs that walked out of it), and how many did. */
  meanEhpAtExit: number[];
  exitsSeen: number[];
  meanLiveSec: number;
  meanScore: number;
  /** The first-sight distribution of every Echo fought at this skill (#249), overall and by sector. */
  sight: SightStats;
  sightBySector: Record<string, SightStats>;
}

/** First-sight distance and height facts over a set of sightings (#249; design §9.4's distance axis, §10's bands). */
export interface SightStats {
  n: number;
  /** Horizontal distance percentiles, metres (10th, 25th, 50th, 75th, 90th); 0 when there are none. */
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** Share of sightings beyond `LONG_M` metres. */
  beyond20: number;
  /** Share with a height difference above `HEIGHT_DIFF_M` metres (either way). */
  heightDiff: number;
}

/** "Long" starts here (design §10, #249: the target is a share of fights beyond 20 m). */
export const LONG_M = 20;
/** A height difference above this counts as a fight across levels (#249). */
export const HEIGHT_DIFF_M = 1;

/** The distribution of a list of sightings. */
export function sightStats(sights: readonly FirstSight[]): SightStats {
  const d = sights.map((x) => x.distM).sort((a, b) => a - b);
  const n = sights.length;
  return {
    n,
    p10: quantile(d, 0.1), p25: quantile(d, 0.25), p50: quantile(d, 0.5), p75: quantile(d, 0.75), p90: quantile(d, 0.9),
    beyond20: n ? sights.filter((x) => x.distM > LONG_M).length / n : 0,
    heightDiff: n ? sights.filter((x) => Math.abs(x.dy) > HEIGHT_DIFF_M).length / n : 0,
  };
}

/** The distribution of the sightings of each sector. */
export function bySector(sights: readonly FirstSight[]): Record<string, SightStats> {
  const groups: Record<string, FirstSight[]> = {};
  for (const x of sights) (groups[x.sector] ??= []).push(x);
  const out: Record<string, SightStats> = {};
  for (const k of Object.keys(groups).sort()) out[k] = sightStats(groups[k]!);
  return out;
}

/** Who walks the route: the bot (runs every metre, turns at 360°/s) or the scripted human pace (`HUMAN_PACE`, #248). */
export type Walker = 'bot' | 'human';

/** One seeded run at one skill, with the sweep facts taken from the bus. */
export function sweepRun(
  skill: number, seed: number, pinDial?: number, gatePolicy?: GatePolicy, overtimePolicy?: OvertimePolicy, walker: Walker = 'bot',
): SweepRunFacts {
  const g = new HeadlessGame({ seed });
  const f: SweepRunFacts = {
    seed, endReason: null, reached: 0, sectors: 0, ehpAtExit: [], contacts: { cleared: 0, disengaged: 0, avoided: 0, died: 0 },
    liveSec: 0, score: 0, kills: 0, cards: [], stakes: [], sights: [], finaleCleared: false, overtimeSectors: 0, overtimeBanked: 0, overtimeLost: 0,
    pace: createFightPaceStats(),
  };
  let sector = '';
  const pace = new FightPace(g.bus, g.world, g.tunables);
  g.bus.on('sectorEntered', (e) => {
    sector = `${e.mapId}/${e.sectorId}`;
    f.reached = e.index + 1;
    f.sectors = e.of;
    if (e.index >= e.of) f.overtimeSectors = e.index - e.of + 1;
    if (e.index > 0) f.stakes.push(e.stake);
  });
  g.bus.on('sectorEnded', (e) => {
    if (e.reason === 'exit') f.ehpAtExit[e.index] = g.world.health.hp + g.world.health.shield;
    if (e.reason === 'exit' && e.index === f.sectors - 1) f.finaleCleared = true;
  });
  g.bus.on('runBanked', (e) => {
    f.overtimeBanked = e.points;
  });
  g.bus.on('overtimeLost', (e) => {
    f.overtimeLost = e.points;
  });
  g.bus.on('contactSettled', (e) => {
    f.contacts[e.outcome]++;
    if (e.card) f.cards.push(e.card);
  });
  g.bus.on('enemySawPlayer', (e) => {
    const t = g.world.targetField.byId(e.targetId);
    if (!t) return;
    const p = g.world.player.pos;
    f.sights.push({ sector, distM: Math.hypot(t.pos.x - p.x, t.pos.z - p.z), dy: t.pos.y - p.y });
  });
  const r = playMode(g, {
    mode: 'sweep', skill, seed, pinDial, gatePolicy, overtimePolicy, sweepHumanPace: walker === 'human', onTick: () => pace.tick(),
  });
  pace.read(f.pace);
  pace.dispose();
  f.endReason = r.stats.endReason;
  f.liveSec = r.stats.liveSec;
  f.score = r.modeRun?.score ?? 0;
  f.kills = r.stats.kills;
  return f;
}

export function sweepReport(
  skills: readonly number[], runs: number, firstSeed = 1, pinDial?: number, gatePolicy?: GatePolicy, walker: Walker = 'bot',
): { rows: SweepSkillRow[]; runs: SweepRunFacts[] } {
  const all: SweepRunFacts[] = [];
  const rows: SweepSkillRow[] = [];
  for (const skill of skills) {
    const list: SweepRunFacts[] = [];
    for (let i = 0; i < runs; i++) list.push(sweepRun(skill, firstSeed + i, pinDial, gatePolicy, undefined, walker));
    all.push(...list);
    let won = 0, fought = 0, reached = 0, finished = 0, live = 0, score = 0;
    const ehpSum: number[] = [], ehpN: number[] = [];
    for (const f of list) {
      won += f.contacts.cleared;
      fought += f.contacts.cleared + f.contacts.died + f.contacts.disengaged;
      reached += f.reached;
      if (f.endReason === 'left') finished++;
      live += f.liveSec;
      score += f.score;
      f.ehpAtExit.forEach((v, k) => {
        if (v === undefined) return;
        ehpSum[k] = (ehpSum[k] ?? 0) + v;
        ehpN[k] = (ehpN[k] ?? 0) + 1;
      });
    }
    const n = list.length || 1;
    rows.push({
      skill, runs: list.length,
      contactWinRate: fought ? won / fought : 0,
      contactsPerRun: fought / n,
      meanReached: reached / n,
      finishedShare: finished / n,
      meanEhpAtExit: ehpSum.map((s, k) => s / (ehpN[k] || 1)),
      exitsSeen: ehpN.map((v) => v ?? 0),
      meanLiveSec: live / n,
      meanScore: score / n,
      sight: sightStats(list.flatMap((f) => f.sights)),
      sightBySector: bySector(list.flatMap((f) => f.sights)),
    });
  }
  return { rows, runs: all };
}

/** Sectors in a run of the shipped tunables: the "of N" of the depth columns. */
const SECTORS = cloneTunables().sweep.sectors;

/** The report as a Markdown table (posted on the issue). */
export function formatSweepReport(rows: readonly SweepSkillRow[]): string[] {
  const exits = Array.from({ length: SECTORS }, (_, k) => k);
  const out = [
    `| Bot skill | Runs | Contact win rate | Fights / run | Depth reached (of ${SECTORS}) | Made it out | HP+shield at exit ${exits.map((k) => k + 1).join(' / ')} | Run length (live s) | Score |`,
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const ehp = exits.map((k) => (r.exitsSeen[k] ? `${r.meanEhpAtExit[k]!.toFixed(0)} (n ${r.exitsSeen[k]})` : '—')).join(' / ');
    out.push(
      `| ${r.skill} | ${r.runs} | ${(r.contactWinRate * 100).toFixed(0)} % | ${r.contactsPerRun.toFixed(1)} | ${r.meanReached.toFixed(2)} | ${(r.finishedShare * 100).toFixed(0)} % | ${ehp} | ${r.meanLiveSec.toFixed(1)} | ${r.meanScore.toFixed(0)} |`,
    );
  }
  return out;
}

/**
 * The first-sight block of the report (#249): per bot skill, how far away the Echoes were when they first saw the player
 * (`enemySawPlayer`, horizontal), and the shares beyond `LONG_M` metres and across more than `HEIGHT_DIFF_M` metres of height.
 */
export function formatSightReport(rows: readonly SweepSkillRow[]): string[] {
  const pct = (x: number): string => `${(x * 100).toFixed(0)} %`;
  const out = [
    `| Bot skill | First sights | 10th / 25th / 50th / 75th / 90th percentile (m) | Beyond ${LONG_M} m | Height difference above ${HEIGHT_DIFF_M} m |`,
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const s = r.sight;
    out.push(`| ${r.skill} | ${s.n} | ${[s.p10, s.p25, s.p50, s.p75, s.p90].map((v) => v.toFixed(1)).join(' / ')} | ${pct(s.beyond20)} | ${pct(s.heightDiff)} |`);
  }
  // By sector, over every skill: which maps give the long fights and the fights across levels.
  const merged: Record<string, { n: number; p50: number; p90: number; beyond20: number; heightDiff: number }> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.sightBySector)) {
      const m = (merged[k] ??= { n: 0, p50: 0, p90: 0, beyond20: 0, heightDiff: 0 });
      m.n += v.n;
      m.p50 += v.p50 * v.n;
      m.p90 += v.p90 * v.n;
      m.beyond20 += v.beyond20 * v.n;
      m.heightDiff += v.heightDiff * v.n;
    }
  }
  const names = Object.keys(merged);
  if (names.length > 0) {
    out.push('', '| Sector (all skills) | First sights | Median / 90th percentile (m) | Beyond 20 m | Height difference above 1 m |', '|---|---|---|---|---|');
    for (const k of names) {
      const m = merged[k]!;
      out.push(`| ${k} | ${m.n} | ${(m.p50 / m.n).toFixed(1)} / ${(m.p90 / m.n).toFixed(1)} | ${pct(m.beyond20 / m.n)} | ${pct(m.heightDiff / m.n)} |`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fight pace (#248, design §2.2): fights per live minute and dead air, for the bot and a person's pace.
// ---------------------------------------------------------------------------------------------

/** One walker at one skill: the fight pace of its runs, against the design's targets. */
export interface PaceRow {
  walker: Walker;
  skill: number;
  runs: number;
  /** Medians over the runs: live seconds, fights, fights and duels per live minute; and the quartiles of fights per minute. */
  liveSec: number;
  fights: number;
  fightsPerMin: number;
  fightsPerMinP25: number;
  fightsPerMinP75: number;
  duelsPerMin: number;
  /** Each run's longest dead air inside a sector: the median and the worst run; and the share of runs with one over the target. */
  deadAirSec: number;
  deadAirWorstSec: number;
  deadAirOverShare: number;
  /** Each run's longest gate: the median and the worst run (runs that walked no gate are left out). */
  gateSec: number;
  gateWorstSec: number;
  /** Share of live time spent in gates. */
  gateShare: number;
}

/** The p-quantile (0..1) of `xs` by linear interpolation; 0 for none. */
export function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k), hi = Math.ceil(k);
  return s[lo]! + (s[hi]! - s[lo]!) * (k - lo);
}

/** The pace row of one walker's runs at one skill. `maxDeadAirSec`: the target a run's longest dead air is judged against. */
export function paceRow(walker: Walker, skill: number, runs: readonly SweepRunFacts[], maxDeadAirSec: number): PaceRow {
  const p = runs.map((r) => r.pace);
  const gated = p.filter((x) => x.gates > 0);
  const live = p.reduce((a, x) => a + x.liveSec, 0);
  return {
    walker, skill, runs: runs.length,
    liveSec: quantile(p.map((x) => x.liveSec), 0.5),
    fights: quantile(p.map((x) => x.fights), 0.5),
    fightsPerMin: quantile(p.map((x) => x.fightsPerMin), 0.5),
    fightsPerMinP25: quantile(p.map((x) => x.fightsPerMin), 0.25),
    fightsPerMinP75: quantile(p.map((x) => x.fightsPerMin), 0.75),
    duelsPerMin: quantile(p.map((x) => x.duelsPerMin), 0.5),
    deadAirSec: quantile(p.map((x) => x.deadAirMaxSec), 0.5),
    deadAirWorstSec: p.reduce((a, x) => Math.max(a, x.deadAirMaxSec), 0),
    deadAirOverShare: p.length ? p.filter((x) => x.deadAirMaxSec > maxDeadAirSec).length / p.length : 0,
    gateSec: quantile(gated.map((x) => x.gateMaxSec), 0.5),
    gateWorstSec: gated.reduce((a, x) => Math.max(a, x.gateMaxSec), 0),
    gateShare: live > 0 ? p.reduce((a, x) => a + x.gateSec, 0) / live : 0,
  };
}

/** The targets the pace table is judged against (`config/fightPace.ts`). */
export interface PaceTargets {
  targetFightsPerMin: number;
  maxDeadAirSec: number;
  maxGateSec: number;
}

/** Which targets a row meets: fights per minute at the median, the median run's longest dead air and longest gate. */
export function paceVerdict(r: PaceRow, t: PaceTargets): { fights: boolean; deadAir: boolean; gates: boolean } {
  return { fights: r.fightsPerMin >= t.targetFightsPerMin, deadAir: r.deadAirSec <= t.maxDeadAirSec, gates: r.gateSec <= t.maxGateSec };
}

/** The pace table as Markdown (posted on the issue), with the targets and each row's verdict. */
export function formatPaceReport(rows: readonly PaceRow[], t: PaceTargets): string[] {
  const mark = (ok: boolean): string => (ok ? 'yes' : '**no**');
  const out = [
    `Target (HYPOTHESIS until #214, design §2.2): at least ${t.targetFightsPerMin} fights per live minute at the median run, no dead air over ${t.maxDeadAirSec} s inside a sector, gates of at most ${t.maxGateSec} s.`,
    '',
    '| Walker | Bot skill | Runs | Live s / run | Fights / run | Fights / live min (p25–p75) | Duels / live min | Longest dead air in a sector: median (worst) | Runs with dead air > target | Longest gate: median (worst) | Time in gates | Meets: fights / dead air / gates |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const v = paceVerdict(r, t);
    out.push(
      `| ${r.walker} | ${r.skill} | ${r.runs} | ${r.liveSec.toFixed(0)} | ${r.fights.toFixed(1)} | ${r.fightsPerMin.toFixed(1)} (${r.fightsPerMinP25.toFixed(1)}–${r.fightsPerMinP75.toFixed(1)}) | ${r.duelsPerMin.toFixed(1)} | ${r.deadAirSec.toFixed(1)} s (${r.deadAirWorstSec.toFixed(1)} s) | ${(r.deadAirOverShare * 100).toFixed(0)} % | ${r.gateSec.toFixed(1)} s (${r.gateWorstSec.toFixed(1)} s) | ${(r.gateShare * 100).toFixed(0)} % | ${mark(v.fights)} / ${mark(v.deadAir)} / ${mark(v.gates)} |`,
    );
  }
  return out;
}

/** One policy at one skill over seeded runs (#205): what the gate choice is worth. */
export interface GatePolicyRow {
  policy: string;
  skill: number;
  runs: number;
  meanScore: number;
  /** Mean sectors entered (depth reached, of the run's sectors) and the share that left through the last exit. */
  meanDepth: number;
  finishedShare: number;
  /** Share of the sectors entered through a door that carried each stake. */
  stakeShare: Record<string, number>;
  /** Mean score difference to the same seeds under the first policy of the report, and its standard error (paired by seed). */
  deltaScore: number;
  deltaScoreSe: number;
  deltaDepth: number;
}

/** The three policies of `gatePolicy.ts` over the same seeds at each skill. The first policy is the baseline of the deltas. */
export function gatePolicyReport(
  skills: readonly number[], runs: number, firstSeed = 1, policies: readonly string[] = ['hot', 'read', 'facts', 'left'], pinDial?: number,
): GatePolicyRow[] {
  const rows: GatePolicyRow[] = [];
  for (const skill of skills) {
    let base: SweepRunFacts[] = [];
    policies.forEach((name, pi) => {
      const policy = GATE_POLICIES[name];
      if (!policy) throw new Error(`unknown gate policy '${name}' (known: ${Object.keys(GATE_POLICIES).join(', ')})`);
      const list: SweepRunFacts[] = [];
      for (let i = 0; i < runs; i++) list.push(sweepRun(skill, firstSeed + i, pinDial, policy));
      if (pi === 0) base = list;
      const n = list.length || 1;
      const stakeShare: Record<string, number> = { shield: 0, arms: 0, hot: 0, plain: 0 };
      let stakes = 0;
      for (const f of list) for (const k of f.stakes) { stakeShare[k] = (stakeShare[k] ?? 0) + 1; stakes++; }
      for (const k of Object.keys(stakeShare)) stakeShare[k] = stakes ? stakeShare[k]! / stakes : 0;
      const diffs = list.map((f, i) => f.score - base[i]!.score);
      const mean = diffs.reduce((a, b) => a + b, 0) / n;
      const varr = diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
      rows.push({
        policy: name, skill, runs: list.length,
        meanScore: list.reduce((a, f) => a + f.score, 0) / n,
        meanDepth: list.reduce((a, f) => a + f.reached, 0) / n,
        finishedShare: list.filter((f) => f.endReason === 'left').length / n,
        stakeShare,
        deltaScore: mean,
        deltaScoreSe: Math.sqrt(varr / n),
        deltaDepth: list.reduce((a, f, i) => a + (f.reached - base[i]!.reached), 0) / n,
      });
    });
  }
  return rows;
}

export function formatGatePolicyReport(rows: readonly GatePolicyRow[]): string[] {
  const out = [
    `| Bot skill | Policy | Runs | Score | Depth (of ${SECTORS}) | Made it out | vs first policy: score (± s.e.) | vs first policy: depth | Doors taken: shield / arms / hot / plain |`,
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const share = ['shield', 'arms', 'hot', 'plain'].map((k) => `${(r.stakeShare[k]! * 100).toFixed(0)} %`).join(' / ');
    out.push(
      `| ${r.skill} | ${r.policy} | ${r.runs} | ${r.meanScore.toFixed(0)} | ${r.meanDepth.toFixed(2)} | ${(r.finishedShare * 100).toFixed(0)} % | ${r.deltaScore >= 0 ? '+' : ''}${r.deltaScore.toFixed(0)} (± ${r.deltaScoreSe.toFixed(0)}) | ${r.deltaDepth >= 0 ? '+' : ''}${r.deltaDepth.toFixed(2)} | ${share} |`,
    );
  }
  return out;
}

/** One policy at one skill over seeded runs (#206): how deep Overtime goes and what the bank-or-push decision is worth. */
export interface OvertimeRow {
  policy: string;
  skill: number;
  runs: number;
  /** Share of runs that cleared the Finale (reached the first Overtime gate). */
  finaleClearedShare: number;
  /** Of the runs that cleared the Finale: how many played 0 (left at once), 1, 2, 3 and 4 or more Overtime sectors, as shares. */
  depthShare: number[];
  /** Of the runs that cleared the Finale: mean Overtime sectors entered, the median and the deepest. */
  meanDepth: number;
  medianDepth: number;
  maxDepth: number;
  /** Of the runs that entered Overtime: the share that left alive, mean Overtime points banked (leavers) and lost (the rest). */
  leftShare: number;
  meanBanked: number;
  meanLost: number;
  meanScore: number;
}

/** The depth buckets of the report: 0, 1, 2, 3, 4 or more Overtime sectors. */
export const OVERTIME_BUCKETS = 5;

/** The Overtime depth distribution (#206): each policy at each skill over the same seeds. */
export function overtimeReport(
  skills: readonly number[], runs: number, firstSeed = 1, policies: readonly string[] = ['push', 'bank'], pinDial?: number,
): { rows: OvertimeRow[]; runs: SweepRunFacts[] } {
  const rows: OvertimeRow[] = [];
  const all: SweepRunFacts[] = [];
  for (const skill of skills) {
    for (const name of policies) {
      const policy = OVERTIME_POLICIES[name];
      if (!policy) throw new Error(`unknown Overtime policy '${name}' (known: ${Object.keys(OVERTIME_POLICIES).join(', ')})`);
      const list: SweepRunFacts[] = [];
      for (let i = 0; i < runs; i++) list.push(sweepRun(skill, firstSeed + i, pinDial, undefined, policy));
      all.push(...list);
      const cleared = list.filter((f) => f.finaleCleared);
      const depths = cleared.map((f) => f.overtimeSectors).sort((a, b) => a - b);
      const share = new Array<number>(OVERTIME_BUCKETS).fill(0);
      for (const d of depths) share[Math.min(d, OVERTIME_BUCKETS - 1)]!++;
      const nc = cleared.length || 1;
      const entered = list.filter((f) => f.overtimeSectors > 0);
      const left = entered.filter((f) => f.endReason === 'left');
      const lost = entered.filter((f) => f.endReason !== 'left');
      rows.push({
        policy: name, skill, runs: list.length,
        finaleClearedShare: cleared.length / (list.length || 1),
        depthShare: share.map((n) => n / nc),
        meanDepth: depths.reduce((a, b) => a + b, 0) / nc,
        medianDepth: depths.length ? depths[Math.floor(depths.length / 2)]! : 0,
        maxDepth: depths.length ? depths[depths.length - 1]! : 0,
        leftShare: entered.length ? left.length / entered.length : 0,
        meanBanked: left.length ? left.reduce((a, f) => a + f.overtimeBanked, 0) / left.length : 0,
        meanLost: lost.length ? lost.reduce((a, f) => a + f.overtimeLost, 0) / lost.length : 0,
        meanScore: list.reduce((a, f) => a + f.score, 0) / (list.length || 1),
      });
    }
  }
  return { rows, runs: all };
}

export function formatOvertimeReport(rows: readonly OvertimeRow[]): string[] {
  const out = [
    '| Bot skill | Policy | Runs | Cleared the Finale | Overtime sectors played, of Finale clears: 0 / 1 / 2 / 3 / 4+ | Mean / median / max | Left alive (of runs in Overtime) | Overtime points banked (leavers) | Overtime points lost (the rest) | Score |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const share = r.depthShare.map((v) => `${(v * 100).toFixed(0)} %`).join(' / ');
    out.push(
      `| ${r.skill} | ${r.policy} | ${r.runs} | ${(r.finaleClearedShare * 100).toFixed(0)} % | ${share} | ${r.meanDepth.toFixed(2)} / ${r.medianDepth} / ${r.maxDepth} | ${(r.leftShare * 100).toFixed(0)} % | ${r.meanBanked.toFixed(0)} | ${r.meanLost.toFixed(0)} | ${r.meanScore.toFixed(0)} |`,
    );
  }
  return out;
}

/** One run of the trial report: what the classifier made of its contacts (#203). */
export interface TrialRunFacts {
  skill: number;
  seed: number;
  /** Run number on its profile (1 = the new profile's first run, with the placing Opener). */
  profileRun: number;
  placing: boolean;
  trials: Record<SkillId, number>;
  wins: Record<SkillId, number>;
  /** Contacts that opened (settled at least once), and those that settled with no trial at all. */
  contacts: number;
  contactsWithoutTrial: number;
  /** Contacts won (cleared) and fought (cleared, died, disengaged). */
  won: number;
  fought: number;
  /** Dial of each sector entered, in order. */
  dials: number[];
  /** Line rating (posterior mean of the seven) after the run. */
  lineAfter: number;
}

/**
 * The trial report (#203): bots play `profileRuns` runs per profile (the first places it), for
 * `runs` runs per skill, and every `skillTrial` and contact settle is counted: trials per skill per
 * run, and the contacts that produced none (there must be none: every contact that opens yields one).
 */
export function trialReport(skills: readonly number[], runs: number, profileRuns = 5, firstSeed = 1): TrialRunFacts[] {
  const out: TrialRunFacts[] = [];
  for (const skill of skills) {
    let g: HeadlessGame | null = null;
    for (let i = 0; i < runs; i++) {
      const seed = firstSeed + i;
      const profileRun = (i % profileRuns) + 1;
      if (profileRun === 1) g = new HeadlessGame({ seed, placesNewProfiles: true });
      const game = g!;
      const f: TrialRunFacts = {
        skill, seed, profileRun, placing: game.modes.newProfile, trials: zeroes(), wins: zeroes(), contacts: 0, contactsWithoutTrial: 0, won: 0, fought: 0,
        dials: [], lineAfter: 0,
      };
      const offs = [
        game.bus.on('skillTrial', (e) => {
          f.trials[e.skill]++;
          if (e.success) f.wins[e.skill]++;
        }),
        game.bus.on('contactSettled', (e) => {
          f.contacts++;
          if (e.trials === 0) f.contactsWithoutTrial++;
          if (e.outcome === 'cleared') f.won++;
          if (e.outcome !== 'avoided') f.fought++;
        }),
        game.bus.on('sectorEntered', (e) => f.dials.push(Math.round(e.dial * 10) / 10)),
      ];
      playMode(game, { mode: 'sweep', skill, seed });
      offs.forEach((off) => off());
      f.lineAfter = game.modes.skills.rating('line');
      out.push(f);
    }
  }
  return out;
}

function zeroes(): Record<SkillId, number> {
  const o = {} as Record<SkillId, number>;
  for (const s of SKILL_IDS) o[s] = 0;
  return o;
}

/** The trial report as Markdown: per bot skill, trials per run by skill (wins in brackets) and contacts without a trial. */
export function formatTrialReport(runs: readonly TrialRunFacts[]): string[] {
  const out = [
    `| Bot skill | Runs | ${SKILL_IDS.join(' | ')} | Trials / run | Contacts / run | Contacts with no trial | Contact win rate |`,
    `|---|---|${SKILL_IDS.map(() => '---').join('|')}|---|---|---|---|`,
  ];
  const skills = [...new Set(runs.map((r) => r.skill))];
  for (const skill of skills) {
    const list = runs.filter((r) => r.skill === skill);
    const n = list.length || 1;
    const cells = SKILL_IDS.map((s) => {
      const t = list.reduce((a, r) => a + r.trials[s], 0);
      const w = list.reduce((a, r) => a + r.wins[s], 0);
      return `${(t / n).toFixed(2)} (${t ? Math.round((100 * w) / t) : 0} %)`;
    });
    const total = list.reduce((a, r) => a + SKILL_IDS.reduce((b, s) => b + r.trials[s], 0), 0);
    const contacts = list.reduce((a, r) => a + r.contacts, 0);
    const none = list.reduce((a, r) => a + r.contactsWithoutTrial, 0);
    const won = list.reduce((a, r) => a + r.won, 0);
    const fought = list.reduce((a, r) => a + r.fought, 0);
    out.push(`| ${skill} | ${list.length} | ${cells.join(' | ')} | ${(total / n).toFixed(1)} | ${(contacts / n).toFixed(1)} | ${none} of ${contacts} | ${fought ? Math.round((100 * won) / fought) : 0} % |`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Meet contacts (#212): who stops first wins more often.
// ---------------------------------------------------------------------------------------------

/** One meet contact the bot fought: who dropped to counter-strafe speed first and how it ended. */
export interface MeetFacts {
  seed: number;
  stopFirst: 'player' | 'echo' | 'both' | 'neither';
  outcome: 'cleared' | 'disengaged' | 'avoided' | 'died';
  /** Echoes in the group (1 or 2). */
  echoes: number;
}

export interface MeetRow {
  skill: number;
  runs: number;
  /** Meet contacts fought (the bot reached a meet sector alive and the contact opened). */
  contacts: number;
  /** By who stopped first: contacts, and how many the player won (every Echo dead, player alive). */
  byStop: Record<MeetFacts['stopFirst'], { n: number; won: number }>;
}

/** Tunables of a run that is the Opener and then one meet sector (a forced role mix; the Opener is always a take). */
function meetTunables() {
  const t = cloneTunables();
  t.sweep.sectors = 2;
  t.sweep.roleMix = { take: 0, hold: 0, meet: 1 };
  // The bot takes the left door: make it Plain, so the gate before the meet changes nothing about the fight measured (#205).
  t.sweep.gate.stakeWeight = { shield: 0, arms: 0, hot: 0, plain: 1 };
  return t;
}

/** One forced run (Opener, then a meet sector) at one skill; the meet contacts the player met. */
export function meetRun(skill: number, seed: number, stopDelaySec: number): MeetFacts[] {
  const g = new HeadlessGame({ seed, tunables: meetTunables() });
  const out: MeetFacts[] = [];
  let echoes = 0;
  g.bus.on('sectorEntered', (e) => {
    echoes = e.role === 'meet' ? e.echoes : 0;
  });
  g.bus.on('contactSettled', (e) => {
    if (e.card === 'meet' && e.stopFirst) out.push({ seed, stopFirst: e.stopFirst, outcome: e.outcome, echoes });
  });
  playMode(g, { mode: 'sweep', skill, seed, sweepStopDelaySec: stopDelaySec });
  return out;
}

/** The meet report: bot skills × forced meet runs; `stopDelaySec` is how long the bot may keep running into a fight it has seen. */
export function meetReport(skills: readonly number[], runs: number, firstSeed = 1, stopDelaySec = 2.5): { rows: MeetRow[]; contacts: MeetFacts[] } {
  const rows: MeetRow[] = [];
  const all: MeetFacts[] = [];
  for (const skill of skills) {
    const row: MeetRow = {
      skill, runs, contacts: 0,
      byStop: { player: { n: 0, won: 0 }, echo: { n: 0, won: 0 }, both: { n: 0, won: 0 }, neither: { n: 0, won: 0 } },
    };
    for (let i = 0; i < runs; i++) {
      for (const f of meetRun(skill, firstSeed + i, stopDelaySec)) {
        all.push(f);
        row.contacts++;
        row.byStop[f.stopFirst].n++;
        if (f.outcome === 'cleared') row.byStop[f.stopFirst].won++;
      }
    }
    rows.push(row);
  }
  return { rows, contacts: all };
}

/** The meet report as a Markdown table (posted on the issue). */
export function formatMeetReport(rows: readonly MeetRow[]): string[] {
  const pct = (c: { n: number; won: number }): string => (c.n ? `${((c.won / c.n) * 100).toFixed(0)} % (${c.won}/${c.n})` : '—');
  const out = [
    '| Bot skill | Runs | Meet contacts | Won when the player stopped first | Won when an Echo stopped first | Both in the same tick | Neither stopped |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(`| ${r.skill} | ${r.runs} | ${r.contacts} | ${pct(r.byStop.player)} | ${pct(r.byStop.echo)} | ${pct(r.byStop.both)} | ${pct(r.byStop.neither)} |`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The lean (#210, `docs/research/replay-not-drills.md` R4): the same player, with and without it.
// ---------------------------------------------------------------------------------------------

/** What the A/B asks of a player: a planted moving-shot weakness, and how much a fight practises it away. */
export interface LeanAbOptions {
  /** Bot skill (the aim), 0..100. */
  skill: number;
  /** Consecutive runs per player and arm (the issue: 20). */
  runs: number;
  /** Independent players per arm (each on its own block of seeds); the rows average over them. */
  players: number;
  /** First seed; both arms play the same seeds in the same order. */
  firstSeed: number;
  /** The planted weakness at the start: the share of fights the bot fires in on the move. */
  startShare: number;
  /**
   * The practice model (an ASSUMPTION, not a measurement of people): each fight in a card that exercises the weakness
   * (`lean.table`) removes this share of what is left of it. A bot does not learn on its own; this is how exposure turns
   * into change, and it is the same in both arms, so the arms differ only in how many such fights they get.
   */
  practice: number;
  /**
   * Where the lean comes from. `planted`: the finding of every run after the first is the planted weakness (a working fix
   * engine, #39, is assumed to find it; a bot run fires only a handful of shots, below the #26 stub's minimum of
   * `results.minShotsForFix`, so the stub rarely fires on one). `stub`: whatever `pickFix` says.
   */
  engine: 'planted' | 'stub';
  pinDial?: number;
}

/** One run of one arm. */
export interface LeanRunFacts {
  seed: number;
  /** The weakness share the bot played this run with. */
  share: number;
  /** The lean it was dealt (cards), and the finding the stub engine reported at the end of the run. */
  lean: string[];
  finding: string;
  shots: number;
  movingShots: number;
  /** Fights (cleared, died or disengaged) in the cards that exercise the planted weakness, and all fights. */
  exposure: number;
  fights: number;
  reached: number;
  score: number;
}

export interface LeanArm {
  name: 'off' | 'on';
  /** The weakness the players started with. */
  startShare: number;
  /** One list of runs per player. */
  players: LeanRunFacts[][];
}

/** The planted weakness is the moving shot: these are the cards its fix leans toward and practises (`lean.table`). */
function plantedCards(t: Tunables): string[] {
  return t.lean.table.movingShots.cards.filter((c) => dealableCards(t.sweep).includes(c));
}

/** One player: `runs` consecutive runs, practising. With the lean on, each run leans as the previous run's finding says. */
function leanPlayer(name: 'off' | 'on', o: LeanAbOptions, firstSeed: number): LeanRunFacts[] {
  const t = cloneTunables();
  const planted = plantedCards(t);
  let share = o.startShare;
  let next: string[] = [];
  const runs: LeanRunFacts[] = [];
  for (let i = 0; i < o.runs; i++) {
    const seed = firstSeed + i;
    const g = new HeadlessGame({ seed, tunables: t });
    const lean = name === 'on' ? next : [];
    let exposure = 0, fights = 0, reached = 0;
    g.bus.on('sectorEntered', (e) => {
      reached = e.index + 1;
    });
    g.bus.on('contactSettled', (e) => {
      if (e.outcome === 'avoided') return;
      fights++;
      if (e.card !== undefined && planted.includes(e.card)) exposure++;
    });
    const r = playMode(g, { mode: 'sweep', skill: o.skill, seed, pinDial: o.pinDial, sweepMovingShare: share, lean });
    const stats = g.run.liveStats();
    const fix = pickFix(stats, shotSplit(g.run.log));
    runs.push({
      seed, share, lean, finding: fix.kind, shots: stats.shots, movingShots: stats.movingShots, exposure, fights, reached, score: r.modeRun?.score ?? 0,
    });
    // The real loop: the card names what the next run leans toward. Practice: every fight in the planted cards wears the weakness down.
    next = leanView(o.engine === 'planted' ? 'movingShots' : fix.kind, t.lean, t.sweep)?.cards ?? [];
    share *= Math.pow(1 - o.practice, exposure);
  }
  return runs;
}

/** One arm: `players` independent players, each on its own block of seeds (the same blocks in both arms). */
export function leanArm(name: 'off' | 'on', o: LeanAbOptions): LeanArm {
  const players: LeanRunFacts[][] = [];
  for (let p = 0; p < o.players; p++) players.push(leanPlayer(name, o, o.firstSeed + p * 1000));
  return { name, startShare: o.startShare, players };
}

export interface LeanAbRow {
  arm: 'off' | 'on';
  /** Fights per run in the cards that exercise the planted weakness, mean over all runs. */
  exposurePerRun: number;
  /** All fights per run (the lean moves fights between situations, not their number). */
  fightsPerRun: number;
  /** Moving-shot share (moving shots ÷ shots) over the first five runs, over the last five, and the change. */
  movingShareFirst5: number;
  movingShareLast5: number;
  change: number;
  /** What is left of the planted weakness at the last run, as a share of what it started with, mean over players. */
  weaknessLeft: number;
  /** Runs whose finding (the stub's) was the moving shot, and runs that were dealt a lean. */
  flaggedRuns: number;
  leanedRuns: number;
  meanReached: number;
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function leanAbRow(arm: LeanArm): LeanAbRow {
  // The share of shots fired moving, pooled over the runs in the window (a run fires only a handful of shots).
  const pooled = (runs: readonly LeanRunFacts[]): number => {
    const shots = runs.reduce((n, r) => n + r.shots, 0);
    return shots > 0 ? runs.reduce((n, r) => n + r.movingShots, 0) / shots : 0;
  };
  const all = arm.players.flat();
  const per = arm.players[0]?.length ?? 0;
  const k = Math.min(5, Math.floor(per / 2));
  const first = pooled(arm.players.flatMap((p) => p.slice(0, k)));
  const last = pooled(arm.players.flatMap((p) => p.slice(per - k)));
  return {
    arm: arm.name,
    exposurePerRun: mean(all.map((r) => r.exposure)),
    fightsPerRun: mean(all.map((r) => r.fights)),
    movingShareFirst5: first,
    movingShareLast5: last,
    change: last - first,
    weaknessLeft: arm.startShare > 0 ? mean(arm.players.map((p) => p[p.length - 1]?.share ?? 0)) / arm.startShare : 0,
    flaggedRuns: all.filter((r) => r.finding === 'movingShots').length,
    leanedRuns: all.filter((r) => r.lean.length > 0).length,
    meanReached: mean(all.map((r) => r.reached)),
  };
}

/** The A/B: the same seeds, the same starting weakness, the lean off and on. */
export function leanAb(o: LeanAbOptions): { off: LeanArm; on: LeanArm; rows: LeanAbRow[] } {
  const off = leanArm('off', o);
  const on = leanArm('on', o);
  return { off, on, rows: [leanAbRow(off), leanAbRow(on)] };
}

/** The A/B as a Markdown table (posted on the issue). */
export function formatLeanAb(rows: readonly LeanAbRow[]): string[] {
  const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
  const out = [
    `| Lean | Fights in the planted cards / run | Fights / run | Moving-shot share, runs 1–5 | Last 5 runs | Change | Weakness left after the last run | Runs flagged "moving shots" by the stub | Runs dealt a lean | Depth (of ${SECTORS}) |`,
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.arm} | ${r.exposurePerRun.toFixed(2)} | ${r.fightsPerRun.toFixed(2)} | ${pct(r.movingShareFirst5)} | ${pct(r.movingShareLast5)} | ${r.change >= 0 ? '+' : '−'}${(Math.abs(r.change) * 100).toFixed(1)} pts | ${pct(r.weaknessLeft)} | ${r.flaggedRuns} | ${r.leanedRuns} | ${r.meanReached.toFixed(2)} |`,
    );
  }
  return out;
}
