import type { SkillId } from './dial';

/**
 * Menu copy and session rules (design section 2 "Session", section 9.5, section 13.4). Pure data:
 * the cards are rendered from the mode registry (`app/modeHost.ts` `MODES`), and this table only
 * adds the words and the order. A mode that is registered but has no entry here still gets a card
 * (name derived from its id, listed last), so a new mode shows up without touching this file.
 */
export interface ModeCardInfo {
  /** Card title. */
  name: string;
  /** One line: what you do and why it trains the skill. */
  blurb: string;
  /** Position in the grid (ascending). */
  order: number;
  /** `false` = no card (fixtures and the placement probe, which run from first-run, not from the grid). */
  listed?: boolean;
}

export interface MenuTunables {
  session: {
    /**
     * The run that closes Today's session (design section 2): the flagship. When it is not
     * registered (yet), the session is the warm-up runs alone.
     */
    finaleMode: string;
  };
  modeCards: Record<string, ModeCardInfo>;
  /** Skill names as shown on cards (design section 3). `line` is the whole profile (Sweep). */
  skillLabels: Record<SkillId | 'line', string>;
  /** The one-line explanation under "Matched to you" (design section 9.5). */
  matchedHint: string;
  /** Shown instead of the cards when no mode is registered. */
  emptyModes: string;
}

export const menu: MenuTunables = {
  session: { finaleMode: 'sweep' },
  modeCards: {
    coldStart: { name: 'Cold Start', blurb: 'One Post at a time. Your first bullet decides it.', order: 10 },
    orbit: { name: 'Orbit', blurb: 'Beacons all around you. Flick, click, next.', order: 20 },
    strafeTrack: { name: 'Strafe Track', blurb: 'Stay on a moving target and keep the line.', order: 30 },
    stopAndPop: { name: 'Stop & Pop', blurb: 'Stop first, then shoot. Moving shots miss.', order: 40 },
    sprayWall: { name: 'Spray Wall', blurb: 'Control the spray from first bullet to last.', order: 50 },
    switchboard: { name: 'Switchboard', blurb: 'Several targets up. Pick the next one fast.', order: 60 },
    cornerClear: { name: 'Corner Clear', blurb: 'Clear each angle before it clears you.', order: 70 },
    sweep: { name: 'Sweep', blurb: 'The flagship: an arena that fights back.', order: 80 },
    test: { name: 'Test', blurb: 'Framework fixture.', order: 900, listed: false },
    placement: { name: 'Placement', blurb: 'The 45 second calibration run.', order: 910, listed: false },
    // Started by Today's session when it is due (design §8.5, #157), never from the grid.
    baseline: { name: 'Baseline', blurb: 'The same 40 targets every day, cold: learning, not warm-up.', order: 920, listed: false },
  },
  skillLabels: {
    precision: 'Precision',
    flick: 'Flick',
    track: 'Track',
    footwork: 'Footwork',
    spray: 'Spray',
    switch: 'Switch',
    angles: 'Angles',
    line: 'All seven skills',
  },
  matchedHint: 'Targets are set to about a 70% hit rate for you.',
  emptyModes: 'No modes are registered yet.',
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { menu };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
