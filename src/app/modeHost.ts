import type { EventBus } from '../core/eventBus';
import type { Vec3 } from '../core/vec3';
import { axes } from '../adaptive/dial';
import { SkillState } from '../adaptive/skillModel';
import type { Tunables } from '../config/tunables';
import type { EnemyKind } from '../config/scoring';
import type { AxisValues, DialSource, TargetSpawner } from '../modes/contracts';
import type { ModeDef } from '../modes/modeDef';
import { ModeRunner, type RunOptions } from '../modes/runner';
import { testMode } from '../modes/testMode';
import type { MapDef } from '../sim/mapTypes';
import type { World } from '../sim/world';
import type { GameEvents } from '../core/gameEvents';

/** The registered modes. Individual modes (#23, #46, ...) add themselves here. */
export const MODES: Readonly<Record<string, ModeDef<never>>> = { test: testMode as ModeDef<never> };

/** The sim's target registry as the framework's spawner (#15). Only the kinds the sim has yet. */
class WorldSpawner implements TargetSpawner {
  constructor(private readonly world: World, private readonly bus: EventBus<GameEvents>) {}

  /** `scale` is not supported by the sim yet (an orb's size comes from the roster). */
  spawn(kind: EnemyKind, pos: Vec3): number {
    if (kind !== 'post' && kind !== 'beacon') return -1;
    return this.world.spawnTarget(kind, pos.x, pos.y, pos.z, this.bus);
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
}

/**
 * Owns the runner for the running game; the game ticks it after every `world.step`. Wires the
 * framework's contracts to the real modules: the sim's target registry, the map's anchors and the
 * skill model's dial.
 */
export class ModeHost {
  readonly runner: ModeRunner;
  /** The player's skill state (placeholder prior until the profile/persistence work). */
  readonly skills = new SkillState('skip');
  private active: ModeDef<never> | null = null;

  constructor(
    private readonly world: World,
    private readonly bus: EventBus<GameEvents>,
    private readonly map: MapDef,
    tunables: Tunables,
  ) {
    const skills = this.skills;
    const dial: DialSource = {
      dialFor: (mode, beat, wave) => skills.dialFor(mode, beat, wave),
      axes: (d) => axes(d, undefined, tunables.dial) as unknown as AxisValues,
    };
    this.runner = new ModeRunner({ events: bus, tunables, dial, spawner: new WorldSpawner(world, bus), player: world.player });
    this.runner.attach(bus);
  }

  start(id: string, opts: Partial<RunOptions> = {}): boolean {
    const mode = MODES[id];
    if (!mode) return false;
    this.stop(); // the previous run ends before the field is cleared
    this.clearField();
    this.active = mode;
    this.runner.begin(mode, { seed: opts.seed ?? this.world.seed, pinDial: opts.pinDial, anchors: opts.anchors ?? this.map });
    return true;
  }

  stop(): void {
    if (this.active) this.runner.end('quit');
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

  /** Modes own spawning: remove the level's placed targets and stop them respawning (`World.reset` restores them). */
  private clearField(): void {
    const field = this.world.targetField;
    for (const t of field.slots) if (t.alive) this.world.despawnTarget(t.id, this.bus);
    field.spawners.length = 0;
  }

  status(): ModeStatus {
    const r = this.runner;
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
    };
  }
}
