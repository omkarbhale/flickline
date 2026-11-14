/**
 * Weapon tunables. One placeholder hitscan weapon for the scaffold; later tasks own real weapons
 * (#14: Pace and Kestrel as data-driven definitions). Damage numbers are already the spec's.
 */

/**
 * One damage band (spec §3.2): applies to hits up to and including `upToM` metres from the
 * muzzle. Beyond the last band the last band is used. Floats are kept; only displays floor them.
 */
export interface DamageBand {
  upToM: number;
  head: number;
  body: number;
  leg: number;
}

export interface WeaponTunables {
  id: string;
  name: string;
  /** Damage by zone and distance. Spec §3.2 / §7.4 `rifle_spray` (Kestrel). Ascending `upToM`. */
  damageBands: readonly DamageBand[];
  /** Seconds between shots (automatic fire while the button is held). */
  fireIntervalSec: number;
  /** Maximum hitscan range, metres. */
  range: number;
  /** Run speed with this weapon equipped, m/s (the deadzone is a fraction of it). */
  runSpeed: number;
  /** Sniper-class weapons use the smaller deadzone fraction. */
  sniper: boolean;
  /** A shot after a pause longer than this restarts the burst (recoil index 0). */
  recoilResetSec: number;
}

export const weapon: WeaponTunables = {
  id: 'proto-rifle',
  name: 'Prototype Rifle',
  damageBands: [
    { upToM: 20, head: 156, body: 39, leg: 33.15 },
    { upToM: 50, head: 140, body: 35, leg: 29.75 },
  ],
  fireIntervalSec: 0.1,
  range: 200,
  runSpeed: 5.4,
  sniper: false,
  recoilResetSec: 0.35,
};
