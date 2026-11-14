import { EventBus } from '../core/eventBus';
import { FixedStepper } from '../core/fixedStep';
import { TICK_DT } from '../core/time';
import { cloneTunables, tunables as liveTunables, type Tunables } from '../config/tunables';
import { AudioEngine } from '../audio/audioEngine';
import { attachSfx } from '../audio/sfx';
import { DebugOverlay } from '../debug/overlay';
import { PerfStats } from '../debug/perfStats';
import { LOGGED_EVENT_TYPES } from '../feedback/eventLog';
import { SessionStats } from '../feedback/sessionStats';
import { Hud } from '../hud/hud';
import { InputManager } from '../input/input';
import { GameRenderer } from '../render/gameRenderer';
import { SettingsStore } from '../settings/settings';
import { RunController, type StartRunOptions } from '../modes/runController';
import { createTickInput, type HitZone, type TargetKind, type TickInput } from '../sim/types';
import { zoneCentre } from '../sim/hitZones';
import type { SpawnOptions } from '../sim/targets';
import type { MapDef } from '../sim/mapTypes';
import { rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { Menu } from '../ui/menu';
import type { GameEvents } from './events';

const AIM_SCRATCH = { x: 0, y: 0, z: 0 };

export interface LoggedEvent {
  type: keyof GameEvents;
  data: unknown;
}

/**
 * Composition root. Owns every subsystem and the frame loop:
 *   rAF -> sample input (every frame) -> run N fixed sim ticks -> render with interpolation.
 * The sim is only ticked while the pointer is locked (or when the debug hook says so).
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
  readonly run: RunController;
  readonly stepper = new FixedStepper(TICK_DT, 8);

  /** Debug: never auto-tick (deterministic stepping only via step()). */
  hold = false;
  /** Debug: tick in real time even without pointer lock. */
  forceRun = false;
  /** Debug: sticky scripted input merged over live input on every frame. */
  override: Partial<Pick<TickInput, 'moveX' | 'moveZ' | 'jump' | 'crouch' | 'walk' | 'fire'>> | null = null;
  menuHidden = false;
  readonly eventLog: LoggedEvent[] = [];
  /** Debug timing of the last instant restart: synchronous reset cost, and press-to-next-frame. */
  lastRestartMs = -1;
  lastRestartToFrameMs = -1;
  private restartStartedAt = -1;

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

    this.renderer = new GameRenderer(canvas, this.bus, this.tunables, s.quality);
    this.renderer.loadLevel(this.world, this.map);

    this.input = new InputManager(canvas, this.bus);
    this.input.maxPitch = (this.tunables.movement.maxPitchDeg * Math.PI) / 180;
    this.input.setSensitivity(s.sensitivity);
    this.input.setLook(this.world.player.yaw, 0);
    this.input.onToggleDebug = () => this.overlay.toggle();

    this.audio = new AudioEngine(this.tunables.audio.masterGain);
    this.audio.setVolume(s.volume);
    attachSfx(this.bus, this.audio);
    this.session.attach(this.bus);
    this.run = new RunController(this.world, this.bus, this.tunables.run, this.tunables.targets);

    this.hud = new Hud(hudRoot, this.bus, this.session, s.crosshair);
    this.menu = new Menu(menuRoot, this.settings, this.tunables, () => this.play());
    this.overlay = new DebugOverlay(debugRoot, this.perf, this.renderer.stats, this.tunables);
    this.overlay.extra = () => this.debugLines();

    for (const type of LOGGED_EVENT_TYPES) {
      this.bus.on(type, (e) => {
        this.eventLog.push({ type, data: JSON.parse(JSON.stringify(e)) });
        if (this.eventLog.length > 256) this.eventLog.shift();
      });
    }

    this.bus.on('settingsChanged', ({ settings, changed }) => {
      if (changed.includes('sensitivity')) this.input.setSensitivity(settings.sensitivity);
      if (changed.includes('volume')) this.audio.setVolume(settings.volume);
      if (changed.includes('quality')) this.renderer.setQuality(settings.quality);
      this.menu.sync();
    });
    this.bus.on('pointerLockChanged', () => this.refreshChrome());

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.refreshChrome();
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
    }

    let ticks = 0;
    if ((this.input.locked || this.forceRun) && !this.hold) {
      ticks = this.stepper.advance(dt);
      for (let i = 0; i < ticks; i++) {
        const t0 = performance.now();
        this.run.step(inp);
        this.perf.recordTick(performance.now() - t0);
        // One-shot inputs apply to the first tick of the frame only.
        inp.jump = false;
        inp.fire = this.input.fireHeld || (o?.fire ?? false);
      }
    } else {
      this.stepper.reset();
    }
    this.input.endFrame(ticks);
    this.perf.ticksLastFrame = ticks;

    this.drawFrame(this.stepper.alpha, dt);
    if (this.restartStartedAt >= 0) {
      this.lastRestartToFrameMs = performance.now() - this.restartStartedAt;
      this.restartStartedAt = -1;
    }
    this.perf.endFrame();
    this.overlay.update(ts);
  };

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
    if (partial.yaw !== undefined || partial.pitch !== undefined) {
      this.input.setLook(partial.yaw ?? this.input.yaw, partial.pitch ?? this.input.pitch);
    }
    for (let i = 0; i < n; i++) {
      s.yaw = this.input.yaw;
      s.pitch = this.input.pitch;
      this.run.step(s);
      s.jump = false;
    }
    this.renderNow();
  }

  /**
   * Add a target (Post: pos = feet centre; Beacon: pos = orb centre). Debug hook and, later, the
   * run/mode layer. Returns its id, or -1 when the registry is full.
   */
  spawnTarget(kind: TargetKind, x: number, y: number, z: number, opts?: SpawnOptions): number {
    return this.world.spawnTarget(kind, x, y, z, this.bus, opts);
  }

  despawnTarget(id: number): boolean {
    return this.world.despawnTarget(id, this.bus);
  }

  /** Point the view at a zone centre of a live target (debug/playtest aid). */
  aimAtTarget(id: number, zone: HitZone = 'head'): boolean {
    const w = this.world;
    const t = w.targetField.byId(id);
    if (!t) return false;
    const tt = this.tunables.targets;
    const c = zoneCentre(AIM_SCRATCH, t, tt.hit, tt.kinds[t.kind], zone);
    const p = w.player;
    const dx = c.x - p.pos.x, dy = c.y - (p.pos.y + p.eyeHeight), dz = c.z - p.pos.z;
    this.input.setLook(Math.atan2(-dx, -dz), Math.asin(dy / Math.hypot(dx, dy, dz)));
    this.renderNow();
    return true;
  }

  /** Abandon any run and reset the world (free play). */
  resetWorld(seed?: number): void {
    this.run.cancel(seed);
    this.afterRunReset();
  }

  /** Begin a run (seeded reset -> ready). */
  startRun(opts: StartRunOptions): void {
    const t0 = performance.now();
    this.run.startRun(opts);
    this.afterRunReset();
    this.noteRestart(t0);
  }

  /** Instant restart of the current run from its seed (or a new one). Returns false if no run. */
  restartRun(seed?: number): boolean {
    const t0 = performance.now();
    if (!this.run.restartRun(seed)) return false;
    this.afterRunReset();
    this.noteRestart(t0);
    return true;
  }

  private afterRunReset(): void {
    this.session.reset();
    this.hud.refresh();
    this.input.setLook(this.world.player.yaw, 0);
    this.stepper.reset();
  }

  private noteRestart(t0: number): void {
    this.lastRestartMs = performance.now() - t0;
    this.lastRestartToFrameMs = -1;
    this.restartStartedAt = t0;
  }

  private debugLines(): string {
    const p = this.world.player;
    const f = (n: number): string => n.toFixed(2);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    return (
      `pos ${f(p.pos.x)} ${f(p.pos.y)} ${f(p.pos.z)}  speed ${f(speed)} m/s\n` +
      `yaw ${((p.yaw * 180) / Math.PI).toFixed(1)}  pitch ${((p.pitch * 180) / Math.PI).toFixed(1)}  ` +
      `${p.grounded ? 'ground' : 'air'}${p.crouching ? ' crouch' : ''}\n` +
      `tick ${this.world.tick}  quality ${this.settings.get().quality}  crosshair draws ${this.hud.crosshair.draws}\n` +
      this.runLine()
    );
  }

  private runLine(): string {
    const r = this.run;
    const tr = r.tracker;
    const acc = tr.accuracy === null ? '--' : `${(tr.accuracy * 100).toFixed(0)}%`;
    const t = r.info ? `${r.elapsedSec.toFixed(1)}/${r.info.durationSec}s` : '';
    const rs = this.lastRestartMs >= 0 ? `  restart ${this.lastRestartMs.toFixed(1)} ms` : '';
    return `run ${r.state} ${t}  acc ${acc} (${tr.hits}/${tr.shots})  kills ${tr.kills}  chain ${tr.chain}  streak ${tr.streak}${rs}`;
  }

  /** Test hook: a plain-data snapshot of gameplay state. */
  snapshot(): unknown {
    const w = this.world;
    const p = w.player;
    return {
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
      weapon: { ...w.weapon },
      targets: w.targets
        .filter((t) => t.alive)
        .map((t) => ({
          id: t.id, kind: t.kind, pos: { ...t.pos }, hp: t.hp, crouched: t.crouched, radius: t.radius,
          visible: t.visibleTick >= 0, bullets: t.bullets,
        })),
      session: { shots: this.session.shots, hits: this.session.hits, kills: this.session.kills },
      run: {
        state: this.run.state,
        info: this.run.info ? { ...this.run.info } : null,
        elapsedSec: this.run.elapsedSec,
        shots: this.run.tracker.shots,
        hits: this.run.tracker.hits,
        accuracy: this.run.tracker.accuracy,
        kills: this.run.tracker.kills,
      },
      settings: { ...this.settings.get() },
      locked: this.input.locked,
    };
  }

  /** A fresh deep copy of the tunables, for what-if experiments. */
  cloneTunables(): Tunables {
    return cloneTunables(this.tunables);
  }
}
