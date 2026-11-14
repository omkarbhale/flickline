import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { createExpectedHead, expectedHead } from './headHeight';
import { createTickInput, type BoxDef, type LevelDef, type SimEvents } from './types';
import { World } from './world';

const floor: BoxDef = { tag: 'floor', min: vec3(-40, -1, -40), max: vec3(40, 0, 40) };
const deck: BoxDef = { tag: 'platform', min: vec3(-10, 0, -38), max: vec3(10, 3, -12) }; // a 3 m deck to the north

function level(enemyFeet?: ReturnType<typeof vec3>[]): LevelDef {
  return { name: 'h', boxes: [floor, deck], spawn: { pos: vec3(0, 0, 0), yaw: 0 }, targets: [], enemyFeet };
}

describe('expected head height', () => {
  const t = cloneTunables();
  const head = t.targets.hit.headCentreStand;
  const out = createExpectedHead();

  function player(world: World, x: number, y: number, z: number, yaw = 0) {
    const p = world.player;
    p.pos.x = x; p.pos.y = y; p.pos.z = z; p.yaw = yaw;
    return p;
  }

  it('without anchors it uses the floor the reference distance ahead (flat ground: the old definition)', () => {
    const w = new World({ level: { ...level(), boxes: [floor] }, tunables: t, seed: 1 });
    expectedHead(out, w.level, player(w, 0, 0, 0), t.run, head);
    expect(out.headY).toBeCloseTo(head, 9);
    expect(out.dist).toBe(t.run.headHeightRefDistance);
  });

  it('on a raised floor the head is measured from that floor, not from y = 0', () => {
    const w = new World({ level: level(), tunables: t, seed: 1 });
    // standing on the deck (y = 3) looking north along it: the floor 10 m ahead is the deck
    expectedHead(out, w.level, player(w, 0, 3, -15), t.run, head);
    expect(out.headY).toBeCloseTo(3 + head, 9);
  });

  it('looking from the deck out over the edge, the expected enemy stands on the lower floor', () => {
    const w = new World({ level: level(), tunables: t, seed: 1 });
    // at the deck's south edge (z = -12.5) looking south (yaw = pi): 10 m ahead is the floor at y = 0
    expectedHead(out, w.level, player(w, 0, 3, -12.5, Math.PI), t.run, head);
    expect(out.headY).toBeCloseTo(head, 9);
  });

  it('prefers the enemy anchor the player is facing, at its own floor height and distance', () => {
    const feet = [vec3(2, 3, -25), vec3(0, 0, 20), vec3(-15, 0, 0)];
    const w = new World({ level: level(feet), tunables: t, seed: 1 });
    // at the origin facing north: the deck anchor (distance ~25) is inside the 30 deg cone, the others are not
    expectedHead(out, w.level, player(w, 0, 0, 0, 0), t.run, head);
    expect(out.headY).toBeCloseTo(3 + head, 9);
    expect(out.dist).toBeCloseTo(Math.hypot(2, 25), 9);
    // facing south it is the anchor behind
    expectedHead(out, w.level, player(w, 0, 0, 0, Math.PI), t.run, head);
    expect(out.headY).toBeCloseTo(head, 9);
    expect(out.dist).toBeCloseTo(20, 9);
    // facing east: nothing within the cone, so the floor-ahead fallback (flat here)
    expectedHead(out, w.level, player(w, 0, 0, 0, -Math.PI / 2), t.run, head);
    expect(out.dist).toBe(t.run.headHeightRefDistance);
  });

  it('ignores anchors that are too close or too far away', () => {
    const w = new World({ level: level([vec3(0, 3, -1), vec3(0, 3, -49)]), tunables: t, seed: 1 });
    expectedHead(out, w.level, player(w, 0, 0, 0), t.run, head);
    expect(out.dist).toBe(t.run.headHeightRefDistance);
  });
});

describe('headHeightSampled on a raised floor', () => {
  it('reads (almost) zero error for a player holding the crosshair at the head height of the enemy ahead', () => {
    const t = cloneTunables();
    const feet = [vec3(0, 3, -25)];
    const w = new World({ level: level(feet), tunables: t, seed: 1 });
    const bus = new EventBus<SimEvents>();
    const errs: number[] = [];
    bus.on('headHeightSampled', (e) => errs.push(e.err));
    const input = createTickInput();
    // Standing on the deck at z = -14, the enemy anchor is 11 m ahead on the same deck; aim at its head centre.
    w.player.pos.x = 0; w.player.pos.y = 3; w.player.pos.z = -14;
    const eye = 3 + t.movement.standEyeHeight;
    const pitch = Math.atan2(3 + t.targets.hit.headCentreStand - eye, 11);
    input.yaw = 0;
    input.pitch = pitch;
    input.moveX = 1; // moving sideways at run speed so samples are taken
    for (let i = 0; i < TICK_RATE; i++) w.step(input, bus);
    expect(errs.length).toBeGreaterThan(3);
    // lateral drift changes the distance slightly; the error stays tiny, and far below the old eye-level bug (several degrees)
    expect(Math.max(...errs) / DEG2RAD).toBeLessThan(0.7);

    // The same aim on flat ground would be wrong by ~16 degrees against a head 3 m up: confirm the old frame of reference is gone.
    expect(Math.atan2(3 + t.targets.hit.headCentreStand - 1.62, 11)).toBeGreaterThan(0.2);
  });
});
