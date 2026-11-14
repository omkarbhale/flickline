import { EventBus } from '../core/eventBus';
import { FixedStepper } from '../core/fixedStep';
import { TICK_DT, TICK_RATE } from '../core/time';
import { cloneTunables, tunables as liveTunables, type Tunables } from '../config/tunables';
import type { WeaponId } from '../config/weapon';
import { AudioEngine } from '../audio/audioEngine';
import { attachSfx } from '../audio/sfx';
import { attachUiSounds } from '../audio/uiSounds';
import { DebugOverlay } from '../debug/overlay';
import { Timeline } from '../debug/timeline';
import { PerfStats } from '../debug/perfStats';
import { SessionStats } from '../feedback/sessionStats';
import type { ModeEvents } from '../modes/contracts';
import { Hud } from '../hud/hud';
import { InputManager } from '../input/input';
import { GameRenderer } from '../render/gameRenderer';
import { ProfileStore } from '../settings/profile';
import { SettingsStore, type Settings } from '../settings/settings';
import { createTickInput, SIM_EVENT_TYPES, type HitZone, type SimEvents, type TargetKind, type TickInput } from '../sim/types';
import { zoneCentre } from '../sim/hitZones';
import type { SpawnOptions } from '../sim/targets';
import type { MapDef } from '../sim/mapTypes';
import { rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { Menu } from '../ui/menu';
import type { GameEvents } from './events';
import { ModeHost } from './modeHost';

const MODE_EVENT_TYPES: (keyof ModeEvents)[] = [
  'runReady', 'runStarted', 'runEnded', 'beatStarted', 'skillTrial', 'scoreAwarded', 'chainUpdated', 'streakUpdated',
];

const AIM_SCRATCH = { x: 0, y: 0, z: 0 };

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
  readonly profile: ProfileStore;
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
  readonly timeline = new Timeline();
  readonly modes: ModeHost;
  readonly stepper = new FixedStepper(TICK_DT, 8);

  /** Debug: never auto-tick (deterministic stepping only via step()). */
  hold = false;
  /** Debug: tick in real time even without pointer lock. */
  forceRun = false;
  /** Debug: sticky scripted input merged over live input on every frame. */
  override: Partial<Pick<TickInput, 'moveX' | 'moveZ' | 'jump' | 'crouch' | 'walk' | 'fire' | 'reload' | 'switchTo'>> | null = null;
  menuHidden = false;
  readonly eventLog: LoggedEvent[] = [];

  private readonly tickInput = createTickInput();
  private readonly scriptInput = createTickInput();
  private lastTs = 0;
  private running = false;
  /** Has the pointer been locked at least once this page load (pause panel vs landing menu). */
  private hasPlayed = false;
  /** The first-run hint is showing and waits for the first hit. */
  private hintActive = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, menuRoot: HTMLElement, debugRoot: HTMLElement) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    this.settings = new SettingsStore(this.bus, storage);
    this.profile = new ProfileStore(this.bus, storage);
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

    this.audio = new AudioEngine(this.tunables.audio);
    this.applyAudioSettings(s);
    // Feedback producers (stats, later streaks) subscribe before presentation (attachSfx), so the kill chime reads the updated streak.
    this.session.attach(this.bus);
    // The mode runner is a feedback producer too: it emits `streakUpdated` before the kill chime reads it.
    this.modes = new ModeHost(this.world, this.bus, this.map, this.tunables);
    attachSfx(this.bus, this.audio, this.tunables.audio);
    attachUiSounds(document, this.audio);

    this.hud = new Hud(hudRoot, this.bus, this.session, s.crosshair, this.world.weapon, this.tunables.weapon);
    this.menu = new Menu(menuRoot, this.settings, this.profile, this.tunables, {
      onPlay: () => this.play(),
      onRestart: () => {
        this.resetWorld();
        this.play();
      },
    });
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
      if (changed.some((k) => k === 'volume' || k.endsWith('Volume'))) this.applyAudioSettings(settings);
      if (changed.includes('quality')) this.renderer.setQuality(settings.quality);
      this.menu.sync();
    });
    this.bus.on('pointerLockChanged', ({ locked }) => {
      if (locked) this.onLockAcquired();
      this.refreshChrome();
    });
    this.bus.on('rawInputChanged', ({ on }) => this.menu.setRawInput(on));
    this.bus.on('shotFired', () => this.timeline.mark('firstShot'));
    this.bus.on('targetHit', () => this.dismissHint());

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.refreshChrome();
    this.timeline.mark(this.profile.get().firstRunDone ? 'mainMenuShown' : 'firstRunPanelShown');
  }

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
    this.timeline.mark('playClicked');
    this.audio.resume();
    this.input.requestLock();
  }

  /**
   * First lock of a first-run player: they are in. Remember it (so the next visit lands on the
   * main menu), start the Placement run with the self-report prior, and point at the first orb.
   */
  private onLockAcquired(): void {
    this.timeline.mark('lockAcquired');
    this.hasPlayed = true;
    if (this.profile.get().firstRunDone) return;
    this.profile.set({ firstRunDone: true });
    const prior = this.profile.prior(this.tunables.dial);
    this.bus.emit('placementRunRequested', { priorMean: prior.mean, priorSd: prior.sd });
    this.showHint();
  }

  /** Float the single "Click the orb" hint over the target nearest to where the player looks. */
  private showHint(): void {
    const targets = this.world.targets;
    let best = -1;
    let bestDot = -2;
    const fx = -Math.sin(this.input.yaw);
    const fz = -Math.cos(this.input.yaw);
    const p = this.world.player.pos;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      if (!t.alive) continue;
      const dx = t.pos.x - p.x;
      const dz = t.pos.z - p.z;
      const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      if (dot > bestDot) {
        bestDot = dot;
        best = i;
      }
    }
    if (best < 0) return;
    const t = targets[best]!;
    this.renderer.hint.show(t.pos.x, t.pos.y + t.radius + 0.9, t.pos.z);
    this.hintActive = true;
  }

  private dismissHint(): void {
    if (!this.hintActive) return;
    this.hintActive = false;
    this.renderer.hint.hide();
  }

  refreshChrome(): void {
    const live = this.input.locked;
    this.menu.setMode(!this.profile.get().firstRunDone ? 'firstRun' : this.hasPlayed ? 'pause' : 'main');
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
        this.modes.tick();
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
    s.reload = partial.reload ?? false;
    s.switchTo = partial.switchTo ?? -1;
    if (partial.yaw !== undefined || partial.pitch !== undefined) {
      this.input.setLook(partial.yaw ?? this.input.yaw, partial.pitch ?? this.input.pitch);
    }
    for (let i = 0; i < n; i++) {
      s.yaw = this.input.yaw;
      s.pitch = this.input.pitch;
      this.world.step(s, this.bus);
      this.modes.tick();
      s.jump = false;
      s.reload = false;
    }
    this.renderNow();
  }

  /**
   * Debug: fire exactly one shot of `id` with deterministic stepping. Switches to the weapon and
   * waits out its equip, reload and cooldown as the sim requires (so back-to-back calls with an
   * automatic weapon are a held spray at the real fire rate; a semi-auto gets a fresh press each
   * call). Returns copies of that shot's `shotFired` and `shotImpact` (null if it hit nothing).
   */
  fireOnce(id: WeaponId): { shot: unknown; impact: unknown } {
    const w = this.world.weapon;
    const slot = w.slots.findIndex((sl) => sl.id === id);
    if (slot < 0) throw new Error(`weapon '${id}' is not in the loadout (${w.slots.map((sl) => sl.id).join(', ')})`);
    const s = this.scriptInput;
    s.moveX = s.moveZ = 0;
    s.jump = s.crouch = s.walk = s.reload = false;
    s.yaw = this.input.yaw;
    s.pitch = this.input.pitch;
    s.switchTo = slot;
    s.fire = false;
    if (w.active !== slot) this.world.step(s, this.bus); // start the swap
    const before = w.shots;
    let shot: unknown = null;
    let impact: unknown = null;
    const off1 = this.bus.on('shotFired', (e) => {
      shot = JSON.parse(JSON.stringify(e));
    });
    const off2 = this.bus.on('shotImpact', (e) => {
      if (impact === null) impact = JSON.parse(JSON.stringify(e));
    });
    const semi = this.tunables.weapon[id].fireMode === 'semi';
    try {
      const maxTicks = TICK_RATE * 10;
      for (let i = 0; i < maxTicks && w.shots === before; i++) {
        // A semi-auto press during equip/reload/cooldown is spent, so release and press again.
        s.fire = !semi || !s.fire;
        this.world.step(s, this.bus);
      }
    } finally {
      off1();
      off2();
      s.switchTo = -1;
    }
    this.renderNow();
    if (w.shots === before) throw new Error(`weapon '${id}' did not fire within 10 s`);
    return { shot, impact };
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
  }

  /** A fresh deep copy of the tunables, for what-if experiments. */
  cloneTunables(): Tunables {
    return cloneTunables(this.tunables);
  }
}
