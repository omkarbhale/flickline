import { defineFeature } from '../app/feature';
import { RAD2DEG } from '../core/math';
import { Rng } from '../core/rng';
import { STREAM_DECISIONS, STREAM_PERSONALITY, streamSeed } from '../core/rngStreams';
import { createMindProfile, profileFor } from '../sim/mind/profile';
import { TICK_DT } from '../core/time';
import { memoryConfidence, PerceptionSystem, type Perceiver } from '../sim/perception';

/** What the debug hook reports about one enemy's perception (degrees, metres, seconds). */
export interface PerceiverReport {
  id: number;
  x: number;
  z: number;
  yawDeg: number;
  sees: boolean;
  inAttention: boolean;
  /** `SEEN_*` bits at the last decision: 1 eye, 2 chest, 4 left shoulder, 8 right shoulder. */
  visibleMask: number;
  contact: string;
  decisions: number;
  raysLast: number;
  heard: number;
  memory: { source: string; x: number; z: number; ageSec: number; confidence: number } | null;
  expect: { fromMemory: boolean; yawDeg: number; halfWidthDeg: number; confidence: number; windowOpenSec: number; windowCloseSec: number } | null;
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Enemy perception (#89) without enemy bodies: `perceiverAdd(x, z, yawDeg, skill)` stands an eye at
     * (`x`, `z`) looking along `yawDeg` (0 = down -Z, + = left) and returns its id; it then sees, hears,
     * remembers and shares like a mind-driven enemy will (field of view, rays, radii, memory).
     * `perceivers()` reports every one; `perceiverSector(id, yawDeg, halfWidthDeg)` aims its hold at a sector;
     * `perceiverPrime(id, x, z)` gives it a pre-filled belief; `perceiverRemove(id)` / `perceiversClear()`.
     */
    perceiverAdd(x: number, z: number, yawDeg: number, skill?: number): number;
    perceiverRemove(id: number): void;
    perceiversClear(): void;
    perceiverSector(id: number, yawDeg: number, halfWidthDeg: number): void;
    perceiverPrime(id: number, x: number, z: number): void;
    perceivers(): PerceiverReport[];
  }
}

function report(p: Perceiver, now: number, halfLifeSec: number): PerceiverReport {
  const m = p.memory;
  const e = p.expect;
  return {
    id: p.id, x: p.eye.x, z: p.eye.z, yawDeg: p.yaw * RAD2DEG, sees: p.sees, inAttention: p.inAttention,
    visibleMask: p.visibleMask, contact: p.contact, decisions: p.decisions, raysLast: p.raysLast, heard: p.heardCount,
    memory: m.valid
      ? { source: m.source, x: m.pos.x, z: m.pos.z, ageSec: now - m.stampSec, confidence: memoryConfidence(m, now, halfLifeSec) }
      : null,
    expect: e.active
      ? {
          fromMemory: e.fromMemory, yawDeg: e.yaw * RAD2DEG, halfWidthDeg: e.halfWidth * RAD2DEG, confidence: e.confidence,
          windowOpenSec: e.windowOpenSec, windowCloseSec: e.windowCloseSec,
        }
      : null,
  };
}

/**
 * Wires `sim/perception.ts` into the running game for the debug hook, the overlay and playtests. The
 * enemy bodies (#87) and minds (#91) will bind their own perceivers to this system; nothing here
 * draws or changes gameplay.
 */
export const feature = defineFeature({
  id: 'perception',
  stage: 'tools',
  setup(game) {
    const world = game.world;
    const sys = new PerceptionSystem(world.tunables, world.level.boxes, world.player, game.bus);
    sys.attach(game.bus);
    sys.setRadii(world.soundRadii);
    let nextId = 9000;
    const halfLife = world.tunables.mind.perception.memoryHalfLifeSec;

    game.onTick(() => {
      sys.setBoxes(world.level.boxes);
      sys.step(world.tick);
    });
    game.onReset(() => sys.reset());

    game.addOverlayLines(() => {
      if (sys.count === 0) return '';
      let seeing = 0, remembering = 0;
      const now = world.tick * TICK_DT;
      sys.each((p) => {
        if (p.sees) seeing++;
        else if (p.memory.valid && sys.confidenceAt(p, now) >= world.tunables.perception.memory.forgetBelow) remembering++;
      });
      return `perception ${sys.count} eyes · see ${seeing} · remember ${remembering} · rays ${sys.raysTotal}`;
    });
    game.addSnapshot('perception', () => {
      const out: PerceiverReport[] = [];
      const now = world.tick * TICK_DT;
      sys.each((p) => out.push(report(p, now, halfLife)));
      return out;
    });

    game.addDebug({
      perceiverAdd(x, z, yawDeg, skill = 50) {
        const id = nextId++;
        const rng = new Rng(streamSeed(world.seed, id, STREAM_DECISIONS));
        const p = sys.add(id, rng, profileFor(skill, new Rng(streamSeed(world.seed, id, STREAM_PERSONALITY)), createMindProfile(), world.tunables));
        if (p === null) return -1;
        p.eye.x = x; p.eye.y = world.tunables.movement.standEyeHeight; p.eye.z = z; p.yaw = yawDeg / RAD2DEG;
        return id;
      },
      perceiverRemove: (id) => sys.remove(id),
      perceiversClear: () => sys.reset(),
      perceiverSector(id, yawDeg, halfWidthDeg) {
        const p = sys.get(id);
        if (p) sys.setAttendedSector(p, yawDeg / RAD2DEG, halfWidthDeg / RAD2DEG);
      },
      perceiverPrime(id, x, z) {
        const p = sys.get(id);
        if (p) sys.prime(p, x, world.player.pos.y, z, world.tick * TICK_DT);
      },
      perceivers() {
        const out: PerceiverReport[] = [];
        const now = world.tick * TICK_DT;
        sys.each((p) => out.push(report(p, now, halfLife)));
        return out;
      },
    });
  },
});
