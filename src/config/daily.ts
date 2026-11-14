/**
 * The Daily Route's seed (design §4.8). The seed is a pure function of the local calendar date, so every
 * player gets the same route, cards and Echo personalities that day with nothing sent anywhere.
 */
export interface DailyTunables {
  /**
   * Version of the date -> seed function (`modes/dailyRoute.ts`). The seed of a date must not change between
   * releases, so a change to the hash, the salt or the route generator that would give an old date a different
   * route bumps this number (and the golden seeds in `dailyRoute.test.ts`); stored day bests keep the seed they
   * were played on, so an old best can still be replayed.
   */
  seedVersion: number;
  /** Text mixed into the hash with the version and the date, so the daily seeds are not the bare hash of the date. */
  salt: string;
}

export const daily: DailyTunables = {
  seedVersion: 1,
  salt: 'flickline.daily',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { daily };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
