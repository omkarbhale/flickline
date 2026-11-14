import type { FairnessFloors } from '../config/dial';
import type { ExpectationTunables } from '../config/expectation';
import { Rng } from '../core/rng';
import { TICK_RATE } from '../core/time';
import {
  createShotTiming, enemyShotTiming, normalDraw, reactionDraw,
  type Expectation, type ReactionDist,
} from './enemyTiming';

/**
 * The settling experiment for #127 (`docs/research/prepared-holders.md`): a player who expects a
 * holder wide-swings an angle that the holder already has its crosshair on. One duel is the opening
 * exchange: each side's time to its first accurate shot, then shots at the fire interval with seeded
 * head/body/miss rolls, until someone takes lethal damage. Both sides share one skill anchor, so the
 * duel isolates timing. Pure and seeded: the same seed gives the same table, in milliseconds.
 *
 * It is a model of the fight's timing, not the game's movement and weapon code; the mind's
 * signature suite (#93) re-runs the same fight with real Echoes once #90/#91 exist.
 */

/** Head and body hit chance of one shot (the rest miss). */
export interface ShotOdds {
  head: number;
  body: number;
}

/**
 * One skill anchor, used for both sides. Timing rows are `docs/research/player-like-enemies.md`
 * §5.4 (reaction ex-Gaussian, correction delay, wide-swing anticipation); the shot odds are
 * HYPOTHESIS values, so the experiment re-runs with them halved and doubled (the verdict must hold).
 * Moves to the mind profiles (`config/mind.ts`, #88) when they exist.
 */
export interface SkillAnchor {
  mind: number;
  reaction: ReactionDist;
  /** Median time to re-acquire a swing that did not land on the crosshair (lognormal, CV `CORRECTION_CV`). */
  correctionSec: number;
  /** Share of contacts where the crosshair already sits where the opponent appears (no correction). */
  onSpotShare: number;
  first: ShotOdds;
  later: ShotOdds;
}

export const WIDE_SWING_ANCHORS: readonly SkillAnchor[] = [
  { mind: 0, reaction: { muSec: 0.43, sigmaSec: 0.06, tauSec: 0.22 }, correctionSec: 0.2, onSpotShare: 0.05, first: { head: 0.1, body: 0.4 }, later: { head: 0.05, body: 0.35 } },
  { mind: 35, reaction: { muSec: 0.33, sigmaSec: 0.045, tauSec: 0.14 }, correctionSec: 0.17, onSpotShare: 0.15, first: { head: 0.18, body: 0.42 }, later: { head: 0.09, body: 0.4 } },
  { mind: 65, reaction: { muSec: 0.27, sigmaSec: 0.03, tauSec: 0.085 }, correctionSec: 0.14, onSpotShare: 0.35, first: { head: 0.28, body: 0.42 }, later: { head: 0.14, body: 0.42 } },
  { mind: 100, reaction: { muSec: 0.235, sigmaSec: 0.022, tauSec: 0.055 }, correctionSec: 0.12, onSpotShare: 0.55, first: { head: 0.38, body: 0.4 }, later: { head: 0.19, body: 0.42 } },
];

/** Spread of a correction's duration (coefficient of variation of the lognormal). */
const CORRECTION_CV = 0.3;
/** A human response faster than this is an anticipation, not a reaction (Woods 2015, research §2.5). */
const HUMAN_MIN_RT_SEC = 0.11;
/** Shots each side fires before the duel is called a draw (a Kestrel burst plus follow-ups). */
const MAX_SHOTS = 12;

export interface WideSwingConfig {
  anchor: SkillAnchor;
  /** `split`: the holder is prepared (this PR's rule). `floors`: the old rule, surprise floors and a tell. */
  rule: 'split' | 'floors';
  /** Dial tell length for the `floors` rule (ignored by `split`). */
  tellSec: number;
  floors: FairnessFloors;
  /** Includes the peeker's advantage the holder suffers (the player is the peeker here). */
  expectation: ExpectationTunables;
  /** Multiplier on both sides' head odds (sensitivity runs); 1 = the anchor's values. */
  headScale: number;
  /** Seconds from the stopping input to the accuracy gate (spec §2.4: ~0.10 s for a rifle). */
  gateSec: number;
  fireIntervalSec: number;
  headDamage: number;
  bodyDamage: number;
  hp: number;
}

export interface WideSwingResult {
  duels: number;
  holderWins: number;
  peekerWins: number;
  /** Both died on the same tick. */
  trades: number;
  /** Nobody died within `MAX_SHOTS` each. */
  draws: number;
  /** Holder wins / (holder + peeker wins). */
  holderShare: number;
  /** Medians of each side's time to first accurate shot, seconds. */
  holderMedianSec: number;
  peekerMedianSec: number;
}

/** Stable per-duel stream seeds, so every condition sees the same peeker draws (common random numbers). */
function streamSeed(seed: number, duel: number, stream: number): number {
  let h = (seed ^ Math.imul(duel + 1, 0x9e3779b1) ^ Math.imul(stream + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function correction(rng: Rng, a: SkillAnchor): number {
  if (rng.next() < a.onSpotShare) return 0;
  const s = Math.sqrt(Math.log(1 + CORRECTION_CV * CORRECTION_CV));
  return a.correctionSec * Math.exp(s * normalDraw(rng));
}

function damage(rng: Rng, o: ShotOdds, headScale: number, c: WideSwingConfig): number {
  const u = rng.next();
  const head = Math.min(1 - o.body, o.head * headScale);
  if (u < head) return c.headDamage;
  return u < head + o.body ? c.bodyDamage : 0;
}

function median(xs: Float64Array): number {
  const s = Float64Array.from(xs).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Run `n` seeded duels. Not a hot path (a test and report tool), so it allocates freely. */
export function runWideSwing(c: WideSwingConfig, seed: number, n: number): WideSwingResult {
  const a = c.anchor;
  const timing = createShotTiming();
  const expectation: Expectation = c.rule === 'split' ? 'prepared' : 'attending';
  const ticksPerShot = Math.max(1, Math.round(c.fireIntervalSec * TICK_RATE));
  const hTimes = new Float64Array(n);
  const pTimes = new Float64Array(n);
  const r: WideSwingResult = {
    duels: n, holderWins: 0, peekerWins: 0, trades: 0, draws: 0, holderShare: 0, holderMedianSec: 0, peekerMedianSec: 0,
  };
  for (let i = 0; i < n; i++) {
    const peekerRng = new Rng(streamSeed(seed, i, 0));
    const holderRng = new Rng(streamSeed(seed, i, 1));
    const shotRng = new Rng(streamSeed(seed, i, 2));

    // Peeker: reacts to the holder it expected (self-timed, so the expectation bonus applies),
    // then is accurate once both its stop has reached the gate and its correction (if any) is done.
    const pReact = reactionDraw(peekerRng, a.reaction, -c.expectation.preparedBonusSec, HUMAN_MIN_RT_SEC);
    const pTime = pReact + Math.max(c.gateSec, correction(peekerRng, a));

    // Holder: already aimed at the angle; needs a correction only when the swing missed its crosshair.
    const hAim = correction(holderRng, a);
    enemyShotTiming(holderRng, a.reaction, expectation, 'player', hAim, c.tellSec, c.floors, c.expectation, timing);
    const hTime = timing.fireReadySec;
    pTimes[i] = pTime;
    hTimes[i] = hTime;

    // Shots happen on ticks, like the weapon sim.
    const p0 = Math.ceil(pTime * TICK_RATE);
    const h0 = Math.ceil(hTime * TICK_RATE);
    let pHp = c.hp;
    let hHp = c.hp;
    let kp = 0;
    let kh = 0;
    let outcome = 0; // 0 draw, 1 holder, 2 peeker, 3 trade
    while (kp < MAX_SHOTS || kh < MAX_SHOTS) {
      const pNext = kp < MAX_SHOTS ? p0 + kp * ticksPerShot : Infinity;
      const hNext = kh < MAX_SHOTS ? h0 + kh * ticksPerShot : Infinity;
      const t = Math.min(pNext, hNext);
      if (pNext === t) { hHp -= damage(shotRng, kp === 0 ? a.first : a.later, c.headScale, c); kp++; }
      if (hNext === t) { pHp -= damage(shotRng, kh === 0 ? a.first : a.later, c.headScale, c); kh++; }
      if (hHp <= 0 || pHp <= 0) {
        outcome = hHp <= 0 && pHp <= 0 ? 3 : hHp <= 0 ? 2 : 1;
        break;
      }
    }
    if (outcome === 1) r.holderWins++;
    else if (outcome === 2) r.peekerWins++;
    else if (outcome === 3) r.trades++;
    else r.draws++;
  }
  const decided = r.holderWins + r.peekerWins;
  r.holderShare = decided > 0 ? r.holderWins / decided : 0;
  r.holderMedianSec = median(hTimes);
  r.peekerMedianSec = median(pTimes);
  return r;
}
