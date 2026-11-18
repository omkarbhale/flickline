import { axes } from '../../adaptive/dial';
import { cloneTunables, type Tunables } from '../../config/tunables';
import { EventBus } from '../../core/eventBus';
import { Rng } from '../../core/rng';
import { TICK_RATE } from '../../core/time';
import { vec3 } from '../../core/vec3';
import { fireParams, straferParams } from '../../sim/enemyParams';
import { createTickInput, type HitZone, type LevelDef, type SimEvents } from '../../sim/types';
import { World } from '../../sim/world';

/**
 * Calibration of the enemy mind's aimed shots (issue #90; research §5.4 S7, design §5.3): one
 * mind-driven Echo shoots at the **standard moving bot** for a while and the harness counts what
 * lands. The bot is a player who strafes like one: run legs of 0.3-0.8 s, alternating direction, with
 * a stop of 0.2-0.5 s (a counter-strafe to shoot) after about half of them, seeded. The player is
 * kept alive so every shot counts.
 *
 * Two questions:
 *  - **S7**: the headshot share of the Echo's hits at each anchor (targets 9 / 15 / 23 / 30 %, +-5),
 *    from a still Echo so the aim alone is measured.
 *  - **Damage per minute** at a dial, from a Sweep-like strafing Echo, against the same Echo with the
 *    dial's rolled shots (`enemyHitChance`, design §5.3): what the aimed model changes for balance.
 */

const arena: LevelDef = {
  name: 'calibration',
  boxes: [{ tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) }],
  spawn: { pos: vec3(0, 0, 0), yaw: 0 },
  targets: [],
};

export interface CalibrationOpts {
  /** Mind skill of the Echo; `null` = the dial's rolled shots (the pre-#90 model). */
  mindSkill: number | null;
  /** Dial for the tell, reaction and hit chance axes (and the strafe numbers when `strafe`). */
  dial: number;
  /** Distance from the player, metres. */
  distanceM: number;
  /** Seconds of play per seed. */
  seconds: number;
  seeds: number;
  /** The Echo strafes on the dial's numbers (Sweep's duel Echo); otherwise it stands still. */
  strafe: boolean;
  /** The player stands still instead of strafing. */
  still?: boolean;
  /**
   * Identical Echoes side by side (2 m apart) at the distance, shooting together: more hits per
   * simulated second for the same answer (default 1). Damage per minute is per Echo.
   */
  copies?: number;
  tunables?: Tunables;
}

export interface CalibrationResult {
  shots: number;
  hits: number;
  zones: Record<HitZone, number>;
  /** Damage dealt (health and shield) per minute of play. */
  damagePerMin: number;
  /** Hits / shots. */
  hitRate: number;
  /** Head hits / hits (S7). */
  headShare: number;
}

/** One seed: the standard moving bot in front of one Echo. */
function runSeed(o: CalibrationOpts, seed: number, out: CalibrationResult): number {
  const tun = o.tunables ?? cloneTunables();
  const world = new World({ level: arena, tunables: tun, seed });
  world.enemiesFire = true;
  const bus = new EventBus<SimEvents>();
  const ax = axes(o.dial);
  const z = -o.distanceM;
  const fire = fireParams(ax, o.mindSkill === null ? {} : { mindSkill: o.mindSkill });
  const strafe = o.strafe
    ? { ...straferParams(ax), laneA: vec3(-6, 0, z), laneB: vec3(6, 0, z) }
    : { speed: 0, legSec: 1, standStillSec: 1, laneA: vec3(0, 0, z), laneB: vec3(0, 0, z) };
  const copies = Math.max(1, o.copies ?? 1);
  for (let c = 0; c < copies; c++) {
    const x = (c - (copies - 1) / 2) * 2;
    const lane = o.strafe ? strafe : { ...strafe, laneA: vec3(x, 0, z), laneB: vec3(x, 0, z) };
    world.spawnTarget('strafer', x, 0, z, bus, { strafe: lane, fire });
  }
  // A player no burst can kill (several Echoes may hit in one tick): every shot counts.
  world.health.maxHp = 1e9;
  let damage = 0;
  bus.on('enemyFired', (e) => {
    out.shots++;
    if (e.hit) out.hits++;
  });
  bus.on('playerDamaged', (e) => {
    damage += e.amount + e.absorbed;
    out.zones[e.zone]++;
  });
  // The standard moving bot (seeded): legs of 0.3-0.8 s, a 0.2-0.5 s stop after about half of them.
  const rng = new Rng(seed * 7919 + 13);
  const input = createTickInput();
  const ticks = Math.round(o.seconds * TICK_RATE);
  let dir = 1;
  let left = 0;
  let stopping = false;
  for (let i = 0; i < ticks; i++) {
    if (!o.still) {
      if (left <= 0) {
        if (!stopping && rng.next() < 0.5) {
          stopping = true;
          left = Math.round(rng.range(0.2, 0.5) * TICK_RATE);
        } else {
          stopping = false;
          dir = -dir;
          left = Math.round(rng.range(0.3, 0.8) * TICK_RATE);
        }
      }
      left--;
      // Keep the bot near the lane's middle so the geometry stays the same.
      const x = world.player.pos.x;
      if (!stopping && Math.abs(x) > 3 && Math.sign(x) === dir) dir = -dir;
      input.moveX = stopping ? 0 : dir;
    }
    world.health.alive = true;
    world.health.hp = world.health.maxHp;
    world.step(input, bus);
  }
  return damage / copies;
}

/** Run `seeds` seeds and sum them. */
export function calibrate(o: CalibrationOpts): CalibrationResult {
  const r: CalibrationResult = { shots: 0, hits: 0, zones: { head: 0, body: 0, leg: 0 }, damagePerMin: 0, hitRate: 0, headShare: 0 };
  let damage = 0;
  for (let s = 1; s <= o.seeds; s++) damage += runSeed(o, s, r);
  r.damagePerMin = damage / ((o.seconds * o.seeds) / 60);
  r.hitRate = r.shots > 0 ? r.hits / r.shots : 0;
  const zoneHits = r.zones.head + r.zones.body + r.zones.leg;
  r.headShare = zoneHits > 0 ? r.zones.head / zoneHits : 0;
  return r;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** The calibration report posted on #90: S7 per anchor, then damage per minute at a dial, aimed vs rolled. */
export function aimReport(seeds = 6, seconds = 60, dial = 50): string[] {
  const lines: string[] = [];
  const t = cloneTunables();
  const anchors = t.mind.anchorSkills;
  const targets = t.mind.anchors.calibrationHeadshotShare;
  lines.push(`S7: headshot share of hits, still Echoes vs the standard moving bot (${seeds} seeds x ${seconds} s x 3 Echoes per row)`);
  lines.push('mind skill | distance | shots | hit rate | head / body / leg | headshot share | target | dmg/min');
  for (let i = 0; i < anchors.length; i++) {
    // S7 pools 10, 15 and 20 m (the band is for the anchor, not for one distance).
    let head = 0, hits = 0;
    for (const d of [10, 15, 20]) {
      const r = calibrate({ mindSkill: anchors[i]!, dial: anchors[i]!, distanceM: d, seconds, seeds, strafe: false, copies: 3 });
      head += r.zones.head;
      hits += r.zones.head + r.zones.body + r.zones.leg;
      lines.push(
        `${anchors[i]} | ${d} m | ${r.shots} | ${pct(r.hitRate)} | ${r.zones.head} / ${r.zones.body} / ${r.zones.leg} | ` +
        `${pct(r.headShare)} | ${pct(targets[i]!)} | ${r.damagePerMin.toFixed(0)}`,
      );
    }
    lines.push(`${anchors[i]} | **10-20 m pooled** | | | ${hits} hits | **${pct(hits > 0 ? head / hits : 0)}** | ${pct(targets[i]!)} |`);
  }
  lines.push('');
  lines.push(`Damage per minute at dial ${dial}: a Sweep strafing Echo, aimed (mind skill ${dial}) vs the dial's rolled shots (pHit ${axes(dial).enemyHitChance.toFixed(3)} at standstill)`);
  lines.push('player | distance | model | shots | hit rate | headshot share | dmg/min');
  for (const still of [true, false]) {
    for (const d of [10, 20]) {
      for (const mind of [dial, null] as const) {
        const r = calibrate({ mindSkill: mind, dial, distanceM: d, seconds, seeds, strafe: true, still });
        lines.push(
          `${still ? 'still' : 'moving bot'} | ${d} m | ${mind === null ? 'rolled (pHit)' : 'aimed'} | ${r.shots} | ${pct(r.hitRate)} | ` +
          `${pct(r.headShare)} | ${r.damagePerMin.toFixed(0)}`,
        );
      }
    }
  }
  return lines;
}
