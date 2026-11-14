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
import { LeanKeeper, weakestCards, type Lean } from '../modes/lean';
import { SWEEP_MODE } from '../modes/sweep';
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
import { SKILL_IDS } from '../config/dial';
import { buildSave, type SaveParts } from '../settings/saveData';
import { SettingsStore, SETTINGS_KEY, type Settings } from '../settings/settings';
import { createTickInput, type TickInput } from '../sim/types';
import type { MapDef } from '../sim/mapTypes';
import { MAPS, rangeMap } from '../sim/mapLoader';
import { World } from '../sim/world';
import { nextSeed } from '../feedback/results';
import { dailyLabel, dailySeed, isDateKey, localDateKey } from '../modes/dailyRoute';
import { Menu } from '../ui/menu';
import { titleFromId } from '../ui/menuModel';
import { DiscardAsk } from '../ui/navigation';
import { tier } from '../adaptive/dial';
import { FEATURES } from './features';
import { ModeHost, MODES } from './modeHost';

/** Events the app shell emits. */
export interface AppEvents {
  /** `Backspace` mid-run asked once whether to discard the run (design §2.3); a second press within `hints.discardWindowSec` does. */
  runDiscardAsked: { tick: number };
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
   * the run history.
   */
  readonly progress: ProgressStore;
  /**
   * The lean (design §4.4, §8.3; #210): the results card sets what the next run leans toward, the next fresh Sweep run
   * takes it and it is spent; a replay of a seed keeps the lean it had, the Daily Route never leans.
   */
  readonly lean = new LeanKeeper();
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
  /**
   * Gameplay facts (every event whose payload has a `tick`), newest last, for the debug hook.
   * Empty until `startEventLog()` is called, which the first hook command does: copying every
   * event (a JSON round trip, a string and an object each) is not something normal play pays for.
   */
  readonly eventLog: LoggedEvent[] = [];
  private stopEventLog: (() => void) | null = null;
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
  /** `Backspace` mid-run asks once before it discards a run. */
  private readonly discard: DiscardAsk;
  /** A link named a mode (`?mode=`) and it is readied: the first Play takes the lock for that run instead of starting Sweep. */
  private urlModeReadied = false;
  private readonly askEv = { tick: 0 };
  /** `?seed=N` from the URL: every run uses it (shareable, replayable), else each run draws its own. */
  private readonly urlSeed: number | null;
  /**
   * The local date (`YYYY-MM-DD`) of the Daily Route now playing (design §4.8), null for every other run. It is set
   * before the run's seed is applied, so listeners of `runReady` and `runEnded` read it as the run's own.
   */
  private dailyDate: string | null = null;
  /** A playtest's stand-in for today's date (`daily.setDate`); null reads the clock. */
  private dateOverride: string | null = null;

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
    this.discard = new DiscardAsk(this.tunables.hints.discardWindowSec);
    this.menu = new Menu(menuRoot, this.settings, this.profile, this.tunables, {
      play: () => this.playRun(),
      playDaily: () => this.launchDailyRoute(),
      daily: () => this.dailyView(),
      resume: () => this.play(),
      newRun: () => this.newRun(),
      toMenu: () => this.toMenu(),
      runPhase: () => this.runPhase(),
      // Play starts Sweep, so Sweep is the one mode with a difficulty to pin.
      pinnableModes: () => [SWEEP_MODE].filter((id) => this.tunables.dial.modes[id] !== undefined).map((id) => ({ id, name: this.modeName(id) })),
      tierLabel: (dialValue) => tier(dialValue).label,
      exportSave: () => this.exportSave(),
      importSave: (parts) => this.importSave(parts),
      resetProgress: () => this.resetProgress(),
      runLabel: () => {
        const id = this.modes.modeId ?? this.run.info?.mode ?? null;
        return id === null ? null : this.modeName(id);
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
    this.bus.on('runReady', () => {
      this.timeline.mark('runReady');
      this.discard.clear();
    });
    this.bus.on('runStarted', () => this.timeline.mark('runLive'));
    // Clicking the range on the first panel locks the pointer in the Lobby: nothing is scored there (design 13.4).
    canvas.addEventListener('click', () => {
      if (!this.input.locked && this.menu.isOpen && this.menu.current === 'firstRun') this.play();
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.refreshChrome();
    this.timeline.mark(this.profile.get().firstRunDone ? 'mainMenuShown' : 'firstRunPanelShown');

    // `?mode=<id>` readies that mode now; it starts ticking when the player clicks Play (the sim only runs with the pointer locked). The menu no longer lists modes (#202); the link is for playtests (`sweep`, `test`).
    const modeParam = new URLSearchParams(window.location.search).get('mode');
    if (modeParam) this.urlModeReadied = this.startMode(modeParam);
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

  /** Start recording gameplay events into `eventLog` (idempotent). The debug hook calls it on its first command. */
  startEventLog(): void {
    if (this.stopEventLog) return;
    this.stopEventLog = this.bus.onAny((type, e) => {
      if (typeof e !== 'object' || e === null || !('tick' in e)) return; // UI state, not a gameplay fact
      this.eventLog.push({ type, data: JSON.parse(JSON.stringify(e)) });
      if (this.eventLog.length > 256) this.eventLog.shift();
    });
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

  /** The name a mode goes by in the menu (pause title, difficulty pin). */
  private modeName(id: string): string {
    return titleFromId(id);
  }

  /** The run clock's phase: the mode run's, else the plain run's (`idle` in the Lobby). */
  private runPhase(): 'idle' | 'ready' | 'live' | 'result' {
    return this.modes.phase !== 'idle' ? this.modes.phase : this.run.state;
  }

  /** The local date the Daily Route is for right now (`YYYY-MM-DD`); it changes at local midnight. */
  today(): string {
    return this.dateOverride ?? localDateKey(new Date());
  }

  /** The date of the Daily Route now playing, or null when the run is not one. */
  get dailyKey(): string | null {
    return this.dailyDate;
  }

  /** Playtests only: the run about to be started straight on the mode host (the bot's) is the Daily Route of `key` (null: not one). */
  markDailyRun(key: string | null): void {
    this.dailyDate = key;
  }

  /** Playtests only: pretend today is `key` (null: the clock), to look at the day best across midnight. */
  setToday(key: string | null): void {
    if (key !== null && !isDateKey(key)) return;
    this.dateOverride = key;
    this.menu.refresh();
  }

  /** Start a run of `id`, saying whether it is the Daily Route of `daily` (a date key) or not. False for an unknown mode. */
  private startModeRun(id: string, seed: number, daily: string | null, replay = false): boolean {
    if (!MODES[id]) return false;
    this.modes.stop(); // the run being left ends as what it was, before the new run's date applies
    const was = this.dailyDate;
    this.dailyDate = daily;
    if (this.modes.start(id, { seed, lean: this.leanFor(id, daily, replay) })) return true;
    this.dailyDate = was;
    return false;
  }

  /**
   * What the run about to start leans toward (#210): a replay keeps its lean (the same seed is the same route), the Daily
   * Route and any mode but Sweep never lean, and a fresh Sweep run takes the pending lean and the weakest cards (the
   * progress records, design §4.4).
   */
  private leanFor(id: string, daily: string | null, replay: boolean): Lean {
    if (id !== SWEEP_MODE || daily !== null) return this.lean.none();
    if (replay) return this.lean.replay();
    const t = this.tunables;
    return this.lean.fresh(weakestCards((card, window) => {
      const r = this.progress.situation(card, window);
      return r.contacts > 0 ? { won: r.wins, played: r.contacts } : null;
    }, t.lean, t.sweep));
  }

  /** The Daily Route button: Sweep on the seed of today's date (unlimited attempts), pointer lock taken. */
  launchDailyRoute(): void {
    if (!this.profile.get().firstRunDone) this.beginFirstRun();
    this.urlModeReadied = false;
    const date = this.today();
    this.launchMode(SWEEP_MODE, dailySeed(date, this.tunables.daily), date);
  }

  /** What the menu shows for the Daily Route: today's date and the day best so far. */
  dailyView(): { label: string; best: number | null } {
    const date = this.today();
    return { label: dailyLabel(date), best: this.progress.dailyBest(date)?.score ?? null };
  }

  /**
   * Start `id` from a seed (a fresh one by default), reset the run state and take the pointer lock. `daily` is the date
   * key when the run is the Daily Route (see `dailyKey`).
   */
  launchMode(id: string, seed: number = this.newSeed(), daily: string | null = null): void {
    const t0 = performance.now();
    if (!this.startModeRun(id, seed, daily)) return;
    this.afterRunReset();
    this.noteRestart(t0);
    this.play();
  }

  /**
   * Play (design §2.2, §13.4): a Sweep run on a new seed. The first one is the player's first run: the
   * self-report sets the skill model's prior first (so the opening dial fits them), then the panel is
   * done with. Needs a user gesture (the lock and the audio).
   */
  playRun(): void {
    if (!this.profile.get().firstRunDone) this.beginFirstRun();
    if (this.urlModeReadied && this.modes.phase === 'ready') {
      this.urlModeReadied = false; // a link that names a mode is an explicit choice: that run is already readied
      this.play();
      return;
    }
    this.urlModeReadied = false;
    this.launchMode(SWEEP_MODE);
  }

  /**
   * The first run starts: remember it (the next visit lands on the menu, not the first panel) and seed the
   * skill model from the self-report (design §9.2). A model that already has trials (an imported save) is kept.
   */
  private beginFirstRun(): void {
    if (SKILL_IDS.every((k) => this.modes.skills.trialCount(k) === 0)) this.modes.skills.reseed(this.profile.prior(this.tunables.dial));
    this.profile.set({ firstRunDone: true });
  }

  /**
   * A new run (the pause menu's button, `Backspace`): the mode in progress on a new seed, no scene rebuild; in
   * the Lobby it resets the range. With the pointer locked and the run live, the key only asks (design §2.3);
   * a second press within the window does it.
   */
  newRun(): void {
    if (this.input.locked && this.discard.press(this.runPhase(), performance.now() / 1000) === 'ask') {
      this.askEv.tick = this.world.tick;
      this.bus.emit('runDiscardAsked', this.askEv);
      return;
    }
    const id = this.modes.modeId;
    if (id !== null) {
      // A new run of the Daily Route is the route of today again; any other run draws a new seed.
      if (this.dailyDate !== null) this.launchDailyRoute();
      else this.launchMode(id);
      return;
    }
    const info = this.run.info;
    if (info !== null && this.run.state !== 'idle' && this.run.isSelfDriven && this.restartRun(nextSeed(info.seed, this.tunables.results))) {
      this.play();
      return;
    }
    this.resetWorld();
    this.play();
  }

  /** Leave the run for the main menu. */
  toMenu(): void {
    this.resetWorld();
    this.menu.setMode('main');
  }

  /** The pointer lock was taken: in the Lobby (nothing scored) or in a run. */
  private onLockAcquired(): void {
    this.timeline.mark('lockAcquired');
    this.hasPlayed = true;
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
    this.dailyDate = null;
    this.lean.none();
    if (!this.modes.start(id, opts)) return false;
    this.afterRunReset();
    this.noteRestart(t0);
    this.renderNow();
    return true;
  }

  /** Abandon any run and reset the world (free play). */
  resetWorld(seed?: number): void {
    this.modes.stop();
    this.dailyDate = null;
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
   * The results card's `Enter` (design §2.3): a new run, the same mode and dial on a new seed (the next one in
   * the `nextSeed` chain, so every run is replayable from its seed), straight back to `ready` with no scene
   * rebuild. `pressedAt` is the key event's timestamp, so `lastRestartToFrameMs` measures key press to the
   * first drawn `ready` frame. Takes the pointer lock back if it was lost (the key press is a user gesture).
   * False when there is no finished run to follow up.
   */
  playAgain(pressedAt: number = performance.now()): boolean {
    const info = this.run.info;
    if (!info || this.run.state !== 'result') return false;
    // The Daily Route again: unlimited attempts at today's route (a new date after midnight is a new route).
    const date = this.dailyDate !== null && !this.run.isSelfDriven ? this.today() : null;
    const seed = date !== null ? dailySeed(date, this.tunables.daily) : nextSeed(info.seed, this.tunables.results);
    if (this.run.isSelfDriven) {
      if (!this.run.restartRun(seed)) return false;
    } else if (!this.startModeRun(info.mode, seed, date)) {
      return false;
    }
    this.afterRunReset();
    this.noteRestart(pressedAt);
    if (!this.input.locked) this.play();
    return true;
  }

  /**
   * The results card's `R` (design §8.2): the same mode, dial and seed again, straight back to `ready`.
   * False when there is no finished run to replay.
   */
  replaySeed(pressedAt: number = performance.now()): boolean {
    const info = this.run.info;
    if (!info || this.run.state !== 'result') return false;
    if (this.run.isSelfDriven) {
      if (!this.run.restartRun(info.seed)) return false;
    } else if (!this.startModeRun(info.mode, info.seed, this.dailyDate, true)) return false;
    this.afterRunReset();
    this.noteRestart(pressedAt);
    if (!this.input.locked) this.play();
    return true;
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
    const speed = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
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
