/** Weapon tunables. One placeholder hitscan weapon for the scaffold; later tasks own real weapons. */
export interface WeaponTunables {
  id: string;
  name: string;
  damage: number;
  /** Seconds between shots (automatic fire while the button is held). */
  fireIntervalSec: number;
  /** Maximum hitscan range, metres. */
  range: number;
  /** Moving-shot threshold as a fraction of run speed (spec §2.4 `move.deadzone_fraction`: 0.275). */
  deadzoneFraction: number;
}

export const weapon: WeaponTunables = {
  id: 'proto-rifle',
  name: 'Prototype Rifle',
  damage: 34,
  fireIntervalSec: 0.1,
  range: 200,
  deadzoneFraction: 0.275,
};
