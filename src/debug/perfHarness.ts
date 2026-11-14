import type { Game } from '../app/game';
import { median } from '../core/math';
import { TICK_DT } from '../core/time';

/**
 * The frame-time perf harness: a scripted 20 s scene run through the game's real frame loop in a
 * real browser (`?perf=1`, or `__flickline.perfRun()`), recording every frame into preallocated
 * buffers so the harness itself allocates nothing while it measures. It reports the numbers a
 * player feels (average, 1 % lows, worst frame) plus the JS heap's growth, and fails only on a
 * generous smoke threshold: headless CI browsers render in software, so absolute frame rates there
 * say nothing about a GPU. Use it for correctness, relative cost and heap behaviour; judge real
 * frame rates on real hardware (design §14.1).
 *
 * The scene is the busiest ordinary moment of the game: free play on the Range with an infinite
 * magazine, the view sweeping across the targets, held automatic fire (tracers, impacts, decals,
 * kill shatters, respawns), strafing, jumps (footsteps, landings) and periodic damage (arcs,
 * vignette, HP bar). Everything is a pure function of elapsed time, so two runs do the same thing.
 */

export interface PerfOptions {
  /** Measured seconds (default 20). */
  seconds?: number;
  /**
   * Unmeasured warm-up before that (shader compile, JIT, first pools), seconds (default 14). It is
   * drawn on a tiny canvas (`WARM_PX`) so that even a software renderer runs the frame loop
   * hundreds of times: V8 only compiles the frame code (three.js, the HUD, the effects) after
   * that many calls, and until then it runs in the interpreter, which boxes every double. The
   * canvas is restored to the window's size when the measurement begins.
   */
  warmupSec?: number;
  /**
   * Sim ticks of the scene to run, unmeasured and undrawn, before the scene starts (default
   * 30 000, about 4 minutes of play). A software-rendered page ticks only a few dozen times a
   * second, so without this the sim is still in V8's interpreter, which boxes every double, for the
   * whole run, and the report would measure the interpreter's allocation instead of the game's. On a GPU
   * machine the first second of play does the same.
   */
  jitWarmTicks?: number;
}

export interface SmokeThresholds {
  /** Average frame time, ms. Generous: software rendering is 10-30x slower than a GPU. */
  avgFrameMs: number;
  /** Worst single frame, ms. */
  worstFrameMs: number;
  /** JS heap growth over the run (floor of the sawtooth, not the raw end minus start), bytes. */
  heapGrowthBytes: number;
  /** Frames the run must have produced (a stalled page fails). */
  minFrames: number;
}

/** Smoke thresholds: only a broken build fails them, on any hardware this project runs on. */
export const SMOKE: SmokeThresholds = {
  avgFrameMs: 500,
  worstFrameMs: 5000,
  heapGrowthBytes: 16 * 1024 * 1024,
  minFrames: 20,
};

export interface PerfReport {
  /** Page and renderer context, so a number is never read without it. */
  context: { quality: string; width: number; height: number; pixelRatio: number; userAgent: string; budgetMs: number };
  seconds: number;
  frames: number;
  avgMs: number;
  avgFps: number;
  p50Ms: number;
  p99Ms: number;
  /** Average fps over the slowest 1 % of frames (the usual "1 % low"), and the slowest 0.1 %. */
  onePercentLowFps: number;
  pointOnePercentLowFps: number;
  worstMs: number;
  /** Share of frames slower than the 144 Hz budget (6.94 ms) and than twice the average. */
  overBudget: number;
  hitches: number;
  /** CPU time spent inside the game's frame callback (sim + draw submission), ms. */
  cpuAvgMs: number;
  cpuP99Ms: number;
  cpuWorstMs: number;
  ticks: number;
  drawCalls: number;
  triangles: number;
  heap: {
    /** `performance.memory` exists (Chromium; exact only with --enable-precise-memory-info). */
    supported: boolean;
    startBytes: number;
    endBytes: number;
    /** Growth of the heap's floor (min per second, least-squares slope x duration): the leak signal. */
    growthBytes: number;
    /**
     * Bytes allocated per second (sum of rises between samples; the sampler's own cost included)
     * and per rendered frame. The split by source is not measurable in the page: the sim's share
     * comes from `npm run bot -- --alloc` (names the functions); the rest is rendering and DOM.
     */
    allocBytesPerSec: number;
    allocBytesPerFrame: number;
    /**
     * The same per second, from the median heap sample interval that did not see a collection, not
     * the sum: the sum also counts the spikes of V8 compiling code and of the browser's own work,
     * which are not the game's steady allocation and swing a short run a lot.
     */
    typicalAllocBytesPerSec: number;
    /** Heap falls larger than 32 KiB (collections seen). */
    collections: number;
  };
  failures: string[];
  pass: boolean;
}

export type PerfStatus =
  | { state: 'idle' }
  | { state: 'running'; elapsedSec: number; totalSec: number }
  | { state: 'done'; report: PerfReport };

const PI2 = Math.PI * 2;
const MAX_FRAMES = 40_000;
const HEAP_SAMPLE_SEC = 0.1;
const MAX_HEAP_SAMPLES = 4096;

/** Scene constants (degrees / seconds). */
const SWEEP_DEG = 28;
const SWEEP_PERIOD = 4;
const BOB_DEG = 3;
const STRAFE_PERIOD = 3;
const JUMP_PERIOD = 2.5;
const HURT_PERIOD = 2;
const HURT_HP = 6;
const JIT_WARM_TICKS = 30_000;
/** Frames at full size after the warm-up that are drawn but not measured. */
const SETTLE_FRAMES = 3;
/** Canvas size of the warm-up phase, px (width x height). */
const WARM_PX = { w: 64, h: 36 };

/** Average fps over the slowest `share` of frames (`sorted` ascending, ms): the usual "1 % low". */
export function lowFps(sorted: readonly number[], share: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const k = Math.max(1, Math.ceil(n * share));
  let sum = 0;
  for (let i = n - k; i < n; i++) sum += sorted[i]!;
  return 1000 / (sum / k);
}

/**
 * Growth of a heap's floor over a run, bytes: the minimum of each window of `perWindow` samples
 * (the bottom of the allocate-and-collect sawtooth), then the least-squares slope of those minima
 * times the number of window steps. A leak makes it grow; ordinary garbage does not.
 */
export function heapFloorGrowth(samples: readonly number[], perWindow: number): number {
  const floors: number[] = [];
  for (let i = 0; i + perWindow <= samples.length; i += perWindow) {
    let m = Infinity;
    for (let j = i; j < i + perWindow; j++) m = Math.min(m, samples[j]!);
    floors.push(m);
  }
  if (floors.length < 2) return 0;
  const mx = (floors.length - 1) / 2;
  const my = floors.reduce((a, b) => a + b, 0) / floors.length;
  let num = 0;
  let den = 0;
  floors.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) * (x - mx);
  });
  return (num / den) * (floors.length - 1);
}

interface HeapInfo {
  usedJSHeapSize: number;
}

export class PerfHarness {
  private state: 'idle' | 'running' | 'done' = 'idle';
  private report: PerfReport | null = null;
  private readonly frameMs = new Float32Array(MAX_FRAMES);
  private readonly cpuMs = new Float32Array(MAX_FRAMES);
  private readonly heap = new Float64Array(MAX_HEAP_SAMPLES);
  private frames = 0;
  private heapCount = 0;
  private lastTs = 0;
  private startTs = 0;
  private measureTs = 0;
  private nextHeapAt = 0;
  private nextHurtAt = 0;
  private nextJumpAt = 0;
  private warmupSec = 14;
  private shrunk = false;
  private settleFrames = 0;
  private seconds = 20;
  private ticksAtStart = 0;
  private saved: { hold: boolean; forceRun: boolean; override: Game['override']; menuHidden: boolean; inf: boolean } | null = null;
  private readonly sceneInput = { moveX: 0, jump: false, fire: true };

  constructor(private readonly game: Game, private readonly thresholds: SmokeThresholds = SMOKE) {}

  status(): PerfStatus {
    if (this.state === 'running') return { state: 'running', elapsedSec: (this.lastTs - this.startTs) / 1000, totalSec: this.warmupSec + this.seconds };
    if (this.state === 'done' && this.report) return { state: 'done', report: this.report };
    return { state: 'idle' };
  }

  /** Begin the scene (no-op if one is running). The result arrives through `status()`. */
  start(opts: PerfOptions = {}): void {
    if (this.state === 'running') return;
    const g = this.game;
    this.seconds = opts.seconds ?? 20;
    this.warmupSec = opts.warmupSec ?? 14;
    this.state = 'running';
    this.report = null;
    this.frames = 0;
    this.settleFrames = 0;
    this.heapCount = 0;
    this.lastTs = this.startTs = this.measureTs = 0;
    this.saved = { hold: g.hold, forceRun: g.forceRun, override: g.override, menuHidden: g.menuHidden, inf: g.world.weapon.infiniteMagazine };
    g.modes.stop();
    g.resetWorld(1);
    g.world.weapon.infiniteMagazine = true;
    g.menuHidden = true;
    g.refreshChrome();
    g.hold = false;
    g.forceRun = true;
    g.override = this.sceneInput;
    this.jitWarm(opts.jitWarmTicks ?? JIT_WARM_TICKS);
    if (this.warmupSec > 0) {
      g.renderer.resize(WARM_PX.w, WARM_PX.h);
      this.shrunk = true;
    }
    g.resetWorld(1);
    g.world.weapon.infiniteMagazine = true;
    this.ticksAtStart = g.world.tick;
    requestAnimationFrame(this.frame);
  }

  /** Run the scene's input through the sim for `ticks` ticks without drawing, so V8 has compiled the tick before anything is measured. */
  private jitWarm(ticks: number): void {
    const g = this.game;
    this.nextHurtAt = HURT_PERIOD;
    this.nextJumpAt = JUMP_PERIOD;
    for (let i = 0; i < ticks; i++) {
      this.driveScene(i * TICK_DT);
      g.step(1, this.sceneInput, false);
    }
  }

  private readonly frame = (ts: number): void => {
    if (this.state !== 'running') return;
    const g = this.game;
    if (this.startTs === 0) {
      this.startTs = ts;
      this.nextHurtAt = HURT_PERIOD;
      this.nextJumpAt = JUMP_PERIOD;
    }
    const t = (ts - this.startTs) / 1000;
    this.driveScene(t);

    if (t >= this.warmupSec) {
      this.restoreCanvas();
      // The first frames at full size reallocate render targets and re-lay-out the page: let them pass unmeasured.
      if (this.settleFrames < SETTLE_FRAMES) {
        this.settleFrames++;
      } else if (this.measureTs === 0) {
        this.measureTs = ts;
        this.nextHeapAt = t;
        this.ticksAtStart = g.world.tick;
      } else if (this.frames < MAX_FRAMES) {
        this.frameMs[this.frames] = ts - this.lastTs;
        this.cpuMs[this.frames] = g.perf.workMs; // the previous frame's CPU time
        this.frames++;
      }
      if (t >= this.nextHeapAt && this.heapCount < MAX_HEAP_SAMPLES) {
        this.nextHeapAt += HEAP_SAMPLE_SEC;
        const m = (performance as unknown as { memory?: HeapInfo }).memory;
        if (m) this.heap[this.heapCount++] = m.usedJSHeapSize;
      }
    }
    this.lastTs = ts;
    if (this.measureTs !== 0 && (ts - this.measureTs) / 1000 >= this.seconds) {
      this.finish();
      return;
    }
    requestAnimationFrame(this.frame);
  };

  /** The scene as a function of time; allocates nothing. */
  private driveScene(t: number): void {
    const g = this.game;
    const yaw = SWEEP_DEG * Math.sin((PI2 * t) / SWEEP_PERIOD);
    const pitch = BOB_DEG * Math.sin((PI2 * t) / 2.3);
    g.input.setLook((yaw * Math.PI) / 180, (pitch * Math.PI) / 180);
    const s = this.sceneInput;
    s.moveX = Math.sin((PI2 * t) / STRAFE_PERIOD) > 0 ? 1 : -1;
    s.fire = true;
    s.jump = false;
    if (t >= this.nextJumpAt) {
      this.nextJumpAt += JUMP_PERIOD;
      s.jump = true;
    }
    if (t >= this.nextHurtAt) {
      this.nextHurtAt += HURT_PERIOD;
      const w = g.world;
      const p = w.player;
      if (w.health.hp < 40) w.health.hp = w.health.maxHp;
      w.damagePlayer(HURT_HP, 'body', p.pos.x + 8, p.pos.y + p.eyeHeight, p.pos.z, -1, g.bus);
    }
  }

  /** End the tiny-canvas warm-up: the game's own resize handler reads the window and puts the canvas back. */
  private restoreCanvas(): void {
    if (!this.shrunk) return;
    this.shrunk = false;
    window.dispatchEvent(new Event('resize'));
  }

  private finish(): void {
    this.restoreCanvas();
    const g = this.game;
    const saved = this.saved;
    if (saved) {
      g.override = saved.override;
      g.hold = saved.hold;
      g.forceRun = saved.forceRun;
      g.menuHidden = saved.menuHidden;
      g.world.weapon.infiniteMagazine = saved.inf;
      g.refreshChrome();
    }
    this.report = this.summarise();
    this.state = 'done';
  }

  /** Reduce the recorded frames to the report. Runs once, at the end; allocation is fine here. */
  private summarise(): PerfReport {
    const g = this.game;
    const n = this.frames;
    const frames = Array.from(this.frameMs.subarray(0, n)).sort((a, b) => a - b);
    const cpu = Array.from(this.cpuMs.subarray(0, n)).sort((a, b) => a - b);
    const q = (a: number[], p: number): number => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))]! : 0);
    const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
    const avg = n ? sum(frames) / n : 0;
    const budget = g.tunables.render.budget.frameMs;
    const seconds = n ? sum(frames) / 1000 : 0;

    const per = Math.round(1 / HEAP_SAMPLE_SEC);
    const hs = Array.from(this.heap.subarray(0, this.heapCount));
    const growth = heapFloorGrowth(hs, per);
    let rises = 0;
    let collections = 0;
    const steps: number[] = [];
    for (let i = 1; i < hs.length; i++) {
      const d = hs[i]! - hs[i - 1]!;
      if (d > 0) rises += d;
      else if (d < -32 * 1024) collections++;
      if (d >= 0) steps.push(d);
    }
    const typicalStep = median(steps) ?? 0;

    const th = this.thresholds;
    const failures: string[] = [];
    if (n < th.minFrames) failures.push(`only ${n} frames (need ${th.minFrames})`);
    if (avg > th.avgFrameMs) failures.push(`average frame ${avg.toFixed(1)} ms > ${th.avgFrameMs} ms`);
    const worst = frames[n - 1] ?? 0;
    if (worst > th.worstFrameMs) failures.push(`worst frame ${worst.toFixed(0)} ms > ${th.worstFrameMs} ms`);
    if (hs.length && growth > th.heapGrowthBytes) failures.push(`heap floor grew ${(growth / 1048576).toFixed(1)} MB > ${(th.heapGrowthBytes / 1048576).toFixed(0)} MB`);

    const r = g.renderer.stats;
    return {
      context: {
        quality: g.settings.get().quality,
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
        userAgent: navigator.userAgent,
        budgetMs: budget,
      },
      seconds,
      frames: n,
      avgMs: avg,
      avgFps: avg ? 1000 / avg : 0,
      p50Ms: q(frames, 0.5),
      p99Ms: q(frames, 0.99),
      onePercentLowFps: lowFps(frames, 0.01),
      pointOnePercentLowFps: lowFps(frames, 0.001),
      worstMs: worst,
      overBudget: n ? frames.filter((f) => f > budget).length / n : 0,
      hitches: frames.filter((f) => f > Math.max(2 * avg, 2 * budget)).length,
      cpuAvgMs: n ? sum(cpu) / n : 0,
      cpuP99Ms: q(cpu, 0.99),
      cpuWorstMs: cpu[n - 1] ?? 0,
      ticks: g.world.tick - this.ticksAtStart,
      drawCalls: r.drawCalls,
      triangles: r.triangles,
      heap: {
        supported: hs.length > 0,
        startBytes: hs[0] ?? 0,
        endBytes: hs[hs.length - 1] ?? 0,
        growthBytes: growth,
        allocBytesPerSec: seconds ? rises / seconds : 0,
        allocBytesPerFrame: n ? rises / n : 0,
        typicalAllocBytesPerSec: seconds ? (typicalStep * hs.length) / seconds : 0,
        collections,
      },
      failures,
      pass: failures.length === 0,
    };
  }
}
