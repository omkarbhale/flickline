import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { createTickInput } from '../sim/types';
import { playMode } from '../debug/bot/play';
import { pickColdOpener } from './coldOpener';
import { currentSector, sweepPlan, type SweepState } from './sweep';

const tunables = cloneTunables();
const LEVEL = 45;

/** A Sweep run with a cold opener at `LEVEL`, headless, with the facts the tests read. */
function startCold(seed: number) {
  const g = new HeadlessGame({ seed });
  const log: { type: string; e: Record<string, unknown> }[] = [];
  const types = ['sectorEntered', 'sectorEnded', 'coldOpenerStarted', 'coldLegEntered', 'coldOpenerEnded', 'skillTrial', 'targetVisible', 'runEnded'] as const;
  for (const type of types) g.bus.on(type, (e) => log.push({ type, e: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  expect(g.modes.start('sweep', { seed, coldOpenerLevel: LEVEL })).toBe(true);
  const input = createTickInput();
  const state = (): SweepState => g.modes.runner.state as SweepState;
  const toExit = (): void => {
    const sp = currentSector(state());
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
  };
  // The ready screen (the primary pick) times out on its own.
  for (let k = 0; k < 128 * 30 && g.modes.runner.phase !== 'live'; k++) g.advance(input);
  expect(g.modes.runner.phase).toBe('live');
  return { g, log, input, state, toExit };
}

describe('Sweep with a cold opener (#209)', () => {
  it('plans the cold opener as the Opener: its first leg stands in for the drawn opener; a placing run never has one', () => {
    const plain = sweepPlan(5, tunables);
    const cold = sweepPlan(5, tunables, undefined, false, LEVEL);
    const pick = pickColdOpener(5, LEVEL);
    expect(cold.cold?.legs).toEqual(pick.legs);
    expect(cold.sectors).toHaveLength(plain.sectors.length);
    expect(cold.sectors[0]).toBe(cold.cold!.sectors[0]);
    expect(cold.sectors[0]!.role).toBe('take');
    expect(sweepPlan(5, tunables, undefined, true, LEVEL).cold).toBeUndefined();
  });

  it('plays every leg on its own map (mirrored ones on <map>~m) with nothing in sight on arrival, as one sector to the rest of the game', () => {
    for (const seed of [3, 8, 21]) {
      const { g, log, input, state, toExit } = startCold(seed);
      const plan = state().plan.cold!;
      expect(log.filter((l) => l.type === 'sectorEntered')).toHaveLength(1);
      expect(log.find((l) => l.type === 'sectorEntered')!.e).toMatchObject({ index: 0, sectorId: 'cold-opener', dial: LEVEL, contacts: plan.sectors.length });
      expect(log.find((l) => l.type === 'coldOpenerStarted')!.e).toMatchObject({ level: LEVEL, legs: plan.sectors.length, version: tunables.coldOpener.version, seed });
      for (let leg = 0; leg < plan.sectors.length; leg++) {
        expect(state().leg).toBe(leg);
        const sp = plan.sectors[leg]!;
        expect(g.modes.currentMap.id).toBe(sp.mapId);
        expect(sp.mapId.endsWith('~m')).toBe(plan.legs[leg]!.mirrored);
        const legEv = log.filter((l) => l.type === 'coldLegEntered').at(-1)!.e;
        expect(legEv).toMatchObject({ leg, of: plan.sectors.length, mapId: sp.mapId, mirrored: plan.legs[leg]!.mirrored });
        const from = log.length;
        for (let k = 0; k < 64; k++) g.advance(input);
        expect(log.slice(from).filter((l) => l.type === 'targetVisible'), `seed ${seed} leg ${leg}`).toEqual([]);
        expect(log.filter((l) => l.type === 'sectorEnded')).toHaveLength(0);
        toExit();
      }
      // The last leg's exit ends the Opener once, then the run goes on through the gate before sector 2 as normal.
      expect(log.filter((l) => l.type === 'sectorEnded')).toHaveLength(1);
      expect(log.find((l) => l.type === 'sectorEnded')!.e).toMatchObject({ index: 0, sectorId: 'cold-opener', reason: 'exit' });
      expect(log.find((l) => l.type === 'coldOpenerEnded')!.e).toMatchObject({ reason: 'exit', legsDone: plan.sectors.length });
      expect(state().leg).toBe(-1);
      expect(state().gate).not.toBeNull();
    }
  });

  it("bot-played: the opener's trials and contacts are benchmark ones at the level's difficulty, never the matched model's; the rest are matched", () => {
    let coldTrials = 0, later = 0;
    for (const seed of [1, 2, 3]) {
      const g = new HeadlessGame({ seed });
      g.modes.coldOpenerFor = () => LEVEL;
      let inCold = false;
      let before = '';
      let afterCold = '';
      g.bus.on('coldOpenerStarted', () => {
        inCold = true;
        before = JSON.stringify(g.modes.skills.serialize());
      });
      g.bus.on('coldOpenerEnded', () => {
        inCold = false;
        afterCold = JSON.stringify(g.modes.skills.serialize());
      });
      g.bus.on('skillTrial', (e) => {
        expect(e.source).toBe(inCold ? 'baseline' : 'matched');
        if (inCold) {
          coldTrials++;
          expect(e.itemDifficulty).toBe(LEVEL + tunables.trials.cardOffset[e.card as 'clear']);
        } else later++;
      });
      g.bus.on('contactSettled', (e) => expect(e.source).toBe(inCold ? 'baseline' : undefined));
      playMode(g, { mode: 'sweep', skill: 50, seed, maxSeconds: 400 });
      // Nothing the opener measured moved the matched model (its trials or its fight track).
      expect(afterCold).toBe(before);
    }
    expect(coldTrials).toBeGreaterThan(10);
    expect(later).toBeGreaterThan(0);
  });

  it('a run quit inside it ends it as quit (offered again); a death ends it as death', () => {
    const a = startCold(6);
    a.toExit();
    a.g.modes.stop();
    expect(a.log.find((l) => l.type === 'coldOpenerEnded')!.e).toMatchObject({ reason: 'quit', legsDone: 1 });
    const b = startCold(6);
    b.g.modes.runner.end('death');
    expect(b.log.find((l) => l.type === 'coldOpenerEnded')!.e).toMatchObject({ reason: 'death', legsDone: 0, kept: 0 });
  });

  it('a run without a cold opener plays as before (no cold events)', () => {
    const g = new HeadlessGame({ seed: 2 });
    let any = false;
    g.bus.on('coldOpenerStarted', () => (any = true));
    expect(g.modes.start('sweep', { seed: 2 })).toBe(true);
    expect(any).toBe(false);
    expect((g.modes.runner.state as SweepState).plan.cold).toBeUndefined();
  });
});
