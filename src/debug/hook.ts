import type { Game } from '../app/game';
import { drawMapPlan } from './mapPlan';
import type { Settings } from '../settings/settings';
import type { TickInput } from '../sim/types';

export interface ScriptStep {
  /** Number of sim ticks to run with this input. */
  ticks: number;
  input?: Partial<TickInput>;
}

/**
 * `window.__flickline`: drive and inspect the game without a human (browser tool, automated
 * playtests). Angles in the hook API are DEGREES for convenience; sim internals use radians.
 * Typical session:  pause(); look(0, 0); step(128, {moveZ: 1}); state()
 *
 * An open interface: these are the core commands; each feature declares its own commands on it
 * with interface merging next to the code that registers them (`game.addDebug`), e.g.
 *
 *   declare module '../debug/hook' {
 *     interface FlicklineDebug { restart(seed?: number): number }
 *   }
 *
 * The feature commands live in `src/features/*.ts` (search for `interface FlicklineDebug`).
 */
export interface FlicklineDebug extends CoreDebug {}

/** The commands the debug hook itself implements over the core game. */
export interface CoreDebug {
  readonly version: number;
  /** Stop real-time ticking; only step()/runScript() advance the sim. */
  pause(): void;
  /** Tick in real time even without pointer lock (use with setInput). */
  resume(): void;
  /** Run exactly n ticks with scripted input (keys/mouse ignored), then render. Returns state. */
  step(n?: number, input?: Partial<TickInput>): unknown;
  /** Run a list of {ticks, input} steps back to back. Returns state. */
  runScript(steps: ScriptStep[]): unknown;
  /** Sticky input applied every frame while ticking in real time; null clears. */
  setInput(input: Partial<TickInput> | null): void;
  /** Set view angles in degrees (yaw + = left, pitch + = up). */
  look(yawDeg: number, pitchDeg: number): void;
  /** Plain-data gameplay snapshot (position, targets, counters, settings). */
  state(): unknown;
  /** Fingerprint of sim state: equal inputs must give equal hashes. */
  hash(): number;
  /** Recent sim events (oldest first), newest `count` entries. */
  events(count?: number): unknown[];
  /** The loaded map as plain data: id, bounds, spawn, anchors, nav, marks (see `sim/mapTypes.ts`). */
  map(): unknown;
  /** Put the player at (x, y, z) feet position, velocity zeroed, optionally facing yawDeg/pitchDeg. */
  teleport(x: number, y: number, z: number, yawDeg?: number, pitchDeg?: number): void;
  /** Reset the world (optionally with a seed). */
  reset(seed?: number): void;
  /** Hide/show the start/pause menu so screenshots show the game. */
  hideMenu(hidden?: boolean): void;
  /** Frame/tick/draw stats. */
  perf(): unknown;
  /** Update a setting through the real store. */
  setSetting(key: keyof Settings, value: number | string | boolean): void;
  /** Toggle the debug overlay. */
  overlay(visible?: boolean): void;
  /** Show or hide a full-window top-down plan of the loaded map: sector regions, gates, hold anchors, approach lanes (see `debug/mapPlan.ts`). */
  mapPlan(visible?: boolean): void;
  /** Named timestamps (ms since page load): panel shown, play clicked, lock, first shot. */
  timeline(): Record<string, number>;
  /** Live tunables object (mutate for experiments; not persisted). */
  readonly tunables: unknown;
}

declare global {
  interface Window {
    __flickline?: FlicklineDebug;
  }
}

const DEG = Math.PI / 180;

export function installDebugHook(game: Game): FlicklineDebug {
  let plan: HTMLCanvasElement | null = null;
  const core: CoreDebug = {
    version: 1,
    pause() {
      game.hold = true;
      game.forceRun = false;
    },
    resume() {
      game.hold = false;
      game.forceRun = true;
    },
    step(n = 1, input = {}) {
      game.step(n, input);
      return game.snapshot();
    },
    runScript(steps) {
      for (const s of steps) game.step(s.ticks, s.input ?? {});
      return game.snapshot();
    },
    setInput(input) {
      game.override = input;
    },
    look(yawDeg, pitchDeg) {
      game.input.setLook(yawDeg * DEG, pitchDeg * DEG);
      game.renderNow();
    },
    state: () => game.snapshot(),
    hash: () => game.world.hash(),
    events(count = 32) {
      return game.eventLog.slice(-count);
    },
    map: () => game.map,
    teleport(x, y, z, yawDeg, pitchDeg) {
      const p = game.world.player;
      p.pos.x = p.prevPos.x = x;
      p.pos.y = p.prevPos.y = y;
      p.pos.z = p.prevPos.z = z;
      p.vel.x = p.vel.y = p.vel.z = 0;
      p.grounded = false;
      if (yawDeg !== undefined || pitchDeg !== undefined) {
        game.input.setLook((yawDeg ?? p.yaw / DEG) * DEG, (pitchDeg ?? p.pitch / DEG) * DEG);
      }
      game.renderNow();
    },
    reset(seed) {
      game.resetWorld(seed);
      game.eventLog.length = 0;
    },
    hideMenu(hidden = true) {
      game.menuHidden = hidden;
      game.refreshChrome();
    },
    perf() {
      const p = game.perf;
      const r = game.renderer.stats;
      return {
        fps: p.fps, avgFrameMs: p.avgMs, p99FrameMs: p.p99Ms, maxFrameMs: p.maxMs,
        cpuFrameMs: p.workMs, tickMs: p.tickMs, ticksLastFrame: p.ticksLastFrame,
        drawCalls: r.drawCalls, triangles: r.triangles, geometries: r.geometries, textures: r.textures,
      };
    },
    setSetting(key, value) {
      game.settings.set({ [key]: value } as never);
    },
    overlay(visible) {
      game.overlay.setVisible(visible ?? !game.overlay.isVisible);
    },
    mapPlan(visible) {
      if (plan === null) {
        plan = document.createElement('canvas');
        plan.id = 'map-plan';
        plan.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483000;';
        document.body.append(plan);
      }
      const on = visible ?? plan.hidden;
      plan.hidden = !on;
      if (!on) return;
      plan.width = window.innerWidth;
      plan.height = window.innerHeight;
      const p = game.world.player;
      drawMapPlan(plan.getContext('2d')!, plan.width, plan.height, game.map, { player: { pos: p.pos, yaw: p.yaw } });
    },
    timeline: () => game.timeline.toObject(),
    tunables: game.tunables,
  };
  for (const key of Object.keys(game.debugCommands)) {
    if (key in core) throw new Error(`debug command '${key}' shadows a core command`);
  }
  // Every merged-in declaration is registered by the feature that declares it (`game.addDebug`).
  const hook = { ...core, ...game.debugCommands } as FlicklineDebug;
  window.__flickline = hook;
  return hook;
}
