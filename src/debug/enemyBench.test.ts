import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { testRoom } from '../sim/levels';
import { benchEnemyBodies } from './enemyBench';

describe('enemy body bench (#87, perf harness)', () => {
  it('measures the three worlds and reports against the budget (timing itself is judged in the browser run)', () => {
    const t = cloneTunables();
    const r = benchEnemyBodies(testRoom, t, { warmTicks: 200, blocks: 2, blockTicks: 100 });
    expect(r.enemies).toBe(t.render.budget.enemyTick.count);
    expect(r.budgetMs).toBe(t.render.budget.enemyTick.ms);
    expect(r.ticks).toBe(200);
    expect(r.baseTickMs).toBeGreaterThan(0);
    expect(Number.isFinite(r.strafersMs) && Number.isFinite(r.sprayingMs)).toBe(true);
    if (process.env.ENEMY_BENCH) {
      const full = benchEnemyBodies(testRoom, t);
      process.stdout.write(`ENEMY_BENCH ${JSON.stringify(full)}\n`);
    }
  });
});
