/**
 * Audio tunables (design section 12). Every cue is synthesised from the recipes below at load;
 * no samples, no downloads. Levels are peak dBFS of the rendered one-shot at unity bus gain.
 * Recipes are data: a sound change is an edit here, not a code change.
 */

export type BusId = 'weapons' | 'hits' | 'enemies' | 'ui';
export const BUS_IDS: readonly BusId[] = ['weapons', 'hits', 'enemies', 'ui'];

export type CueId =
  | 'shotPace'
  | 'shotKestrel'
  | 'hitBody'
  | 'hitLeg'
  | 'hitHead'
  | 'kill'
  | 'killSparkle'
  | 'miss'
  | 'movingShot'
  | 'streakBreak'
  | 'uiTick'
  | 'uiConfirm'
  | 'jump'
  | 'land'
  | 'footstep'
  // #41: the rest of design section 12.
  | 'shotRill'
  | 'shotLongnail'
  | 'reloadOut'
  | 'reloadIn'
  | 'equip'
  | 'enemyShot'
  | 'enemyTell'
  | 'whiz'
  | 'damageThud'
  | 'enemyFootstep'
  | 'chain'
  | 'medal'
  | 'surgeWhoosh'
  | 'surgeShimmer'
  | 'uiReady'
  | 'uiGo'
  | 'resultsFanfare'
  | 'runEnd';

export const CUE_IDS: readonly CueId[] = [
  'shotPace', 'shotKestrel', 'hitBody', 'hitLeg', 'hitHead', 'kill', 'killSparkle', 'miss',
  'movingShot', 'streakBreak', 'uiTick', 'uiConfirm', 'jump', 'land', 'footstep',
  'shotRill', 'shotLongnail', 'reloadOut', 'reloadIn', 'equip', 'enemyShot', 'enemyTell', 'whiz', 'damageThud',
  'enemyFootstep', 'chain', 'medal', 'surgeWhoosh', 'surgeShimmer', 'uiReady', 'uiGo', 'resultsFanfare', 'runEnd',
];

/** A pitched partial: sine or triangle with an optional exponential frequency sweep. */
export interface ToneLayer {
  kind: 'tone';
  wave: 'sine' | 'triangle';
  startMs: number;
  durMs: number;
  hz: number;
  /** Frequency at the end of the layer (exponential sweep); omitted = constant. */
  endHz?: number;
  attackMs: number;
  /** Relative level inside the cue (the cue is normalised to its peak target afterwards). */
  gain: number;
}

/** Filtered noise burst. */
export interface NoiseLayer {
  kind: 'noise';
  startMs: number;
  durMs: number;
  filter: 'lowpass' | 'highpass' | 'bandpass';
  hz: number;
  endHz?: number;
  q: number;
  attackMs: number;
  gain: number;
}

export type Layer = ToneLayer | NoiseLayer;

export interface CueRecipe {
  bus: BusId;
  /** Random pitch and gain variation per play (`audio.shotJitter`): shots and footsteps, so repeats are not machine-gunned. */
  jitter?: boolean;
  /** Never dropped when the voice limit is reached (information the player must not miss). */
  priority?: boolean;
  /** Loops until stopped (`setLoop`); the buffer must be seamless (integer cycles, no envelope). */
  loop?: boolean;
  /** Distance model override for positional plays of this cue (the default is `audio.panner`). */
  spatial?: { refDistance: number; rolloff: number };
  /** Target peak of the rendered buffer in dBFS (design section 12 mix: hits -12, weapons -15). */
  peakDb: number;
  /** Envelope falls this far (dB) by the end of each layer. */
  decayDb: number;
  layers: Layer[];
}

const tone = (
  wave: ToneLayer['wave'], startMs: number, durMs: number, hz: number, endHz: number | undefined,
  attackMs: number, gain: number,
): ToneLayer => ({ kind: 'tone', wave, startMs, durMs, hz, endHz, attackMs, gain });

const noise = (
  filter: NoiseLayer['filter'], startMs: number, durMs: number, hz: number, endHz: number | undefined,
  q: number, attackMs: number, gain: number,
): NoiseLayer => ({ kind: 'noise', startMs, durMs, filter, hz, endHz, q, attackMs, gain });

const SEMITONE = Math.pow(2, 1 / 12);

/** Fixed cues. `kill`, `killSparkle` and `chain` are built per ladder step and `enemyTell` per length, in audio/cues.ts and audio/tell.ts. */
/** Cues that are not built from a fixed layer list: stepped by ladder step, or sized by the event. */
export type BuiltCueId = 'kill' | 'killSparkle' | 'chain' | 'enemyTell';

export const cueRecipes: Record<Exclude<CueId, BuiltCueId>, CueRecipe> = {
  // Shots: 2 ms noise transient + pitched body sweep + short filtered-noise tail.
  // Pace = high and dry.
  shotPace: {
    bus: 'weapons', peakDb: -15, decayDb: -50, jitter: true,
    layers: [
      noise('highpass', 0, 2, 1800, undefined, 0.7, 0, 1.0),
      tone('triangle', 0, 70, 520, 210, 0.5, 0.8),
      noise('bandpass', 2, 80, 3600, 2200, 0.9, 0.5, 0.45),
    ],
  },
  // Kestrel = mid and punchy.
  shotKestrel: {
    bus: 'weapons', peakDb: -15, decayDb: -50, jitter: true,
    layers: [
      noise('highpass', 0, 2, 900, undefined, 0.7, 0, 1.0),
      tone('sine', 0, 110, 230, 84, 0.5, 1.0),
      tone('triangle', 0, 45, 460, 170, 0.5, 0.35),
      noise('lowpass', 2, 150, 2800, 1100, 0.8, 0.5, 0.55),
    ],
  },
  // Hits: the thock is a 60 ms sine drop 220 -> 110 Hz with a low-passed click, so it carries no
  // energy above ~1.5 kHz; the tink (two detuned triangles at 1.9 kHz, 120 ms) is what makes a
  // headshot.
  hitBody: {
    bus: 'hits', peakDb: -12, decayDb: -45,
    layers: [
      noise('lowpass', 0, 3, 700, undefined, 0.7, 0, 0.5),
      tone('sine', 0, 60, 220, 110, 0.6, 1.0),
    ],
  },
  hitLeg: {
    // A semitone lower and 6 dB quieter than the body thock.
    bus: 'hits', peakDb: -18, decayDb: -45,
    layers: [
      noise('lowpass', 0, 3, 700 / SEMITONE, undefined, 0.7, 0, 0.5),
      tone('sine', 0, 60, 220 / SEMITONE, 110 / SEMITONE, 0.6, 1.0),
    ],
  },
  hitHead: {
    bus: 'hits', peakDb: -12, decayDb: -50,
    layers: [
      noise('lowpass', 0, 3, 700, undefined, 0.7, 0, 0.5),
      tone('sine', 0, 60, 220, 110, 0.6, 0.8),
      tone('triangle', 0, 120, 1900, undefined, 0.8, 0.55),
      tone('triangle', 0, 120, 1900 * 1.011, undefined, 0.8, 0.55),
    ],
  },
  // Miss: a quiet 20 ms surface "pfft".
  miss: {
    bus: 'hits', peakDb: -26, decayDb: -40,
    layers: [noise('bandpass', 0, 20, 2300, 1400, 0.6, 1.5, 1.0)],
  },
  // Moving shot: a flat, low, dull "tock" under the shot; deliberately no pitch sweep or ladder.
  movingShot: {
    bus: 'hits', peakDb: -20, decayDb: -45,
    layers: [
      noise('lowpass', 0, 3, 600, undefined, 0.7, 0, 0.4),
      tone('triangle', 0, 70, 150, undefined, 0.8, 1.0),
    ],
  },
  // Streak break: a falling minor third (A5 -> F#5), soft, 150 ms.
  streakBreak: {
    bus: 'hits', peakDb: -22, decayDb: -35, priority: true,
    layers: [
      tone('sine', 0, 75, 880, undefined, 3, 1.0),
      tone('sine', 75, 75, 880 / Math.pow(SEMITONE, 3), undefined, 3, 0.9),
    ],
  },
  // UI ticks: short, soft, never resembling a hit or a kill.
  uiTick: {
    bus: 'ui', peakDb: -24, decayDb: -45,
    layers: [tone('sine', 0, 40, 1200, undefined, 1, 1.0)],
  },
  uiConfirm: {
    bus: 'ui', peakDb: -22, decayDb: -45,
    layers: [
      tone('sine', 0, 40, 1200, undefined, 1, 1.0),
      tone('sine', 35, 45, 1600, undefined, 1, 1.0),
    ],
  },
  // Movement (design 12 "Footsteps": information, not ambience). Own steps are quiet filtered clicks
  // with a soft low thump; the jump is a push-off scuff, the landing a heavier thump.
  jump: {
    bus: 'weapons', peakDb: -30, decayDb: -40,
    layers: [
      noise('lowpass', 0, 50, 900, undefined, 0.7, 1, 1.0),
      tone('sine', 0, 40, 120, 80, 1, 0.5),
    ],
  },
  land: {
    bus: 'weapons', peakDb: -24, decayDb: -40,
    layers: [
      noise('lowpass', 0, 90, 600, undefined, 0.7, 1, 0.8),
      tone('sine', 0, 90, 110, 55, 1, 1.0),
    ],
  },
  footstep: {
    bus: 'weapons', peakDb: -32, decayDb: -40, jitter: true,
    layers: [
      noise('bandpass', 0, 14, 1400, undefined, 1.0, 0.3, 1.0),
      tone('sine', 0, 35, 95, 60, 1, 0.8),
    ],
  },
  // An enemy's step: the same family, heavier on the click so it carries at distance. Positioned.
  enemyFootstep: {
    bus: 'enemies', peakDb: -26, decayDb: -40, jitter: true,
    layers: [
      noise('bandpass', 0, 16, 1800, undefined, 1.0, 0.3, 1.0),
      tone('sine', 0, 40, 85, 50, 1, 0.7),
    ],
  },

  // Weapons: Rill = tight and fast, Longnail = deep with a long tail (design 12).
  shotRill: {
    bus: 'weapons', peakDb: -15, decayDb: -50, jitter: true,
    layers: [
      noise('highpass', 0, 2, 1400, undefined, 0.7, 0, 1.0),
      tone('triangle', 0, 45, 400, 180, 0.5, 0.9),
      noise('bandpass', 2, 55, 3000, 1800, 0.9, 0.5, 0.4),
    ],
  },
  shotLongnail: {
    bus: 'weapons', peakDb: -15, decayDb: -50, jitter: true,
    layers: [
      noise('highpass', 0, 3, 600, undefined, 0.7, 0, 1.0),
      tone('sine', 0, 220, 150, 45, 0.5, 1.0),
      tone('triangle', 0, 90, 300, 90, 0.5, 0.4),
      noise('lowpass', 3, 520, 1800, 250, 0.8, 0.5, 0.6),
    ],
  },
  // An enemy's shot: a different timbre from the player's (duller attack, nasal mid), so it is never
  // mistaken for your own fire. Positioned and distance-attenuated at play time.
  enemyShot: {
    bus: 'enemies', peakDb: -15, decayDb: -50, jitter: true,
    layers: [
      noise('bandpass', 0, 3, 1000, undefined, 0.8, 0, 1.0),
      tone('triangle', 0, 80, 300, 110, 0.5, 0.9),
      noise('lowpass', 3, 140, 1500, 450, 1.2, 0.5, 0.6),
    ],
  },
  // Reload and equip: small mechanical sounds under the shots, never near hit level.
  reloadOut: {
    bus: 'weapons', peakDb: -24, decayDb: -40,
    layers: [
      noise('highpass', 0, 4, 2500, undefined, 1.0, 0, 1.0),
      tone('triangle', 0, 18, 900, 500, 0.5, 0.4),
      noise('bandpass', 35, 6, 1800, undefined, 1.0, 0, 0.7),
    ],
  },
  reloadIn: {
    bus: 'weapons', peakDb: -22, decayDb: -40,
    layers: [
      tone('sine', 0, 40, 180, 120, 0.5, 1.0),
      noise('bandpass', 0, 5, 2200, undefined, 1.0, 0, 0.8),
      noise('bandpass', 45, 5, 3000, undefined, 1.0, 0, 0.6),
    ],
  },
  equip: {
    bus: 'weapons', peakDb: -24, decayDb: -40,
    layers: [
      noise('bandpass', 0, 40, 900, 3200, 1.5, 6, 0.7),
      noise('bandpass', 40, 5, 2200, undefined, 1.0, 0, 1.0),
      tone('triangle', 40, 25, 600, 400, 0.5, 0.3),
    ],
  },

  // Near miss: a short pitched whiz falling in pitch as the bullet passes. Positioned at the point
  // of closest approach, so it comes from the side the shot passed.
  whiz: {
    bus: 'enemies', peakDb: -20, decayDb: -30, priority: true,
    layers: [
      noise('bandpass', 0, 100, 3200, 1100, 3, 25, 1.0),
      tone('sine', 0, 100, 2200, 900, 25, 0.5),
    ],
  },
  // Damage taken: a low, dry thud centred in the head (not positional), well under the body thock
  // in pitch and longer. The 300 ms low-pass dip on everything else is the engine's `dipLowpass`.
  damageThud: {
    bus: 'enemies', peakDb: -12, decayDb: -45, priority: true,
    layers: [
      noise('lowpass', 0, 4, 420, undefined, 0.7, 0, 0.6),
      tone('sine', 0, 150, 95, 42, 1, 1.0),
      tone('triangle', 0, 50, 180, 70, 1, 0.3),
    ],
  },

  // Medal: a 4-note rising phrase (C5 E5 G5 C6), 400 ms, triangle-bright so it is not a kill chime.
  medal: {
    bus: 'ui', peakDb: -17, decayDb: -35, priority: true,
    layers: [523.25, 659.26, 783.99, 1046.5].flatMap((hz, i) => [
      tone('triangle', i * 100, i === 3 ? 100 : 140, hz, undefined, 2, 1.0),
      tone('sine', i * 100, i === 3 ? 100 : 140, hz * 2, undefined, 2, 0.35),
    ]),
  },
  // Surge: a rising whoosh at the start, then a sustained shimmer (a seamless 1 s loop: every partial
  // is a whole number of cycles per second, beating at 4 and 7 Hz).
  surgeWhoosh: {
    bus: 'ui', peakDb: -20, decayDb: -40,
    layers: [
      noise('bandpass', 0, 450, 250, 5000, 1.1, 330, 1.0),
      tone('sine', 0, 450, 200, 900, 330, 0.3),
    ],
  },
  surgeShimmer: {
    bus: 'ui', peakDb: -34, decayDb: 0, loop: true,
    layers: [
      tone('sine', 0, 1000, 880, undefined, 0, 1.0),
      tone('sine', 0, 1000, 884, undefined, 0, 1.0),
      tone('sine', 0, 1000, 1320, undefined, 0, 0.6),
      tone('sine', 0, 1000, 1327, undefined, 0, 0.6),
    ],
  },

  // Run flow (design 12 "UI"): ready blip, go chirp, and the results fanfare that resolves to the
  // ladder root (E5 -> C#5 -> A4 = 440 Hz); a death or quit gets just the closing root note.
  uiReady: {
    bus: 'ui', peakDb: -22, decayDb: -40,
    layers: [tone('sine', 0, 70, 880, undefined, 4, 1.0)],
  },
  uiGo: {
    bus: 'ui', peakDb: -21, decayDb: -40,
    layers: [
      tone('sine', 0, 120, 880, 1480, 3, 1.0),
      tone('triangle', 0, 120, 440, 740, 3, 0.4),
    ],
  },
  resultsFanfare: {
    bus: 'ui', peakDb: -16, decayDb: -35, priority: true,
    layers: [
      tone('sine', 0, 110, 659.26, undefined, 3, 1.0),
      tone('sine', 110, 110, 554.37, undefined, 3, 1.0),
      tone('sine', 220, 320, 440, undefined, 3, 1.0),
      tone('sine', 220, 320, 220, undefined, 3, 0.5),
    ],
  },
  runEnd: {
    bus: 'ui', peakDb: -22, decayDb: -35,
    layers: [
      tone('sine', 0, 200, 440, undefined, 3, 1.0),
      tone('sine', 0, 200, 220, undefined, 3, 0.4),
    ],
  },
};

/** The kill chime ladder: major pentatonic, 8 steps from the root, step = clean streak. */
export interface LadderTunables {
  rootHz: number;
  /** Semitone offsets from the root, one per step (length = max step). */
  semitones: readonly number[];
  /** Length of each chime note. */
  noteMs: number;
  /** Frequency ratio of the detuned twin partial that gives the chime its shimmer. */
  shimmer: number;
  /** Octave sparkle (headshot kills): ms of a short high partial layered on top. */
  sparkleMs: number;
  peakDb: number;
  sparklePeakDb: number;
}

/** The enemy tell: a rising sweep whose length is the event's `durationMs` (design 5.3, 12). */
export interface TellTunables {
  startHz: number;
  endHz: number;
  /** Linear fade-in and fade-out inside the tone, so the ends never click. Both count towards the length. */
  attackMs: number;
  releaseMs: number;
  /** Level at the start relative to the end (the tell gets louder as it ends: urgency). */
  startLevel: number;
  /** Level of the octave partial (a brighter, saw-like edge) relative to the fundamental. */
  octaveMix: number;
  peakDb: number;
  /** Length of the reference render used by the docs snapshot and tests when no length is given. */
  referenceMs: number;
  /** Tells carry further than other positional cues: a gentler distance roll-off. */
  spatial: { refDistance: number; rolloff: number };
}

/** The chain layer: extra chimes a fifth above the kill note, one per chain step beyond the first. */
export interface ChainTunables {
  /** Layers for a chain of 2, 3, 4+ (so `gains.length` is the cap). */
  gains: readonly number[];
  staggerMs: number;
  noteMs: number;
  peakDb: number;
  /** Fold the fifth down an octave when it would land above this, to stay under the headshot tink. */
  foldAboveHz: number;
}

export interface AudioTunables {
  /** Master gain multiplier applied on top of the user volume setting. */
  masterGain: number;
  ladder: LadderTunables;
  enemyTell: TellTunables;
  chain: ChainTunables;
  /** Where enemy sounds come from, and how far they are heard. */
  enemy: {
    /** Height above an enemy's feet that its tell and shots are placed at (head/muzzle), metres. */
    muzzleHeightM: number;
    /** Footsteps beyond this distance are not played. */
    maxAudibleM: number;
    /** Distance between enemy footsteps, metres (the player's stride is `movement.footstepStride`). */
    strideM: number;
    /** An enemy that moves further than this in one tick teleported (respawn): no step is counted. */
    teleportM: number;
  };
  /** Near-miss whiz: played where the bullet line passes the head, if it passes within `maxMissM`. */
  whiz: { maxMissM: number; minOffsetM: number };
  /** Fade of the looping Surge shimmer in and out. */
  loopFadeMs: number;
  /**
   * Hit and kill cues duck the `weapons` bus for `holdMs`, then release over `releaseMs`. The depth
   * keeps the weapons bus `dominanceDb` under the cue that ducks it, and never less than `db`
   * (design 12: 3 dB): with weapons at `weaponsPeakDb` that is 3.5 dB under a body thock, headshot
   * or kill (-12 dBFS) and 9.5 dB under the leg thock (-18), so a hit is always at least 6 dB above
   * the weapons bus. The 0.5 dB over 6 dB covers the shots' +-3% gain variation.
   */
  duck: { db: number; attackMs: number; holdMs: number; releaseMs: number; dominanceDb: number; weaponsPeakDb: number };
  /** Taking damage dips the master low-pass (design §7.1: "a 300 ms low-pass dip"): the cutoff drops to `hz` in `attackMs`, then returns to open over the rest of `durationMs`. */
  damageDip: { hz: number; q: number; attackMs: number; durationMs: number };
  /** Master limiter: a static soft limiter (waveshaper): transparent below the threshold, saturating to just under 0 dBFS above it. No latency. */
  limiter: { thresholdDb: number };
  /** Shot sounds get this much random pitch and gain variation (fraction, +/-). */
  shotJitter: { pitch: number; gain: number };
  /**
   * "Hit sound style" (design §13.3): a tone filter and a level trim on the `hits` bus. `standard` is
   * the cues as designed (the filter is left open); `soft` rounds the thock, tink and chime off with a
   * low-pass and lowers them, for players who find them sharp. Every hit is still audible and still
   * distinct (the filter keeps the fundamentals), only brighter detail goes.
   */
  hitStyles: Record<'standard' | 'soft', { hz: number; gainDb: number }>;
  /** Maximum simultaneous voices; extra low-priority cues are dropped. */
  voiceLimit: number;
  /** HRTF panner settings for positional voices. */
  panner: { refDistance: number; maxDistance: number; rolloff: number };
  /** Weapon id (from the shotFired event) to shot cue. */
  weaponCues: Record<string, CueId>;
  defaultShotCue: CueId;
  /** A streak of at least this many that ends plays the streak-break cue. */
  streakBreakMin: number;
  /** Seed of the audio-side jitter generator (presentation only; never the sim rng). */
  jitterSeed: number;
}

export const audio: AudioTunables = {
  masterGain: 0.5,
  ladder: {
    rootHz: 440,
    semitones: [0, 2, 4, 7, 9, 12, 14, 16],
    noteMs: 200,
    shimmer: 1.005,
    sparkleMs: 90,
    peakDb: -12,
    sparklePeakDb: -18,
  },
  enemyTell: {
    startHz: 300, endHz: 900, attackMs: 6, releaseMs: 10, startLevel: 0.55, octaveMix: 0.3,
    peakDb: -14, referenceMs: 300, spatial: { refDistance: 3, rolloff: 0.6 },
  },
  chain: { gains: [1, 0.8, 0.65], staggerMs: 55, noteMs: 140, peakDb: -17, foldAboveHz: 1400 },
  enemy: { muzzleHeightM: 1.3, maxAudibleM: 30, strideM: 2.2, teleportM: 1.5 },
  whiz: { maxMissM: 3, minOffsetM: 0.25 },
  loopFadeMs: 120,
  duck: { db: -3, attackMs: 2, holdMs: 80, releaseMs: 40, dominanceDb: 6.5, weaponsPeakDb: -15 },
  damageDip: { hz: 900, q: 0.7, attackMs: 8, durationMs: 300 },
  limiter: { thresholdDb: -3 },
  shotJitter: { pitch: 0.03, gain: 0.03 },
  hitStyles: { standard: { hz: 20000, gainDb: 0 }, soft: { hz: 2600, gainDb: -4 } },
  voiceLimit: 24,
  panner: { refDistance: 1, maxDistance: 120, rolloff: 1.2 },
  weaponCues: { pace: 'shotPace', kestrel: 'shotKestrel', rill: 'shotRill', longnail: 'shotLongnail' },
  defaultShotCue: 'shotKestrel',
  streakBreakMin: 2,
  jitterSeed: 0x51f15e,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { audio };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
