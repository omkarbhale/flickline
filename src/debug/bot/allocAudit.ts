import { Session } from 'node:inspector';
import { createTickInput } from '../../sim/types';
import { Bot } from './bot';
import { HeadlessGame } from './headless';
import { FREEPLAY } from './play';
import { resolveParams } from './skill';

/**
 * Allocation audit of the simulation tick (architecture §7: no allocation in hot paths). A bot
 * plays a free-play run on the real sim (shooting, killing, respawning and ticking the run
 * machinery all the time) while its view angles and trigger are recorded; that recording is then
 * replayed, with a scripted movement (strafing, walking, jumping, crouching) overlaid, on a fresh
 * game with the bot nowhere in the process. After a warm-up that lets the JIT settle, V8's
 * sampling heap profiler records every allocation of the replay, including the ones the scavenger
 * has already freed, for N ticks. The result is the total, the bytes per tick, and the functions
 * responsible. The bot is kept out of the measured run on purpose: its once-per-engagement code is
 * cold, runs in V8's interpreter and boxes every double there, a test tool's cost, not the game's.
 *
 * Node only (inspector). It measures the simulation and the bot, not the browser: rendering and
 * DOM cost are measured by the page's perf harness (`?perf=1`, `src/debug/perfHarness.ts`).
 */

export interface AllocSite {
  fn: string;
  where: string;
  bytes: number;
}

export interface AllocAudit {
  warmupTicks: number;
  ticks: number;
  totalBytes: number;
  bytesPerTick: number;
  /**
   * Regression ceiling in bytes per tick. The target is 0 (architecture §7) and the sim sits at a
   * fraction of a byte; the ceiling is 8 B/tick, under one boxed double every two ticks, so it
   * catches a NEW per-tick allocation (a closure, an array, an object literal, a double passed to
   * or returned from a function V8 does not inline) the day it appears. See README "Allocation audit".
   */
  ceilingBytesPerTick: number;
  sites: AllocSite[];
  ok: boolean;
}

export interface AuditOptions {
  ticks?: number;
  warmupTicks?: number;
  ceilingBytesPerTick?: number;
  seed?: number;
}

/** Sample every ~64 bytes allocated: fine enough to see a 24-byte object per tick over 100 k ticks. */
const SAMPLING_INTERVAL = 64;

export function auditAllocations(opts: AuditOptions = {}): AllocAudit {
  const ticks = opts.ticks ?? 100_000;
  const warmupTicks = opts.warmupTicks ?? 20_000;
  const ceiling = opts.ceilingBytesPerTick ?? 8;
  const seed = opts.seed ?? 1;

  // Pass 1: the bot plays; its view and trigger are recorded (it never moves the player).
  const recorded = warmupTicks + ticks;
  const yaws = new Float64Array(recorded);
  const pitches = new Float64Array(recorded);
  const fires = new Uint8Array(recorded);
  {
    const game = new HeadlessGame({ seed });
    game.reset(seed);
    // A run far longer than the audit, so the run machinery never stops mid-measurement.
    game.run.startRun({ mode: FREEPLAY, seed, dial: 50, durationSec: 3600 });
    const bot = new Bot(resolveParams(60), seed, game.tunables);
    const input = createTickInput();
    for (let i = 0; i < recorded; i++) {
      bot.step(game.world, input);
      yaws[i] = input.yaw;
      pitches[i] = input.pitch;
      fires[i] = input.fire ? 1 : 0;
      game.advance(input);
    }
  }

  // Pass 2: the replay, on a fresh game, with scripted movement; only this pass is profiled.
  const game = new HeadlessGame({ seed });
  game.reset(seed);
  game.run.startRun({ mode: FREEPLAY, seed, dial: 50, durationSec: 3600 });
  const input = createTickInput();
  let at = 0;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++, at++) {
      input.yaw = yaws[at]!;
      input.pitch = pitches[at]!;
      input.fire = fires[at] === 1;
      // Forward for 2 s of every 4 s, strafing left and right every 0.75 s, a jump every 5.5 s and
      // a crouch for 0.5 s every 7 s, so the movement, collision and footstep paths all run.
      input.moveZ = at % 512 < 256 ? 1 : 0;
      input.moveX = Math.floor(at / 96) % 3 - 1;
      input.jump = at % 700 === 0;
      input.crouch = at % 900 < 64;
      game.advance(input);
    }
  };

  return profileTicks(run, warmupTicks, ticks, ceiling);
}

/**
 * Warm `run` up for `warmupTicks`, then record every allocation V8's sampling heap profiler sees
 * while it runs `ticks` more, and compare the bytes per tick with `ceiling`. `run(n)` advances the
 * scenario `n` ticks; `sites` keeps the `topSites` biggest allocation sites. Shared by the free-play audit above and the enemy mind's (`mindAudit.ts`, #90).
 */
export function profileTicks(
  run: (n: number) => void, warmupTicks: number, ticks: number, ceiling: number, topSites = 12,
): AllocAudit {
  run(warmupTicks);
  const session = new Session();
  session.connect();
  const post = (method: string, params?: object): unknown => {
    let result: unknown;
    session.post(method, params, (err, res) => {
      if (err) throw err;
      result = res;
    });
    return result;
  };
  post('HeapProfiler.startSampling', {
    samplingInterval: SAMPLING_INTERVAL,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  run(ticks);
  const profile = (post('HeapProfiler.stopSampling') as { profile: { head: ProfileNode } }).profile;
  session.disconnect();

  const byKey = new Map<string, AllocSite>();
  let total = 0;
  const walk = (n: ProfileNode): void => {
    // The inspector session's own messages (start/stop sampling) are the profiler's cost, not the sim's.
    if (n.callFrame.url.startsWith('node:inspector')) return;
    if (n.selfSize > 0) {
      total += n.selfSize;
      const f = n.callFrame;
      const where = `${f.url.replace(/^.*\/src\//, 'src/')}:${f.lineNumber + 1}`;
      const key = `${f.functionName}@${where}`;
      const site = byKey.get(key) ?? { fn: f.functionName || '(anonymous)', where, bytes: 0 };
      site.bytes += n.selfSize;
      byKey.set(key, site);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  const sites = [...byKey.values()].sort((a, b) => b.bytes - a.bytes).slice(0, topSites);
  const perTick = total / ticks;
  return { warmupTicks, ticks, totalBytes: total, bytesPerTick: perTick, ceilingBytesPerTick: ceiling, sites, ok: perTick <= ceiling };
}

interface ProfileNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: ProfileNode[];
}

export function formatAudit(a: AllocAudit): string {
  const lines = [
    `allocation audit: ${a.ticks} sim ticks after ${a.warmupTicks} warm-up ticks (free play replayed from a bot at skill 60, with scripted movement)`,
    `  allocated ${a.totalBytes} bytes = ${a.bytesPerTick.toFixed(2)} bytes/tick (target 0, regression ceiling ${a.ceilingBytesPerTick}): ${a.ok ? 'under the ceiling' : 'OVER THE CEILING'}`,
  ];
  if (a.sites.length) {
    lines.push('  top allocation sites:');
    for (const s of a.sites) lines.push(`    ${String(s.bytes).padStart(9)} B  ${s.fn}  ${s.where}`);
  }
  return lines.join('\n');
}
