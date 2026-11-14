import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import { createTickInput, type LevelDef, type SimEvents } from '../sim/types';
import { World } from '../sim/world';
import { retainedHeapBytes } from './heapProbe';
import { TargetsView } from './targetsView';

const arena: LevelDef = {
  name: 'arena',
  boxes: [{ tag: 'floor', min: vec3(-40, -1, -40), max: vec3(40, 0, 40) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

function setup() {
  const tunables = cloneTunables();
  const world = new World({ level: arena, tunables, seed: 1 });
  const bus = new EventBus<SimEvents>();
  const view = new TargetsView(tunables, bus, world.targets.length, tunables.render.quality.high);
  return { tunables, world, bus, view, input: createTickInput() };
}

describe('TargetsView (no GL needed: batches are plain buffers until drawn)', () => {
  it('draws up to 64 Echoes in ONE instanced draw (body) plus one for the outline', () => {
    const s = setup();
    for (let i = 0; i < 64; i++) s.world.spawnTarget('post', (i % 8) - 4, 0, -5 - Math.floor(i / 8), s.bus);
    s.world.step(s.input, s.bus);
    s.view.update(s.world, 1, 0.007, 0, 1.6, 0);
    expect(s.view.echo.mesh.count).toBe(64);
    expect(s.view.echo.hull.count).toBe(64); // High: outline on
    expect(s.view.beacon.mesh.count).toBe(0);
    expect(s.view.gnat.mesh.count).toBe(0);
    expect(s.view.echo.capacity).toBe(64);
  });

  it('routes Beacons to the orb batch, and showcase Gnats to the Gnat batch', () => {
    const s = setup();
    s.world.spawnTarget('beacon', 0, 1.5, -8, s.bus);
    s.world.spawnTarget('post', 1, 0, -8, s.bus, { crouched: true });
    s.view.showcase = [{ look: 'gnat', x: 0, y: 1.5, z: -6 }, { look: 'gnat', x: 1, y: 2, z: -6 }];
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.beacon.mesh.count).toBe(1);
    expect(s.view.echo.mesh.count).toBe(1);
    expect(s.view.gnat.mesh.count).toBe(2);
    // The crouched Echo is flagged in the per-instance state (crouch = 1).
    const state = (s.view.echo.mesh.geometry.getAttribute('aState') as { array: Float32Array }).array;
    expect(state[2]).toBe(1);
  });

  it('the outline follows the quality preset, except Contrast which always has it', () => {
    const s = setup();
    s.world.spawnTarget('post', 0, 0, -8, s.bus);
    s.view.setQuality(s.tunables.render.quality.low);
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.hull.count).toBe(0);
    s.view.setPreset('contrast');
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.hull.count).toBe(1);
    s.view.setPreset('lime');
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.hull.count).toBe(0);
  });

  it('a kill launches 12 shards at the hit point and a kill allocates nothing', () => {
    const s = setup();
    const k = { tick: 0, t: 0, targetId: 0, kind: 'post' as const, zone: 'head' as const, point: vec3(1, 1.6, -9), distance: 9, ttkMs: 0, rtMs: 0, firstBullet: true, bullets: 1, clean: true };
    s.view.update(s.world, 1, 0.007, 0, 1.6, 0);
    s.bus.emit('targetKilled', k);
    const ring = s.view.shatter.ring;
    const alive = (): number => {
      let n = 0;
      for (let i = 0; i < ring.instances; i++) if (ring.kill[i * 4 + 3] > -1e8) n++;
      return n;
    };
    expect(alive()).toBe(12);
    expect(ring.kill[0]).toBe(1);
    expect(ring.kill[1]).toBeCloseTo(1.6, 5);

    // Steady state: kill + frame update, 100k times, with a Post present (flash/dissolve paths run).
    s.world.spawnTarget('post', 0, 0, -8, s.bus);
    const retained = retainedHeapBytes(() => {
      s.bus.emit('targetKilled', k);
      s.view.update(s.world, 0.5, 0.007, 0, 1.6, 0);
    }, 100_000);
    expect(retained).toBeLessThan(256 * 1024);
  });

  it('a killed Echo keeps its slot while it dissolves, then disappears', () => {
    const s = setup();
    const id = s.world.spawnTarget('post', 0, 0, -8, s.bus);
    expect(id).toBeGreaterThanOrEqual(0);
    const t = s.world.targets.find((x) => x.alive)!;
    // Kill it the way the sim does: hp <= 0, slot released, last hit recorded.
    t.hp = 0; t.alive = false; t.lastHitTick = s.world.tick;
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.mesh.count).toBe(1);
    const dissolve = (s.view.echo.mesh.geometry.getAttribute('aState') as { array: Float32Array }).array[1]!;
    expect(dissolve).toBeGreaterThanOrEqual(0);
    expect(dissolve).toBeLessThan(0.2);
    for (let i = 0; i < 64; i++) s.world.step(s.input, s.bus); // 0.5 s of sim time > dissolveSec
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.mesh.count).toBe(0);
  });

  it('an expired (never killed) target just vanishes, no dissolve', () => {
    const s = setup();
    s.world.spawnTarget('post', 0, 0, -8, s.bus);
    s.world.despawnTarget(s.world.targets.find((x) => x.alive)!.id, s.bus);
    s.view.update(s.world, 1, 0, 0, 1.6, 0);
    expect(s.view.echo.mesh.count).toBe(0);
  });
});
