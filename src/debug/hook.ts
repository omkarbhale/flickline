import type { Game } from '../app/game';
import type { PlayLogEntry, PlayOptions, SoundSetStats } from '../audio/audioEngine';
import type { CueId } from '../config/audio';
import type { WeaponId } from '../config/weapon';
import { decodeCrosshair, encodeCrosshair } from '../settings/crosshair';
import type { HitZone, TargetKind, TickInput } from '../sim/types';

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
  /**
   * Add a target and return its id (-1 if the registry is full). `pos` is `{x,y,z}` or `[x,y,z]`
   * in metres: a Post's feet centre, a Beacon's centre. `opts.crouched` poses a Post crouched;
   * `opts.lifetimeSec` makes it expire (`targetExpired`).
   */
  spawn(kind: TargetKind, pos: Vec3Like, opts?: { crouched?: boolean; lifetimeSec?: number }): number;
  /** Remove a target without a kill (emits `targetExpired`). */
  despawn(id: number): boolean;
  /** Point the view at the centre of a zone of a live target. Returns false for an unknown id. */
  aimAt(id: number, zone?: HitZone): boolean;
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
  setSetting(key: 'sensitivity' | 'dpi' | 'volume' | 'weaponsVolume' | 'hitsVolume' | 'enemiesVolume' | 'uiVolume' | 'quality', value: number | string): void;
  /** Play a cue through the real engine (needs the context unlocked by a user gesture, see audioUnlock). */
  playCue(cue: CueId, opts?: PlayOptions): void;
  /** Create/resume the audio context without a click (headless checks). */
  audioUnlock(): void;
  /** Audio state: running, voices, sound-set render stats, and the most recent plays (what was scheduled where). */
  audio(count?: number): { running: boolean; voices: number; stats: SoundSetStats | null; plays: PlayLogEntry[] };
  /** Crosshair state: current params, share code, redraw counter and last device-pixel geometry. */
  crosshair(): unknown;
  /** Import a crosshair share code through the real parser; returns `{ok, error?}`. */
  setCrosshairCode(code: string): { ok: boolean; error?: string };
  /** Toggle the debug overlay. */
  overlay(visible?: boolean): void;
  /**
   * Fire one shot of `weaponId` (a loadout id, e.g. 'kestrel' or 'pace') at the current look, with
   * deterministic stepping: swaps, equips, reloads and waits for the fire interval as the sim
   * requires. Repeated calls with an automatic weapon form one held spray at the real fire rate.
   * Returns copies of the shot's `shotFired` and `shotImpact` (impact null if it hit nothing).
   */
  fire(weaponId: string): { shot: unknown; impact: unknown };
  /** `n` shots of `weaponId` back to back (a held spray for automatic weapons). */
  spray(weaponId: string, n: number): { shot: unknown; impact: unknown }[];
  /** Weapon options used by drills; persist across reset(). Returns the current options. */
  weaponOptions(opts?: { infiniteMagazine?: boolean; infiniteReserve?: boolean }): {
    infiniteMagazine: boolean;
    infiniteReserve: boolean;
  };
  /** Live tunables object (mutate for experiments; not persisted). */
  readonly tunables: unknown;
}

export type Vec3Like = { x: number; y: number; z: number } | readonly [number, number, number];

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
    spawn(kind, pos, opts) {
      const [x, y, z] = Array.isArray(pos) ? (pos as readonly number[]) : [(pos as { x: number }).x, (pos as { y: number }).y, (pos as { z: number }).z];
      const id = game.spawnTarget(kind, x!, y!, z!, opts);
      game.renderNow();
      return id;
    },
    despawn(id) {
      const ok = game.despawnTarget(id);
      game.renderNow();
      return ok;
    },
    aimAt(id, zone = 'head') {
      return game.aimAtTarget(id, zone);
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
    playCue(cue, opts) {
      game.audio.play(cue, opts);
    },
    audioUnlock() {
      game.audio.resume();
    },
    audio(count = 16) {
      return {
        running: game.audio.running,
        voices: game.audio.activeVoices,
        stats: game.audio.stats,
        plays: game.audio.recentPlays(count),
      };
    },
    crosshair() {
      const p = game.settings.get().crosshair;
      return { params: p, code: encodeCrosshair(p), draws: game.hud.crosshair.draws, view: game.hud.crosshair.describe() };
    },
    setCrosshairCode(code) {
      const res = decodeCrosshair(code);
      if (!res.ok) return { ok: false, error: res.error };
      game.settings.set({ crosshair: res.params });
      return { ok: true };
    },
    overlay(visible) {
      game.overlay.setVisible(visible ?? !game.overlay.isVisible);
    },
    fire(weaponId) {
      return game.fireOnce(weaponId as WeaponId);
    },
    spray(weaponId, n) {
      const out: { shot: unknown; impact: unknown }[] = [];
      for (let i = 0; i < n; i++) out.push(game.fireOnce(weaponId as WeaponId));
      return out;
    },
    weaponOptions(opts = {}) {
      const w = game.world.weapon;
      if (opts.infiniteMagazine !== undefined) w.infiniteMagazine = opts.infiniteMagazine;
      if (opts.infiniteReserve !== undefined) w.infiniteReserve = opts.infiniteReserve;
      game.hud.refresh();
      return { infiniteMagazine: w.infiniteMagazine, infiniteReserve: w.infiniteReserve };
    },
    tunables: game.tunables,
  };
  window.__flickline = hook;
  return hook;
}
