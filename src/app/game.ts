import { EventBus } from '../core/eventBus';
import { FixedStepper } from '../core/fixedStep';
import { FrameLimiter } from '../core/frameLimiter';
import type { GameEvents } from '../core/gameEvents';
import { TICK_DT } from '../core/time';
import { cloneTunables, tunables as liveTunables, type Tunables } from '../config/tunables';
import { AudioEngine } from '../audio/audioEngine';
import type { FlicklineDebug } from '../debug/hook';
import { DebugOverlay } from '../debug/overlay';
import { Timeline } from '../debug/timeline';
import { PerfStats } from '../debug/perfStats';
import { EdgeMeter } from '../feedback/edgeMeter';
import { TrackerHudStats } from '../feedback/hudStats';
import { SessionStats } from '../feedback/sessionStats';
import { applySettingsToOptions, createFeedbackOptions } from '../feedback/options';
import { ShotCues } from '../feedback/shotCues';
import type { RunEndReason } from '../modes/contracts';
import { PLACEMENT_MODE } from '../modes/placement';
import { RunController, type StartRunOptions } from '../modes/runController';
import { DamageView } from '../hud/damageView';
import { Hud } from '../hud/hud';
import { FpsReadout } from '../hud/fpsReadout';
import type { HudClock } from '../hud/liveHud';
import { InputManager } from '../input/input';
import { GameRenderer } from '../render/gameRenderer';
import { DEFAULT_PROFILE, ProfileStore } from '../settings/profile';
import { ProgressStore } from '../progress/store';
import { SkillState } from '../adaptive/skillModel';
import { buildSave, type SaveParts } from '../settings/saveData';
import { SettingsStore, SETTINGS_KEY, type Settings } from '../settings/settings';
import { createTickInput, type TickInput } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import { MAPS, rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { nextSeed } from '../feedback/results';
import { Menu } from '../ui/menu';
import { buildCards, titleFromId, type CardModel } from '../ui/menuModel';
import { tier } from '../adaptive/dial';
import { FEATURES } from './features';
import { ModeHost, MODES } from './modeHost';
import { registeredModes, SessionFlow } from './sessionFlow';

/** Events the app shell emits. */
export interface AppEvents {
  /**
   * The first-run player entered the game: start the Placement run (#23). `priorMean`/`priorSd`
   * are the skill prior from the self-report chips (#17). Nothing subscribes until those land.
   */
  placementRunRequested: { priorMean: number; priorSd: number };
}

declare module '../core/gameEvents' {
  interface GameEvents extends AppEvents {}
}

export interface LoggedEvent {
  type: keyof GameEvents;
  data: unknown;
}

/** The map named by `?map=<id>` in the URL, else Range. */
function mapFromUrl(): MapDef {
  const id = new URLSearchParams(window.location.search).get('map');
  return id !== null && Object.hasOwn(MAPS, id) ? MAPS[id]! : rangeMap;
}

/**
 * Composition root. Owns the core subsystems and the frame loop:
 *   rAF -> sample input (every frame) -> run N fixed sim ticks -> render with interpolation.
 * The sim is only ticked while the pointer is locked (or when the debug hook says so).
 *
 * Everything else is a feature (`src/features/*.ts`, see app/feature.ts): it is set up once the
 * core exists and wires itself in through the registration API below (tick/frame/reset hooks,
 * overlay lines, snapshot sections, debug commands, render layers). A new feature adds a file; it
 * does not edit this one.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly tunables: Tunables = liveTunables;
  readonly settings: SettingsStore;
  readonly profile: ProfileStore;
  /**
   * The progress save (design §14.5): skill posteriors, ranks, personal bests per mode and dial band, medals and
   * the run history. Also the best scores, finished-run counts and flagged skill behind the mode cards and
   * Today's session.
   */
  readonly progress: ProgressStore;
  /** Today's session: which mode is next (the menu shows it, the game launches it). */
  readonly todaysSession: SessionFlow;
  /**
   * The map in the world now. Range, or the URL's `?map=lane|elbow` (a dev/playtest switch), until a
   * mode starts: starting a mode loads the map it is designed for (`ModeDef.map`, see `ModeHost.start`).
   */
  get map(): MapDef {
    return this.modes.currentMap;
  }
  readonly world: World;
  readonly renderer: GameRenderer;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  readonly hud: Hud;
  /** Arc, vignette, desaturation and HP bar for damage taken (design §7.1). */
  readonly damage: DamageView;
  readonly menu: Menu;
  readonly overlay: DebugOverlay;
  /** The FPS and 1% lows readout in the corner (setting `showFps`). */
  readonly fps: FpsReadout;
  /** The frame-rate cap (setting `fpsCap`): decides which display frames do work. */
  readonly limiter = new FrameLimiter();
  readonly perf = new PerfStats();
  readonly session = new SessionStats();
  /** Run lifecycle, event log and stats (follows the mode runner's runs too). */
  readonly run: RunController;
  /** Per-shot effect cues (pure model; the renderer draws them). */
  readonly cues: ShotCues;
  /** Feedback-related settings, shared (live) with the cue model and the HUD. */
  readonly feedbackOptions: ReturnType<typeof createFeedbackOptions>;
  readonly timeline = new Timeline();
  /** The stat strip's view of the run's stat tracker (the HUD never computes a stat). */
  readonly hudStats: TrackerHudStats;
  readonly edge: EdgeMeter;
  readonly modes: ModeHost;
  readonly stepper = new FixedStepper(TICK_DT, 8);

  /** Debug: never auto-tick (deterministic stepping only via step()). */
  hold = false;
  /** Debug: tick in real time even without pointer lock. */
  forceRun = false;
  /** Debug: sticky scripted input merged over live input on every frame. */
  override: Partial<Pick<TickInput, 'moveX' | 'moveZ' | 'jump' | 'crouch' | 'walk' | 'fire' | 'reload' | 'switchTo'>> | null = null;
  /** Debug: draw with dt = 0 so transient effects hold still for screenshots. */
  freezeFx = false;
  menuHidden = false;
  /** Gameplay facts (every event whose payload has a `tick`), newest last, for the debug hook. */
  readonly eventLog: LoggedEvent[] = [];
  /** Debug-hook commands registered by features (see `addDebug`). */
  readonly debugCommands: Partial<FlicklineDebug> = {};
  /** Debug timing of the last instant restart: synchronous reset cost, and press-to-next-frame. */
  lastRestartMs = -1;
  lastRestartToFrameMs = -1;
  private restartStartedAt = -1;

  private readonly tickHooks: (() => void)[] = [];
  private readonly frameHooks: ((dt: number) => void)[] = [];
  private readonly frameEndHooks: (() => void)[] = [];
  private readonly resetHooks: (() => void)[] = [];
  private readonly overlayLines: (() => string)[] = [];
  private readonly snapshotSections = new Map<string, () => unknown>();
  private readonly tickInput = createTickInput();
  private readonly scriptInput = createTickInput();
  private lastTs = 0;
  private running = false;
  /** View angles frozen when the run ends or the player dies (radians; the frame the results card sits over). */
  private frozenYaw = 0;
  private frozenPitch = 0;
  private wasFrozen = false;
  /** Has the pointer been locked at least once this page load (pause panel vs landing menu). */
  private hasPlayed = false;
  /** The first-run hint is showing and waits for the first hit. */
  private hintActive = false;
  /** The first-run hint is owed: shown over the first orb that exists, until the first hit. */
  private hintWanted = false;
  /** `?seed=N` from the URL: every run uses it (shareable, replayable), else each run draws its own. */
  private readonly urlSeed: number | null;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, menuRoot: HTMLElement, debugRoot: HTMLElement) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    const firstRun = storage === null || storage.getItem(SETTINGS_KEY) === null;
    this.settings = new SettingsStore(this.bus, storage);
    // Research R12: Reduce flashing defaults on when the OS asks for reduced motion (first run only).
    if (firstRun && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.settings.set({ reduceFlashing: true });
    }
    this.profile = new ProfileStore(this.bus, storage);
    this.progress = new ProgressStore(this.bus, storage);
    const s = this.settings.get();
    this.feedbackOptions = createFeedbackOptions(s);

    const seedParam = new URLSearchParams(window.location.search).get('seed');
    this.urlSeed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : null;
    const seed = this.urlSeed ?? 1;
    const initialMap = mapFromUrl();
    this.world = new World({ level: initialMap, tunables: this.tunables, seed });

    this.cues = new ShotCues(this.bus, this.tunables.feedback, this.feedbackOptions, this.world.targets, this.tunables.targets);
    this.renderer = new GameRenderer(canvas, this.tunables, s.quality);
    this.applyGraphicsSettings(s);

    this.input = new InputManager(canvas, this.bus);
    this.input.maxPitch = (this.tunables.movement.maxPitchDeg * Math.PI) / 180;
    this.input.setSensitivity(s.sensitivity);
    this.applyInputSettings(s);
    this.input.setLook(this.world.player.yaw, 0);
    this.input.onToggleDebug = () => this.overlay.toggle();

    this.audio = new AudioEngine(this.tunables.audio);
    this.applyAudioSettings(s);
    // Feedback producers (stats, later streaks) subscribe before presentation (attachSfx), so the kill chime reads the updated streak.
    this.session.attach(this.bus);
    this.edge = new EdgeMeter(this.tunables.hud);
    this.edge.attach(this.bus);
    // The mode runner is a feedback producer too: it emits `streakUpdated` before the kill chime reads it.
    this.modes = new ModeHost(this.world, this.bus, initialMap, this.tunables, SkillState.deserialize(this.progress.snapshot.ratings, this.tunables.dial) ?? undefined);
    this.run = new RunController(this.world, this.bus, this.tunables);
    this.hudStats = new TrackerHudStats(this.run);
    this.hudStats.attach(this.bus);

    this.hud = new Hud(hudRoot, this.bus, s.crosshair, {
      stats: this.hudStats,
      edge: this.edge,
      clock: this.hudClock(),
      hud: this.tunables.hud,
      streakCap: this.tunables.scoring.streakCap,
      settings: s.hud,
      weapon: this.world.weapon,
      weapons: this.tunables.weapon,
      health: this.world.health,
      hpFlashMs: this.tunables.damageFx.hpFlashMs,
    }, {
      options: this.feedbackOptions,
      cfg: this.tunables.feedback,
      project: (x, y, z, out) => this.renderer.projectToScreen(x, y, z, out),
      cues: this.tunables.cues,
      medianRtMs: () => this.hudStats.medianRtMs,
    });
    this.damage = new DamageView(
      hudRoot, this.bus, this.tunables.damageFx, s.reduceFlashing,
      () => performance.now(), () => this.viewYaw(),
    );
    this.tunables.player.flinch.strength = s.flinchStrength;
    const modes = this.modes;
    this.todaysSession = new SessionFlow(
      this.bus,
      { registry: MODES, skills: modes.skills, get modeId() { return modes.modeId; } },
      this.progress,
      this.tunables.menu,
      this.tunables.dial,
    );
    this.menu = new Menu(menuRoot, this.settings, this.profile, this.tunables, {
      play: () => this.play(),
      resume: () => this.play(),
      restart: () => this.restartCurrent(),
      toMenu: () => this.toMenu(),
      playSession: () => this.playSession(),
      skipStep: () => this.skipStep(),
      launchMode: (id) => {
        this.todaysSession.abandon();
        this.launchMode(id);
      },
      runPhase: () => (this.modes.phase !== 'idle' ? this.modes.phase : this.run.state),
      cards: () => this.modeCards(),
      session: () => this.todaysSession.view(),
      pinnableModes: () => this.modeCards().filter((c) => this.tunables.dial.modes[c.id] !== undefined).map((c) => ({ id: c.id, name: c.name })),
      tierLabel: (dialValue) => tier(dialValue).label,
      exportSave: () => this.exportSave(),
      importSave: (parts) => this.importSave(parts),
      resetProgress: () => this.resetProgress(),
      runLabel: () => {
        const id = this.modes.modeId ?? this.run.info?.mode ?? null;
        return id === null ? null : (this.tunables.menu.modeCards[id]?.name ?? id);
      },
    });
    this.overlay = new DebugOverlay(debugRoot, this.perf, this.renderer.stats, this.tunables);
    this.overlay.extra = () => this.debugLines();
    this.fps = new FpsReadout(hudRoot, this.perf);
    this.fps.setVisible(s.showFps);
    this.limiter.setCap(s.fpsCap);
    this.modes.pinFor = (id) => this.settings.get().difficultyPin[id];

    // Features, in stage order: producers subscribe before presentation (see app/feature.ts). Then
    // the level loads, so the render layers they added get their shaders compiled with it.
    for (const f of FEATURES) f.setup(this);
    this.renderer.loadLevel(this.world, initialMap);

    this.bus.onAny((type, e) => {
      if (typeof e !== 'object' || e === null || !('tick' in e)) return; // UI state, not a gameplay fact
      this.eventLog.push({ type, data: JSON.parse(JSON.stringify(e)) });
      if (this.eventLog.length > 256) this.eventLog.shift();
    });

    // A mode started on a map other than the loaded one (ModeHost.start): show that map's level before the run's first frame.
    this.bus.on('mapLoaded', () => this.renderer.loadLevel(this.world, this.modes.currentMap));
    this.bus.on('settingsChanged', ({ settings, changed }) => {
      if (changed.includes('sensitivity')) this.input.setSensitivity(settings.sensitivity);
      if (changed.some((k) => k === 'keys' || k === 'invertY' || k === 'rawInput')) this.applyInputSettings(settings);
      if (changed.some((k) => k === 'volume' || k.endsWith('Volume') || k === 'monoAudio' || k === 'hitSoundStyle')) this.applyAudioSettings(settings);
      if (changed.some((k) => k === 'quality' || k === 'postEffects' || k === 'enemyOutline' || k === 'renderScale' || k === 'echoPreset' || k === 'reduceFlashing')) {
        this.applyGraphicsSettings(settings);
      }
      if (changed.includes('fpsCap')) this.limiter.setCap(settings.fpsCap);
      if (changed.includes('showFps')) this.fps.setVisible(settings.showFps);
      if (changed.includes('reduceFlashing')) this.damage.setReduceFlashing(settings.reduceFlashing);
      if (changed.includes('flinchStrength')) this.tunables.player.flinch.strength = settings.flinchStrength;
      applySettingsToOptions(this.feedbackOptions, settings);
      this.menu.sync();
    });
    this.bus.on('pointerLockChanged', ({ locked }) => {
      if (locked) this.onLockAcquired();
      this.refreshChrome();
    });
    this.bus.on('rawInputChanged', ({ on, requested }) => this.menu.setRawInput(on, requested));
    this.bus.on('progressChanged', () => this.menu.refresh());
    this.bus.on('shotFired', () => this.timeline.mark('firstShot'));
    this.bus.on('targetHit', () => this.dismissHint());
    // The Placement run's first orb appears after the run goes live, not at the click: the hint waits for it.
    this.bus.on('targetSpawned', () => {
      if (this.hintWanted) this.showHint();
    });
    this.bus.on('targetExpired', () => {
      if (this.hintActive) this.hideHint(); // the orb it pointed at left unhit: wait for the next one
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.refreshChrome();
    this.timeline.mark(this.profile.get().firstRunDone ? 'mainMenuShown' : 'firstRunPanelShown');

    // `?mode=orbit` readies that mode now; it starts ticking when the player clicks Play (the sim only runs with the pointer locked). The menu for choosing modes is #27.
    const modeParam = new URLSearchParams(window.location.search).get('mode');
    if (modeParam) this.startMode(modeParam);
  }

  // --- Feature registration: call these from a feature's `setup` --------------------------------

  /** Run after every sim tick of a run (real time and `step`), in setup order. Must not allocate. */
  onTick(fn: () => void): void {
    this.tickHooks.push(fn);
  }

  /** Run once per rendered frame, after that frame's ticks and before drawing. Must not allocate. */
  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  /** Run once per rendered frame, after the frame has been drawn (debug timing probes). Must not allocate. */
  onFrameEnd(fn: () => void): void {
    this.frameEndHooks.push(fn);
  }

  /** Run whenever the world is reset or a run restarts, after the reset (clear per-run state). */
  onReset(fn: () => void): void {
    this.resetHooks.push(fn);
  }

  /** More debug-overlay text, shown below the core lines ('' for nothing). */
  addOverlayLines(fn: () => string): void {
    this.overlayLines.push(fn);
  }

  /** A section of the `state()` snapshot under `key` (plain data), after the core fields. */
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
    this.audio.setTellVolume(s.tellVolume);
    this.audio.setHitStyle(s.hitSoundStyle);
    this.audio.setMono(s.monoAudio);
  }

  private applyInputSettings(s: Readonly<Settings>): void {
    this.input.setKeys(s.keys);
    this.input.setInvertY(s.invertY);
    this.input.setRawWanted(s.rawInput);
  }

  /** Preset, post/outline switches, render scale, enemy colours and Reduce flashing: everything the renderer takes from settings. */
  private applyGraphicsSettings(s: Readonly<Settings>): void {
    this.renderer.setGraphics(s);
    this.renderer.setEchoPreset(s.echoPreset);
    this.renderer.setReduceFlashing(s.reduceFlashing);
    // Anything drawn in the DOM that pulses or glows is hidden by one CSS rule keyed on this (styles.css).
    document.documentElement.dataset.reduceFlashing = String(s.reduceFlashing);
  }

  private readonly onResize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    this.damage.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  };

  /** Start playing: needs a user gesture (browser rule for pointer lock + audio). */
  play(): void {
    this.timeline.mark('playClicked');
    this.audio.resume();
    this.input.requestLock();
  }

  // --- Data: the save file of the settings menu (design §13.3) ----------------------------------

  /** The save as JSON text: settings, profile and the progress save (design §14.5). */
  exportSave(): string {
    return buildSave(
      { settings: { ...this.settings.get() }, profile: { ...this.profile.get() }, progress: this.progress.exportData() },
      new Date().toISOString(),
    );
  }

  /** Apply the parts of an imported save through the stores (which persist them). The caller reloads. */
  importSave(parts: SaveParts): void {
    if (parts.settings) this.settings.set(parts.settings);
    if (parts.profile) this.profile.set(parts.profile);
    if (parts.progress) this.progress.replace(parts.progress);
  }

  /** Reset progress: the profile (so the first-run flow starts again) and the progress save. Settings stay. The caller reloads. */
  resetProgress(): void {
    this.profile.set(DEFAULT_PROFILE);
    this.progress.reset();
  }

  // --- Menu flow: what the menu's buttons and keys do (design section 2) -------------------------

  /** A seed for a fresh run: the URL's `?seed=` when given (so a shared link replays), else random. */
  private newSeed(): number {
    return this.urlSeed ?? (Math.floor(Math.random() * 0x7fffffff) + 1);
  }

  /** Start `id` from a seed (a fresh one by default), reset the run state and take the pointer lock. */
  launchMode(id: string, seed: number = this.newSeed()): void {
    const t0 = performance.now();
    if (!this.modes.start(id, { seed })) return;
    this.dismissHint();
    this.afterRunReset();
    this.noteRestart(t0);
    this.play();
  }

  /**
   * Instant restart of whatever is running, from the same seed (design section 2: `Backspace`, from
   * anywhere in a run): a mode run, a plain run, or free play. Also takes the pointer lock.
   */
  restartCurrent(): void {
    const id = this.modes.modeId;
    if (id !== null) {
      this.launchMode(id, this.modes.runner.seed);
      return;
    }
    if (!this.restartRun()) this.resetWorld();
    this.play();
  }

  /** Leave the run for the main menu (the session, if any, can be continued from there). */
  toMenu(): void {
    this.resetWorld();
    this.menu.setMode('main');
  }

  /** Play (today's session): its first step, or the one it is on. With no modes registered, free play. */
  playSession(): void {
    const id = this.todaysSession.start();
    if (id === null) this.play();
    else this.launchMode(id);
  }

  /** Skip the session's current step; past the last one the session is over and the menu shows. */
  skipStep(): void {
    const id = this.todaysSession.skip();
    if (id === null) this.toMenu();
    else this.launchMode(id);
  }

  /** The mode cards: the registry's modes with each one's skill, best score and matched tier. */
  private modeCards(): CardModel[] {
    const dial = this.tunables.dial;
    const skills = this.modes.skills;
    return buildCards(registeredModes(MODES, dial), this.tunables.menu, {
      bestScore: (id) => this.progress.best(id),
      matchedDial: (id) => {
        const d = dial.modes[id];
        return d ? skills.targetDial(d.skill, d.targetSuccess) : null;
      },
      tierLabel: (value) => tier(value).label,
    });
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

  /** Float the single "Click the orb" hint over the orb nearest to where the player looks; with none yet, the next one that spawns. */
  private showHint(): void {
    this.hintWanted = true;
    const targets = this.world.targets;
    let best = -1;
    let bestDot = -2;
    const fx = -Math.sin(this.input.yaw);
    const fz = -Math.cos(this.input.yaw);
    const p = this.world.player.pos;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      if (!t.alive || t.kind !== 'beacon') continue;
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

  /** The hint is done for good (first hit, or another run started). */
  private dismissHint(): void {
    this.hintWanted = false;
    this.hideHint();
  }

  private hideHint(): void {
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
    if (!this.limiter.shouldRun(ts)) return; // capped: this display frame does nothing (design §13.3 FPS cap)
    this.perf.beginFrame(ts);
    this.cues.beginFrame();
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

    // A dead player and a finished run freeze the world and the view: the last frame the results card is drawn over.
    const alive = this.world.health.alive;
    const frozen = !alive || this.run.state === 'result';
    if (frozen && !this.wasFrozen) {
      this.frozenYaw = this.input.yaw;
      this.frozenPitch = this.input.pitch + this.world.player.aimPunch;
    }
    this.wasFrozen = frozen;

    let ticks = 0;
    if ((this.input.locked || this.forceRun) && !this.hold && alive) {
      ticks = this.stepper.advance(dt);
      for (let i = 0; i < ticks; i++) {
        const t0 = performance.now();
        if (this.run.step(inp)) this.tickRun();
        this.perf.recordTick(performance.now() - t0);
        // One-shot inputs apply to the first tick of the frame only.
        inp.jump = false;
        inp.reload = false;
        inp.switchTo = -1;
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

    this.hud.update();
    this.drawFrame(this.stepper.alpha, dt);
    this.damage.update();
    for (let i = 0; i < this.frameEndHooks.length; i++) this.frameEndHooks[i]!();
    if (this.restartStartedAt >= 0) {
      this.lastRestartToFrameMs = performance.now() - this.restartStartedAt;
      this.restartStartedAt = -1;
    }
    this.perf.endFrame();
    this.overlay.update(ts);
    this.fps.update(ts);
  };

  /** After every sim tick a run takes: the mode runner, then the features' tick hooks. */
  private tickRun(): void {
    this.modes.tick();
    for (let i = 0; i < this.tickHooks.length; i++) this.tickHooks[i]!();
  }

  /** The view stops following the mouse once the player is dead or the run is over. */
  private get viewFrozen(): boolean {
    return !this.world.health.alive || this.run.state === 'result';
  }

  /** The yaw the camera shows: the live mouse yaw, frozen once the view is. */
  private viewYaw(): number {
    return this.viewFrozen ? this.frozenYaw : this.input.yaw;
  }

  private drawFrame(alpha: number, dt: number): void {
    const w = this.world;
    if (this.viewFrozen) {
      this.renderer.render(w, 1, this.frozenYaw, this.frozenPitch, dt);
      return;
    }
    // The aim punch from being hit moves the view too (spec §4.4); never past the pitch limit.
    const maxPitch = this.input.maxPitch;
    const pitch = Math.max(-maxPitch, Math.min(maxPitch, this.input.pitch + w.player.aimPunch));
    this.renderer.render(w, alpha, this.input.yaw, pitch, this.freezeFx ? 0 : dt);
  }

  /** Render once immediately with no interpolation lag (used after deterministic stepping). */
  renderNow(): void {
    this.drawFrame(1, 0);
  }

  /**
   * Deterministic stepping for tests and automated playtests: run exactly `n` ticks with a clean
   * scripted input (physical keys/mouse are ignored; view angles come from input.setLook).
   */
  step(n: number, partial: Partial<TickInput> = {}, render = true): void {
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
      this.advance(s);
      s.jump = false;
      s.reload = false;
    }
    if (render) this.renderNow();
  }

  /** Run one sim tick with `input` exactly as the frame loop does (run state, mode runner, tick hooks), without drawing. */
  advance(input: TickInput): void {
    if (this.run.step(input)) this.tickRun();
  }

  /**
   * The run clock for the HUD timer: the run controller's state and elapsed time, with the duration
   * from whoever times the run (the controller for plain runs, the mode runner for mode runs).
   */
  private hudClock(): HudClock {
    const run = this.run;
    const modes = this.modes;
    return {
      get phase() { return run.state; },
      get modeId() { return run.info?.mode ?? null; },
      get timeSec() { return run.elapsedSec; },
      get remainingSec() {
        const d = run.info?.durationSec ?? null;
        if (d !== null) return Math.max(0, d - run.elapsedSec);
        return modes.running || run.state !== 'idle' ? modes.remainingSec : Infinity;
      },
    };
  }

  /**
   * Ready a run of a mode (its player setup is applied by the host): the world restarts from the
   * seed, the view is reset to the stand pose and the per-run counters start fresh. Returns false
   * for an unknown mode id.
   */
  startMode(id: string, opts: { seed?: number; pinDial?: number } = {}): boolean {
    const t0 = performance.now();
    if (!this.modes.start(id, opts)) return false;
    this.afterRunReset();
    this.noteRestart(t0);
    this.renderNow();
    return true;
  }

  /** Abandon any run and reset the world (free play). */
  resetWorld(seed?: number): void {
    this.modes.stop();
    this.run.cancel(seed);
    this.afterRunReset();
  }

  /** Begin a plain run (seeded reset -> ready); replaces a mode run in progress. */
  startRun(opts: StartRunOptions): void {
    const t0 = performance.now();
    this.modes.stop();
    this.run.startRun(opts);
    this.afterRunReset();
    this.noteRestart(t0);
  }

  /** Instant restart of the current plain run from its seed (or a new one). False if there is none. */
  restartRun(seed?: number): boolean {
    const t0 = performance.now();
    if (!this.run.restartRun(seed)) return false;
    this.afterRunReset();
    this.noteRestart(t0);
    return true;
  }

  /**
   * The results card's `Enter`: the next run of the same mode and dial on a fresh seed
   * (`nextSeed`), straight back to `ready` with no scene rebuild. `pressedAt` is the key event's
   * timestamp, so `lastRestartToFrameMs` measures key press to the first drawn `ready` frame.
   * Takes the pointer lock back if it was lost (the key press is a user gesture). False when
   * there is no finished run to follow up.
   */
  playAgain(pressedAt: number = performance.now()): boolean {
    const info = this.run.info;
    if (!info || this.run.state !== 'result') return false;
    // In Today's session the next run is the session's next step (it advanced when this run ended).
    // After the Placement run it is the first step of a new session: the next click is the real game (design 13.4).
    const next = this.run.isSelfDriven ? null : info.mode === PLACEMENT_MODE ? this.todaysSession.start() : this.todaysSession.next();
    const seed = next === null ? nextSeed(info.seed, this.tunables.results) : this.newSeed();
    if (this.run.isSelfDriven) {
      if (!this.run.restartRun(seed)) return false;
    } else {
      if (!this.modes.start(next ?? info.mode, { seed })) return false;
    }
    this.afterRunReset();
    this.noteRestart(pressedAt);
    if (!this.input.locked) this.play();
    return true;
  }

  /** What the results card's primary button says: the session's next step, or null for plain "Play again". */
  nextRunLabel(): string | null {
    const info = this.run.info;
    const next = this.run.isSelfDriven
      ? null
      : info?.mode === PLACEMENT_MODE
        ? (this.todaysSession.plan()[0]?.modeId ?? null)
        : this.todaysSession.next();
    return next === null ? null : `Next: ${this.tunables.menu.modeCards[next]?.name ?? titleFromId(next)}`;
  }

  /** Show the menu over whatever is on screen (the results card's `Esc` when the pointer is already free). */
  openMenu(): void {
    this.menu.setVisible(true);
    this.hud.setVisible(false);
  }

  /** End the current run, whoever times it. */
  endRun(reason: RunEndReason): void {
    if (this.run.isSelfDriven) this.run.endRun(reason);
    else this.modes.stop();
  }

  private afterRunReset(): void {
    this.session.reset();
    this.hudStats.invalidate();
    this.edge.reset();
    this.damage.reset();
    this.cues.clear();
    this.hud.refresh();
    this.input.setLook(this.world.player.yaw, 0);
    this.stepper.reset();
    for (const fn of this.resetHooks) fn();
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
      `tick ${this.world.tick}  quality ${this.settings.get().quality}  scale ${this.renderer.pixelRatio.toFixed(2)}  cap ${this.limiter.fps || 'off'}  crosshair draws ${this.hud.crosshair.draws}` +
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
      health: {
        ...w.health,
        tagSince: Number.isFinite(w.health.tagSince) ? w.health.tagSince : null,
        tagScale: p.tagScale, aimPunchDeg: (p.aimPunch * 180) / Math.PI,
      },
      targets: w.targets
        .filter((t) => t.alive)
        .map((t) => ({
          id: t.id, kind: t.kind, pos: { ...t.pos }, hp: t.hp, shield: t.shield, crouched: t.crouched, radius: t.radius,
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
