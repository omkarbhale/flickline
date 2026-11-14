/** Weapon tunables. One placeholder hitscan weapon for the scaffold; later tasks own real weapons. */
export interface WeaponTunables {
  id: string;
  name: string;
  damage: number;
  /** Seconds between shots (automatic fire while the button is held). */
  fireIntervalSec: number;
  /** Maximum hitscan range, metres. */
  range: number;
}

export const weapon: WeaponTunables = {
  id: 'proto-rifle',
  name: 'Prototype Rifle',
  damage: 34,
  fireIntervalSec: 0.1,
  range: 200,
};
