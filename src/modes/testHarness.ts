import { EventBus } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import { cloneTunables, type Tunables } from '../config/tunables';
import type {
  AnchorLike, AxisValues, DialSource, ModeEvents, PlayerSourceEvents, SourceEvents, StrafeSpawn, TargetSpawner, WeaponSourceEvents,
} from './contracts';
import { createLinearDial, type AxisRange } from './linearDial';
import { ModeRunner } from './runner';
import { TEST_MODE_AXES } from './testMode';

/** `shotFired` as a test may emit it: the framework's fields, plus the weapon fields only Spray Wall reads. */
type HarnessSourceEvents = Omit<SourceEvents, 'shotFired'> & { shotFired: SourceEvents['shotFired'] & Partial<WeaponSourceEvents['shotFired']> };

/** Test support: a runner wired to fake sim sides, with a JSON log of every event it emits. */
export interface Harness {
  bus: EventBus<ModeEvents & HarnessSourceEvents & PlayerSourceEvents & Omit<WeaponSourceEvents, 'shotFired'>>;
  runner: ModeRunner;
  tunables: Tunables;
  log: { type: string; data: Record<string, unknown> }[];
  targets: Map<number, { kind: string; pos: Vec3; scale: number; strafe?: StrafeSpawn; durable?: boolean }>;
  dialCalls: number[];
  /** Every `placePlayer` the mode asked for, in order (feet position and yaw). */
  placed: { x: number; y: number; z: number; yaw: number }[];
  simTick: number;
  player: { pos: Vec3; yaw: number; pitch: number; eyeHeight: number; vel: Vec3; crouching: boolean; grounded: boolean };
  step(n: number): void;
  kill(id: number, o?: Partial<SourceEvents['targetKilled']>): void;
  miss(): void;
  events(type: string): Record<string, unknown>[];
}

const EVENT_TYPES = [
  'runReady', 'runStarted', 'runEnded', 'beatStarted', 'skillTrial', 'scoreAwarded', 'chainUpdated', 'streakUpdated',
  'sprayStarted', 'sprayEnded',
] as const;

/** Rings of Post anchors (every `stepDeg` degrees) at several distances around the origin. */
export function ringAnchors(stepDeg = 30): AnchorLike[] {
  const out: AnchorLike[] = [];
  let i = 0;
  for (const r of [2, 6, 10, 15, 20, 30]) {
    for (let a = 0; a < 360; a += stepDeg) {
      const rad = (a * Math.PI) / 180;
      out.push({ id: `p${i++}`, kind: 'post', pos: vec3(Math.sin(rad) * r, 0, -Math.cos(rad) * r), tags: [`band-${r}`] });
    }
  }
  return out;
}

export function makeHarness(
  table: Record<string, AxisRange> = TEST_MODE_AXES, baseDial = 50, axesFor?: (dial: number) => AxisValues,
): Harness {
  const bus = new EventBus<ModeEvents & HarnessSourceEvents & PlayerSourceEvents & Omit<WeaponSourceEvents, 'shotFired'>>();
  const tunables = cloneTunables();
  const log: Harness['log'] = [];
  const targets: Harness['targets'] = new Map();
  let nextId = 1;
  const spawner: TargetSpawner = {
    spawn(kind, pos, scale, strafe, durable) {
      const id = nextId++;
      targets.set(id, { kind, pos: vec3(pos.x, pos.y, pos.z), scale, strafe: strafe && { ...strafe }, durable });
      return id;
    },
    despawn(id) {
      targets.delete(id);
    },
  };
  const inner = createLinearDial(table, baseDial);
  const dialCalls: number[] = [];
  const dial: DialSource = {
    dialFor(mode, beat, curve) {
      dialCalls.push(beat);
      return inner.dialFor(mode, beat, curve);
    },
    axes: (d) => (axesFor ? axesFor(d) : inner.axes(d)),
  };
  const player = { pos: vec3(0, 0, 0), yaw: 0, pitch: 0, eyeHeight: 1.62, vel: vec3(0, 0, 0), crouching: false, grounded: true };
  const placed: Harness['placed'] = [];
  const runner = new ModeRunner({
    events: bus, tunables, dial, spawner, player,
    placePlayer(x, y, z, yaw) {
      player.pos = vec3(x, y, z);
      player.yaw = yaw;
      player.pitch = 0;
      placed.push({ x, y, z, yaw });
    },
  });
  runner.attach(bus as never) // the fake bus types shotFired loosely so older tests may omit the weapon fields;
  for (const type of EVENT_TYPES) bus.on(type, (e) => log.push({ type, data: JSON.parse(JSON.stringify(e)) as Record<string, unknown> }));
  const h: Harness = {
    bus, runner, tunables, log, targets, dialCalls, placed, simTick: 0, player,
    step(n) {
      for (let i = 0; i < n; i++) {
        h.simTick++;
        runner.tick(h.simTick);
      }
    },
    kill(id, o = {}) {
      bus.emit('targetKilled', {
        tick: h.simTick, targetId: id, kind: 'post', zone: 'head', ttkMs: 400, rtMs: 250, firstBullet: true, bullets: 1, clean: true, ...o,
      });
    },
    miss() {
      bus.emit('shotImpact', { tick: h.simTick, onTarget: false });
    },
    events: (type) => log.filter((l) => l.type === type).map((l) => l.data),
  };
  return h;
}
