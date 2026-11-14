import { EventBus, type EventSink, type Subscribable } from '../core/eventBus';
import { TICK_DT } from '../core/time';
import type { Vec3 } from '../core/vec3';
import type { Tunables } from '../config/tunables';
import { createLinearDial } from '../modes/linearDial';
import type { DialSource, ModeEvents, SourceEvents, TargetSpawner } from '../modes/contracts';
import type { ModeDef } from '../modes/modeDef';
import { ModeRunner, type RunOptions } from '../modes/runner';
import { testMode, TEST_MODE_AXES } from '../modes/testMode';
import type { EnemyKind } from '../config/scoring';
import type { SimEvents } from '../sim/types';
import type { World } from '../sim/world';
import { stubAnchors } from './stubAnchors';

/**
 * Composition of the mode framework with the foundation's sim.
 *
 * TEMPORARY SEAMS (each disappears when its issue lands; the framework itself does not change):
 *  - `ModeHost.dial`: a linear stand-in for #17's `SkillState` (same `DialSource` shape).
 *  - `FoundationSpawner`: drives the foundation's fixed sphere targets as spawn slots until #15's
 *    spawn/despawn exists.
 *  - `SourceBridge`: derives the design §14.3 facts (`targetKilled` with ttk/rt/clean, `shotImpact`
 *    result) from the foundation's raw events until #13/#15 emit them natively; then the runner
 *    attaches straight to the game bus.
 *  - `stubAnchors`: hand-placed Post anchors for the test room until #16's map data.
 */
export const MODES: Readonly<Record<string, ModeDef<never>>> = { test: testMode as ModeDef<never> };

/** Foundation targets as spawn slots: a slot is free when it is dead and will never respawn by itself. */
class FoundationSpawner implements TargetSpawner {
  /** Per-slot facts the bridge needs. */
  readonly kind: EnemyKind[] = [];
  readonly spawnTick: number[] = [];
  readonly firstShotTick: number[] = [];
  readonly firstHitTick: number[] = [];
  readonly hits: number[] = [];
  readonly missed: boolean[] = [];

  constructor(private readonly world: World, private readonly tunables: Tunables) {}

  /** A shot was fired: the first one after a target appeared defines its reaction time. */
  onShot(tick: number): void {
    const ts = this.world.targets;
    for (let i = 0; i < ts.length; i++) if (ts[i]!.alive && this.firstShotTick[i] === -1) this.firstShotTick[i] = tick;
  }

  /** A shot missed everything: every live target now has a miss against the run (not clean). */
  onMiss(): void {
    const ts = this.world.targets;
    for (let i = 0; i < ts.length; i++) if (ts[i]!.alive) this.missed[i] = true;
  }

  freeAll(): void {
    for (const t of this.world.targets) this.free(t.id);
  }

  free(id: number): void {
    const t = this.world.targets[id];
    if (!t) return;
    t.alive = false;
    t.respawnTick = Number.MAX_SAFE_INTEGER;
  }

  spawn(kind: EnemyKind, pos: Vec3, scale: number): number {
    for (const t of this.world.targets) {
      if (t.alive || t.respawnTick !== Number.MAX_SAFE_INTEGER) continue;
      // A Post anchor is at the feet; the placeholder sphere is centred on the aim point.
      const y = kind === 'post' ? pos.y + this.tunables.modes.aimHeightStand : pos.y;
      t.home.x = t.pos.x = pos.x;
      t.home.y = t.pos.y = y;
      t.home.z = t.pos.z = pos.z;
      t.radius = this.tunables.targets.radius * scale;
      t.hp = t.maxHp;
      t.alive = true;
      this.kind[t.id] = kind;
      this.spawnTick[t.id] = this.world.tick;
      this.firstShotTick[t.id] = -1;
      this.firstHitTick[t.id] = -1;
      this.hits[t.id] = 0;
      this.missed[t.id] = false;
      return t.id;
    }
    return -1;
  }

  despawn(id: number): void {
    this.free(id);
  }
}

/** Derives §14.3-shaped facts for the runner from the foundation's raw sim events. */
class SourceBridge {
  readonly out = new EventBus<SourceEvents>();
  private readonly kill = { tick: 0, id: 0, kind: 'post' as EnemyKind, zone: 'body' as 'head' | 'body' | 'leg', ttkMs: 0, rtMs: 0, firstBullet: false, bullets: 0, clean: false };
  private readonly impact = { tick: 0, result: 'miss' as 'hit' | 'miss' };

  constructor(bus: Subscribable<SimEvents>, slots: FoundationSpawner) {
    bus.on('shotFired', (e) => slots.onShot(e.tick));
    bus.on('shotImpact', (e) => {
      this.impact.tick = e.tick;
      this.impact.result = e.onTarget ? 'hit' : 'miss';
      if (!e.onTarget) slots.onMiss();
      this.out.emit('shotImpact', this.impact);
    });
    bus.on('targetHit', (e) => {
      const id = e.targetId;
      slots.hits[id] = (slots.hits[id] ?? 0) + 1;
      if (slots.firstHitTick[id] === -1) slots.firstHitTick[id] = e.tick;
    });
    bus.on('targetKilled', (e) => {
      const id = e.targetId;
      const k = this.kill;
      const kind = slots.kind[id] ?? 'post';
      k.tick = e.tick;
      k.id = id;
      k.kind = kind;
      k.zone = kind === 'beacon' ? 'head' : 'body'; // placeholder spheres have no zones until #15
      k.ttkMs = (e.tick - (slots.firstHitTick[id]! >= 0 ? slots.firstHitTick[id]! : e.tick)) * TICK_DT * 1000;
      k.rtMs = ((slots.firstShotTick[id]! >= 0 ? slots.firstShotTick[id]! : e.tick) - (slots.spawnTick[id] ?? e.tick)) * TICK_DT * 1000;
      k.bullets = slots.hits[id] ?? 1;
      k.firstBullet = k.bullets === 1;
      k.clean = !slots.missed[id];
      slots.free(id); // modes own spawning: no automatic respawn
      this.out.emit('targetKilled', k);
    });
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

/** Owns the runner for the running game; the game ticks it after every `world.step`. */
export class ModeHost {
  readonly runner: ModeRunner;
  readonly dial: DialSource & { baseDial: number };
  private readonly slots: FoundationSpawner;
  private active: ModeDef<never> | null = null;

  constructor(private readonly world: World, events: EventSink<ModeEvents> & Subscribable<SimEvents>, tunables: Tunables) {
    this.dial = createLinearDial(TEST_MODE_AXES);
    this.slots = new FoundationSpawner(world, tunables);
    const bridge = new SourceBridge(events, this.slots);
    this.runner = new ModeRunner({ events, tunables, dial: this.dial, spawner: this.slots, player: world.player });
    this.runner.attach(bridge.out);
  }

  start(id: string, opts: Partial<RunOptions> = {}): boolean {
    const mode = MODES[id];
    if (!mode) return false;
    this.active = mode;
    this.slots.freeAll();
    this.runner.begin(mode, { seed: opts.seed ?? this.world.seed, pinDial: opts.pinDial, anchors: opts.anchors ?? stubAnchors });
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

  get running(): boolean {
    return this.active !== null && this.runner.phase !== 'result';
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
