import { EventBus } from '../../core/eventBus';
import type { GameEvents } from '../../core/gameEvents';
import { ModeHost } from '../../app/modeHost';
import { cloneTunables, type Tunables } from '../../config/tunables';
import { RunController } from '../../modes/runController';
import type { MapDef } from '../../sim/mapTypes';
import { rangeMap } from '../../sim/mapLoader';
import type { TickInput } from '../../sim/types';
import { World } from '../../sim/world';

/**
 * What the bot needs from a game: the world to look at, the run machinery to start and read, and a
 * way to run one tick. The headless game (tests, `npm run bot`) and the browser page (through
 * `window.__flickline.bot`) both provide it, so a bot run is the same code in either place.
 */
export interface BotGame {
  readonly world: World;
  readonly tunables: Tunables;
  readonly run: RunController;
  readonly modes: ModeHost;
  /** Return the world to its seeded initial state (free play). */
  reset(seed: number): void;
  /** Run exactly one sim tick with this input. */
  advance(input: TickInput): void;
}

export interface HeadlessOptions {
  seed?: number;
  map?: MapDef;
  /** Defaults to a fresh clone of the shipped tunables, so runs cannot disturb each other. */
  tunables?: Tunables;
  /** A new profile's first Sweep run places it with the staircase Opener (design §9.2), as in the game. Default false: the usual run shape. */
  placesNewProfiles?: boolean;
}

/**
 * The simulation without presentation: world, bus, mode host and run controller wired exactly as
 * the game's composition root wires them, minus rendering, audio, HUD and input. No DOM, no
 * three.js, no wall clock: a run is a pure function of (seed, tunables, bot).
 */
export class HeadlessGame implements BotGame {
  readonly bus = new EventBus<GameEvents>();
  readonly tunables: Tunables;
  readonly map: MapDef;
  readonly world: World;
  readonly modes: ModeHost;
  readonly run: RunController;

  constructor(opts: HeadlessOptions = {}) {
    this.tunables = opts.tunables ?? cloneTunables();
    this.map = opts.map ?? rangeMap;
    this.world = new World({ level: this.map, tunables: this.tunables, seed: opts.seed ?? 1 });
    this.modes = new ModeHost(this.world, this.bus, this.map, this.tunables);
    this.modes.placesNewProfiles = opts.placesNewProfiles ?? false;
    this.run = new RunController(this.world, this.bus, this.tunables);
  }

  reset(seed: number): void {
    this.modes.stop();
    this.run.cancel(seed);
  }

  advance(input: TickInput): void {
    if (this.run.step(input)) this.modes.tick();
  }
}
