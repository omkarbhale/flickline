import { Rng } from './rng';

/**
 * Per-enemy random streams (player-like enemies research §5.8). Every enemy owns four independent
 * `Rng`s seeded from a hash of `(runSeed, enemySerial, stream)`, so adding an enemy, or drawing more
 * or less from one stream, never shifts another enemy's or another stream's draws: replays and
 * tests stay stable while the behaviour code evolves. Pure and allocation-free after construction.
 */

/** The stream an enemy draws from. Values are part of the seed hash: never renumber. */
export const STREAM_PERSONALITY = 0;
export const STREAM_REACTION = 1;
export const STREAM_AIM = 2;
export const STREAM_DECISIONS = 3;
export const STREAM_COUNT = 4;

/** 32-bit finaliser (murmur3 fmix32): every input bit flips about half the output bits. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Seed of one stream of one enemy: a well-mixed 32-bit hash of `(runSeed, enemySerial, stream)`.
 * Pure; the same triple always gives the same seed, and neighbouring triples (serial 3 vs 4,
 * stream 1 vs 2) give unrelated ones.
 */
export function streamSeed(runSeed: number, enemySerial: number, stream: number): number {
  let h = fmix((runSeed | 0) ^ 0x9e3779b9);
  h = fmix(h ^ Math.imul((enemySerial | 0) + 1, 0x85ebca6b));
  h = fmix(h ^ Math.imul((stream | 0) + 1, 0xc2b2ae35));
  return h;
}

/** The four streams of one enemy. Create once per enemy slot; `reseed` when it spawns. */
export class EnemyStreams {
  readonly personality = new Rng();
  readonly reaction = new Rng();
  readonly aim = new Rng();
  readonly decisions = new Rng();

  constructor(runSeed = 0, enemySerial = 0) {
    this.reseed(runSeed, enemySerial);
  }

  /** Restart all four streams for an enemy: allocation-free, independent of every other enemy. */
  reseed(runSeed: number, enemySerial: number): void {
    this.personality.setState(streamSeed(runSeed, enemySerial, STREAM_PERSONALITY));
    this.reaction.setState(streamSeed(runSeed, enemySerial, STREAM_REACTION));
    this.aim.setState(streamSeed(runSeed, enemySerial, STREAM_AIM));
    this.decisions.setState(streamSeed(runSeed, enemySerial, STREAM_DECISIONS));
  }
}
