import type { EventBus } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import { axes } from '../adaptive/dial';
import { SkillState } from '../adaptive/skillModel';
import type { Tunables } from '../config/tunables';
import type { EnemyKind } from '../config/scoring';
import type { WeaponId } from '../config/weapon';
import { coldStart } from '../modes/coldStart';
import type { AnchorSource, AxisValues, DialSource, EchoSpawn, StrafeSpawn, TargetSpawner } from '../modes/contracts';
import type { ModeDef } from '../modes/modeDef';
import { orbit } from '../modes/orbit';
import { placement, type PlacementState } from '../modes/placement';
import { sprayWall } from '../modes/sprayWall';
import { strafeTrack } from '../modes/strafeTrack';
import { stopAndPop } from '../modes/stopAndPop';
import { sweep } from '../modes/sweep';
import { ModeRunner, type RunOptions } from '../modes/runner';
import { testMode } from '../modes/testMode';
import { economyShield } from '../sim/damage';
import { FIRE_IDLE } from '../sim/enemyAi';
import { rayBox } from '../sim/collision';
import { MAPS } from '../sim/mapLoader';
import type { MapDef } from '../sim/mapTypes';
import type { SpawnOptions } from '../sim/targets';
import type { World } from '../sim/world';
import type { GameEvents } from '../core/gameEvents';

/** The registered modes. Individual modes (#46, ...) add themselves here. */
export const MODES: Readonly<Record<string, ModeDef<never>>> = {
  test: testMode as ModeDef<never>,
  coldStart: coldStart as ModeDef<never>,
  orbit: orbit as ModeDef<never>,
  placement: placement as ModeDef<never>,
  sprayWall: sprayWall as ModeDef<never>,
  strafeTrack: strafeTrack as ModeDef<never>,
  stopAndPop: stopAndPop as ModeDef<never>,
  sweep: sweep as ModeDef<never>,
};

/** A durable target's health: a spray cannot kill it. */
const DURABLE_HP = 1e6;

/** The sim's target registry as the framework's spawner (#15). Only the kinds the sim has yet (Rusher, Bulwark and Gnat: #33). */
class WorldSpawner implements TargetSpawner {
  constructor(private readonly world: World, private readonly bus: EventBus<GameEvents>) {}

  /** `scale` sizes an orb (Beacon); humanoids keep the spec's hit volumes. `durable` = Spray Wall's Post. */
  spawn(kind: EnemyKind, pos: Vec3, scale: number, strafe?: StrafeSpawn, durable?: boolean, echo?: EchoSpawn): number {
    if (kind !== 'post' && kind !== 'beacon' && kind !== 'strafer' && kind !== 'peeker') return -1;
    // A Strafer's numbers and lane, a Peeker's anchor and the shooting numbers go to the sim as given; the sim copies them at spawn.
    const o: SpawnOptions = { scale };
    if (strafe) o.strafe = strafe;
    if (durable) o.hp = DURABLE_HP;
    if (echo?.peek) o.peek = echo.peek;
    if (echo?.fire) o.fire = echo.fire;
    if (echo?.arrive) o.arrive = echo.arrive;
    if (echo?.crouched) o.crouched = true;
    return this.world.spawnTarget(kind, pos.x, pos.y, pos.z, this.bus, o);
  }

  despawn(id: number): void {
    this.world.despawnTarget(id, this.bus);
  }

  /** The Echo's shooting model is in contact: it has the player in an unoccluded line, in range (`enemyFire.seesPlayer`). */
  inSight(id: number): boolean {
    const t = this.world.targetField.byId(id);
    return t !== null && t.alive && t.ai.fireOn && t.ai.phase !== FIRE_IDLE;
  }

  position(id: number, out: Vec3): boolean {
    const t = this.world.targetField.byId(id);
    if (!t || !t.alive) return false;
    out.x = t.pos.x;
    out.y = t.pos.y;
    out.z = t.pos.z;
    return true;
  }
}

export interface ModeStatus {
  mode: string | null;
  phase: string;
  seed: number;
  beat: number;
  dial: number;
  itemDifficulty: number;
  axes: Record<string, number>;
  score: number;
  kills: number;
  misses: number;
  trials: number;
  trialsWon: number;
  streak: number;
  chain: number;
  bestStreak: number;
  bestChain: number;
  timeSec: number;
  remainingSec: number;
  refusedSpawns: number;
  /** Result of the last finished Placement run, or null. */
  placement: PlacementOutcome | null;
  /** Placement run only: the staircase's current dial, step and reversal count. */
  staircase: { dial: number; step: number; reversals: number } | null;
}

/** What the Placement run hands the skill model when it ends (design §9.2). */
export interface PlacementOutcome {
  /** Posterior mean of each trained skill after the run (dial scale), the staircase bound applied. */
  flick: number;
  precision: number;
  /** Staircase ability estimate (NaN with fewer than 4 reversals) and its reversal count. */
  staircaseEstimate: number;
  reversals: number;
}

/**
 * Owns the runner for the running game; the game ticks it after every `world.step`. Wires the
 * framework's contracts to the real modules: the sim's target registry, the map's anchors and the
 * skill model's dial; applies a mode's player setup (stand position, weapon, movement lock); and
 * feeds every `skillTrial` to the skill model.
 */
export class ModeHost {
  readonly runner: ModeRunner;
  /** The player's skill state: restored from the progress save when there is one (`features/progress.ts` saves it after every run), else a prior of 'skip' until the self-report sets it. */
  readonly skills: SkillState;
  /** Result of the last finished Placement run, or null. */
  placementOutcome: PlacementOutcome | null = null;
  private active: ModeDef<never> | null = null;
  /** The player's difficulty pin for a mode (setting `difficultyPin`), or undefined for matched difficulty. */
  pinFor: (modeId: string) => number | undefined = () => undefined;
  private anchors: AnchorSource;
  private priorInfiniteMagazine = false;
  private priorInfiniteReserve = false;
  private readonly ray = vec3();
  private readonly placedEv = { tick: 0, x: 0, y: 0, z: 0, yaw: 0 };
  private readonly mapEv = { tick: 0, mapId: '' };

  constructor(
    private readonly world: World,
    private readonly bus: EventBus<GameEvents>,
    private map: MapDef,
    private readonly tunables: Tunables,
    skills: SkillState = new SkillState('skip'),
  ) {
    this.skills = skills;
    const dial: DialSource = {
      dialFor: (mode, beat, wave) => skills.dialFor(mode, beat, wave),
      axes: (d) => axes(d, undefined, tunables.dial) as unknown as AxisValues,
    };
    this.runner = new ModeRunner({
      events: bus, tunables, dial, spawner: new WorldSpawner(world, bus), player: world.player,
      placePlayer: (x, y, z, yaw) => this.placePlayer(x, y, z, yaw),
      vitals: world.health,
      loadMap: (mapId) => (this.loadMap(mapId) ? this.anchors : null),
    });
    this.runner.attach(bus);
    this.anchors = this.anchorsOf(map);
    // Benchmark trials (the cold opener's, design §8.5) are a separate measurement: the matched posterior never consumes them.
    bus.on('skillTrial', (e) => {
      if (e.source !== 'baseline') skills.observeTrial(e);
    });
    bus.on('runEnded', (e) => {
      if (this.active?.id === 'placement' && e.reason !== 'quit') this.finishPlacement();
    });
  }

  /** The map in the world now: the one the last started mode asked for (the URL's `?map=` or Range until one starts). */
  get currentMap(): MapDef {
    return this.map;
  }

  private anchorsOf(map: MapDef): AnchorSource {
    return { anchors: map.anchors, bounds: map.bounds, sightClear: (from, to) => this.sightClear(from, to) };
  }

  /**
   * Load the map a mode is designed for (`ModeDef.map`) when it is not the one in the world: the
   * sim's level, this host's anchors and, through `mapLoaded`, the renderer's level visuals. A mode
   * naming a map that is not shipped plays on the current one.
   */
  private loadMapFor(mode: ModeDef<never>): void {
    this.loadMap(mode.map);
  }

  /**
   * Load a shipped map in place (no-op when it is the loaded one): the sim's level, this host's
   * anchors and, through `mapLoaded`, the level visuals. Also the run's own move between maps (Sweep
   * sectors, `ModeContext.loadMap`): the player, his health and the run are untouched. False for an
   * unknown map id.
   */
  loadMap(mapId: string): boolean {
    const next = MAPS[mapId];
    if (!next) return false;
    if (next === this.map) return true;
    this.map = next;
    this.anchors = this.anchorsOf(next);
    this.world.setLevel(next);
    this.mapEv.tick = this.world.tick;
    this.mapEv.mapId = next.id;
    this.bus.emit('mapLoaded', this.mapEv);
    return true;
  }

  start(id: string, opts: Partial<RunOptions> = {}): boolean {
    const mode = MODES[id];
    if (!mode) return false;
    this.stop(); // the previous run ends before the field is cleared
    this.loadMapFor(mode); // before the reset: the world resets onto the mode's map, spawn and placed targets
    const seed = opts.seed ?? this.world.seed;
    this.world.reset(seed); // the run starts from the seed: same seed, same spread, same sway, same layout
    this.clearField();
    this.applyPlayerSetup(mode);
    this.active = mode;
    this.runner.begin(mode, { seed, pinDial: opts.pinDial ?? this.pinFor(id), anchors: opts.anchors ?? this.anchors });
    return true;
  }

  stop(): void {
    if (this.active) {
      this.runner.end('quit');
      this.world.weapon.infiniteMagazine = this.priorInfiniteMagazine;
      this.world.weapon.infiniteReserve = this.priorInfiniteReserve;
    }
    this.world.movementLocked = false;
    this.world.swapLocked = false;
    this.world.setShields(0, 0);
    this.world.enemiesFire = false;
    this.active = null;
  }

  /** Call once after each `world.step`. Cheap when no mode runs. */
  tick(): void {
    if (this.active) this.runner.tick(this.world.tick);
  }

  /** The run clock for the HUD (cheap getters, no allocation). */
  get phase(): 'idle' | 'ready' | 'live' | 'result' {
    return this.active ? this.runner.phase : 'idle';
  }
  get modeId(): string | null {
    return this.active?.id ?? null;
  }
  get timeSec(): number {
    return this.runner.timeSec;
  }
  get remainingSec(): number {
    return this.runner.remainingSec;
  }

  get running(): boolean {
    return this.active !== null && this.runner.phase !== 'result';
  }

  /** The mode's stand position, weapon and rules (design §4.1, §4.2): declarative on the `ModeDef`, applied here. */
  private applyPlayerSetup(mode: ModeDef<never>): void {
    const w = this.world;
    const setup = mode.player;
    const m = this.tunables.movement;
    let x = w.level.spawn.pos.x;
    let y = w.level.spawn.pos.y;
    let z = w.level.spawn.pos.z;
    let yaw = w.level.spawn.yaw;
    const anchor = setup?.standAt ? this.map.anchors.find((a) => a.kind === setup.standAt) : undefined;
    if (anchor) {
      const p = anchor.kind === 'beacon-shell' ? anchor.centre : 'pos' in anchor ? anchor.pos : undefined;
      if (p) {
        x = p.x;
        y = anchor.kind === 'beacon-shell' ? Math.max(0, p.y - m.standEyeHeight) : p.y;
        z = p.z;
        yaw = 0;
      }
    }
    w.placePlayer(x, y, z, yaw);
    const id = mode.weapon as WeaponId;
    if (!w.equipWeapon(id)) {
      // The mode's weapon is not in the current loadout (e.g. Rill after Kestrel): put it in the
      // slot of its class, keeping the other slot, and take it in hand.
      const cur = w.loadout;
      const isSidearm = this.tunables.weapon[id]?.slotClass === 'sidearm';
      w.setLoadout({ primary: isSidearm ? cur[0]! : id, sidearm: isSidearm ? id : cur[1]! });
      w.equipWeapon(id);
    }
    w.swapLocked = !(setup?.allowSwap ?? false);
    this.priorInfiniteMagazine = w.weapon.infiniteMagazine;
    w.weapon.infiniteMagazine = setup?.infiniteMagazine ?? this.priorInfiniteMagazine;
    this.priorInfiniteReserve = w.weapon.infiniteReserve;
    w.weapon.infiniteReserve = setup?.infiniteReserve ?? this.priorInfiniteReserve;
    w.movementLocked = setup?.lockMovement ?? false;
    const level = mode.economy ? economyShield(mode.economy, this.tunables.economy, this.tunables.player.shield) : 0;
    w.setShields(level, level);
    // A mode with an economy is a mode where enemies shoot back (design §5.3); drills never have one.
    w.enemiesFire = mode.economy !== undefined;
    if (mode.economy) w.enemyWeapon = this.tunables.economy.levels[mode.economy].enemyWeapon;
  }

  /** A mode moves the player (Spray Wall's alcoves): place the sim's player and tell the view to follow. */
  private placePlayer(x: number, y: number, z: number, yaw: number): void {
    this.world.placePlayer(x, y, z, yaw);
    const e = this.placedEv;
    e.tick = this.world.tick;
    e.x = x;
    e.y = y;
    e.z = z;
    e.yaw = yaw;
    this.bus.emit('playerPlaced', e);
  }

  /** Line of sight between two points through the level's collision boxes. */
  private sightClear(from: Vec3, to: Vec3): boolean {
    const d = this.ray;
    d.x = to.x - from.x;
    d.y = to.y - from.y;
    d.z = to.z - from.z;
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (len < 1e-6) return true;
    d.x /= len;
    d.y /= len;
    d.z /= len;
    const boxes = this.world.level.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const hit = rayBox(from.x, from.y, from.z, d.x, d.y, d.z, boxes[i]!, len - 0.01, SCRATCH);
      if (hit >= 0 && hit < len - 0.01) return false;
    }
    return true;
  }

  private finishPlacement(): void {
    const st = this.runner.state as PlacementState;
    const sk = this.skills;
    const flick = sk.finishPlacement('flick', st.staircase);
    const precision = sk.finishPlacement('precision', st.staircase);
    this.placementOutcome = { flick, precision, staircaseEstimate: st.staircase.abilityEstimate(), reversals: st.staircase.reversals };
  }

  /** Modes own spawning: remove the level's placed targets and stop them respawning (`World.reset` restores them). */
  private clearField(): void {
    const field = this.world.targetField;
    for (const t of field.slots) if (t.alive) this.world.despawnTarget(t.id, this.bus);
    field.spawners.length = 0;
  }

  status(): ModeStatus {
    const r = this.runner;
    const st = this.active?.id === 'placement' ? (r.state as PlacementState).staircase : null;
    return {
      mode: this.active?.id ?? null,
      phase: this.active ? r.phase : 'idle',
      seed: r.seed,
      beat: r.beat,
      dial: r.dial,
      itemDifficulty: r.itemDifficulty,
      axes: { ...r.axes },
      score: r.stats.score,
      kills: r.stats.kills,
      misses: r.stats.misses,
      trials: r.stats.trials,
      trialsWon: r.stats.trialsWon,
      streak: r.cleanStreak,
      chain: r.chain,
      bestStreak: r.bestStreak,
      bestChain: r.bestChain,
      timeSec: r.timeSec,
      remainingSec: r.remainingSec,
      refusedSpawns: r.refusedSpawns,
      placement: this.placementOutcome,
      staircase: st ? { dial: st.dial, step: st.step, reversals: st.reversals } : null,
    };
  }
}

const SCRATCH = vec3();
