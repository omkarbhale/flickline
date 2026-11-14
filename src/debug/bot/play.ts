import { TICK_DT, secondsToTicks } from '../../core/time';
import { MODES } from '../../app/modeHost';
import type { RunStats } from '../../feedback/statTracker';
import type { MapDef } from '../../sim/mapTypes';
import { MAPS, rangeMap } from '../../sim/mapLoader';
import { createTickInput } from '../../sim/types';
import { Bot, type BotStats } from './bot';
import { FootworkBot } from './footwork';
import type { GatePolicy } from './gatePolicy';
import { HUMAN_PACE, SweepBot } from './sweepBot';
import type { BotGame } from './headless';
import { clampSkill, resolveParams, type BotParams } from './skill';

/** Plain free play on the map's own targets, as a self-driven timed run (no mode runner). */
export const FREEPLAY = 'freeplay';
const FREEPLAY_SEC = 30;
/** Never simulate longer than this (a run that does not end is a bug the report names). */
const MAX_SIM_SEC = 180;
/** A Sweep run has no clock: it ends at death or the last exit. A bot stuck longer than this is a bug the report names. */
const MAX_RUN_SEC = 600;

export interface BotRunOptions {
  /** A registered mode id (`test`, `coldStart`, ...; case and dashes are ignored, so `cold-start` works) or `freeplay`. */
  mode: string;
  /** 0..100 (default 50). */
  skill?: number;
  /** World and mode seed (default 1). */
  seed?: number;
  /** The bot's own random stream (default: the run seed). */
  botSeed?: number;
  /** Fix the dial for the run (the skill model otherwise picks it, and learns from the run). */
  pinDial?: number;
  /** Start the run as a new profile's first (true: the placing Opener, design §9.2) or not; default: the host decides from the skill model. */
  newProfile?: boolean;
  /** Override single skill parameters. */
  params?: Partial<BotParams>;
  /** Hard stop in simulated seconds. */
  maxSeconds?: number;
  /** Sweep only: how the bot chooses a door at a gate (default: the left door). */
  gatePolicy?: GatePolicy;
  /** Sweep: the longest the bot keeps running into a fight it has seen before it stops (see `SweepBot`); default 0. */
  sweepStopDelaySec?: number;
  /** Sweep: the share of fights the bot never stops in (a planted moving-shot weakness, see `SweepBot`); default 0. */
  sweepMovingShare?: number;
  /** Sweep: the scenario cards the run leans toward (design §4.4, #210); default none. */
  lean?: readonly string[];
  /** Sweep: walk at a scripted person's pace (`HUMAN_PACE`, #248) instead of the bot's; default false. */
  sweepHumanPace?: boolean;
  /** Called after every sim tick (a measurement that samples the world, such as the fight pace). */
  onTick?: () => void;
}

/** The numbers of a finished run, plain data (the per-target and per-bullet arrays are left out). */
export interface BotRunStats {
  endReason: string | null;
  liveSec: number;
  shots: number;
  hits: number;
  misses: number;
  headHits: number;
  bodyHits: number;
  kills: number;
  cleanKills: number;
  accuracy: number | null;
  headshotRate: number | null;
  medianRtMs: number | null;
  medianTtkMs: number | null;
  timeOnTarget: number | null;
  preAimErrorDeg: number | null;
  /** Mean signed flick error, degrees: positive = overshoot. */
  flickErrorBiasDeg: number | null;
  flickErrorMeanAbsDeg: number | null;
  flickCount: number;
  maxChain: number;
}

export interface BotReport {
  mode: string;
  skill: number;
  seed: number;
  botSeed: number;
  params: BotParams;
  /** Sim ticks run (including the ready phase) and the simulated time they stand for. */
  ticks: number;
  simSec: number;
  /** Wall-clock milliseconds the run took (not part of the deterministic result). */
  wallMs: number;
  /** The run reached its result phase (false: stopped by the time limit). */
  finished: boolean;
  /** Fingerprint of the final sim state: equal for equal (seed, skill, params, build). */
  hash: number;
  stats: BotRunStats;
  /** Mode-runner totals (null for free play). */
  modeRun: { score: number; trials: number; trialsWon: number; dial: number; beats: number } | null;
  bot: BotStats;
}

/** Registered mode ids plus `freeplay`. */
export function listModes(): string[] {
  return [FREEPLAY, ...Object.keys(MODES)];
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The registered id for `id` (ignoring case, dashes and underscores), or null. */
export function resolveMode(id: string): string | null {
  const n = norm(id);
  return listModes().find((m) => norm(m) === n) ?? null;
}

/** The map a mode is designed for (`ModeDef.map`): Range for the drills and free play, Lane for Stop & Pop. */
export function mapForMode(mode: string): MapDef {
  const id = resolveMode(mode);
  const named = id ? MODES[id]?.map : undefined;
  return (named ? MAPS[named] : undefined) ?? rangeMap;
}

function compact(s: RunStats): BotRunStats {
  return {
    endReason: s.endReason,
    liveSec: s.durationSec,
    shots: s.shots,
    hits: s.hits,
    misses: s.misses,
    headHits: s.headHits,
    bodyHits: s.bodyHits,
    kills: s.kills,
    cleanKills: s.cleanKills,
    accuracy: s.accuracy,
    headshotRate: s.headshotRate,
    medianRtMs: s.medianRtMs,
    medianTtkMs: s.medianTtkMs,
    timeOnTarget: s.timeOnTarget,
    preAimErrorDeg: s.preAimErrorDeg,
    flickErrorBiasDeg: s.flickErrorBiasDeg,
    flickErrorMeanAbsDeg: s.flickErrorMeanAbsDeg,
    flickCount: s.flickCount,
    maxChain: s.maxChain,
  };
}

/**
 * Play one run of a mode with a bot and report what happened. Synchronous; the sim runs as fast as
 * the CPU allows (a 60 s drill takes well under a second). Deterministic: the same `game` state,
 * options and build give the same `hash` and stats.
 */
export function playMode(game: BotGame, opts: BotRunOptions): BotReport {
  const id = resolveMode(opts.mode);
  if (!id) throw new Error(`unknown mode '${opts.mode}' (known: ${listModes().join(', ')})`);
  const skill = clampSkill(opts.skill ?? 50);
  const seed = opts.seed ?? 1;
  const botSeed = opts.botSeed ?? seed;
  const params = resolveParams(skill, opts.params);
  const t0 = performance.now();

  game.reset(seed);
  if (id === FREEPLAY) {
    game.run.startRun({ mode: FREEPLAY, seed, dial: opts.pinDial ?? 50, durationSec: FREEPLAY_SEC });
  } else if (!game.modes.start(id, { seed, pinDial: opts.pinDial, pick: game.modes.primary, lean: opts.lean, newProfile: opts.newProfile })) {
    throw new Error(`mode '${id}' could not start`);
  }

  const aimer = new Bot(params, botSeed, game.tunables);
  // Stop & Pop needs feet: the footwork bot strafes, counter-strafes, takes the ring's stance, then lets the aimer fire.
  // Sweep needs feet too: the sweep bot walks each sector entry to exit and stops to fight what it sees.
  const bot = id === 'stopAndPop' ? new FootworkBot(aimer, game, botSeed) : id === 'sweep' ? new SweepBot(aimer, game, opts.sweepStopDelaySec ?? 0, botSeed, opts.gatePolicy, opts.sweepMovingShare ?? 0, opts.sweepHumanPace ? HUMAN_PACE : null) : aimer;
  const input = createTickInput();
  const maxTicks = secondsToTicks(opts.maxSeconds ?? (id === 'sweep' ? MAX_RUN_SEC : MAX_SIM_SEC));
  const startTick = game.world.tick;
  let ticks = 0;
  while (ticks < maxTicks && game.run.state !== 'result') {
    bot.step(game.world, input);
    game.advance(input);
    opts.onTick?.();
    ticks++;
  }
  const finished = game.run.state === 'result';
  if (!finished) {
    if (id === FREEPLAY) game.run.endRun('quit');
    else game.modes.stop();
  }
  const status = id === FREEPLAY ? null : game.modes.status();
  return {
    mode: id,
    skill,
    seed,
    botSeed,
    params,
    ticks,
    simSec: (game.world.tick - startTick) * TICK_DT,
    wallMs: performance.now() - t0,
    finished,
    hash: game.world.hash(),
    stats: compact(game.run.liveStats()),
    modeRun: status ? { score: status.score, trials: status.trials, trialsWon: status.trialsWon, dial: status.dial, beats: status.beat + 1 } : null,
    bot: { ...bot.stats },
  };
}
