import { describe, expect, it } from 'vitest';
import { results as cfg } from '../config/results';
import { player } from '../config/player';
import { scriptedRun, type Ev } from '../debug/scriptedSweep';
import type { LoggedEvent, RunLog } from './eventLog';
import { buildCard, depthLabel } from './results';
import { RunStoryTracker, storyConfigFrom, type ContactOutcome, type StoryEventType, type StoryEvents } from './runStory';
import { computeStats } from './statTracker';

const CFG = storyConfigFrom(player, cfg.run.routeSectors, cfg.run.maxSectors);

function runOf(events: Ev[], seed: number): RunLog {
  return { mode: 'sweep', seed, dial: 50, events: events as unknown as LoggedEvent[], truncated: false };
}

function foldStory(events: Ev[]): RunStoryTracker {
  const t = new RunStoryTracker(CFG);
  for (const e of events) if (RunStoryTracker.reads(e.type)) t.ingest(e.type as StoryEventType, e.data as never);
  return t;
}

describe('the route and the fights match the run events (three seeded runs)', () => {
  for (const [seed, sectors] of [[11, 4], [2024, 6], [90210, 3]] as const) {
    it(`seed ${seed}: every tile, row and total equals the events and the stat tracker`, () => {
      const { events, expect: exp } = scriptedRun(seed, sectors, 'death');
      const story = foldStory(events).snapshot();
      const stats = computeStats(runOf(events, seed));

      // Route: one tile per entered sector with exactly the scripted numbers.
      expect(story.sectors).toHaveLength(exp.sectors.length);
      story.sectors.forEach((t, i) => {
        const e = exp.sectors[i]!;
        expect({ role: t.role, won: t.won, lost: t.lost, kills: t.kills, hpIn: t.hpIn, hpOut: t.hpOut, flawless: t.flawless }).toEqual({
          role: e.role, won: e.won, lost: e.lost, kills: e.kills, hpIn: e.hpIn, hpOut: e.hpOut, flawless: e.flawless,
        });
        expect(t.number).toBe(i + 1);
      });
      // Against the stat tracker: the tiles' kills are the run's kills.
      expect(story.sectors.reduce((n, t) => n + t.kills, 0)).toBe(stats.kills);
      expect(stats.kills).toBe(exp.kills);
      // Fights by situation: per-card counts equal the scripted ones, and they add up to the contacts.
      expect(Object.fromEntries(story.situations.map((r) => [r.card, { played: r.played, won: r.won, lost: r.lost }]))).toEqual(exp.cards);
      const contacts = events.filter((e) => e.type === 'contactSettled').length;
      expect(story.situations.reduce((n, r) => n + r.played, 0)).toBe(contacts);
      expect(story.won + story.lost + story.sectors.reduce((n, t) => n + t.avoided, 0)).toBe(contacts);

      // The card carries the same numbers through formatting, with the stat tracker's own stats.
      const card = buildCard({ stats, split: null, score: 1234, rating: null, pb: null, medals: [], story });
      expect(card.route.map((t) => [t.won, t.lost, t.hpIn, t.hpOut])).toEqual(exp.sectors.map((t) => [t.won, t.lost, t.hpIn, t.hpOut]));
      expect(card.route.map((t) => t.flawless)).toEqual(exp.sectors.map((t) => t.flawless));
      expect(card.stats.find((c) => c.id === 'kills')).toBeUndefined(); // the six headline stats of §8.2, not the drill eight
      expect(card.situations.reduce((n, r) => n + r.played, 0)).toBe(contacts);
      expect(card.depth).toBe(depthLabel(story, 'death'));
    });
  }

  it('is a pure function of the events: the same run folds to the same card, a different seed does not', () => {
    const a = scriptedRun(5, 5, 'death');
    const b = scriptedRun(5, 5, 'death');
    expect(foldStory(a.events).snapshot()).toEqual(foldStory(b.events).snapshot());
    expect(foldStory(scriptedRun(6, 5, 'death').events).snapshot()).not.toEqual(foldStory(a.events).snapshot());
  });
});

describe('RunStoryTracker', () => {
  const t = (events: [StoryEventType, object][]): ReturnType<RunStoryTracker['snapshot']> => {
    const tr = new RunStoryTracker(CFG);
    for (const [type, data] of events) tr.ingest(type, data as StoryEvents[typeof type]);
    return tr.snapshot();
  };
  const enter = (i: number, extra: object = {}): [StoryEventType, object] => ['sectorEntered', { sectorId: `s${i}`, index: i, role: 'take', ...extra }];

  it('a run without sectors has an empty story', () => {
    const s = t([['runReady', { mode: 'test', seed: 1, dial: 50 }]]);
    expect(s.sectors).toEqual([]);
    expect(s.situations).toEqual([]);
  });

  it('defaults a missing condition and stake and starts at full health', () => {
    const s = t([enter(0)]);
    expect(s.sectors[0]).toMatchObject({ condition: 'full', stake: 'plain', hpIn: 100, hpOut: 100, cleared: false, ended: false, flawless: false });
  });

  it('closes a sector that has no exit event at the health the player walked out with', () => {
    const s = t([enter(0), ['playerDamaged', { hp: 60, shield: 0 }], enter(1), ['playerDamaged', { hp: 25, shield: 0 }]]);
    expect(s.sectors.map((x) => [x.hpIn, x.hpOut])).toEqual([[100, 60], [60, 25]]);
  });

  it('counts a disengage as lost and an avoided contact as neither won nor lost', () => {
    const settle = (outcome: ContactOutcome, card: string): [StoryEventType, object] => ['contactSettled', { contactId: 1, outcome, kept: 0.5, points: 0, card }];
    const s = t([enter(0), settle('cleared', 'clear'), settle('disengaged', 'clear'), settle('avoided', 'hold'), settle('died', 'hold')]);
    expect(s.sectors[0]).toMatchObject({ won: 1, lost: 2, avoided: 1 });
    expect(s.situations).toEqual([
      { card: 'clear', played: 2, won: 1, lost: 1, avoided: 0 },
      { card: 'hold', played: 2, won: 0, lost: 1, avoided: 1 },
    ]);
  });

  it('tells a sector that was cleared from one walked out of and one the run ended in', () => {
    const end = (id: string, cleared: boolean, reason = 'exit'): [StoryEventType, object] => ['sectorEnded', { sectorId: id, cleared, reason }];
    const s = t([enter(0), end('s0', true), enter(1), end('s1', false), enter(2), enter(3), end('s3', false, 'death')]);
    expect(s.sectors.map((x) => [x.cleared, x.fell])).toEqual([[true, false], [false, false], [false, true], [false, true]]);
  });

  it('marks Flawless only with a shot fired, no miss and no moving shot', () => {
    const shot = (moving: boolean): [StoryEventType, object] => ['shotFired', { moving }];
    const miss: [StoryEventType, object] = ['shotImpact', { result: 'miss' }];
    const hit: [StoryEventType, object] = ['shotImpact', { result: 'hit' }];
    const s = t([
      enter(0), shot(false), hit, shot(false), hit,
      enter(1), shot(false), miss,
      enter(2), shot(true), hit,
      enter(3),
    ]);
    expect(s.sectors.map((x) => x.flawless)).toEqual([true, false, false, false]);
  });

  it('flags sectors past the route as Overtime and caps the strip', () => {
    const many: [StoryEventType, object][] = [];
    for (let i = 0; i < 20; i++) many.push(enter(i));
    const s = t(many);
    expect(s.sectors).toHaveLength(CFG.maxSectors);
    expect(s.sectors.filter((x) => x.overtime).map((x) => x.number)[0]).toBe(7);
    expect(s.overtimeSectors).toBe(CFG.maxSectors - 6);
  });

  it('a new run clears the old story', () => {
    const tr = new RunStoryTracker(CFG);
    tr.ingest('sectorEntered', { sectorId: 'a', index: 0, role: 'take' });
    tr.ingest('playerDamaged', { hp: 10, shield: 0 });
    tr.ingest('runReady', { mode: 'sweep', seed: 2, dial: 50 });
    tr.ingest('sectorEntered', { sectorId: 'b', index: 0, role: 'hold' });
    const s = tr.snapshot();
    expect(s.sectors).toHaveLength(1);
    expect(s.sectors[0]).toMatchObject({ role: 'hold', hpIn: 100 });
  });
});
