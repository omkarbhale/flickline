import { GATE_POLICIES, type GatePolicy } from './gatePolicy';
import { cloneTunables } from '../../config/tunables';
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
export function sweepRun(skill: number, seed: number, pinDial?: number, gatePolicy?: GatePolicy): SweepRunFacts {
  const g = new HeadlessGame({ seed });
  const f: SweepRunFacts = {
    seed, endReason: null, reached: 0, sectors: 0, ehpAtExit: [], contacts: { cleared: 0, disengaged: 0, avoided: 0, died: 0 },
    liveSec: 0, score: 0, kills: 0, cards: [], stakes: [],
  };
  g.bus.on('sectorEntered', (e) => {
    f.reached = e.index + 1;
    f.sectors = e.of;
    if (e.index > 0) f.stakes.push(e.stake);
  });
  g.bus.on('sectorEnded', (e) => {
    if (e.reason === 'exit') f.ehpAtExit[e.index] = g.world.health.hp + g.world.health.shield;
  });
  g.bus.on('contactSettled', (e) => {
    f.contacts[e.outcome]++;
    if (e.card) f.cards.push(e.card);
  });
  const r = playMode(g, { mode: 'sweep', skill, seed, pinDial, gatePolicy });
  f.endReason = r.stats.endReason;
  f.liveSec = r.stats.liveSec;
  f.score = r.modeRun?.score ?? 0;
  f.kills = r.stats.kills;
  return f;
}

export function sweepReport(skills: readonly number[], runs: number, firstSeed = 1, pinDial?: number, gatePolicy?: GatePolicy): { rows: SweepSkillRow[]; runs: SweepRunFacts[] } {
  const all: SweepRunFacts[] = [];
  const rows: SweepSkillRow[] = [];
  for (const skill of skills) {
    const list: SweepRunFacts[] = [];
    for (let i = 0; i < runs; i++) list.push(sweepRun(skill, firstSeed + i, pinDial, gatePolicy));
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
    '| Bot skill | Policy | Runs | Score | Depth (of 4) | Made it out | vs first policy: score (± s.e.) | vs first policy: depth | Doors taken: shield / arms / hot / plain |',
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
