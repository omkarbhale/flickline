import type { Game } from '../app/game';
import type { Settings } from '../settings/settings';
import type { SimEvents, TickInput } from '../sim/types';

export interface ScriptStep {
  /** Number of sim ticks to run with this input. */
  ticks: number;
  input?: Partial<TickInput>;
}

/**
 * `window.__flickline`: drive and inspect the game without a human (browser tool, automated
 * playtests). Angles in the hook API are DEGREES for convenience; sim internals use radians.
 * Typical session:  pause(); look(0, 0); step(128, {moveZ: 1}); state()
 */
export interface FlicklineDebug {
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
  /** Per-shot effect stats: cue-to-draw frame latency, pool sizes, JS heap (if exposed). */
  fx(): unknown;
  /** Hold transient effects still (dt = 0) so screenshots can catch them; CSS ones need the injected pause style. */
  freezeFx(on?: boolean): void;
  /** Render one frame advancing effect time by `sec` (use with freezeFx to step effects to a chosen moment). */
  fxAdvance(sec: number): void;
  /** Reset the effect latency counters. */
  fxResetStats(): void;
  /**
   * Emit a synthetic sim event on the bus (zones other than 'body', RT/TTK, ... before the enemy
   * framework exists), then render. Payload is merged over safe defaults; `point`, `origin`, `dir`
   * take {x,y,z}. Returns nothing; read the result on screen or with events().
   */
  emit(type: keyof SimEvents, payload?: Record<string, unknown>): void;
  /** Toggle the debug overlay. */
  overlay(visible?: boolean): void;
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
  const hook: FlicklineDebug = {
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
    fx() {
      const l = game.cues.latency;
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        frame: game.cues.frame,
        latencyMax: l.max,
        latencyLast: l.last,
        cuesDrawn: l.samples,
        late: l.late,
        tracers: game.cues.tracers.length,
        impacts: game.cues.impacts.length,
        decals: game.cues.decals.length,
        shatters: game.cues.shatters.length,
        heapBytes: heap ? heap.usedJSHeapSize : null,
        drawCalls: game.renderer.stats.drawCalls,
      };
    },
    freezeFx(on = true) {
      game.freezeFx = on;
    },
    fxAdvance(sec) {
      game.renderer.render(game.world, 1, game.input.yaw, game.input.pitch, sec);
    },
    fxResetStats() {
      game.cues.resetLatency();
    },
    emit(type, payload = {}) {
      const v = { x: 0, y: 1.5, z: -10 };
      const defaults: Record<string, unknown> = {
        tick: game.world.tick,
        point: v,
        origin: { x: 0, y: 1.62, z: 8 },
        dir: { x: 0, y: 0, z: -1 },
        normal: { x: 0, y: 0, z: 1 },
        moving: false,
        speed: 0,
        airborne: false,
        onTarget: false,
        distance: 10,
        targetId: 0,
        damage: 34,
        hpLeft: 66,
        zone: 'body',
        killed: false,
      };
      (game.bus as unknown as { emit(t: string, p: unknown): void }).emit(type, { ...defaults, ...payload });
      game.renderNow();
    },
    overlay(visible) {
      game.overlay.setVisible(visible ?? !game.overlay.isVisible);
    },
    tunables: game.tunables,
  };
  window.__flickline = hook;
  return hook;
}
