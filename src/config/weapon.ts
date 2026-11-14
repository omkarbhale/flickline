/**
 * Weapon tunables: one data entry per weapon, keyed by its Flickline id (`weapon.pace`,
 * `weapon.kestrel`), all simulated by the single generic weapon model in `sim/weapon.ts`.
 *
 * Every number comes from `docs/mechanics-spec.md` §7 (per-archetype tables) or the section cited
 * on the field; nothing here is invented. Changing a weapon is a data change: no code reads a
 * weapon number from anywhere else. Units: seconds, metres, degrees (fields ending `Deg`).
 * Recoil yaw is in screen terms: positive = the shot goes to the RIGHT of the crosshair.
 */

/** Flickline weapon ids. Add an id here and an entry in `weapon` to add a weapon. */
export type WeaponId = 'pace' | 'kestrel' | 'vane' | 'rill';

/** Which loadout slot a weapon belongs in (design §4.8): slot 0 holds a primary, slot 1 a sidearm. */
export type WeaponSlotClass = 'primary' | 'sidearm';

export type FireMode = 'auto' | 'semi';

/** Spec §3.6 penetration class (kept on the weapon; v1 maps have no penetrable walls). */
export type PenetrationClass = 'low' | 'medium' | 'high';

/** One damage band (spec §3.2 / §7.4): applies to hits at distance <= `upToM`. */
export interface DamageBand {
  upToM: number;
  head: number;
  body: number;
  leg: number;
}

export interface WeaponDef {
  /** Display name (Flickline's own). */
  name: string;
  /** Spec archetype the numbers come from (spec §0.3). */
  archetype: string;
  /** Loadout slot class (design §6 / §4.8); `setLoadout` rejects a weapon in the wrong slot. */
  slotClass: WeaponSlotClass;
  fireMode: FireMode;

  // --- Handling (spec §3.1, §7.2) ---
  /** Rounds per second. The sim keeps fractional timing, so the rate is exact at 128 Hz. */
  fireRateHz: number;
  magazine: number;
  /** Reserve ammo outside the magazine (spec §3.1, wiki-sourced, medium confidence). */
  reserve: number;
  reloadSec: number;
  equipSec: number;
  /** Equipped run speed, m/s (spec §2.1 / §7.2 `run_speed_mps`): the "max speed" of the deadzone. */
  runSpeedMps: number;

  // --- Spread (spec §3.3, §7.3) ---
  /** First-shot error, half-angle in degrees (`spread_first_deg`). */
  spreadFirstDeg: number;
  /** Spread after the ramp (`spread_max_deg`). */
  spreadMaxDeg: number;
  /** Multiplier on the stationary spread while crouched (`crouch_mult`). */
  crouchSpreadMult: number;
  /** Gun recovery time: a shot this long after the previous one starts fresh (`recovery_s`). */
  recoverySec: number;
  /** Tap efficiency: deliberate taps add 1/tapEfficiency to the spray count (`tap_eff`). */
  tapEfficiency: number;
  /** Spray count at which spread reaches max (`n_ramp`, ESTIMATE 30%). */
  spreadRampBullets: number;

  // --- Movement error (spec §3.4, §7.3), degrees added on top of stationary spread ---
  errCrouchMoveDeg: number;
  errWalkDeg: number;
  errRunDeg: number;
  errAirDeg: number;
  /** Speed fraction of `runSpeedMps` above which shots are inaccurate (spec §2.4 `deadzone`). */
  deadzoneFraction: number;

  // --- Damage (spec §3.2, §7.4) ---
  /** Bands in ascending `upToM`; beyond the last band the last band applies. */
  damageBands: DamageBand[];
  penetration: PenetrationClass;

  // --- Recoil (spec §3.5): data, so measured patterns replace these without code changes ---
  /** Pitch kick (deg, + = up) applied after bullet i (0-based). Past the end the last entry repeats. */
  recoilPitchDeg: number[];
  /** Yaw kick (deg, + = right) applied after bullet i, before the flip sign. Last entry repeats. */
  recoilYawDeg: number[];
  /** Bullets protected from a yaw direction switch (spec §3.5, PN 11.08). */
  recoilProtectedBullets: number;
  /** Chance per unprotected bullet that the yaw direction switches (spec §3.5, PN 11.08). */
  recoilFlipChance: number;
  /** Seconds the yaw direction takes to swing fully to the other side (spec §3.5 "switch time"). */
  recoilFlipTimeSec: number;
  /**
   * Seconds after the last shot that the aim offset holds before it returns (spec §3.5). The
   * return is a straight line that reaches the crosshair at `recoverySec`, so this must be shorter
   * than `recoverySec`; at least `heldFireIntervals` shot intervals keeps a held spray climbing.
   */
  recoilReturnDelaySec: number;
  /** Pitch-kick multiplier for a moving or airborne shot (spec §3.5, PN 4.0 / PN 6.11). */
  recoilMovingPitchMult: number;
  /** Yaw-kick multiplier for a moving or airborne shot (spec §3.5, PN 4.0). */
  recoilMovingYawMult: number;
  /** Yaw-kick multiplier while crouched and not moving (spec §3.5, PN 0.50: -15%). */
  recoilCrouchYawMult: number;
}

/** Rules shared by every weapon (spec §7.1 global keys). */
export interface WeaponRules {
  /** Hitscan reach, metres. Spec §3.2 bands end at 50 m; this only bounds the trace. */
  rangeM: number;
  /** `move.walk_fraction` (spec §2.2): walk speed as a fraction of the equipped run speed. */
  walkFraction: number;
  /** `move.crouch_walk_fraction` (spec §2.2). */
  crouchWalkFraction: number;
  /** `move.landing_spread_add` (spec §2.6): degrees added for a window after landing. */
  landingSpreadAddDeg: number;
  /** `move.landing_spread_duration` (spec §2.6), seconds. */
  landingSpreadSec: number;
  /** `spread.center_bias_power_still` (spec §3.3): radius = spread * U^p for still shots. */
  centreBiasPowerStill: number;
  /** `spread.center_bias_power_moving` (spec §3.3). */
  centreBiasPowerMoving: number;
  /** A shot within this many fire intervals of the previous one counts as held fire (spec §3.3). */
  heldFireIntervals: number;
  /** Weapons in the default loadout, slot order (primary, sidearm). `World.setLoadout` changes it. */
  defaultLoadout: WeaponId[];
}

export type WeaponTable = Record<WeaponId, WeaponDef>;

/** Repeat `value` n times (keeps the recoil tables readable; the result is plain data). */
function times(n: number, value: number): number[] {
  return new Array<number>(n).fill(value);
}

export const weapon: WeaponTable = {
  /** Pace: accurate semi-auto sidearm. Archetype `pistol_accurate`. */
  pace: {
    name: 'Pace',
    archetype: 'pistol_accurate',
    slotClass: 'sidearm',
    fireMode: 'semi', // spec §3.1
    fireRateHz: 6.75, // spec §7.2
    magazine: 13, // spec §7.2
    reserve: 39, // spec §3.1
    reloadSec: 1.5, // spec §7.2
    equipSec: 0.75, // spec §7.2
    runSpeedMps: 5.7375, // spec §7.2 (0.85 x 6.75)
    spreadFirstDeg: 0.3, // spec §7.3
    spreadMaxDeg: 1.65, // spec §7.3
    crouchSpreadMult: 0.75, // spec §7.3
    recoverySec: 0.25, // spec §7.3 (ESTIMATE 30%)
    tapEfficiency: 3, // spec §7.3 (ESTIMATE 30%)
    spreadRampBullets: 4, // spec §7.3 (ESTIMATE 30%)
    errCrouchMoveDeg: 0.5, // spec §7.3
    errWalkDeg: 1.1, // spec §7.3
    errRunDeg: 2.3, // spec §7.3
    errAirDeg: 7, // spec §7.3
    deadzoneFraction: 0.275, // spec §7.3 / §2.4
    damageBands: [
      { upToM: 30, head: 105, body: 30, leg: 25.5 }, // spec §7.4
      { upToM: 50, head: 87.5, body: 25, leg: 21.25 }, // spec §7.4
    ],
    penetration: 'medium', // spec §7.4
    recoilPitchDeg: [0.6], // spec §3.5 `pistol_*`: 0.60 per shot (PLACEHOLDER)
    recoilYawDeg: [0], // spec §3.5 `pistol_*`: no pattern
    recoilProtectedBullets: 0, // spec §3.5: no pattern, so no switching
    recoilFlipChance: 0, // spec §3.5
    recoilFlipTimeSec: 0, // spec §3.5
    recoilReturnDelaySec: 0, // spec §3.5 "recovers within 0.25 s": returns from the first tick
    recoilMovingPitchMult: 1.5, // spec §3.5 (PN 4.0, both axes x1.5)
    recoilMovingYawMult: 1.5, // spec §3.5 (PN 4.0)
    recoilCrouchYawMult: 0.85, // spec §3.5 (PN 0.50)
  },

  /** Kestrel: controllable full-auto rifle. Archetype `rifle_spray`. */
  kestrel: {
    name: 'Kestrel',
    archetype: 'rifle_spray',
    slotClass: 'primary',
    fireMode: 'auto', // spec §3.1
    fireRateHz: 11, // spec §7.2
    magazine: 30, // spec §7.2
    reserve: 60, // spec §3.1
    reloadSec: 2.5, // spec §7.2
    equipSec: 1.0, // spec §7.2
    runSpeedMps: 5.4, // spec §7.2 (0.80 x 6.75)
    spreadFirstDeg: 0.2, // spec §7.3
    spreadMaxDeg: 0.9, // spec §7.3
    crouchSpreadMult: 0.85, // spec §7.3
    recoverySec: 0.35, // spec §7.3 (OFFICIAL, PN 0.50)
    tapEfficiency: 4, // spec §7.3 (OFFICIAL, PN 0.50)
    spreadRampBullets: 8, // spec §7.3 (ESTIMATE 30%)
    errCrouchMoveDeg: 0.8, // spec §7.3
    errWalkDeg: 3, // spec §7.3
    errRunDeg: 6, // spec §7.3
    errAirDeg: 10, // spec §7.3
    deadzoneFraction: 0.275, // spec §7.3 / §2.4
    damageBands: [
      { upToM: 20, head: 156, body: 39, leg: 33.15 }, // spec §7.4
      { upToM: 50, head: 140, body: 35, leg: 29.75 }, // spec §7.4
    ],
    penetration: 'medium', // spec §7.4
    // spec §3.5 `rifle_spray` PLACEHOLDER: 0.30 deg up for bullets 1-11, then 0.07.
    recoilPitchDeg: [...times(11, 0.3), 0.07],
    // spec §3.5: 0.15 deg sideways after the 8 protected bullets, none before.
    recoilYawDeg: [...times(8, 0), 0.15],
    recoilProtectedBullets: 8, // spec §3.5 (PN 11.08)
    recoilFlipChance: 0.1, // spec §3.5 (PN 11.08)
    recoilFlipTimeSec: 0.6, // spec §3.5 (PN 11.08)
    recoilReturnDelaySec: 1.5 / 11, // spec §3.5: holds through held fire (1.5 shot intervals), back at recoverySec
    recoilMovingPitchMult: 1.8, // spec §3.5 (PN 6.11, vertical while running, rifles)
    recoilMovingYawMult: 1.5, // spec §3.5 (PN 4.0)
    recoilCrouchYawMult: 0.85, // spec §3.5 (PN 0.50)
  },
  /** Vane: one-tap rifle, high damage with no falloff, punishes spraying. Archetype `rifle_precise`. */
  vane: {
    name: 'Vane',
    archetype: 'rifle_precise',
    slotClass: 'primary',
    fireMode: 'auto', // spec §3.1
    fireRateHz: 9.75, // spec §7.2
    magazine: 25, // spec §7.2
    reserve: 50, // spec §3.1
    reloadSec: 2.5, // spec §7.2
    equipSec: 1.0, // spec §7.2
    runSpeedMps: 5.4, // spec §7.2 (0.80 x 6.75)
    spreadFirstDeg: 0.25, // spec §7.3
    spreadMaxDeg: 1.0, // spec §7.3
    crouchSpreadMult: 0.85, // spec §7.3
    recoverySec: 0.375, // spec §7.3 (OFFICIAL, PN 0.50)
    tapEfficiency: 6, // spec §7.3 (OFFICIAL, PN 0.50)
    spreadRampBullets: 8, // spec §7.3 (ESTIMATE 30%)
    errCrouchMoveDeg: 0.8, // spec §7.3
    errWalkDeg: 3, // spec §7.3
    errRunDeg: 6, // spec §7.3
    errAirDeg: 10, // spec §7.3
    deadzoneFraction: 0.275, // spec §7.3 / §2.4
    damageBands: [
      { upToM: 50, head: 160, body: 40, leg: 34 }, // spec §7.4: no falloff
    ],
    penetration: 'medium', // spec §7.4
    // spec §3.5 `rifle_precise` PLACEHOLDER: 0.35 deg up for bullets 1-9, then 0.08.
    recoilPitchDeg: [...times(9, 0.35), 0.08],
    // spec §3.5: 0.18 deg sideways after the 6 protected bullets, none before.
    recoilYawDeg: [...times(6, 0), 0.18],
    recoilProtectedBullets: 6, // spec §3.5 (PN 11.08)
    recoilFlipChance: 0.1, // spec §3.5 (PN 11.08)
    recoilFlipTimeSec: 0.6, // spec §3.5 (PN 11.08)
    recoilReturnDelaySec: 1.5 / 9.75, // spec §3.5: holds through held fire (1.5 shot intervals), back at recoverySec
    recoilMovingPitchMult: 1.8, // spec §3.5 (PN 6.11, vertical while running)
    recoilMovingYawMult: 1.5, // spec §3.5 (PN 4.0)
    recoilCrouchYawMult: 0.85, // spec §3.5 (PN 0.50)
  },

  /** Rill: close-range full-auto SMG, fast on its feet, low recoil. Archetype `smg`. */
  rill: {
    name: 'Rill',
    archetype: 'smg',
    slotClass: 'primary',
    fireMode: 'auto', // spec §3.1
    fireRateHz: 13.333, // spec §7.2
    magazine: 30, // spec §7.2
    reserve: 90, // spec §3.1
    reloadSec: 2.25, // spec §7.2
    equipSec: 0.75, // spec §7.2
    runSpeedMps: 5.7375, // spec §7.2 (0.85 x 6.75)
    spreadFirstDeg: 0.4, // spec §7.3
    spreadMaxDeg: 1.3, // spec §7.3 (patch note 11.08 over the wiki's 1.4; spec §3.3 disagreement)
    crouchSpreadMult: 0.85, // spec §7.3
    recoverySec: 0.25, // spec §7.3 (ESTIMATE 35%)
    tapEfficiency: 3, // spec §7.3 (OFFICIAL, PN 11.08)
    spreadRampBullets: 6, // spec §7.3 (ESTIMATE 30%)
    errCrouchMoveDeg: 0.15, // spec §7.3
    errWalkDeg: 1, // spec §7.3
    errRunDeg: 2.5, // spec §7.3
    errAirDeg: 10, // spec §7.3
    deadzoneFraction: 0.275, // spec §7.3 / §2.4
    damageBands: [
      { upToM: 15, head: 78, body: 26, leg: 22.1 }, // spec §7.4
      { upToM: 30, head: 66, body: 22, leg: 18.7 }, // spec §7.4
      { upToM: 50, head: 60, body: 20, leg: 17 }, // spec §7.4
    ],
    penetration: 'low', // spec §7.4
    // spec §3.5 `smg` PLACEHOLDER: 0.22 deg up for bullets 1-8, then 0.06.
    recoilPitchDeg: [...times(8, 0.22), 0.06],
    // spec §3.5: 0.12 deg sideways after the 5 protected bullets, none before.
    recoilYawDeg: [...times(5, 0), 0.12],
    recoilProtectedBullets: 5, // spec §3.5 (PN 11.08)
    recoilFlipChance: 0.1, // spec §3.5 (ASSUMED: PN 11.08 states no chance for the smg)
    recoilFlipTimeSec: 0.28, // spec §3.5 (PN 11.08)
    recoilReturnDelaySec: 1.5 / 13.333, // spec §3.5: holds through held fire (1.5 shot intervals), back at recoverySec
    recoilMovingPitchMult: 1.8, // spec §3.5 (PN 6.11, vertical while running, also the SMG)
    recoilMovingYawMult: 1.5, // spec §3.5 (PN 4.0)
    recoilCrouchYawMult: 0.85, // spec §3.5 (PN 0.50)
  },
};

export const weaponRules: WeaponRules = {
  rangeM: 200,
  walkFraction: 0.5, // spec §7.1 `move.walk_fraction`
  crouchWalkFraction: 0.34, // spec §7.1 `move.crouch_walk_fraction`
  landingSpreadAddDeg: 7, // spec §7.1 `move.landing_spread_add`
  landingSpreadSec: 0.225, // spec §7.1 `move.landing_spread_duration`
  centreBiasPowerStill: 1.5, // spec §7.1 `spread.center_bias_power_still`
  centreBiasPowerMoving: 0.5, // spec §7.1 `spread.center_bias_power_moving`
  heldFireIntervals: 1.5, // spec §3.3 model: `interval <= 1.5 * fire_interval`
  defaultLoadout: ['kestrel', 'pace'],
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { weapon, weaponRules };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
