import { defineFeature } from '../app/feature';
import type { Game } from '../app/game';
import { TICK_RATE } from '../core/time';
import type { WeaponId } from '../config/weapon';
import { createTickInput, type TickInput } from '../sim/types';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Fire one shot of `weaponId` (a loadout id, e.g. 'kestrel' or 'pace') at the current look, with
     * deterministic stepping: swaps, equips, reloads and waits for the fire interval as the sim
     * requires. Repeated calls with an automatic weapon form one held spray at the real fire rate.
     * Returns copies of the shot's `shotFired` and `shotImpact` (impact null if it hit nothing).
     */
    fire(weaponId: string): { shot: unknown; impact: unknown };
    /** `n` shots of `weaponId` back to back (a held spray for automatic weapons). */
    spray(weaponId: string, n: number): { shot: unknown; impact: unknown }[];
    /**
     * The loadout, by slot. With `{primary, sidearm}` (e.g. `{primary: 'rill', sidearm: 'pace'}`)
     * it first tries `world.setLoadout`: full ammo, primary in hand. An invalid pair changes
     * nothing and comes back as `{ok: false, reason, message}`.
     */
    loadout(req?: { primary: string; sidearm: string }): { ok: boolean; reason?: string; message?: string; slots: string[] };
    /** Weapon options used by drills; persist across reset(). Returns the current options. */
    weaponOptions(opts?: { infiniteMagazine?: boolean; infiniteReserve?: boolean }): {
      infiniteMagazine: boolean;
      infiniteReserve: boolean;
    };
  }
}

/**
 * Fire exactly one shot of `id` with deterministic stepping. Switches to the weapon and waits out
 * its equip, reload and cooldown as the sim requires (so back-to-back calls with an automatic
 * weapon are a held spray at the real fire rate; a semi-auto gets a fresh press each call).
 * Returns copies of that shot's `shotFired` and `shotImpact` (null if it hit nothing).
 */
function fireOnce(game: Game, s: TickInput, id: WeaponId): { shot: unknown; impact: unknown } {
  const w = game.world.weapon;
  const slot = w.slots.findIndex((sl) => sl.id === id);
  if (slot < 0) throw new Error(`weapon '${id}' is not in the loadout (${w.slots.map((sl) => sl.id).join(', ')})`);
  s.moveX = s.moveZ = 0;
  s.jump = s.crouch = s.walk = s.reload = false;
  s.yaw = game.input.yaw;
  s.pitch = game.input.pitch;
  s.switchTo = slot;
  s.fire = false;
  if (w.active !== slot) {
    // Debug shooting may use any loadout weapon, even in a mode that locks the swap keys.
    const locked = game.world.swapLocked;
    game.world.swapLocked = false;
    game.world.step(s, game.bus); // start the swap
    game.world.swapLocked = locked;
  }
  const before = w.shots;
  let shot: unknown = null;
  let impact: unknown = null;
  const off1 = game.bus.on('shotFired', (e) => {
    shot = JSON.parse(JSON.stringify(e));
  });
  const off2 = game.bus.on('shotImpact', (e) => {
    if (impact === null) impact = JSON.parse(JSON.stringify(e));
  });
  const semi = game.tunables.weapon[id].fireMode === 'semi';
  try {
    const maxTicks = TICK_RATE * 10;
    for (let i = 0; i < maxTicks && w.shots === before; i++) {
      // A semi-auto press during equip/reload/cooldown is spent, so release and press again.
      s.fire = !semi || !s.fire;
      game.world.step(s, game.bus);
    }
  } finally {
    off1();
    off2();
    s.switchTo = -1;
  }
  game.renderNow();
  if (w.shots === before) throw new Error(`weapon '${id}' did not fire within 10 s`);
  return { shot, impact };
}

/** Debug/playtest shooting: single shots, sprays and drill options. */
export const feature = defineFeature({
  id: 'weapons',
  stage: 'tools',
  setup(game) {
    const input = createTickInput();
    game.addDebug({
      fire(weaponId) {
        return fireOnce(game, input, weaponId as WeaponId);
      },
      spray(weaponId, n) {
        const out: { shot: unknown; impact: unknown }[] = [];
        for (let i = 0; i < n; i++) out.push(fireOnce(game, input, weaponId as WeaponId));
        return out;
      },
      loadout(req) {
        const r = req ? game.world.setLoadout(req) : null;
        if (r?.ok) game.hud.refresh();
        const slots = [...game.world.loadout];
        return r && !r.ok ? { ok: false, reason: r.reason, message: r.message, slots } : { ok: true, slots };
      },
      weaponOptions(opts = {}) {
        const w = game.world.weapon;
        if (opts.infiniteMagazine !== undefined) w.infiniteMagazine = opts.infiniteMagazine;
        if (opts.infiniteReserve !== undefined) w.infiniteReserve = opts.infiniteReserve;
        game.hud.refresh();
        return { infiniteMagazine: w.infiniteMagazine, infiniteReserve: w.infiniteReserve };
      },
    });
  },
});
