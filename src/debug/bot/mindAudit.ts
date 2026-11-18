import { axes } from '../../adaptive/dial';
import { cloneTunables } from '../../config/tunables';
import { EventBus } from '../../core/eventBus';
import { vec3 } from '../../core/vec3';
import { fireParams, straferParams } from '../../sim/enemyParams';
import { createTickInput, type LevelDef, type SimEvents } from '../../sim/types';
import { World } from '../../sim/world';
import { profileTicks, type AllocAudit } from './allocAudit';

/**
 * Cost of the enemy mind's aim and shots (issue #90: zero allocation, <= 0.01 ms per enemy per
 * tick). A fight on an open floor: `enemies` Strafers on lanes 8-26 m away, mind skills cycling
 * through the four anchors, all shooting at a player who strafes left and right and is kept alive,
 * so every path runs: holds, reactions, flicks, corrections, tracking, tells, bursts.
 */

const arena: LevelDef = {
  name: 'mind-audit',
  boxes: [{ tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

/**
 * How the Echoes shoot: the mind (#90); the mind aiming but never firing (its on-target tolerance at
 * 0: every aim path runs each tick, no shot path); not at all (the baseline the mind is measured against).
 */
export type AuditFire = 'mind' | 'aim' | 'none';

/** Build the fight and return a function that advances it `n` ticks. */
export function mindScenario(enemies: number, fire: AuditFire, seed = 1): (n: number) => void {
  const tun = cloneTunables();
  if (fire === 'aim') tun.mind.shoot.onTargetZones = 0;
  const world = new World({ level: arena, tunables: tun, seed });
  world.enemiesFire = true;
  const bus = new EventBus<SimEvents>();
  const anchors = tun.mind.anchorSkills;
  for (let i = 0; i < enemies; i++) {
    const m = anchors[i % anchors.length]!;
    const ax = axes(m);
    const z = -8 - (18 * i) / Math.max(1, enemies - 1);
    const x = (i % 2 === 0 ? -1 : 1) * (i % 3);
    world.spawnTarget('strafer', x, 0, z, bus, {
      strafe: { ...straferParams(ax), laneA: vec3(x - 5, 0, z), laneB: vec3(x + 5, 0, z) },
      fire: fire === 'none' ? undefined : fireParams(ax, { mindSkill: m }),
    });
  }
  const input = createTickInput();
  let at = 0;
  return (n: number): void => {
    for (let i = 0; i < n; i++, at++) {
      input.moveX = Math.floor(at / 70) % 3 - 1; // left, still, right: legs and stops
      world.health.alive = true;
      world.health.hp = world.health.maxHp;
      world.step(input, bus);
    }
  };
}

/** Allocation audit of the fight above (sampling heap profiler, as `auditAllocations`). */
export function auditMindAllocations(
  fire: AuditFire, enemies = 8, ticks = 20_000, warmupTicks = 40_000, ceilingBytesPerTick = 8,
): AllocAudit {
  return profileTicks(mindScenario(enemies, fire), warmupTicks, ticks, ceilingBytesPerTick, 1000);
}

/** Milliseconds per enemy per tick that the mind adds over Echoes that do not shoot (median of `repeats`). */
export function mindTickCostMs(enemies = 8, ticks = 20_000, repeats = 5): number {
  const mind = mindScenario(enemies, 'mind');
  const none = mindScenario(enemies, 'none');
  mind(ticks); // warm the JIT on both paths
  none(ticks);
  const costs: number[] = [];
  for (let r = 0; r < repeats; r++) {
    let t0 = performance.now();
    mind(ticks);
    const tm = performance.now() - t0;
    t0 = performance.now();
    none(ticks);
    const tn = performance.now() - t0;
    costs.push((tm - tn) / (ticks * enemies));
  }
  costs.sort((a, b) => a - b);
  return costs[costs.length >> 1]!;
}
