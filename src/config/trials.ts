/**
 * Trial classification for Sweep contacts (design §3.1, §9.1; #203): the rules that turn a fight's
 * facts into `skillTrial`s for the seven skills, as data next to the stat definitions. The rule
 * code is `modes/contactTrials.ts`; every number it judges by is here. Starting values are
 * HYPOTHESIS until the balance pass (#53) tunes them against human play.
 * Seconds, metres; names ending `Deg` are degrees.
 *
 * **Thresholds are dial axes.** An item's difficulty is the dial its contact was placed at (design
 * §9.1), so its chance of success must fall as that dial rises, or the posterior cannot find the
 * player: a rule whose bar ignores the dial gives the same success rate at every dial, and the
 * sector dial (aimed at 70 % from the posterior) drifts without bound. The Echoes' own numbers
 * (reaction, tell, strafe speed) already make most fights harder with the dial; a rule that judges
 * something the Echo does not change (crosshair placement, a flick's time, time on target, a spray's
 * hit share, a switch's time) moves its bar along the dial instead, as Spray Wall's hit fraction
 * did (`dial.axes.sprayHitFraction`). `{ at0, at100 }`: the bar at dial 0 and at dial 100, linear between.
 */

import type { SweepCard } from './sweep';

/** A threshold that moves with the item's dial: its value at dial 0 and at dial 100, linear between. */
export interface TrialBar {
  at0: number;
  at100: number;
}

export interface TrialTunables {
  /**
   * First sight (design §3.1, §9.1): an Echo first seen more than `flickMinDeg` from the crosshair
   * is a must-flick item (a `flick` trial); nearer, its first shot is a `precision` trial (Cold
   * Start's rule: the first bullet hits the head). Within `preAimedDeg` the item is recorded as
   * pre-aimed (`extra.preAimed`), the trial type of §9.1.
   */
  flickMinDeg: number;
  preAimedDeg: number;
  /**
   * `flick` succeeds when the first shot at the Echo hits it within `(baseSec + perDegSec × angle) ×
   * slack(dial)` of first sight. `baseSec + perDegSec × angle` is about 1.3× the minimum feasible
   * time (reaction plus the aiming movement, design §9.3.5, #12 §4.1: 0.8 s for a small adjustment,
   * 1.25 s for 135°), so a slack of 1 at dial 100 is the tightest fair bar.
   */
  flick: { baseSec: number; perDegSec: number; slack: TrialBar };
  /** `angles` (take sectors): at the contact's first sight, pre-aim error and head-height error both within the bars. */
  angles: { maxPreAimDeg: TrialBar; maxHeadDeg: TrialBar };
  /**
   * `track`: a duel with a strafing Echo (a Strafer with a lane) lasting at least `minDuelSec` of
   * mutual sight after the player first saw it; success = the padded aim ray (`aimOnTarget`, design
   * §3.2 time on target) was on it for at least `onTargetShare` of that time.
   */
  track: { minDuelSec: number; onTargetShare: TrialBar };
  /**
   * `spray`: a burst is consecutive shots no more than `maxGapSec` apart; one of `minBullets` or more
   * with a shot at an Echo is a trial, won when at least `hitShare` of its bullets hit an Echo.
   */
  spray: { minBullets: number; maxGapSec: number; hitShare: TrialBar };
  /** `switch`: after a kill with another seen Echo of the contact in sight, the next shot at it must hit within `maxSec`. */
  switch: { maxSec: TrialBar };
  /**
   * Item difficulty = the dial the contact's Echoes were placed at + this card offset (design §9.1:
   * "a function of the dial settings in force ... and of its scenario card"). A prepared holder is
   * harder than an unaware one, a crossfire harder than a single angle.
   */
  cardOffset: Readonly<Record<SweepCard, number>>;
}

export const trials: TrialTunables = {
  flickMinDeg: 20,
  preAimedDeg: 2,
  flick: { baseSec: 0.95, perDegSec: 0.005, slack: { at0: 1.6, at100: 1 } },
  angles: { maxPreAimDeg: { at0: 20, at100: 4 }, maxHeadDeg: { at0: 6, at100: 1.5 } },
  track: { minDuelSec: 0.4, onTargetShare: { at0: 0.2, at100: 0.65 } },
  spray: { minBullets: 5, maxGapSec: 0.2, hitShare: { at0: 0.3, at100: 0.75 } },
  switch: { maxSec: { at0: 1.6, at100: 0.7 } },
  cardOffset: { 'take-unaware': -3, 'take-expected': 2, clear: 0, crossfire: 4, meet: 0 },
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { trials };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
