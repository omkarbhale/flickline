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
  | 'footstep';

export const CUE_IDS: readonly CueId[] = [
  'shotPace', 'shotKestrel', 'hitBody', 'hitLeg', 'hitHead', 'kill', 'killSparkle', 'miss',
  'movingShot', 'streakBreak', 'uiTick', 'uiConfirm', 'jump', 'land', 'footstep',
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

/** Fixed (non-stepped) cues. `kill` and `killSparkle` are built per ladder step in audio/cues.ts. */
export const cueRecipes: Record<Exclude<CueId, 'kill' | 'killSparkle'>, CueRecipe> = {
  // Shots: 2 ms noise transient + pitched body sweep + short filtered-noise tail.
  // Pace = high and dry.
  shotPace: {
    bus: 'weapons', peakDb: -15, decayDb: -50,
    layers: [
      noise('highpass', 0, 2, 1800, undefined, 0.7, 0, 1.0),
      tone('triangle', 0, 70, 520, 210, 0.5, 0.8),
      noise('bandpass', 2, 80, 3600, 2200, 0.9, 0.5, 0.45),
    ],
  },
  // Kestrel = mid and punchy.
  shotKestrel: {
    bus: 'weapons', peakDb: -15, decayDb: -50,
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
    bus: 'hits', peakDb: -22, decayDb: -35,
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
  // Movement placeholders carried over from the scaffold; #41 owns the real set.
  jump: {
    bus: 'weapons', peakDb: -30, decayDb: -40,
    layers: [noise('lowpass', 0, 50, 900, undefined, 0.7, 1, 1.0)],
  },
  land: {
    bus: 'weapons', peakDb: -24, decayDb: -40,
    layers: [noise('lowpass', 0, 90, 600, undefined, 0.7, 1, 1.0)],
  },
  footstep: {
    bus: 'weapons', peakDb: -32, decayDb: -40,
    layers: [noise('lowpass', 0, 40, 700, undefined, 0.7, 1, 1.0)],
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

export interface AudioTunables {
  /** Master gain multiplier applied on top of the user volume setting. */
  masterGain: number;
  ladder: LadderTunables;
  /** Hit and kill cues duck the `weapons` bus by `db` for `holdMs`, then release over `releaseMs`. */
  duck: { db: number; attackMs: number; holdMs: number; releaseMs: number };
  /** Master limiter: a static soft limiter (waveshaper): transparent below the threshold, saturating to just under 0 dBFS above it. No latency. */
  limiter: { thresholdDb: number };
  /** Shot sounds get this much random pitch and gain variation (fraction, +/-). */
  shotJitter: { pitch: number; gain: number };
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
  duck: { db: -3, attackMs: 2, holdMs: 80, releaseMs: 40 },
  limiter: { thresholdDb: -3 },
  shotJitter: { pitch: 0.03, gain: 0.03 },
  voiceLimit: 24,
  panner: { refDistance: 1, maxDistance: 120, rolloff: 1.2 },
  weaponCues: { pace: 'shotPace', kestrel: 'shotKestrel' },
  defaultShotCue: 'shotKestrel',
  streakBreakMin: 2,
  jitterSeed: 0x51f15e,
};
