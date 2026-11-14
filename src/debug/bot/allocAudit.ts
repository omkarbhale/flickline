import { Session } from 'node:inspector';
import { createTickInput } from '../../sim/types';
import { Bot } from './bot';
import { HeadlessGame } from './headless';
import { FREEPLAY } from './play';
import { resolveParams } from './skill';

/**
 * Allocation audit of the simulation tick (architecture §7: no allocation in hot paths). A bot
 * plays a long free-play run on the real sim (movement-free, but shooting, killing, respawning and
 * ticking the run machinery all the time); after a warm-up that lets the JIT settle, V8's sampling
 * heap profiler records every allocation, including the ones the scavenger has already freed, for
 * N ticks. The result is the total, the bytes per tick, and the functions responsible.
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
   * Regression ceiling in bytes per tick. The target is 0 (architecture §7); today's sim sits well
   * above it because V8 boxes the double returned by `Math.hypot` and by small functions it does
   * not inline (`raySphereN`, ...), see README "Allocation audit" and the sites listed below. The
   * ceiling catches a NEW per-tick allocation (a closure, an array, an object literal) the day it appears.
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
  const ceiling = opts.ceilingBytesPerTick ?? 400;
  const seed = opts.seed ?? 1;

  const game = new HeadlessGame({ seed });
  game.reset(seed);
  // A run far longer than the audit, so the run machinery never stops mid-measurement.
  game.run.startRun({ mode: FREEPLAY, seed, dial: 50, durationSec: 3600 });
  const bot = new Bot(resolveParams(60), seed, game.tunables);
  const input = createTickInput();
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      bot.step(game.world, input);
      game.advance(input);
    }
  };

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
  const sites = [...byKey.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 12);
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
    `allocation audit: ${a.ticks} sim ticks after ${a.warmupTicks} warm-up ticks (free play, bot at skill 60)`,
    `  allocated ${a.totalBytes} bytes = ${a.bytesPerTick.toFixed(2)} bytes/tick (target 0, regression ceiling ${a.ceilingBytesPerTick}): ${a.ok ? 'under the ceiling' : 'OVER THE CEILING'}`,
  ];
  if (a.sites.length) {
    lines.push('  top allocation sites:');
    for (const s of a.sites) lines.push(`    ${String(s.bytes).padStart(9)} B  ${s.fn}  ${s.where}`);
  }
  return lines.join('\n');
}
