import type { Game } from '../app/game';
import { MODES } from '../app/modeHost';
import type { PlayLogEntry, PlayOptions, SoundSetStats } from '../audio/audioEngine';
import type { CueId } from '../config/audio';
import { ECHO_PRESET_IDS, type EchoPresetId } from '../config/palette';
import type { RunStats } from '../feedback/statTracker';
import type { RunState, StartRunOptions } from '../modes/runController';
import type { RunEndReason } from '../modes/contracts';
import type { WeaponId } from '../config/weapon';
import type { ShowcaseItem } from '../render/targetsView';
import { decodeCrosshair, encodeCrosshair } from '../settings/crosshair';
import { cloneHud, HUD_ELEMENTS, type HudElementId } from '../settings/hud';
import type { Settings } from '../settings/settings';
import type { HitZone, SimEvents, TargetKind, TickInput } from '../sim/types';

export interface ScriptStep {
  /** Number of sim ticks to run with this input. */
  ticks: number;
  input?: Partial<TickInput>;
}

/** `__flickline.run`: drive the run lifecycle and read its stats (seconds, degrees, plain data). */
export interface FlicklineRunApi {
  /** Start a run (seeded reset -> ready). Defaults: mode 'freeplay', current seed, dial 50. Returns the run info. */
  start(opts?: Partial<StartRunOptions>): unknown;
  /** End the run (default reason 'quit') and return the final stats. */
  end(reason?: RunEndReason): RunStats;
  /** Instant restart; returns the measured synchronous cost in ms (-1 if there is no run). */
  restart(seed?: number): number;
  /** idle | ready | live | result */
  state(): RunState;
  /** Live stats during a run, final stats once ended. */
  stats(): RunStats;
  /** Measured restart timing: `sync` = reset cost, `toFrame` = call to the next rendered frame (-1 until drawn). */
  restartMs(): { sync: number; toFrame: number; budget: number };
  /** The run's logged events (oldest first), newest `count` entries. */
  log(count?: number): unknown[];
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
  /** Enemy colour preset: ember, magenta, lime, amber or contrast. Returns false for an unknown id. */
  echoPreset(id: EchoPresetId): boolean;
  /**
   * Draw display-only enemy props (`look`: echo | beacon | gnat) next to the real targets, for
   * screenshots and the Gnat (no sim kind yet). `null` clears them. Returns how many were set.
   */
  echoShowcase(items: ShowcaseItem[] | null): number;
  /** Pin the Echo clock (kill shards, Gnat spin) at `sec` seconds, or resume it with null. */
  echoClock(sec: number | null): void;
  /** Toggle the debug overlay. */
  overlay(visible?: boolean): void;
  /** Run lifecycle (reset-only restart, event log, stats). Runs started by `mode.start` are mirrored here too. */
  readonly run: FlicklineRunApi;
  /** Named timestamps (ms since page load): panel shown, play clicked, lock, first shot. */
  timeline(): Record<string, number>;
  /**
   * Live HUD (design 7.2, 13.1): `state()` reads what is displayed (text per element), `pb()` installs a
   * fake personal best (a straight line to `finalScore` over `durationSec`; `null` removes it, so the
   * ghost-pace bar hides), `hp()` shows a health bar (`null` hides it), `show()` toggles an element and
   * `scale()` sets the HUD scale (both through the real settings store).
   */
  readonly hud: {
    state(): unknown;
    pb(curve: { finalScore: number; durationSec: number } | null): void;
    hp(hp: number | null, max?: number): void;
    show(id: HudElementId, visible: boolean): void;
    scale(s: number): void;
  };
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
  /**
   * The player takes `amount` HP to `zone` from a shooter `distance` m away at `bearingDeg`
   * clockwise from where the player faces (0 ahead, 90 right, 180 behind): the damage arc, vignette,
   * HP bar, tagging, flinch and the audio dip all run as for a real hit. Returns whether it killed.
   */
  hurt(amount: number, opts?: { zone?: HitZone; bearingDeg?: number; distance?: number; sourceId?: number }): boolean;
  /** As `hurt`, with the damage taken from `weaponId`'s band for the zone at the distance (spec §3.2 / §7.4). */
  hitBy(weaponId: string, opts?: { zone?: HitZone; bearingDeg?: number; distance?: number; sourceId?: number }): boolean;
  /** HP, tagging and flinch state plus the damage view (arcs showing, redraws) and the last low-pass dip. */
  health(): unknown;
  /** Keep the HP bar visible at full health (modes with enemy fire). */
  hpAlwaysVisible(v?: boolean): void;
  /** Live tunables object (mutate for experiments; not persisted). */
  readonly tunables: unknown;
  /** Mode framework: start/stop a mode run and read its state (`step()` advances it like any tick). */
  readonly mode: {
    /** Ready a run (ready phase 0.8 s, then live). `pinDial` fixes the dial. Returns false for an unknown id. */
    start(id?: string, opts?: { seed?: number; pinDial?: number }): boolean;
    stop(): void;
    /** Phase, beat, dial, axes, score, streak, chain, trials, timing. */
    status(): unknown;
    /** Ids of the registered modes. */
    list(): string[];
  };
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
    echoPreset(id) {
      if (!(ECHO_PRESET_IDS as readonly string[]).includes(id)) return false;
      game.renderer.setEchoPreset(id);
      game.renderNow();
      return true;
    },
    echoShowcase(items) {
      const view = game.renderer.enemies;
      if (view) view.showcase = items;
      game.renderNow();
      return items?.length ?? 0;
    },
    echoClock(sec) {
      game.renderer.enemies?.setTime(sec);
      game.renderNow();
    },
    overlay(visible) {
      game.overlay.setVisible(visible ?? !game.overlay.isVisible);
    },
    run: {
      start(opts = {}) {
        game.startRun({
          mode: opts.mode ?? 'freeplay',
          seed: opts.seed ?? game.world.seed,
          dial: opts.dial ?? 50,
          durationSec: opts.durationSec,
        });
        return { state: game.run.state, ...game.run.info };
      },
      end(reason = 'quit') {
        game.endRun(reason);
        return game.run.liveStats();
      },
      restart(seed) {
        return game.restartRun(seed) ? game.lastRestartMs : -1;
      },
      state: () => game.run.state,
      stats: () => game.run.liveStats(),
      restartMs: () => ({
        sync: game.lastRestartMs,
        toFrame: game.lastRestartToFrameMs,
        budget: game.tunables.run.restartBudgetMs,
      }),
      log: (count = 64) => game.run.log.events.slice(-count),
    },
    timeline: () => game.timeline.toObject(),
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
    hurt: (amount, o = {}) => game.hurt(amount, o.zone, o.bearingDeg, o.distance, o.sourceId),
    hitBy: (weaponId, o = {}) => game.hitBy(weaponId as WeaponId, o.zone, o.bearingDeg, o.distance, o.sourceId),
    health() {
      const w = game.world;
      return {
        ...(game.snapshot() as { health: unknown }).health as object,
        arcsShowing: game.damage.arcsShowing,
        arcDraws: game.damage.draws,
        dip: { ...game.audio.lastDip },
        runPhase: game.run.state,
        runEndReason: game.run.finalStats ? game.modes.runner.endReason : null,
        tick: w.tick,
      };
    },
    hpAlwaysVisible: (v = true) => game.damage.setHpAlwaysVisible(v),
    tunables: game.tunables,
    hud: {
      state() {
        const out: Record<string, unknown> = { scale: game.settings.get().hud.scale, edge: { rate: game.edge.rate, count: game.edge.count } };
        for (const id of HUD_ELEMENTS) {
          const el = game.hud.root.querySelector(`[data-el="${id}"]`) as HTMLElement | null;
          out[id] = el ? { hidden: el.hidden || el.classList.contains('off'), text: el.textContent?.replace(/\s+/g, ' ').trim() } : null;
        }
        return out;
      },
      pb(curve) {
        game.hud.live.setPersonalBest(curve ? { scoreAt: (_m, t) => (curve.finalScore * Math.min(t, curve.durationSec)) / curve.durationSec } : null);
      },
      hp: (hp, max) => game.hud.live.setHp(hp, max),
      show(id, visible) {
        const h = cloneHud(game.settings.get().hud);
        h.show[id] = visible;
        game.settings.set({ hud: h });
      },
      scale(s) {
        const h = cloneHud(game.settings.get().hud);
        h.scale = s;
        game.settings.set({ hud: h });
      },
    },
    mode: {
      start: (id = 'test', opts = {}) => game.modes.start(id, opts),
      stop: () => game.modes.stop(),
      status: () => game.modes.status(),
      list: () => Object.keys(MODES),
    },
  };
  window.__flickline = hook;
  return hook;
}
