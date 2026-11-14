/**
 * Menu copy (design section 2, section 13.4). The menu lists no modes: Play starts a Sweep run (#202), and the
 * drill modes, their cards and Today's session are retired (design §4.10, #211).
 */
export interface MenuTunables {
  /** One line under the wordmark on the first panel and the main menu (vision principle 10: no trainer, no drills). */
  tagline: string;
  /** Under Play on the first panel: what clicking the range does instead (design 13.4). */
  lobbyNote: string;
}

export const menu: MenuTunables = {
  tagline: 'First-person fights that read your aim',
  lobbyNote: 'Or click the range first to try your sensitivity. Nothing there counts.',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { menu };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
