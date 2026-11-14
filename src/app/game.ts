import { EventBus } from '../core/eventBus';
import { FixedStepper } from '../core/fixedStep';
import { TICK_DT } from '../core/time';
import { cloneTunables, tunables as liveTunables, type Tunables } from '../config/tunables';
import { AudioEngine } from '../audio/audioEngine';
import type { GameEvents } from '../core/gameEvents';
import type { FlicklineDebug } from '../debug/hook';
import { DebugOverlay } from '../debug/overlay';
import { PerfStats } from '../debug/perfStats';
import { SessionStats } from '../feedback/sessionStats';
import { Hud } from '../hud/hud';
import { InputManager } from '../input/input';
import { GameRenderer } from '../render/gameRenderer';
import { SettingsStore, type Settings } from '../settings/settings';
import { createTickInput, type TickInput } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import { rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { Menu } from '../ui/menu';
import { FEATURES } from './features';

/** UI state changes, not gameplay facts: kept out of the debug event log. */
const UNLOGGED_EVENTS: ReadonlySet<keyof GameEvents> = new Set<keyof GameEvents>(['settingsChanged', 'pointerLockChanged']);

export interface LoggedEvent {
  type: keyof GameEvents;
  data: unknown;
}

/**
 * Composition root. Owns the core subsystems and the frame loop:
 *   rAF -> sample input (every frame) -> run N fixed sim ticks -> render with interpolation.
 * The sim is only ticked while the pointer is locked (or when the debug hook says so).
 *
 * Everything else is a feature (`src/features/*.ts`, see app/feature.ts): it is set up after the
 * core exists and wires itself in through the registration API below. A new feature adds a file;
 * it does not edit this one.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly tunables: Tunables = liveTunables;
  readonly settings: SettingsStore;
  readonly map: MapDef = rangeMap;
  readonly world: World;
  readonly renderer: GameRenderer;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  readonly hud: Hud;
  readonly menu: Menu;
  readonly overlay: DebugOverlay;
  readonly perf = new PerfStats();
  readonly session = new SessionStats();
  readonly stepper = new FixedStepper(TICK_DT, 8);

  /** Debug: never auto-tick (deterministic stepping only via step()). */
  hold = false;
  /** Debug: tick in real time even without pointer lock. */
  forceRun = false;
  /** Debug: sticky scripted input merged over live input on every frame. */
  override: Partial<Pick<TickInput, 'moveX' | 'moveZ' | 'jump' | 'crouch' | 'walk' | 'fire' | 'reload' | 'switchTo'>> | null = null;
  menuHidden = false;
  readonly eventLog: LoggedEvent[] = [];
  /** Debug-hook commands registered by features (see `addDebug`). */
  readonly debugCommands: Partial<FlicklineDebug> = {};

  private readonly tickHooks: (() => void)[] = [];
  private readonly frameHooks: ((dt: number) => void)[] = [];
  private readonly resetHooks: (() => void)[] = [];
  private readonly overlayLines: (() => string)[] = [];
  private readonly snapshotSections = new Map<string, () => unknown>();
  private readonly tickInput = createTickInput();
  private readonly scriptInput = createTickInput();
  private lastTs = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, menuRoot: HTMLElement, debugRoot: HTMLElement) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    this.settings = new SettingsStore(this.bus, storage);
    const s = this.settings.get();

    const seedParam = new URLSearchParams(window.location.search).get('seed');
    const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : 1;
    this.world = new World({ level: this.map, tunables: this.tunables, seed });

    this.renderer = new GameRenderer(canvas, this.tunables, s.quality);

    this.input = new InputManager(canvas, this.bus);
    this.input.maxPitch = (this.tunables.movement.maxPitchDeg * Math.PI) / 180;
    this.input.setSensitivity(s.sensitivity);
    this.input.setLook(this.world.player.yaw, 0);
    this.input.onToggleDebug = () => this.overlay.toggle();

    this.audio = new AudioEngine(this.tunables.audio);
    this.applyAudioSettings(s);
    // Session stats subscribe before any feature, so every feature reads up-to-date counters.
    this.session.attach(this.bus);

    this.hud = new Hud(hudRoot, this.bus, this.session, s.crosshair, this.world.weapon, this.tunables.weapon);
    this.menu = new Menu(menuRoot, this.settings, this.tunables, () => this.play());
    this.overlay = new DebugOverlay(debugRoot, this.perf, this.renderer.stats, this.tunables);
    this.overlay.extra = () => this.debugLines();

    // Features, in stage order (producers subscribe before presentation). Then the level loads, so
    // the render layers they added are compiled ahead with it.
    for (const f of FEATURES) f.setup(this);
    this.renderer.loadLevel(this.world, this.map);

    this.bus.onAny((type, e) => {
      if (UNLOGGED_EVENTS.has(type)) return;
      this.eventLog.push({ type, data: JSON.parse(JSON.stringify(e)) });
      if (this.eventLog.length > 256) this.eventLog.shift();
    });

    this.bus.on('settingsChanged', ({ settings, changed }) => {
      if (changed.includes('sensitivity')) this.input.setSensitivity(settings.sensitivity);
      if (changed.some((k) => k === 'volume' || k.endsWith('Volume'))) this.applyAudioSettings(settings);
      if (changed.includes('quality')) this.renderer.setQuality(settings.quality);
      this.menu.sync();
    });
    this.bus.on('pointerLockChanged', () => this.refreshChrome());

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.refreshChrome();
  }

  // --- Feature registration: call these from a feature's `setup` --------------------------------

  /** Run after every sim tick (real-time and `step`), in setup order. Must not allocate. */
  onTick(fn: () => void): void {
    this.tickHooks.push(fn);
  }

  /** Run once per rendered frame, after that frame's ticks and before drawing. Must not allocate. */
  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  /** Run at the start of `resetWorld`, before the world itself resets. */
  onReset(fn: () => void): void {
    this.resetHooks.push(fn);
  }

  /** More debug-overlay text, shown below the core lines ('' for nothing). */
  addOverlayLines(fn: () => string): void {
    this.overlayLines.push(fn);
  }

  /** A section of the `state()` snapshot under `key` (plain data). */
  addSnapshot(key: string, fn: () => unknown): void {
    if (this.snapshotSections.has(key)) throw new Error(`snapshot section '${key}' registered twice`);
    this.snapshotSections.set(key, fn);
  }

  /**
   * Debug-hook commands (`window.__flickline.<name>`). Declare each on `FlicklineDebug` with
   * interface merging in the same file, so the implementation is checked against it.
   */
  addDebug<K extends keyof FlicklineDebug>(commands: Pick<FlicklineDebug, K>): void {
    for (const key of Object.keys(commands) as K[]) {
      if (key in this.debugCommands) throw new Error(`debug command '${String(key)}' registered twice`);
      this.debugCommands[key] = commands[key];
    }
  }

  // -----------------------------------------------------------------------------------------------

  private applyAudioSettings(s: Readonly<Settings>): void {
    this.audio.setVolume(s.volume);
    this.audio.setBusVolume('weapons', s.weaponsVolume);
    this.audio.setBusVolume('hits', s.hitsVolume);
    this.audio.setBusVolume('enemies', s.enemiesVolume);
    this.audio.setBusVolume('ui', s.uiVolume);
  }

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  };

  /** Start playing: needs a user gesture (browser rule for pointer lock + audio). */
  play(): void {
    this.audio.resume();
    this.input.requestLock();
  }

  refreshChrome(): void {
    const live = this.input.locked;
    this.menu.setVisible(!live && !this.menuHidden);
    this.hud.setVisible(live || this.menuHidden);
    if (live) this.stepper.reset();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (ts: number): void => {
    requestAnimationFrame(this.frame);
    this.perf.beginFrame(ts);
    const dt = this.lastTs === 0 ? 0 : Math.min((ts - this.lastTs) / 1000, 0.25);
    this.lastTs = ts;

    const inp = this.tickInput;
    this.input.sample(inp);
    const o = this.override;
    if (o) {
      if (o.moveX !== undefined) inp.moveX = o.moveX;
      if (o.moveZ !== undefined) inp.moveZ = o.moveZ;
      if (o.jump !== undefined) inp.jump = inp.jump || o.jump;
      if (o.crouch !== undefined) inp.crouch = o.crouch;
      if (o.walk !== undefined) inp.walk = o.walk;
      if (o.fire !== undefined) inp.fire = inp.fire || o.fire;
      if (o.reload !== undefined) inp.reload = inp.reload || o.reload;
      if (o.switchTo !== undefined) inp.switchTo = o.switchTo;
    }

    let ticks = 0;
    if ((this.input.locked || this.forceRun) && !this.hold) {
      ticks = this.stepper.advance(dt);
      for (let i = 0; i < ticks; i++) {
        const t0 = performance.now();
        this.world.step(inp, this.bus);
        this.runTickHooks();
        this.perf.recordTick(performance.now() - t0);
        // One-shot inputs apply to the first tick of the frame only.
        inp.jump = false;
        inp.reload = false;
        inp.fire = this.input.fireHeld || (o?.fire ?? false);
      }
    } else {
      this.stepper.reset();
    }
    const pl = this.world.player;
    this.audio.setListener(pl.pos.x, pl.pos.y + pl.eyeHeight, pl.pos.z, this.input.yaw, this.input.pitch);
    for (let i = 0; i < this.frameHooks.length; i++) this.frameHooks[i]!(dt);
    this.input.endFrame(ticks);
    this.perf.ticksLastFrame = ticks;

    this.drawFrame(this.stepper.alpha, dt);
    this.perf.endFrame();
    this.overlay.update(ts);
  };

  private runTickHooks(): void {
    for (let i = 0; i < this.tickHooks.length; i++) this.tickHooks[i]!();
  }

  private drawFrame(alpha: number, dt: number): void {
    this.renderer.render(this.world, alpha, this.input.yaw, this.input.pitch, dt);
  }

  /** Render once immediately with no interpolation lag (used after deterministic stepping). */
  renderNow(): void {
    this.drawFrame(1, 0);
  }

  /**
   * Deterministic stepping for tests and automated playtests: run exactly `n` ticks with a clean
   * scripted input (physical keys/mouse are ignored; view angles come from input.setLook).
   */
  step(n: number, partial: Partial<TickInput> = {}): void {
    const s = this.scriptInput;
    s.moveX = partial.moveX ?? 0;
    s.moveZ = partial.moveZ ?? 0;
    s.jump = partial.jump ?? false;
    s.crouch = partial.crouch ?? false;
    s.walk = partial.walk ?? false;
    s.fire = partial.fire ?? false;
    s.reload = partial.reload ?? false;
    s.switchTo = partial.switchTo ?? -1;
    if (partial.yaw !== undefined || partial.pitch !== undefined) {
      this.input.setLook(partial.yaw ?? this.input.yaw, partial.pitch ?? this.input.pitch);
    }
    for (let i = 0; i < n; i++) {
      s.yaw = this.input.yaw;
      s.pitch = this.input.pitch;
      this.world.step(s, this.bus);
      this.runTickHooks();
      s.jump = false;
      s.reload = false;
    }
    this.renderNow();
  }

  resetWorld(seed?: number): void {
    for (const fn of this.resetHooks) fn();
    this.world.reset(seed);
    this.session.reset();
    this.hud.refresh();
    this.input.setLook(this.world.player.yaw, 0);
    this.stepper.reset();
  }

  private debugLines(): string {
    const p = this.world.player;
    const f = (n: number): string => n.toFixed(2);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    return (
      `pos ${f(p.pos.x)} ${f(p.pos.y)} ${f(p.pos.z)}  speed ${f(speed)} m/s\n` +
      `yaw ${((p.yaw * 180) / Math.PI).toFixed(1)}  pitch ${((p.pitch * 180) / Math.PI).toFixed(1)}  ` +
      `${p.grounded ? 'ground' : 'air'}${p.crouching ? ' crouch' : ''}\n` +
      `tick ${this.world.tick}  quality ${this.settings.get().quality}  crosshair draws ${this.hud.crosshair.draws}` +
      this.featureLines()
    );
  }

  private featureLines(): string {
    let out = '';
    for (const fn of this.overlayLines) {
      const text = fn();
      if (text) out += `\n${text}`;
    }
    return out;
  }

  /** Test hook: a plain-data snapshot of gameplay state. */
  snapshot(): unknown {
    const w = this.world;
    const p = w.player;
    const snap: Record<string, unknown> = {
      tick: w.tick,
      time: w.time,
      seed: w.seed,
      hash: w.hash(),
      player: {
        pos: { ...p.pos }, vel: { ...p.vel },
        yaw: p.yaw, pitch: p.pitch,
        grounded: p.grounded, crouching: p.crouching,
        eyeHeight: p.eyeHeight, height: p.height,
      },
      weapon: { ...w.weapon, slots: w.weapon.slots.map((sl) => ({ ...sl })) },
      targets: w.targets
        .filter((t) => t.alive)
        .map((t) => ({
          id: t.id, kind: t.kind, pos: { ...t.pos }, hp: t.hp, crouched: t.crouched, radius: t.radius,
          visible: t.visibleTick >= 0, bullets: t.bullets,
        })),
      session: { shots: this.session.shots, hits: this.session.hits, kills: this.session.kills },
      settings: { ...this.settings.get() },
      locked: this.input.locked,
    };
    for (const [key, fn] of this.snapshotSections) {
      if (key in snap) throw new Error(`snapshot section '${key}' shadows a core field`);
      snap[key] = fn();
    }
    return snap;
  }

  /** A fresh deep copy of the tunables, for what-if experiments. */
  cloneTunables(): Tunables {
    return cloneTunables(this.tunables);
  }
}
