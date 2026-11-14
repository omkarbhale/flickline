/** First-run profile tunables: the self-report chips and the skill prior they set. */
export type SelfReport = 'new' | 'some' | 'experienced' | 'competitive';
export const SELF_REPORTS: readonly SelfReport[] = ['new', 'some', 'experienced', 'competitive'];

export interface ProfileTunables {
  /** Prior mean on the 0..100 difficulty dial for each chip (design 9.2). */
  priorByReport: Record<SelfReport, number>;
  /** Prior mean when the player skips the chips. */
  priorSkipped: number;
  /** Prior standard deviation on the dial, whatever was chosen. */
  priorSd: number;
  /** Chip captions shown in the first-run panel. */
  chipLabels: Record<SelfReport, string>;
}

export const profile: ProfileTunables = {
  priorByReport: { new: 15, some: 35, experienced: 55, competitive: 75 },
  priorSkipped: 40,
  priorSd: 25,
  chipLabels: { new: 'New', some: 'Some', experienced: 'Experienced', competitive: 'Competitive' },
};
