import { EventBus } from '../core/eventBus';
import { FixedStepper } from '../core/fixedStep';
import { TICK_DT } from '../core/time';
import { cloneTunables, tunables as liveTunables, type Tunables } from '../config/tunables';
import { AudioEngine } from '../audio/audioEngine';
import { attachSfx } from '../audio/sfx';
import { DebugOverlay } from '../debug/overlay';
import { PerfStats } from '../debug/perfStats';
import { SessionStats } from '../feedback/sessionStats';
import type { ModeEvents } from '../modes/contracts';
import { Hud } from '../hud/hud';
import { InputManager } from '../input/input';
import { GameRenderer } from '../render/gameRenderer';
import { SettingsStore } from '../settings/settings';
import { createTickInput, type SimEvents, type TickInput } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import { rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { Menu } from '../ui/menu';
import type { GameEvents } from './events';
import { ModeHost } from './modeHost';

const SIM_EVENT_TYPES: (keyof SimEvents)[] = [
  'shotFired', 'shotImpact', 'targetHit', 'targetKilled', 'targetRespawned',
  'playerJumped', 'playerLanded', 'footstep',
];

const MODE_EVENT_TYPES: (keyof ModeEvents)[] = [
  'runReady', 'runStarted', 'runEnded', 'beatStarted', 'skillTrial', 'scoreAwarded', 'chainUpdated', 'streakUpdated',
];

export interface LoggedEvent {
  type: keyof SimEvents | keyof ModeEvents;
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
  readonly modes: ModeHost;
  readonly stepper = new FixedStepper(TICK_DT, 8);

  /** Debug: never auto-tick (deterministic stepping only via step()). */
  hold = false;
  /** Debug: tick in real time even without pointer lock. */
  forceRun = false;
  /** Debug: sticky scripted input merged over live input on every frame. */
  override: Partial<Pick<TickInput, 'moveX' | 'moveZ' | 'jump' | 'crouch' | 'walk' | 'fire'>> | null = null;
  menuHidden = false;
  readonly eventLog: LoggedEvent[] = [];

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
    this.modes = new ModeHost(this.world, this.bus, this.tunables);

    this.hud = new Hud(hudRoot, this.bus, this.session, s.crosshair);
    this.menu = new Menu(menuRoot, this.settings, this.tunables, () => this.play());
    this.overlay = new DebugOverlay(debugRoot, this.perf, this.renderer.stats, this.tunables);
    this.overlay.extra = () => this.debugLines();

    for (const type of [...SIM_EVENT_TYPES, ...MODE_EVENT_TYPES]) {
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
        this.world.step(inp, this.bus);
        this.modes.tick();
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
      this.world.step(s, this.bus);
      this.modes.tick();
      s.jump = false;
    }
    this.renderNow();
  }

  resetWorld(seed?: number): void {
    this.modes.stop();
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
      this.modeLine()
    );
  }

  private modeLine(): string {
    const m = this.modes.status();
    if (m.mode === null) return '';
    return (
      `\nmode ${m.mode} ${m.phase}  beat ${m.beat} dial ${m.dial.toFixed(0)}  ${m.timeSec.toFixed(1)}s\n` +
      `score ${m.score}  kills ${m.kills}  trials ${m.trialsWon}/${m.trials}  streak ${m.streak}  chain ${m.chain}`
    );
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
      targets: w.targets.map((t) => ({ id: t.id, pos: { ...t.pos }, hp: t.hp, alive: t.alive, radius: t.radius })),
      session: { shots: this.session.shots, hits: this.session.hits, kills: this.session.kills },
      settings: { ...this.settings.get() },
      locked: this.input.locked,
    };
  }

  /** A fresh deep copy of the tunables, for what-if experiments. */
  cloneTunables(): Tunables {
    return cloneTunables(this.tunables);
  }
}
