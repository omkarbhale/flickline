import type { SelfReport as DialSelfReport } from './dial';

/** First-run profile tunables: the self-report chips. The prior each chip sets lives in `dial.ts`. */
export type SelfReport = Exclude<DialSelfReport, 'skip'>;
export const SELF_REPORTS: readonly SelfReport[] = ['new', 'some', 'experienced', 'competitive'];

export interface ProfileTunables {
  /** Chip captions shown in the first-run panel. */
  chipLabels: Record<SelfReport, string>;
}

export const profile: ProfileTunables = {
  chipLabels: { new: 'New', some: 'Some', experienced: 'Experienced', competitive: 'Competitive' },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { profile };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
