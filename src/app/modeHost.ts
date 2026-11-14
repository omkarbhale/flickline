import type { EventBus } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import { axes } from '../adaptive/dial';
import { SkillState } from '../adaptive/skillModel';
import type { Tunables } from '../config/tunables';
import type { EnemyKind } from '../config/scoring';
import type { WeaponId } from '../config/weapon';
import { coldStart } from '../modes/coldStart';
import type { AnchorSource, AxisValues, DialSource, TargetSpawner } from '../modes/contracts';
import type { ModeDef } from '../modes/modeDef';
import { orbit } from '../modes/orbit';
import { placement, type PlacementState } from '../modes/placement';
import { ModeRunner, type RunOptions } from '../modes/runner';
import { testMode } from '../modes/testMode';
import { rayBox } from '../sim/collision';
import type { MapDef } from '../sim/mapTypes';
import type { World } from '../sim/world';
import type { GameEvents } from './events';

/** The registered modes. Individual modes (#46, ...) add themselves here. */
export const MODES: Readonly<Record<string, ModeDef<never>>> = {
  test: testMode as ModeDef<never>,
  coldStart: coldStart as ModeDef<never>,
  orbit: orbit as ModeDef<never>,
  placement: placement as ModeDef<never>,
};

/** The sim's target registry as the framework's spawner (#15). Only the kinds the sim has yet. */
class WorldSpawner implements TargetSpawner {
  constructor(private readonly world: World, private readonly bus: EventBus<GameEvents>) {}

  /** `scale` sizes an orb (Beacon); humanoids keep the spec's hit volumes. */
  spawn(kind: EnemyKind, pos: Vec3, scale: number): number {
    if (kind !== 'post' && kind !== 'beacon') return -1;
    return this.world.spawnTarget(kind, pos.x, pos.y, pos.z, this.bus, { scale });
  }

  despawn(id: number): void {
    this.world.despawnTarget(id, this.bus);
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
  /** The player's skill state (placeholder prior until the profile/persistence work). */
  readonly skills = new SkillState('skip');
  /** Result of the last finished Placement run, or null. */
  placementOutcome: PlacementOutcome | null = null;
  private active: ModeDef<never> | null = null;
  private readonly anchors: AnchorSource;
  private priorInfiniteMagazine = false;
  private readonly ray = vec3();

  constructor(
    private readonly world: World,
    private readonly bus: EventBus<GameEvents>,
    private readonly map: MapDef,
    private readonly tunables: Tunables,
  ) {
    const skills = this.skills;
    const dial: DialSource = {
      dialFor: (mode, beat, wave) => skills.dialFor(mode, beat, wave),
      axes: (d) => axes(d, undefined, tunables.dial) as unknown as AxisValues,
    };
    this.runner = new ModeRunner({ events: bus, tunables, dial, spawner: new WorldSpawner(world, bus), player: world.player });
    this.runner.attach(bus);
    this.anchors = { anchors: map.anchors, bounds: map.bounds, sightClear: (from, to) => this.sightClear(from, to) };
    bus.on('skillTrial', (e) => skills.observeTrial(e));
    bus.on('runEnded', (e) => {
      if (this.active?.id === 'placement' && e.reason !== 'quit') this.finishPlacement();
    });
  }

  start(id: string, opts: Partial<RunOptions> = {}): boolean {
    const mode = MODES[id];
    if (!mode) return false;
    this.stop(); // the previous run ends before the field is cleared
    const seed = opts.seed ?? this.world.seed;
    this.world.reset(seed); // the run starts from the seed: same seed, same spread, same sway, same layout
    this.clearField();
    this.applyPlayerSetup(mode);
    this.active = mode;
    this.runner.begin(mode, { seed, pinDial: opts.pinDial, anchors: opts.anchors ?? this.anchors });
    return true;
  }

  stop(): void {
    if (this.active) {
      this.runner.end('quit');
      this.world.weapon.infiniteMagazine = this.priorInfiniteMagazine;
    }
    this.world.movementLocked = false;
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
    w.equipWeapon(mode.weapon as WeaponId);
    this.priorInfiniteMagazine = w.weapon.infiniteMagazine;
    w.weapon.infiniteMagazine = setup?.infiniteMagazine ?? this.priorInfiniteMagazine;
    w.movementLocked = setup?.lockMovement ?? false;
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
