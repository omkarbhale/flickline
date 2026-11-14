/** View / camera tunables. */
export interface ViewTunables {
  /** Horizontal FOV in degrees at the 16:9 reference aspect. Locked: not a user setting. */
  hfovDeg: number;
  near: number;
  far: number;
  /** Shown in the settings UI. */
  fovLockNote: string;
}

export const view: ViewTunables = {
  hfovDeg: 103,
  near: 0.05,
  far: 250,
  fovLockNote:
    'Field of view is locked to 103° horizontal at 16:9, the same as the game Flickline trains you for, so what you see transfers 1:1.',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { view };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
