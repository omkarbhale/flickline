import type { WeaponId, WeaponSlotClass, WeaponTable } from '../config/weapon';

/**
 * Loadouts (design §4.8, §6): slot 0 holds a primary, slot 1 a sidearm, in that order, and the
 * `1` / `2` keys swap between them. A loadout request is validated here, as plain data, before
 * `World.setLoadout` rebuilds the weapon slots, so a mode or the debug hook can never put a rifle
 * in the sidearm slot or an unknown id in the world.
 */

/** What a mode or the menu asks for. Ids are strings because they come from mode data or the debug hook. */
export interface LoadoutRequest {
  primary: string;
  sidearm: string;
}

export type LoadoutRejection = 'unknownPrimary' | 'unknownSidearm' | 'primaryNotPrimary' | 'sidearmNotSidearm';

export type LoadoutResult =
  | { ok: true; slots: [WeaponId, WeaponId] }
  | { ok: false; reason: LoadoutRejection; message: string };

/** Slot index (the `switchTo` value) of each slot class. */
export const SLOT_INDEX: Record<WeaponSlotClass, number> = { primary: 0, sidearm: 1 };

function isWeaponId(table: WeaponTable, id: string): id is WeaponId {
  return Object.prototype.hasOwnProperty.call(table, id);
}

/** Weapons that may go in a slot class, in table order (what a loadout picker offers). */
export function weaponsForSlot(table: WeaponTable, slotClass: WeaponSlotClass): WeaponId[] {
  return (Object.keys(table) as WeaponId[]).filter((id) => table[id].slotClass === slotClass);
}

/** Check a loadout request against the weapon table; on success returns the slot order `[primary, sidearm]`. */
export function validateLoadout(table: WeaponTable, req: LoadoutRequest): LoadoutResult {
  const { primary, sidearm } = req;
  if (!isWeaponId(table, primary)) {
    return { ok: false, reason: 'unknownPrimary', message: `unknown primary weapon '${primary}'` };
  }
  if (!isWeaponId(table, sidearm)) {
    return { ok: false, reason: 'unknownSidearm', message: `unknown sidearm '${sidearm}'` };
  }
  if (table[primary].slotClass !== 'primary') {
    return { ok: false, reason: 'primaryNotPrimary', message: `'${primary}' is a ${table[primary].slotClass}, not a primary` };
  }
  if (table[sidearm].slotClass !== 'sidearm') {
    return { ok: false, reason: 'sidearmNotSidearm', message: `'${sidearm}' is a ${table[sidearm].slotClass}, not a sidearm` };
  }
  return { ok: true, slots: [primary, sidearm] };
}
