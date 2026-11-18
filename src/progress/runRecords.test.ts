import { describe, expect, it } from 'vitest';
import { progress as cfg } from '../config/progress';
import { applyRunRecord, isDeeper, recordContacts, RunPace, RunRecorder, situationStats, type RunRecord } from './runRecords';
import { defaultProgress } from './save';

/** A scripted run: the health the recorder reads is whatever the script sets. */
class Script {
  hp = 150;
  readonly rec = new RunRecorder(() => this.hp, 6);
  total = 0;

  constructor(seed = 11, dial = 40) {
    this.rec.begin(seed, dial);
  }

  /** Sector `n` (1-based, as the design numbers them); the event carries it 0-based. */
  enter(n: number, role = 'take', condition = 'full', stake = 'plain', opener = false): this {
    this.rec.sectorEntered({ index: n - 1, opener, role, condition, stake });
    return this;
  }

  score(total: number): this {
    this.total = total;
    this.rec.scored(total);
    return this;
  }

  contact(outcome: 'cleared' | 'disengaged' | 'avoided' | 'died', card?: string, kept = 1): this {
    this.rec.contactSettled({ outcome, kept, card });
    return this;
  }

  end(cleared = true): this {
    this.rec.sectorEnded({ cleared });
    return this;
  }
}

describe('RunRecorder: the route strip', () => {
  it('records each sector with its facts, the contacts won and lost, health in and out, and the pace', () => {
    const s = new Script();
    s.enter(1, 'take', 'cold', 'plain');
    s.contact('cleared', 'take-unaware', 0.9).contact('cleared', 'take-expected', 0.7);
    s.score(400);
    s.hp = 120;
    s.end(true);
    s.enter(2, 'take', 'full', 'hot');
    s.contact('died', 'crossfire', 0);
    s.score(650);
    s.hp = 0;
    const r = s.rec.finish(650);
    expect(r).toMatchObject({ seed: 11, dial: 40, score: 650, depth: 2, cleared: 1, finaleCleared: false, pace: [400] });
    expect(r.strip).toEqual([
      { index: 1, role: 'take', condition: 'cold', stake: 'plain', won: 2, lost: 0, hpIn: 150, hpOut: 120, cleared: true, flawless: false },
      // the sector the player died in: closed at the health it ended with, not cleared
      { index: 2, role: 'take', condition: 'full', stake: 'hot', won: 0, lost: 1, hpIn: 120, hpOut: 0, cleared: false, flawless: false },
    ]);
  });

  it('a placing Opener\'s contact sectors are one tile and one pace entry (#273)', () => {
    const s = new Script();
    for (let k = 0; k < 4; k++) {
      s.enter(1, 'take', 'full', 'plain', true).contact('cleared', 'take-unaware').score(100 * (k + 1));
      s.hp = 150 - 10 * k;
      s.end(true);
    }
    s.enter(2).contact('died', 'crossfire', 0);
    s.hp = 0;
    const r = s.rec.finish(400);
    expect(r.depth).toBe(2);
    expect(r.cleared).toBe(1);
    expect(r.pace).toEqual([400]);
    expect(r.strip.map((t) => [t.index, t.won, t.cleared, t.hpIn, t.hpOut])).toEqual([[1, 4, true, 150, 120], [2, 0, false, 120, 0]]);
  });

  it('a disengaged contact is a loss for the strip and the situation, an avoided one is neither', () => {
    const s = new Script().enter(1);
    s.contact('disengaged', 'meet', 0.5).contact('avoided', 'hold', 1).contact('cleared', 'meet', 1);
    const r = s.rec.finish(0);
    expect(r.strip[0]).toMatchObject({ won: 1, lost: 1 });
    expect(r.contacts).toEqual([{ card: 'meet', won: false, kept: 0.5 }, { card: 'meet', won: true, kept: 1 }]);
  });

  it('a contact with no card still counts in the strip but not in the situation records', () => {
    const s = new Script().enter(1).contact('cleared');
    const r = s.rec.finish(0);
    expect(r.strip[0]!.won).toBe(1);
    expect(r.contacts).toEqual([]);
  });

  it('marks a sector Flawless from its medal, even when the medal lands after the sector ended', () => {
    const s = new Script().enter(1).end(true);
    s.rec.medal('flawless'); // the medals feature may hear sectorEnded after this one
    s.rec.medal('needle');
    s.enter(2).end(true);
    const r = s.rec.finish(0);
    expect(r.strip.map((t) => t.flawless)).toEqual([true, false]);
  });

  it('knows the Finale was cleared, and Overtime depth', () => {
    const s = new Script();
    for (let i = 1; i <= 7; i++) s.enter(i).score(i * 100).end(i <= 6);
    const r = s.rec.finish(700);
    expect(r).toMatchObject({ depth: 7, cleared: 6, finaleCleared: true });
    expect(r.pace).toEqual([100, 200, 300, 400, 500, 600, 700]);
    const died = new Script();
    for (let i = 1; i <= 6; i++) died.enter(i).end(i < 6);
    expect(died.rec.finish(0).finaleCleared).toBe(false);
  });

  it('starts clean for every run and keeps no clock: a record has no time in it', () => {
    const s = new Script().enter(1).score(100).end(true);
    s.rec.begin(2, 55);
    const r = s.rec.finish(0);
    expect(r).toMatchObject({ seed: 2, dial: 55, depth: 0, cleared: 0, strip: [], pace: [], contacts: [] });
    expect(Object.keys(new Script().enter(1).rec.finish(5)).join(' ')).not.toMatch(/time|duration|seconds|xp/i);
  });
});

function record(score: number, depth: number, cleared: number, extra: Partial<RunRecord> = {}): RunRecord {
  return { seed: 1, dial: 40, score, depth, cleared, finaleCleared: false, strip: [], pace: Array.from({ length: depth }, (_, i) => Math.round((score * (i + 1)) / depth)), contacts: [], ...extra };
}

describe('applyRunRecord', () => {
  it('sets the band best, deepest and Finales on the first run, and never from a run with no sector', () => {
    const d = defaultProgress();
    expect(applyRunRecord(d, record(0, 0, 0), 'd', null)).toMatchObject({ newBest: false, newDeepest: false });
    expect(d.runBests).toEqual({});
    expect(applyRunRecord(d, record(500, 3, 2), 'd1', null)).toMatchObject({ newBest: true, previousBest: null, newDeepest: true });
    expect(d.runBests.steelCobalt!.best).toMatchObject({ score: 500, depth: 3, cleared: 2, date: 'd1' });
  });

  it('a run that scored nothing can still be the deepest, but never a best', () => {
    const d = defaultProgress();
    expect(applyRunRecord(d, record(0, 2, 1), 'd', null)).toMatchObject({ newBest: false, newDeepest: true });
    expect(d.runBests.steelCobalt!.best).toBeNull();
  });

  it('orders deepest by depth, then sectors cleared, then score', () => {
    expect(isDeeper({ depth: 5, cleared: 0, score: 0 }, { depth: 4, cleared: 4, score: 9e6 })).toBe(true);
    expect(isDeeper({ depth: 4, cleared: 4, score: 0 }, { depth: 4, cleared: 3, score: 9e6 })).toBe(true);
    expect(isDeeper({ depth: 4, cleared: 3, score: 10 }, { depth: 4, cleared: 3, score: 9 })).toBe(true);
    expect(isDeeper({ depth: 4, cleared: 3, score: 9 }, { depth: 4, cleared: 3, score: 9 })).toBe(false);
  });

  it('copies the record: later edits to it do not change the save', () => {
    const d = defaultProgress();
    const r = record(500, 3, 2, { strip: [{ index: 1, role: 'take', condition: 'full', stake: 'plain', won: 1, lost: 0, hpIn: 1, hpOut: 1, cleared: true, flawless: false }] });
    applyRunRecord(d, r, 'd', null);
    r.strip[0]!.won = 99;
    r.pace[0] = 99;
    expect(d.runBests.steelCobalt!.best!.strip[0]!.won).toBe(1);
    expect(d.runBests.steelCobalt!.best!.pace[0]).toBe(167);
  });
});

describe('situation records', () => {
  it('keep the last 50 contacts per card and compute win rate and HP kept', () => {
    const d = defaultProgress();
    recordContacts(d, Array.from({ length: 70 }, (_, i) => ({ card: 'clear', won: i >= 20, kept: 0.5 })));
    expect(d.situations.clear).toHaveLength(cfg.situationWindow);
    expect(situationStats(d.situations.clear)).toEqual({ contacts: 50, wins: 50, winRate: 1, keptMean: 0.5 });
    // the next ten losses push ten wins out of the window
    recordContacts(d, Array.from({ length: 10 }, () => ({ card: 'clear', won: false, kept: 0 })));
    expect(situationStats(d.situations.clear).winRate).toBe(0.8);
    expect(situationStats(d.situations.clear, 10)).toEqual({ contacts: 10, wins: 0, winRate: 0, keptMean: 0 });
  });

  it('clamps health kept and caps how many cards a save remembers', () => {
    const d = defaultProgress();
    recordContacts(d, [{ card: 'a', won: true, kept: 1.7 }, { card: 'a', won: true, kept: -2 }]);
    expect(d.situations.a!.map((c) => c.kept)).toEqual([1, 0]);
    const small = { ...cfg, maxCards: 2 };
    recordContacts(d, [{ card: 'b', won: true, kept: 1 }, { card: 'c', won: true, kept: 1 }], small);
    expect(Object.keys(d.situations)).toEqual(['a', 'b']);
  });

  it('say nothing without a sample (never a fake zero)', () => {
    expect(situationStats(undefined)).toEqual({ contacts: 0, wins: 0, winRate: null, keptMean: null });
    expect(situationStats([])).toEqual({ contacts: 0, wins: 0, winRate: null, keptMean: null });
  });
});

describe('RunPace: ahead or behind the best run at the same sector', () => {
  const best = (pace: number[], score: number = pace[pace.length - 1]!): ReturnType<typeof applyRunRecord> extends never ? never : import('./save').RunBest => ({
    score, depth: pace.length, cleared: pace.length, seed: 1, date: 'd', dial: 40, strip: [], pace,
  });

  it('shows nothing before a sector is done or without a best run', () => {
    const s = new Script();
    const p = new RunPace(s.rec);
    expect(p.pace()).toBeNull();
    p.arm(best([300, 700]));
    expect(p.pace()).toBeNull(); // sector 1 not done yet
    p.arm(null);
    s.enter(1).score(500).end(true);
    expect(p.pace()).toBeNull();
  });

  it('compares the run total at the end of sector k with the best run\'s at the end of sector k', () => {
    const s = new Script();
    const p = new RunPace(s.rec);
    p.arm(best([300, 700, 1200]));
    s.enter(1).score(250).end(true);
    expect(p.pace()).toEqual({ score: 250, reference: 300 }); // behind by 50
    s.enter(2).score(800).end(true);
    expect(p.pace()).toEqual({ score: 800, reference: 700 }); // ahead by 100
  });

  it('holds the last comparison inside a sector: points earned mid-sector, or time spent, do not move it', () => {
    const s = new Script();
    const p = new RunPace(s.rec);
    p.arm(best([300, 700]));
    s.enter(1).score(300).end(true);
    s.enter(2).score(5000);
    expect(p.pace()).toEqual({ score: 300, reference: 300 });
  });

  it('past the end of the best run, the reference is the score it finished on', () => {
    const s = new Script();
    const p = new RunPace(s.rec);
    p.arm(best([300, 700], 750)); // it died in sector 3 with 750
    s.enter(1).score(300).end(true).enter(2).score(700).end(true).enter(3).score(900).end(true);
    expect(p.pace()).toEqual({ score: 900, reference: 750 });
  });

  it('a new run starts without a pace until its first sector is done', () => {
    const s = new Script();
    const p = new RunPace(s.rec);
    p.arm(best([300]));
    s.enter(1).score(100).end(true);
    expect(p.pace()).not.toBeNull();
    s.rec.begin(2, 40);
    expect(p.pace()).toBeNull();
  });
});
