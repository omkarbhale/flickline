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
}

/** One seeded run at one skill, with the sweep facts taken from the bus. */
export function sweepRun(skill: number, seed: number, pinDial?: number): SweepRunFacts {
  const g = new HeadlessGame({ seed });
  const f: SweepRunFacts = {
    seed, endReason: null, reached: 0, sectors: 0, ehpAtExit: [], contacts: { cleared: 0, disengaged: 0, avoided: 0, died: 0 },
    liveSec: 0, score: 0, kills: 0, cards: [],
  };
  g.bus.on('sectorEntered', (e) => {
    f.reached = e.index + 1;
    f.sectors = e.of;
  });
  g.bus.on('sectorEnded', (e) => {
    if (e.reason === 'exit') f.ehpAtExit[e.index] = g.world.health.hp + g.world.health.shield;
  });
  g.bus.on('contactSettled', (e) => {
    f.contacts[e.outcome]++;
    if (e.card) f.cards.push(e.card);
  });
  const r = playMode(g, { mode: 'sweep', skill, seed, pinDial });
  f.endReason = r.stats.endReason;
  f.liveSec = r.stats.liveSec;
  f.score = r.modeRun?.score ?? 0;
  f.kills = r.stats.kills;
  return f;
}

export function sweepReport(skills: readonly number[], runs: number, firstSeed = 1, pinDial?: number): { rows: SweepSkillRow[]; runs: SweepRunFacts[] } {
  const all: SweepRunFacts[] = [];
  const rows: SweepSkillRow[] = [];
  for (const skill of skills) {
    const list: SweepRunFacts[] = [];
    for (let i = 0; i < runs; i++) list.push(sweepRun(skill, firstSeed + i, pinDial));
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
    });
  }
  return { rows, runs: all };
}

/** The report as a Markdown table (posted on the issue). */
export function formatSweepReport(rows: readonly SweepSkillRow[]): string[] {
  const out = [
    '| Bot skill | Runs | Contact win rate | Fights / run | Depth reached (of 4) | Made it out | HP+shield at exit 1 / 2 / 3 / 4 | Run length (live s) | Score |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const ehp = [0, 1, 2, 3].map((k) => (r.exitsSeen[k] ? `${r.meanEhpAtExit[k]!.toFixed(0)} (n ${r.exitsSeen[k]})` : '—')).join(' / ');
    out.push(
      `| ${r.skill} | ${r.runs} | ${(r.contactWinRate * 100).toFixed(0)} % | ${r.contactsPerRun.toFixed(1)} | ${r.meanReached.toFixed(2)} | ${(r.finishedShare * 100).toFixed(0)} % | ${ehp} | ${r.meanLiveSec.toFixed(1)} | ${r.meanScore.toFixed(0)} |`,
    );
  }
  return out;
}
