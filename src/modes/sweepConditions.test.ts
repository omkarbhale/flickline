import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { HeadlessGame } from '../debug/bot/headless';
import { createTickInput } from '../sim/types';
import { sweepEnv, type SweepState } from './sweep';
import { drawConditions, type RunPlan } from './sweepDirector';
import { planRoute } from './sweepGate';

const tunables = cloneTunables();
// These tests are about the economy of a sector, not the stake of the door before it: every door is Plain, and the player takes the left one.
tunables.sweep.gate.stakeWeight = { shield: 0, arms: 0, hot: 0, plain: 1 };
const cfg = tunables.sweep;

/** The whole route a seed gives along the left door of every gate (the gates are drawn as the run reaches them; this walks them offline). */
function sweepPlan(seed: number, t = tunables): RunPlan {
  return planRoute(seed, sweepEnv(t), () => 0);
}

/** A seed whose plan deals an eco (or light) sector at index 1..`notAfter`, and a full sector right after it (so what comes back can be read). */
function seedWith(cond: 'eco' | 'light', notAfter = 99): number {
  for (let s = 1; s < 500; s++) {
    const sectors = sweepPlan(s).sectors;
    const i = sectors.findIndex((x) => x.condition === cond);
    if (i >= 1 && i <= notAfter && sectors[i + 1]?.condition === 'full') return s;
  }
  throw new Error('no seed');
}

describe('sector conditions (#207, design §4.6)', () => {
  it('limits hold over 500 seeds: at most one eco and one light, never the Opener or the Finale, and both do come up', () => {
    let eco = 0, light = 0, both = 0, none = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const conds = sweepPlan(seed).sectors.map((s) => s.condition);
      const nEco = conds.filter((c) => c === 'eco').length;
      const nLight = conds.filter((c) => c === 'light').length;
      expect(nEco, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(nLight, `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(conds[0], `seed ${seed}: the Opener is always full`).toBe('full');
      if (cfg.finaleSector - 1 < conds.length) expect(conds[cfg.finaleSector - 1]).toBe('full');
      eco += nEco;
      light += nLight;
      if (nEco && nLight) both++;
      if (!nEco && !nLight) none++;
    }
    // Rare, not absent: each shows up in roughly its chance of the runs, and plenty of runs have neither.
    expect(eco).toBeGreaterThan(500 * cfg.conditions.ecoChance * 0.7);
    expect(eco).toBeLessThan(500 * cfg.conditions.ecoChance * 1.3);
    expect(light).toBeGreaterThan(500 * cfg.conditions.lightChance * 0.7);
    expect(both).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(500 * 0.2);
  });

  it('a six-sector run keeps both off the Opener and the Finale too', () => {
    const six = { ...cfg, sectors: 6 };
    for (let seed = 1; seed <= 500; seed++) {
      const c = drawConditions(seed, 6, six);
      expect(c[0]).toBe('full');
      expect(c[5]).toBe('full');
      expect(c.filter((x) => x === 'eco').length).toBeLessThanOrEqual(1);
      expect(c.filter((x) => x === 'light').length).toBeLessThanOrEqual(1);
    }
  });

  it('conditions are a function of the seed alone, and dealing them moves no placement', () => {
    expect(sweepPlan(11).sectors.map((s) => s.condition)).toEqual(sweepPlan(11).sectors.map((s) => s.condition));
    const noCond = cloneTunables();
    noCond.sweep.conditions.ecoChance = 0;
    noCond.sweep.conditions.lightChance = 0;
    for (const seed of [3, 8, 21]) {
      const a = sweepPlan(seed).sectors.map((s) => [s.sectorId, s.contacts]);
      const b = sweepPlan(seed, noCond).sectors.map((s) => [s.sectorId, s.contacts]);
      expect(a).toEqual(b);
    }
  });
});

function start(seed: number, pick?: string) {
  const g = new HeadlessGame({ seed, tunables });
  const input = createTickInput();
  const entered: { index: number; condition: string }[] = [];
  g.bus.on('sectorEntered', (e) => entered.push({ index: e.index, condition: e.condition }));
  expect(g.modes.start('sweep', { seed, pick })).toBe(true);
  const state = (): SweepState => g.modes.runner.state as SweepState;
  /** Leave the sector by its exit and walk through the left door of the gate behind it (none after the last sector). */
  const toExit = (): void => {
    const sp = state().plan.sectors[state().sector]!;
    // A hold sector's exit opens when its Echoes are dead (#204): these tests are about conditions, so it is opened for them.
    if (state().role === 'hold') state().exitOpen = true;
    g.world.placePlayer(sp.exit.x, sp.exit.y, sp.exit.z, 0);
    g.advance(input);
    const gc = cfg.gate;
    if (!state().gate) return;
    g.world.placePlayer(gc.doors[0].x, 0, gc.doors[0].z - gc.commitDepthM - 0.1, 0);
    for (let k = 0; k < Math.ceil(gc.commitSec * 128) + 3 && state().gate; k++) g.advance(input);
  };
  return { g, input, state, toExit, entered };
}

describe('conditions applied to the player and the Echoes (#207)', () => {
  it('an eco sector gives the player and every Echo Pace and no shield; leaving it brings the primary and the shield back', () => {
    const seed = seedWith('eco', 2);
    const { g, input, state, toExit } = start(seed, 'vane');
    for (let k = 0; k < 5; k++) g.advance(input);
    const plan = state().plan;
    const w = g.world;
    const primary = w.loadout[0];
    expect(primary).toBe('vane');
    // The Opener is a full sector: heavy shield for both, the primary in hand.
    expect(w.health.maxShield).toBe(tunables.player.shield.heavy);
    expect(w.targetField.enemyShield).toBe(tunables.player.shield.heavy);
    expect(w.loadout[w.weapon.active]).toBe('vane');
    // A hit before the eco sector: the carried shield is what comes back.
    w.hitPlayer('kestrel', 'body', 0, 1.2, 0, -1, g.bus);
    const carried = w.health.shield;
    expect(carried).toBeLessThan(tunables.player.shield.heavy);
    for (let i = 0; i < plan.sectors.length; i++) {
      if (plan.sectors[i]!.condition === 'eco') break;
      toExit();
    }
    const eco = state().sector;
    expect(plan.sectors[eco]!.condition).toBe('eco');
    // In the eco sector: nobody has a shield, everybody has Pace, the primary is away.
    expect(w.health.maxShield).toBe(0);
    expect(w.health.shield).toBe(0);
    expect(w.targetField.enemyShield).toBe(0);
    expect(w.enemyWeapon).toBe('pace');
    expect(w.loadout[w.weapon.active]).toBe('pace');
    expect(w.swapLocked).toBe(true);
    for (const t of w.targets) if (t.alive) expect(t.shield).toBe(0);
    // Pressing the primary key does nothing here.
    const key = createTickInput();
    key.switchTo = 0;
    g.advance(key);
    expect(w.loadout[w.weapon.active]).toBe('pace');
    // Leaving: the primary is in hand again, swapping works, the carried shield is back (nothing spent, nothing refilled).
    toExit();
    expect(g.run.state).not.toBe('result');
    expect(w.loadout[w.weapon.active]).toBe('vane');
    expect(w.swapLocked).toBe(false);
    expect(w.health.maxShield).toBe(tunables.player.shield.heavy);
    expect(w.health.shield).toBeCloseTo(carried, 6);
  });

  it('eco sector Echoes spawn with no shield and Pace; a full sector Echo has the heavy shield', () => {
    const seed = seedWith('eco', 2);
    const { g, input, state, toExit } = start(seed);
    for (let k = 0; k < 5; k++) g.advance(input);
    const alive = (): number[] => g.world.targets.filter((t) => t.alive).map((t) => t.shield);
    expect(alive().length).toBeGreaterThan(0);
    expect(alive().every((s) => s === tunables.player.shield.heavy)).toBe(true);
    while (state().plan.sectors[state().sector]!.condition !== 'eco') toExit();
    expect(alive().length).toBeGreaterThan(0);
    expect(alive().every((s) => s === 0)).toBe(true);
  });

  it('a light sector caps the player at the light shield and gives the Echoes 25; the rest of the carried shield returns, minus what the sector spent', () => {
    const seed = seedWith('light', 2);
    const { g, input, state, toExit } = start(seed);
    for (let k = 0; k < 5; k++) g.advance(input);
    const w = g.world;
    expect(w.health.shield).toBe(tunables.player.shield.heavy);
    while (state().plan.sectors[state().sector]!.condition !== 'light') toExit();
    const light = tunables.player.shield.light;
    expect(w.health.maxShield).toBe(light);
    expect(w.health.shield).toBe(light);
    expect(w.targetField.enemyShield).toBe(light);
    expect(w.swapLocked).toBe(false);
    // Spend 10 of the worn shield in the sector.
    w.hitPlayer('kestrel', 'body', 0, 1.2, 0, -1, g.bus);
    const spent = light - w.health.shield;
    expect(spent).toBeGreaterThan(0);
    toExit();
    expect(g.run.state).not.toBe('result');
    expect(w.health.maxShield).toBe(tunables.player.shield.heavy);
    expect(w.health.shield).toBeCloseTo(tunables.player.shield.heavy - spent, 6);
  });

  it('the sector announces its condition, and the plan lists them', () => {
    const seed = seedWith('eco');
    const { g, input, state, toExit, entered } = start(seed);
    for (let k = 0; k < 5; k++) g.advance(input);
    while (state().plan.sectors[state().sector]!.condition !== 'eco') toExit();
    expect(entered.map((e) => e.condition)).toEqual(state().plan.sectors.slice(0, entered.length).map((s) => s.condition));
    expect(entered[entered.length - 1]!.condition).toBe('eco');
  });
});

describe('the primary pick on the ready screen (#207, design §4.1)', () => {
  it('the screen waits, then a pick sets the primary (sidearm Pace) and starts the run at once', () => {
    const g = new HeadlessGame({ seed: 5 });
    const input = createTickInput();
    const picked: string[] = [];
    g.bus.on('primaryPicked', (e) => picked.push(e.weapon));
    expect(g.modes.start('sweep', { seed: 5 })).toBe(true);
    expect(g.modes.phase).toBe('ready');
    // Nothing moves and nothing fires while the screen waits; the default is Kestrel.
    expect(g.world.movementLocked).toBe(true);
    expect(g.world.enemiesFire).toBe(false);
    expect(g.world.loadout.slice()).toEqual(['kestrel', 'pace']);
    for (let k = 0; k < 128; k++) g.advance(input);
    expect(g.modes.phase).toBe('ready');
    expect(g.modes.pickPrimary('rill')).toBe(true);
    expect(g.world.loadout.slice()).toEqual(['rill', 'pace']);
    expect(g.world.loadout[g.world.weapon.active]).toBe('rill');
    g.advance(input);
    g.advance(input);
    expect(g.modes.phase).toBe('live');
    expect(g.world.movementLocked).toBe(false);
    expect(g.world.swapLocked).toBe(false);
    expect(g.world.enemiesFire).toBe(true);
    expect(picked).toEqual(['rill']);
    expect(g.modes.primary).toBe('rill');
    // Once live the pick is closed.
    expect(g.modes.pickPrimary('vane')).toBe(false);
  });

  it('without a pick the screen times out on the last pick; the next run starts with it', () => {
    const g = new HeadlessGame({ seed: 5 });
    const input = createTickInput();
    expect(g.modes.setPrimary('vane')).toBe(true);
    expect(g.modes.setPrimary('pace')).toBe(false);
    expect(g.modes.setPrimary('nonsense')).toBe(false);
    g.modes.start('sweep', { seed: 5 });
    expect(g.world.loadout[0]).toBe('vane');
    const ticks = Math.ceil(cfg.pick.readySec * 128) + 2;
    for (let k = 0; k < ticks; k++) g.advance(input);
    expect(g.modes.phase).toBe('live');
    expect(g.world.loadout[0]).toBe('vane');
  });

  it('only the three primaries can be picked, and only on a ready screen that has a pick', () => {
    const g = new HeadlessGame({ seed: 5 });
    expect(g.modes.pickPrimary('kestrel')).toBe(false); // no run
    g.modes.start('sweep', { seed: 5 });
    expect(g.modes.pickPrimary('pace')).toBe(false); // a sidearm is never a primary pick
    expect(g.modes.pickPrimary('ghost')).toBe(false);
    expect(g.modes.phase).toBe('ready');
    expect(g.modes.pickPrimary('kestrel')).toBe(true);
    g.modes.start('orbit', { seed: 5 });
    expect(g.modes.pickPrimary('vane')).toBe(false); // a drill has no loadout pick
  });
});
