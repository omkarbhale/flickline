import { palette } from './palette';

/**
 * Per-shot feedback tunables (design §7.1, §11; timings follow docs/research/cues.md R10/R11:
 * every pulse is specified in milliseconds, never in frames). Pool sizes are fixed capacities:
 * when a pool is full the oldest cue is recycled, nothing is allocated.
 */
export interface FeedbackTunables {
  tracer: {
    capacity: number;
    lifeSec: number;
    /** Strip width in metres. */
    width: number;
    /** Length of the dash pattern for moving-shot tracers, metres. */
    dashLength: number;
    /** Minimum on-screen thickness in pixels. */
    minPx: number;
    /** Tracers are drawn at most this far when nothing was hit, metres. */
    maxLength: number;
    color: number;
    movingColor: number;
  };
  /** How long the muzzle flash cue lives; its sprites are per weapon (config/viewmodel.ts). */
  muzzleFlash: { lifeSec: number };
  impact: {
    capacity: number;
    lifeSec: number;
    missSize: number;
    hitSize: number;
    killSize: number;
    missColor: number;
    hitColor: number;
  };
  decal: { capacity: number; ttlSec: number; fadeSec: number; size: number; color: number };
  shatter: {
    /** Kills that can be in flight at once. */
    capacity: number;
    shards: number;
    lifeSec: number;
    minSpeed: number;
    maxSpeed: number;
    size: number;
    gravity: number;
    color: number;
  };
  ghost: {
    lifeSec: number;
    /** Ring radius around the head centre, metres (placeholder spheres are 0.28 m; humanoid head r = 0.14, #15). */
    radius: number;
    /** Ignore targets whose head is further than this from the aim ray, degrees. */
    maxOffsetDeg: number;
    color: number;
  };
  hitmarker: { bodyMs: number; legMs: number; headMs: number; killMs: number };
  moveGlyphMs: number;
  floatText: { ms: number; rtTtkMs: number; pool: number; riseRem: number };
  /** Screen-edge pulse on kills (research R10): milliseconds, alpha cap, rate limit. */
  pulse: { ms: number; maxAlpha: number; maxPerSecond: number };
  /** Provisional kill score until the scoring module (#22) exists (design §8.1 base and head precision). */
  provisionalScore: { base: number; headMultiplier: number };
  /** Target hit flash (white), seconds (design §7.1: 60 ms). */
  targetFlashSec: number;
}

export const feedback: FeedbackTunables = {
  tracer: {
    capacity: 32,
    lifeSec: 0.08,
    width: 0.014,
    dashLength: 0.35,
    minPx: 1.6,
    maxLength: 120,
    color: palette.core,
    movingColor: palette.warn,
  },
  muzzleFlash: { lifeSec: 0.035 },
  impact: {
    capacity: 48,
    lifeSec: 0.16,
    missSize: 0.28,
    hitSize: 0.4,
    killSize: 0.8,
    missColor: palette.core,
    hitColor: palette.ember,
  },
  decal: { capacity: 64, ttlSec: 12, fadeSec: 2, size: 0.1, color: palette.ink },
  shatter: {
    capacity: 8,
    shards: 12,
    lifeSec: 0.4,
    minSpeed: 1.5,
    maxSpeed: 4.5,
    size: 0.16,
    gravity: 9,
    color: palette.ember,
  },
  ghost: { lifeSec: 0.25, radius: 0.4, maxOffsetDeg: 25, color: palette.trim },
  hitmarker: { bodyMs: 90, legMs: 90, headMs: 140, killMs: 220 },
  moveGlyphMs: 300,
  floatText: { ms: 700, rtTtkMs: 600, pool: 12, riseRem: 3.2 },
  pulse: { ms: 90, maxAlpha: 0.15, maxPerSecond: 3 },
  provisionalScore: { base: 100, headMultiplier: 1.5 },
  targetFlashSec: 0.06,
};

/** This file's groups of `Tunables` (config/tunables.ts composes them). */
export const tunableGroups = { feedback };
type Groups = typeof tunableGroups;
declare module './tunables' {
  interface Tunables extends Groups {}
}
