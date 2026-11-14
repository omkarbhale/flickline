/** Weapon tunables. One placeholder hitscan weapon for the scaffold; later tasks own real weapons. */
export interface WeaponTunables {
  id: string;
  name: string;
  damage: number;
  /** Seconds between shots (automatic fire while the button is held). */
  fireIntervalSec: number;
  /** Maximum hitscan range, metres. */
  range: number;
  /**
   * Fraction of max run speed above which a shot counts as fired while moving (the accuracy
   * deadzone, mechanics spec 2.6: 27.5%). Drives `shotFired.moving`.
   */
  movingSpeedFraction: number;
}

export const weapon: WeaponTunables = {
  id: 'proto-rifle',
  name: 'Prototype Rifle',
  damage: 34,
  fireIntervalSec: 0.1,
  range: 200,
  movingSpeedFraction: 0.275,
};
