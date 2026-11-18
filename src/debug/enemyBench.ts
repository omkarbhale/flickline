import type { Tunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_RATE } from '../core/time';
import { createTickInput, type LevelDef, type SimEvents, type TickInput } from '../sim/types';
import { World } from '../sim/world';

/**
 * What humanoid Echoes playing through the shared body (#87) cost the sim tick: the same level,
 * the same strafing player, with no Echoes, with `count` Strafers (their FSM writes commands, the
 * player's movement code runs them), and with `count` bodies driven running and spraying (movement,
 * the gun model and a bullet trace every shot: the path an aiming mind will use). Each world ticks
 * in blocks, interleaved, and the fastest block of each counts, so a busy machine inflates the
 * numbers less. Part of the perf harness report; budget `render.budget.enemyTick`.
 */
export interface EnemyBench {
  enemies: number;
  /** Measured ticks per world. */
  ticks: number;
  /** One tick with no Echoes, ms. */
  baseTickMs: number;
  /** Added to a tick by the Strafers, and by the running, spraying bodies, ms. */
  strafersMs: number;
  sprayingMs: number;
  budgetMs: number;
  pass: boolean;
}

export interface EnemyBenchOptions {
  /** Unmeasured ticks per world first (V8 compiles the tick), default 20 000. */
  warmTicks?: number;
  /** Blocks per world and ticks per block, default 12 x 1 000. */
  blocks?: number;
  blockTicks?: number;
}

type Scene = 'base' | 'strafers' | 'spraying';

interface Bench {
  world: World;
  bus: EventBus<SimEvents>;
  input: TickInput;
  bodies: number[];
}

function build(level: LevelDef, tunables: Tunables, scene: Scene, count: number): Bench {
  const world = new World({ level, tunables, seed: 1 });
  const bus = new EventBus<SimEvents>();
  const sp = level.spawn.pos;
  const bodies: number[] = [];
  if (scene !== 'base') {
    for (let i = 0; i < count; i++) {
      // A ring round the player, 10 m out, on the spawn's floor.
      const a = (i / count) * Math.PI * 2;
      const id = world.spawnTarget(scene === 'strafers' ? 'strafer' : 'post', sp.x + 10 * Math.cos(a), sp.y, sp.z + 10 * Math.sin(a), bus);
      if (scene === 'spraying' && id >= 0) {
        const b = world.targetField.byId(id)!.body;
        b.driven = true;
        b.cmd.fire = true;
        // Facing out of the ring: its bullets never reach the player, so nobody dies and the scene never changes.
        b.cmd.yaw = Math.atan2(-Math.cos(a), -Math.sin(a));
        bodies.push(id);
      }
    }
  }
  return { world, bus, input: createTickInput(), bodies };
}

/** `n` ticks: the player and the driven bodies change strafe direction every half second. */
function run(b: Bench, n: number): void {
  const half = TICK_RATE / 2;
  for (let i = 0; i < n; i++) {
    const tick = b.world.tick;
    const dir = Math.floor(tick / half) % 2 === 0 ? 1 : -1;
    b.input.moveX = dir;
    for (let k = 0; k < b.bodies.length; k++) b.world.targetField.byId(b.bodies[k]!)!.body.cmd.moveX = dir;
    b.world.step(b.input, b.bus);
  }
}

export function benchEnemyBodies(level: LevelDef, tunables: Tunables, opts: EnemyBenchOptions = {}): EnemyBench {
  const count = tunables.render.budget.enemyTick.count;
  const budgetMs = tunables.render.budget.enemyTick.ms;
  const warm = opts.warmTicks ?? 20_000;
  const blocks = opts.blocks ?? 12;
  const blockTicks = opts.blockTicks ?? 1_000;
  const scenes: Scene[] = ['base', 'strafers', 'spraying'];
  const benches = scenes.map((s) => build(level, tunables, s, count));
  for (const b of benches) run(b, warm);
  const best = [Infinity, Infinity, Infinity];
  for (let k = 0; k < blocks; k++) {
    for (let s = 0; s < benches.length; s++) {
      const t0 = performance.now();
      run(benches[s]!, blockTicks);
      best[s] = Math.min(best[s]!, (performance.now() - t0) / blockTicks);
    }
  }
  const [base, strafers, spraying] = best as [number, number, number];
  const strafersMs = Math.max(0, strafers - base);
  const sprayingMs = Math.max(0, spraying - base);
  return {
    enemies: count, ticks: blocks * blockTicks, baseTickMs: base, strafersMs, sprayingMs, budgetMs,
    pass: strafersMs <= budgetMs && sprayingMs <= budgetMs,
  };
}
