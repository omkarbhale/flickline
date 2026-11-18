/**
 * Mode framework tunables (design §4 intro). Only the framework's own numbers live here: the drill
 * modes that used to add their own groups (see the fate table in design §4.10)
 * are retired (design §4.10, #211), and the fairness floors and beat length are in `config/dial.ts`.
 * Sweep's numbers are in `config/sweep.ts`.
 */
export interface ModeTunables {
  /** `ready` phase length: crosshair and movement work, targets not live (§2 definitions). */
  readySec: number;
}

export const modes: ModeTunables = {
  readySec: 0.8,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { modes };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
