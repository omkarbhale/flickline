/**
 * Sweep (design §4.8) tunables. Only what the simulation needs lives here for now; the director
 * and the surge meter add their own fields when their tasks land.
 */
export interface SweepTunables {
  /** HP restored by a kill (design §4.8: "a body kill restores 5 HP, a headshot kill 10"); capped at max HP. A leg kill counts as a body kill. */
  killHeal: { body: number; head: number };
}

export const sweep: SweepTunables = {
  killHeal: { body: 5, head: 10 },
};
