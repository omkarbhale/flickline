import type { Vec3 } from '../core/vec3';
import { vec3 } from '../core/vec3';

/**
 * The busiest moment of a Sweep fight as a scripted event stream (design 4.8, 5.3), for the mix
 * check: a Kestrel full-auto spray at its real fire rate that hits on most bullets (body, head,
 * leg), kills every third hit and so builds a chain and a clean streak, three enemies telling and
 * firing bursts (one hit, one near miss each) from different bearings, the player taking damage,
 * own and enemy footsteps, and a Surge and a medal on top. Every sound source in the game is
 * sounding at once. Pure data: `audio/probe.ts` replays it through the real event wiring and the
 * real audio graph.
 */

export interface ScenarioEvent {
  /** Seconds from the start of the scenario. */
  t: number;
  type: string;
  payload: unknown;
}

export interface Scenario {
  events: ScenarioEvent[];
  /** Times of every `targetHit` (the moments the hit cue must not be masked). */
  hitTimes: number[];
  /** The zone of each hit in `hitTimes` order. */
  hitZones: string[];
  durationSec: number;
  /** Where each enemy id speaks from. */
  enemies: Record<number, Vec3>;
  /** The player's eye. */
  eye: Vec3;
}

export interface ScenarioOptions {
  fireRateHz: number;
  seconds: number;
}

const v = (x: number, y: number, z: number): Vec3 => vec3(x, y, z);
const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z);
  return v(x / n, y / n, z / n);
};

export function busiestSweepMoment(o: ScenarioOptions): Scenario {
  const eye = v(0, 1.6, 0);
  const enemies: Record<number, Vec3> = { 1: v(-6, 1.3, -10), 2: v(4, 1.3, -14), 3: v(10, 1.3, -6) };
  const events: ScenarioEvent[] = [];
  const hitTimes: number[] = [];
  const hitZones: string[] = [];
  const t0 = 0.1;
  let tick = 0;
  const at = (t: number, type: string, payload: unknown): void => {
    events.push({ t, type, payload });
  };
  const base = { origin: eye, dir: v(0, 0, -1), speed: 0, airborne: false, crouching: false, spreadDeg: 0.3, recoilIndex: 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: 20, yaw: 0, pitch: 0, aimTargetId: -1, aimErr: 0, aimDYaw: 0, aimDPitch: 0 };

  at(t0, 'runStarted', { tick });
  at(t0 + 0.4, 'surgeStarted', { tick });
  at(t0 + 1.4, 'medalAwarded', { tick, id: 'quickDraw' });

  // The spray.
  let hits = 0;
  let chain = 0;
  let streak = 0;
  for (let i = 0, ts = t0; ts < t0 + o.seconds; i++, ts = t0 + i / o.fireRateHz) {
    tick++;
    at(ts, 'shotFired', { ...base, tick, t: ts, shotId: i, weapon: 'kestrel', moving: i >= 10 && i < 22 });
    const onTarget = i % 6 !== 5;
    at(ts, 'shotImpact', { tick, t: ts, shotId: i, result: onTarget ? 'hit' : 'miss', targetId: onTarget ? 1 : -1, zone: onTarget ? 'body' : null, damage: onTarget ? 20 : 0, killed: false, point: v(0, 1.5, -12), normal: v(0, 0, 1), onTarget, distance: 12 });
    if (!onTarget) {
      streak = 0;
      at(ts, 'streakUpdated', { tick, t: ts, streak, mult: 1 });
      continue;
    }
    const zone = i % 5 === 0 ? 'head' : i % 7 === 0 ? 'leg' : 'body';
    hits++;
    const killed = hits % 3 === 0;
    hitTimes.push(ts);
    hitZones.push(zone);
    at(ts, 'targetHit', { tick, t: ts, targetId: 1, kind: 'strafer', zone, point: v(0, 1.5, -12), damage: 20, hpLeft: killed ? 0 : 40, distance: 12, killed });
    if (killed) {
      chain++;
      streak++;
      at(ts, 'chainUpdated', { tick, t: ts, count: chain });
      at(ts, 'streakUpdated', { tick, t: ts, streak, mult: 1 + streak * 0.1 });
      at(ts, 'targetKilled', { tick, t: ts, targetId: 1, kind: 'strafer', zone, point: v(0, 1.5, -12), distance: 12, ttkMs: 300, rtMs: 200, firstBullet: false, bullets: 3, clean: true });
    }
  }

  // Three enemies tell and fire: the tell, then a burst of two (the first hits, the second passes the head).
  const tells = [{ id: 1, at: 0.2, ms: 300, side: 1 }, { id: 2, at: 0.8, ms: 250, side: -1 }, { id: 3, at: 1.5, ms: 180, side: 1 }];
  for (const e of tells) {
    const ts = t0 + e.at;
    const p = enemies[e.id]!;
    tick++;
    at(ts, 'enemyTell', { tick, id: e.id, durationMs: e.ms });
    const fire = ts + e.ms / 1000;
    const toHead = unit(eye.x - p.x, eye.y - p.y, eye.z - p.z);
    at(fire, 'enemyFired', { tick, id: e.id, hit: true, dir: toHead });
    at(fire, 'playerDamaged', { tick, t: fire, amount: 26, hp: 74, maxHp: 100, zone: 'body', dir: v(0, 0, -1), yaw: 0, sourceId: e.id, killed: false });
    const miss = unit(eye.x - p.x + e.side * 0.5, eye.y - p.y, eye.z - p.z);
    at(fire + 0.09, 'enemyFired', { tick, id: e.id, hit: false, dir: miss });
  }

  // Footsteps: own at a 2.2 m stride at ~6 m/s; enemies at their own stride.
  for (let ts = t0 + 0.1; ts < t0 + o.seconds; ts += 0.37) at(ts, 'footstep', { tick, crouching: false, walking: false });
  for (let ts = t0 + 0.05; ts < t0 + o.seconds; ts += 0.3) {
    for (const id of [1, 2, 3]) at(ts + id * 0.01, '__enemyFootstep', { id });
  }
  events.sort((a, b) => a.t - b.t);
  return { events, hitTimes, hitZones, durationSec: t0 + o.seconds + 0.5, enemies, eye };
}
