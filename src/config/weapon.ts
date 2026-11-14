/** Weapon tunables. One placeholder hitscan weapon for the scaffold; later tasks own real weapons. */
export interface WeaponTunables {
  id: string;
  name: string;
  damage: number;
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
  damage: 34,
  fireIntervalSec: 0.1,
  range: 200,
  runSpeed: 5.4,
  sniper: false,
  recoilResetSec: 0.35,
};
