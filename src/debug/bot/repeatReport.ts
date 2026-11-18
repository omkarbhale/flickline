import { cloneTunables } from '../../config/tunables';
import { nextSeed, pickFix, shotSplit } from '../../feedback/results';
import { LeanKeeper, leanView, weakestCards, type CardRecord } from '../../modes/lean';
import { GATE_POLICIES, OVERTIME_POLICIES } from './gatePolicy';
import { HeadlessGame } from './headless';
import { playMode } from './play';

/**
 * The repeat report (#214, `docs/research/replay-not-drills.md` R1 and R3): does run 20 still deal something new?
 * Each bot player plays `runs` consecutive Sweep runs on one profile, the way a session of **Enter** on the results
 * card plays them: the next seed is `nextSeed` of the last (`app/game.ts` `playAgain`), the skill model carries over,
 * and every run takes the lean the last results card set plus the player's weakest cards, as `app/game.ts` `leanFor`
 * does. What comes back is how often the route repeats (a sector, a sector-and-card pair, a whole route), how long
 * runs last, and how many reach and clear the Finale.
 *
 * A bot does not get bored and does not learn, so these numbers say what the game *deals*, not what a person feels.
 * The day's first run is not a cold opener here (no clock): it changes only the Opener's dial, not its sector or card.
 */

export interface RepeatOptions {
  skills: readonly number[];
  /** Consecutive runs per player (the issue: 50). */
  runs: number;
  /** Players per skill, each on its own seed chain. */
  players: number;
  firstSeed: number;
  /** How the bot picks a door (default `facts`: it reads all three facts, as a player who looks at the gate does). */
  gatePolicy: string;
  /** What the bot does after the Finale (default `bank`: push while healthy, leave when hurt). */
  overtimePolicy: string;
}

export const REPEAT_DEFAULTS: RepeatOptions = { skills: [30, 50, 70], runs: 50, players: 3, firstSeed: 1, gatePolicy: 'facts', overtimePolicy: 'bank' };

/** One run of a chain. */
export interface RepeatRunFacts {
  seed: number;
  /** Sectors entered, as `map/sector`, in order (Overtime included). */
  route: string[];
  /** One `map/sector card` per contact that settled (avoided included: the player met it). */
  pairs: string[];
  /** Cards the run leaned toward. */
  lean: string[];
  endReason: string | null;
  liveSec: number;
  /** Sectors in the run's route (the Finale is the last) and the deepest sector entered (1-based). */
  sectors: number;
  reached: number;
  finaleCleared: boolean;
  overtimeSectors: number;
  fights: number;
  score: number;
}

/** One chain of consecutive runs on one profile. */
export function repeatChain(skill: number, runs: number, firstSeed: number, gatePolicy = REPEAT_DEFAULTS.gatePolicy, overtimePolicy = REPEAT_DEFAULTS.overtimePolicy): RepeatRunFacts[] {
  const gate = GATE_POLICIES[gatePolicy];
  if (!gate) throw new Error(`unknown gate policy '${gatePolicy}' (known: ${Object.keys(GATE_POLICIES).join(', ')})`);
  const overtime = OVERTIME_POLICIES[overtimePolicy];
  if (!overtime) throw new Error(`unknown Overtime policy '${overtimePolicy}' (known: ${Object.keys(OVERTIME_POLICIES).join(', ')})`);
  const t = cloneTunables();
  const g = new HeadlessGame({ seed: firstSeed, tunables: t });
  const keeper = new LeanKeeper();
  // The player's situation records (progress store's `situation`): per card, each fight's outcome, newest last.
  const record = new Map<string, boolean[]>();
  const recordOf = (card: string, window: number): CardRecord | null => {
    const r = record.get(card);
    if (!r || r.length === 0) return null;
    const last = r.slice(-window);
    return { won: last.filter(Boolean).length, played: last.length };
  };
  let f: RepeatRunFacts | null = null;
  let sector = '';
  g.bus.on('sectorEntered', (e) => {
    if (!f) return;
    sector = `${e.mapId}/${e.sectorId}`;
    f.route.push(sector);
    f.reached = e.index + 1;
    f.sectors = e.of;
    if (e.index >= e.of) f.overtimeSectors = e.index - e.of + 1;
  });
  g.bus.on('sectorEnded', (e) => {
    if (f && e.reason === 'exit' && e.index === f.sectors - 1) f.finaleCleared = true;
  });
  g.bus.on('contactSettled', (e) => {
    if (!f || !e.card) return;
    f.pairs.push(`${sector} ${e.card}`);
    if (e.outcome === 'avoided') return;
    f.fights++;
    const r = record.get(e.card) ?? [];
    r.push(e.outcome === 'cleared');
    record.set(e.card, r);
  });

  const out: RepeatRunFacts[] = [];
  let seed = firstSeed;
  for (let i = 0; i < runs; i++) {
    const lean = keeper.fresh(weakestCards(recordOf, t.lean, t.sweep));
    f = { seed, route: [], pairs: [], lean: lean.slice(), endReason: null, liveSec: 0, sectors: 0, reached: 0, finaleCleared: false, overtimeSectors: 0, fights: 0, score: 0 };
    const r = playMode(g, { mode: 'sweep', skill, seed, gatePolicy: gate, overtimePolicy: overtime, lean });
    f.endReason = r.stats.endReason;
    f.liveSec = r.stats.liveSec;
    f.score = r.modeRun?.score ?? 0;
    out.push(f);
    // The results card names the one thing to fix; the next fresh run leans toward its cards.
    const fix = pickFix(g.run.liveStats(), shotSplit(g.run.log));
    keeper.setNext(leanView(fix.kind, t.lean, t.sweep)?.cards ?? []);
    seed = nextSeed(seed, t.results);
  }
  return out;
}

export interface RepeatRow {
  skill: number;
  players: number;
  runsPerPlayer: number;
  /** Sector-and-card pairs met per run, and of runs 2..n: the share of a run's pairs also met in the run just before, and in any earlier run of the chain. */
  pairsPerRun: number;
  pairRepeatLast: number;
  pairRepeatAny: number;
  /** The same, from run 20 on (R3: "run 20 fresh"): the share of a run's pairs never met before in its chain. */
  pairNewFrom20: number;
  /** Distinct pairs and distinct sectors met over a whole chain (mean over players). */
  distinctPairs: number;
  distinctSectors: number;
  /** Of runs 2..n: the share of a run's sectors that were also in the run just before. */
  sectorRepeatLast: number;
  /** Of runs 2..n: the share whose whole route, and whose first three sectors, repeat an earlier run of the chain. */
  routeRepeat: number;
  firstThreeRepeat: number;
  /** Live seconds: 10th, 50th, 90th percentile and the extremes, over every run. */
  lengthP10: number;
  lengthP50: number;
  lengthP90: number;
  lengthMin: number;
  lengthMax: number;
  /** Median live seconds of the runs that cleared the Finale (design §4.1: a full run takes five to nine minutes); 0 when none did. */
  clearedLengthP50: number;
  /** Share of runs that entered, and that cleared, the Finale; runs that went into Overtime. */
  finaleReached: number;
  finaleCleared: number;
  overtimeShare: number;
  /** Runs that leaned toward anything. */
  leanedShare: number;
  fightsPerRun: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const k = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[k]!;
}

/** The share of `xs` that `has` holds (0 for an empty list). */
function shareIn(xs: readonly string[], has: (x: string) => boolean): number {
  return xs.length ? xs.filter(has).length / xs.length : 0;
}

/** The row of one skill from its players' chains. */
export function repeatRow(skill: number, chains: readonly RepeatRunFacts[][]): RepeatRow {
  let pairs = 0, runsN = 0;
  let lastSum = 0, anySum = 0, laterN = 0, new20Sum = 0, new20N = 0, sectorLastSum = 0, routeRep = 0, firstThreeRep = 0;
  let distinctPairs = 0, distinctSectors = 0;
  const lengths: number[] = [];
  const clearedLengths: number[] = [];
  let reached = 0, cleared = 0, overtime = 0, leaned = 0, fights = 0;
  for (const chain of chains) {
    const seenPairs = new Set<string>();
    const seenSectors = new Set<string>();
    const routes = new Set<string>();
    const firstThrees = new Set<string>();
    chain.forEach((r, i) => {
      runsN++;
      pairs += r.pairs.length;
      lengths.push(r.liveSec);
      if (r.reached >= r.sectors && r.sectors > 0) reached++;
      if (r.finaleCleared) {
        cleared++;
        clearedLengths.push(r.liveSec);
      }
      if (r.overtimeSectors > 0) overtime++;
      if (r.lean.length > 0) leaned++;
      fights += r.fights;
      const route = r.route.join(' > ');
      const firstThree = r.route.slice(0, 3).join(' > ');
      if (i > 0) {
        const prev = chain[i - 1]!;
        const prevPairs = new Set(prev.pairs);
        const prevSectors = new Set(prev.route);
        laterN++;
        lastSum += shareIn(r.pairs, (p) => prevPairs.has(p));
        anySum += shareIn(r.pairs, (p) => seenPairs.has(p));
        sectorLastSum += shareIn(r.route, (s) => prevSectors.has(s));
        if (routes.has(route)) routeRep++;
        if (r.route.length >= 3 && firstThrees.has(firstThree)) firstThreeRep++;
        if (i >= 19) {
          new20N++;
          new20Sum += shareIn(r.pairs, (p) => !seenPairs.has(p));
        }
      }
      for (const p of r.pairs) seenPairs.add(p);
      for (const s of r.route) seenSectors.add(s);
      routes.add(route);
      if (r.route.length >= 3) firstThrees.add(firstThree);
    });
    distinctPairs += seenPairs.size;
    distinctSectors += seenSectors.size;
  }
  lengths.sort((a, b) => a - b);
  clearedLengths.sort((a, b) => a - b);
  const n = runsN || 1, nc = chains.length || 1, nl = laterN || 1;
  return {
    skill, players: chains.length, runsPerPlayer: chains[0]?.length ?? 0,
    pairsPerRun: pairs / n,
    pairRepeatLast: lastSum / nl,
    pairRepeatAny: anySum / nl,
    pairNewFrom20: new20N ? new20Sum / new20N : 0,
    distinctPairs: distinctPairs / nc,
    distinctSectors: distinctSectors / nc,
    sectorRepeatLast: sectorLastSum / nl,
    routeRepeat: routeRep / nl,
    firstThreeRepeat: firstThreeRep / nl,
    lengthP10: quantile(lengths, 0.1), lengthP50: quantile(lengths, 0.5), lengthP90: quantile(lengths, 0.9),
    lengthMin: lengths[0] ?? 0, lengthMax: lengths[lengths.length - 1] ?? 0,
    clearedLengthP50: quantile(clearedLengths, 0.5),
    finaleReached: reached / n,
    finaleCleared: cleared / n,
    overtimeShare: overtime / n,
    leanedShare: leaned / n,
    fightsPerRun: fights / n,
  };
}

/** Every skill's players, each on its own seed chain (player `p` of every skill starts at `firstSeed + 1000 p`). */
export function repeatReport(o: RepeatOptions = REPEAT_DEFAULTS): { rows: RepeatRow[]; chains: { skill: number; runs: RepeatRunFacts[] }[] } {
  const rows: RepeatRow[] = [];
  const chains: { skill: number; runs: RepeatRunFacts[] }[] = [];
  for (const skill of o.skills) {
    const list: RepeatRunFacts[][] = [];
    for (let p = 0; p < o.players; p++) {
      const runs = repeatChain(skill, o.runs, o.firstSeed + p * 1000, o.gatePolicy, o.overtimePolicy);
      list.push(runs);
      chains.push({ skill, runs });
    }
    rows.push(repeatRow(skill, list));
  }
  return { rows, chains };
}

/** The report as two Markdown tables (variety, then length and depth). */
export function formatRepeatReport(rows: readonly RepeatRow[]): string[] {
  const pct = (v: number): string => `${(v * 100).toFixed(0)} %`;
  const out = [
    '| Bot skill | Players × runs | Pairs met / run | Pair also in the run before | Pair met earlier in the chain | New pairs, runs 20+ | Distinct pairs / chain | Distinct sectors / chain | Sector also in the run before | Route repeats an earlier run | First 3 sectors repeat |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    out.push(
      `| ${r.skill} | ${r.players} × ${r.runsPerPlayer} | ${r.pairsPerRun.toFixed(1)} | ${pct(r.pairRepeatLast)} | ${pct(r.pairRepeatAny)} | ${pct(r.pairNewFrom20)} | ${r.distinctPairs.toFixed(1)} | ${r.distinctSectors.toFixed(1)} | ${pct(r.sectorRepeatLast)} | ${pct(r.routeRepeat)} | ${pct(r.firstThreeRepeat)} |`,
    );
  }
  out.push(
    '',
    '| Bot skill | Run length, live s: p10 / median / p90 (min–max) | Median length of runs that cleared the Finale | Reached the Finale | Cleared the Finale | Went into Overtime | Fights / run | Runs that leaned |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const r of rows) {
    out.push(
      `| ${r.skill} | ${r.lengthP10.toFixed(0)} / ${r.lengthP50.toFixed(0)} / ${r.lengthP90.toFixed(0)} (${r.lengthMin.toFixed(0)}–${r.lengthMax.toFixed(0)}) | ${r.clearedLengthP50.toFixed(0)} s | ${pct(r.finaleReached)} | ${pct(r.finaleCleared)} | ${pct(r.overtimeShare)} | ${r.fightsPerRun.toFixed(1)} | ${pct(r.leanedShare)} |`,
    );
  }
  return out;
}
