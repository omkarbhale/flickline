/** Static practice target tunables. */
export interface TargetTunables {
  radius: number;
  maxHp: number;
  /** Seconds a destroyed target stays down before respawning. */
  respawnSec: number;
  /** Respawn position jitter (metres, seeded RNG) so the RNG path is exercised and deterministic. */
  respawnJitter: number;
}

export const targets: TargetTunables = {
  radius: 0.28,
  maxHp: 100,
  respawnSec: 1.2,
  respawnJitter: 0.4,
};
