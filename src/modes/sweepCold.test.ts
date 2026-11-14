import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { createTickInput } from '../sim/types';
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
  const ready = Math.ceil(tunables.run.readySec * 128) + 1;
  for (let k = 0; k < ready; k++) g.advance(input);
  return { g, log, input, state, toExit };
}

describe('Sweep with a cold opener (#209)', () => {
  it('plans the cold opener as the Opener: its legs, then the run continues into sector 2 with the same later sectors', () => {
    const plain = sweepPlan(5, tunables);
    const cold = sweepPlan(5, tunables, LEVEL);
    const pick = pickColdOpener(5, LEVEL);
    expect(cold.cold?.legs).toEqual(pick.legs);
    expect(cold.sectors).toHaveLength(plain.sectors.length);
    expect(cold.sectors[0]).toBe(cold.cold!.sectors[0]);
    expect(cold.sectors.slice(1).map((s) => s.sectorId)).toEqual(plain.sectors.slice(1).map((s) => s.sectorId));
    // Contacts are numbered after the legs'.
    expect(cold.sectors[1]!.contacts[0]!.index).toBe(pick.legs.length);
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
      // The last leg's exit ends the Opener once, then sector 2 begins as normal.
      expect(log.filter((l) => l.type === 'sectorEnded')).toHaveLength(1);
      expect(log.find((l) => l.type === 'coldOpenerEnded')!.e).toMatchObject({ reason: 'exit', legsDone: plan.sectors.length });
      expect(state().sector).toBe(1);
      expect(state().leg).toBe(-1);
      expect(log.filter((l) => l.type === 'sectorEntered').at(-1)!.e).toMatchObject({ index: 1 });
    }
  });

  it("its Echoes' trials are benchmark trials at the level's difficulty; the run's later ones are matched", () => {
    const { g, log, toExit, state } = startCold(4);
    const id = state().contacts[0]!.echoIds[0]!;
    expect(g.modes.runner.resolveTrial(id, true)).toBe(true);
    const cold = log.filter((l) => l.type === 'skillTrial').at(-1)!.e;
    expect(cold).toMatchObject({ source: 'baseline', itemDifficulty: LEVEL, success: true });
    for (let leg = 0; leg < state().plan.cold!.sectors.length; leg++) toExit();
    const later = state().contacts[0]!.echoIds.find((x) => x >= 0)!;
    expect(g.modes.runner.resolveTrial(later, false)).toBe(true);
    expect(log.filter((l) => l.type === 'skillTrial').at(-1)!.e.source).toBe('matched');
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
