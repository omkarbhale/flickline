import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { weapon as weaponTable, weaponRules, type WeaponId } from '../config/weapon';
import { defaultBindings } from '../input/bindings';
import { EventBus } from '../core/eventBus';
import { TICK_RATE } from '../core/time';
import { SLOT_INDEX, validateLoadout, weaponsForSlot } from './loadout';
import { testRoom } from './levels';
import { createTickInput, type SimEvents, type TickInput } from './types';
import { World } from './world';

function setup(seed = 1) {
  const world = new World({ level: testRoom, tunables: cloneTunables(), seed });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; tick: number; data: unknown }[] = [];
  bus.onAny((type, e) => log.push({ type, tick: world.tick, data: JSON.parse(JSON.stringify(e)) }));
  const input = createTickInput();
  /** Run n ticks; `reload` and `switchTo` apply to the first tick only. */
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.reload = false;
      input.switchTo = -1;
    }
  };
  const all = <K extends keyof SimEvents>(t: K): SimEvents[K][] =>
    log.filter((l) => l.type === t).map((l) => l.data as SimEvents[K]);
  run(4);
  log.length = 0;
  return { world, run, all, log };
}

/** Ticks from the current tick until the first `shotFired` while holding fire (undefined if none). */
function ticksToFirstShot(s: ReturnType<typeof setup>, within: number): number | undefined {
  const start = s.world.tick;
  s.run(within, { fire: true });
  const first = s.log.find((l) => l.type === 'shotFired');
  s.run(1, { fire: false });
  return first ? first.tick - start : undefined;
}

describe('validateLoadout', () => {
  const t = weaponTable;

  it('accepts every primary with the sidearm', () => {
    for (const primary of ['kestrel', 'vane', 'rill']) {
      const r = validateLoadout(t, { primary, sidearm: 'pace' });
      expect(r).toEqual({ ok: true, slots: [primary, 'pace'] });
    }
  });

  it('rejects a weapon in the wrong slot class', () => {
    expect(validateLoadout(t, { primary: 'pace', sidearm: 'pace' })).toMatchObject({ ok: false, reason: 'primaryNotPrimary' });
    expect(validateLoadout(t, { primary: 'kestrel', sidearm: 'rill' })).toMatchObject({ ok: false, reason: 'sidearmNotSidearm' });
    expect(validateLoadout(t, { primary: 'rill', sidearm: 'rill' })).toMatchObject({ ok: false, reason: 'sidearmNotSidearm' });
    expect(validateLoadout(t, { primary: 'pace', sidearm: 'kestrel' })).toMatchObject({ ok: false, reason: 'primaryNotPrimary' });
  });

  it('rejects unknown ids, including names every object inherits', () => {
    expect(validateLoadout(t, { primary: 'longnail', sidearm: 'pace' })).toMatchObject({ ok: false, reason: 'unknownPrimary' });
    expect(validateLoadout(t, { primary: 'rill', sidearm: 'classic' })).toMatchObject({ ok: false, reason: 'unknownSidearm' });
    expect(validateLoadout(t, { primary: 'toString', sidearm: 'pace' })).toMatchObject({ ok: false, reason: 'unknownPrimary' });
    expect(validateLoadout(t, { primary: 'rill', sidearm: 'constructor' })).toMatchObject({ ok: false, reason: 'unknownSidearm' });
    expect(validateLoadout(t, { primary: '', sidearm: '' })).toMatchObject({ ok: false, reason: 'unknownPrimary' });
  });

  it('lists the weapons for each slot class, and slot indices match the 1 / 2 keys', () => {
    expect(weaponsForSlot(t, 'primary')).toEqual(['kestrel', 'vane', 'rill']);
    expect(weaponsForSlot(t, 'sidearm')).toEqual(['pace']);
    expect(SLOT_INDEX).toEqual({ primary: 0, sidearm: 1 });
    expect(defaultBindings.slotPrimary).toEqual(['Digit1']);
    expect(defaultBindings.slotSidearm).toEqual(['Digit2']);
    expect(weaponRules.defaultLoadout.map((id) => t[id].slotClass)).toEqual(['primary', 'sidearm']);
  });
});

describe('World.setLoadout', () => {
  it('puts the primary in slot 0 and the sidearm in slot 1 with full ammo, primary in hand', () => {
    const s = setup();
    const r = s.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    expect(r.ok).toBe(true);
    expect([...s.world.loadout]).toEqual(['rill', 'pace']);
    const w = s.world.weapon;
    expect(w.slots.map((x) => x.id)).toEqual(['rill', 'pace']);
    expect(w.slots[0]).toMatchObject({ mag: 30, reserve: 90 });
    expect(w.slots[1]).toMatchObject({ mag: 13, reserve: 39 });
    expect(w.active).toBe(0);
    expect(w.equipLeft).toBe(0);
  });

  it('an invalid request changes nothing (loadout, ammo and the weapon in hand)', () => {
    const s = setup();
    s.run(5, { fire: true });
    s.run(1, { switchTo: 1 });
    const before = JSON.stringify(s.world.weapon);
    const hash = s.world.hash();
    for (const bad of [
      { primary: 'pace', sidearm: 'pace' },
      { primary: 'rill', sidearm: 'kestrel' },
      { primary: 'nope', sidearm: 'pace' },
    ]) {
      const r = s.world.setLoadout(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
    }
    expect([...s.world.loadout]).toEqual(['kestrel', 'pace']);
    expect(JSON.stringify(s.world.weapon)).toBe(before);
    expect(s.world.hash()).toBe(hash);
  });

  it('survives reset() so a restarted run keeps the pick, and keeps the infinite-magazine option', () => {
    const s = setup();
    s.world.weapon.infiniteMagazine = true;
    s.world.setLoadout({ primary: 'vane', sidearm: 'pace' });
    s.run(20, { fire: true });
    s.world.reset(7);
    expect([...s.world.loadout]).toEqual(['vane', 'pace']);
    expect(s.world.weapon.slots.map((x) => x.id)).toEqual(['vane', 'pace']);
    expect(s.world.weapon.slots[0]!.mag).toBe(25);
    expect(s.world.weapon.infiniteMagazine).toBe(true);
  });

  it('can be set again between runs: a spent primary comes back full', () => {
    const s = setup();
    s.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    s.run(30, { fire: true });
    expect(s.world.weapon.slots[0]!.mag).toBeLessThan(30);
    s.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    expect(s.world.weapon.slots[0]!.mag).toBe(30);
  });

  it('is deterministic: the same loadout and inputs give the same hash', () => {
    const a = setup(5);
    const b = setup(5);
    a.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    b.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    for (const s of [a, b]) {
      s.run(30, { fire: true });
      s.run(1, { switchTo: 1 });
      s.run(30, { fire: true });
    }
    expect(a.world.hash()).toBe(b.world.hash());
  });
});

describe('swapping between the primary and the sidearm', () => {
  it('Rill equip time 0.75 s and Vane equip time 1.0 s gate the first shot after a swap', () => {
    for (const [id, equipSec] of [['rill', 0.75], ['vane', 1.0]] as const) {
      const s = setup();
      s.world.setLoadout({ primary: id, sidearm: 'pace' });
      s.run(1, { switchTo: 1 });
      s.run(TICK_RATE);
      expect(s.all('weaponSwitched').at(-1)).toMatchObject({ weapon: 'pace', slot: 1 });
      s.log.length = 0;
      s.run(1, { switchTo: 0 });
      expect(s.all('weaponSwitched')[0]).toMatchObject({ weapon: id, slot: 0, equipSec });
      // The swap tick itself counts; equipLeft hits zero `equipSec` seconds of ticks later.
      s.log.length = 0;
      const gate = Math.round(equipSec * TICK_RATE);
      const ticks = ticksToFirstShot(s, gate + 4)!;
      expect(ticks).toBe(gate);
      expect(s.all('shotFired')[0]!.weapon).toBe(id);
    }
  });

  it('a swap cancels a Rill reload and the magazine keeps its ammo per weapon', () => {
    const s = setup();
    s.world.setLoadout({ primary: 'rill', sidearm: 'pace' });
    s.run(8, { fire: true });
    s.run(1, { fire: false });
    const mag = s.world.weapon.slots[0]!.mag;
    expect(mag).toBeLessThan(30);
    s.run(1, { reload: true });
    expect(s.all('reloadStarted')[0]).toMatchObject({ weapon: 'rill', durationSec: 2.25 });
    s.run(Math.round(2.25 * TICK_RATE) - 3);
    s.run(1, { switchTo: 1 }); // just before the reload would complete
    expect(s.all('reloadCancelled')).toEqual([{ tick: s.world.tick, weapon: 'rill' }]);
    expect(s.all('reloadCompleted')).toHaveLength(0);
    // Shoot the sidearm, swap back: each weapon's magazine is its own, and the reload never resumes.
    s.run(TICK_RATE);
    s.run(1, { fire: true });
    s.run(1, { fire: false });
    const paceMag = s.world.weapon.slots[1]!.mag;
    expect(paceMag).toBe(12);
    s.run(1, { switchTo: 0 });
    s.run(TICK_RATE * 4);
    expect(s.world.weapon.slots[0]!.mag).toBe(mag);
    expect(s.world.weapon.slots[1]!.mag).toBe(paceMag);
    expect(s.all('reloadCompleted')).toHaveLength(0);
  });

  it('per-weapon reserve ammo also persists across swaps within a run', () => {
    const s = setup();
    s.world.setLoadout({ primary: 'vane', sidearm: 'pace' });
    s.run(30, { fire: true }); // drains part of the Vane magazine
    s.run(1, { fire: false });
    s.run(1, { reload: true });
    s.run(Math.round(2.5 * TICK_RATE) + 2);
    expect(s.all('reloadCompleted')[0]).toMatchObject({ weapon: 'vane', ammo: 25 });
    const reserve = s.world.weapon.slots[0]!.reserve;
    expect(reserve).toBeLessThan(50);
    s.run(1, { switchTo: 1 });
    s.run(1, { switchTo: 0 });
    expect(s.world.weapon.slots[0]!.reserve).toBe(reserve);
  });

  it('switching to the weapon already in hand does nothing', () => {
    const s = setup();
    s.run(1, { switchTo: 0 });
    expect(s.all('weaponSwitched')).toHaveLength(0);
    expect(s.world.weapon.equipLeft).toBe(0);
  });

  it('a mode without a loadout ignores the swap keys (swapLocked), free play does not', () => {
    const s = setup();
    s.world.swapLocked = true;
    s.run(1, { switchTo: 1 });
    expect(s.world.weapon.active).toBe(0);
    expect(s.all('weaponSwitched')).toHaveLength(0);
    s.world.swapLocked = false;
    s.run(1, { switchTo: 1 });
    expect(s.world.weapon.active).toBe(1);
  });

  it('every weapon id in the default loadout exists in the table', () => {
    for (const id of weaponRules.defaultLoadout as WeaponId[]) expect(weaponTable[id]).toBeDefined();
  });
});
