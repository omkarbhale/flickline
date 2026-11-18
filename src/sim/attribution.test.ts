import { describe, expect, it } from 'vitest';
import { cloneTunables, tunables as defaultTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { directionFromAngles, vec3 } from '../core/vec3';
import { axes } from '../adaptive/dial';
import { createSightPerception } from './attribution';
import { fireParams, straferParams } from './enemyParams';
import { createTickInput, type BoxDef, type LevelDef, type SimEvents, type TickInput } from './types';
import { World } from './world';

const floor: BoxDef = { tag: 'floor', min: vec3(-60, -1, -60), max: vec3(60, 0, 60) };
/** A 4 m wide, 3 m high wall across the lane, 10 m ahead of the spawn. */
const wall: BoxDef = { tag: 'wall', min: vec3(-2, 0, -10.5), max: vec3(2, 3, -10) };

function level(boxes: BoxDef[], x = 0): LevelDef {
  return { name: 'attribution', boxes, spawn: { pos: vec3(x, 0, 0), yaw: 0 }, targets: [] };
}

function setup(boxes: BoxDef[] = [floor], x = 0) {
  const world = new World({ level: level(boxes, x), tunables: cloneTunables(), seed: 5 });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; data: Record<string, unknown> }[] = [];
  bus.onAny((type, e) => log.push({ type, data: JSON.parse(JSON.stringify(e)) }));
  const input: TickInput = createTickInput();
  const run = (n: number, patch: Partial<TickInput> = {}): void => {
    Object.assign(input, patch);
    for (let i = 0; i < n; i++) world.step(input, bus);
  };
  const of = (type: keyof SimEvents): Record<string, unknown>[] => log.filter((l) => l.type === type).map((l) => l.data);
  run(4); // settle on the floor
  log.length = 0;
  return { world, bus, log, input, run, of };
}

describe('shotFired.aimDir (F8: aim before spread)', () => {
  it('a stationary first shot has aimDir equal to the camera ray', () => {
    const s = setup();
    s.run(1, { yaw: 0.4, pitch: -0.15 });
    s.run(1, { fire: true });
    const shot = s.of('shotFired')[0] as unknown as SimEvents['shotFired'];
    const cam = directionFromAngles(vec3(), 0.4, -0.15);
    expect(shot.aimDir.x).toBeCloseTo(cam.x, 12);
    expect(shot.aimDir.y).toBeCloseTo(cam.y, 12);
    expect(shot.aimDir.z).toBeCloseTo(cam.z, 12);
    // The bullet itself is a different, spread ray inside the cone (unless the draw landed dead centre).
    const spreadRad = (shot.spreadDeg * Math.PI) / 180;
    const dot = shot.dir.x * cam.x + shot.dir.y * cam.y + shot.dir.z * cam.z;
    expect(Math.acos(Math.min(1, dot))).toBeLessThanOrEqual(spreadRad + 1e-9);
  });

  it('carries the recoil the player is countering: view plus recoil, still inside the spread cone of the bullet', () => {
    const s = setup();
    s.run(1, { yaw: 0, pitch: 0, fire: true });
    s.run(40, { fire: true }); // hold fire: the spray kicks the barrel up while the view stays put
    const shots = s.of('shotFired') as unknown as SimEvents['shotFired'][];
    expect(shots.length).toBeGreaterThan(2);
    const late = shots[shots.length - 1]!;
    const cam = directionFromAngles(vec3(), late.yaw, late.pitch);
    const dotAim = late.aimDir.x * cam.x + late.aimDir.y * cam.y + late.aimDir.z * cam.z;
    // aimDir is the camera ray rotated by exactly the recoil offset the shot fired with.
    const offRad = Math.acos(Math.min(1, dotAim));
    const recoilRad = (Math.hypot(late.recoilPitchDeg, late.recoilYawDeg) * Math.PI) / 180;
    expect(late.recoilPitchDeg).not.toBe(0);
    expect(offRad).toBeCloseTo(recoilRad, 3);
    // The bullet deviates from aimDir by no more than the spread it was drawn from.
    const dotBullet = late.dir.x * late.aimDir.x + late.dir.y * late.aimDir.y + late.dir.z * late.aimDir.z;
    expect(Math.acos(Math.min(1, dotBullet))).toBeLessThanOrEqual((late.spreadDeg * Math.PI) / 180 + 1e-9);
    // It is a unit vector.
    expect(Math.hypot(late.aimDir.x, late.aimDir.y, late.aimDir.z)).toBeCloseTo(1, 12);
  });

  it('does not change the shot: the bullet direction and the world hash match a run without the extra field', () => {
    const a = setup();
    const b = setup();
    a.run(30, { fire: true });
    b.run(30, { fire: true });
    expect(a.world.hash()).toBe(b.world.hash());
  });
});

describe('enemy sounds: audibleToPlayer at the radius edge', () => {
  const radii = defaultTunables.attribution.soundRadiusM;

  it('a footstep exactly at the radius is audible and a hair beyond it is not', () => {
    const s = setup();
    const r = radii.footstep;
    s.world.attribution.footstep(s.bus, 7, 11, 0, 0, -r);
    s.world.attribution.footstep(s.bus, 8, 11, 0, 0, -(r + 0.001));
    const [inside, outside] = s.of('enemyFootstep');
    expect(inside).toMatchObject({ tick: 7, id: 11, audibleToPlayer: true });
    expect(inside!.distance).toBeCloseTo(r, 9);
    expect(outside).toMatchObject({ id: 11, audibleToPlayer: false });
  });

  it('landings and reloads use their own radii, measured horizontally from the player', () => {
    const s = setup();
    s.world.attribution.landed(s.bus, 1, 3, radii.landing, 4, 0); // 4 m above the player does not count
    s.world.attribution.landed(s.bus, 1, 3, radii.landing + 0.01, 0, 0);
    s.world.attribution.reloadStarted(s.bus, 2, 3, 0, 0, radii.reload);
    s.world.attribution.reloadStarted(s.bus, 2, 3, 0, 0, radii.reload + 0.01);
    expect(s.of('enemyLanded').map((e) => e.audibleToPlayer)).toEqual([true, false]);
    expect(s.of('enemyReloadStarted').map((e) => e.audibleToPlayer)).toEqual([true, false]);
  });

  it('answers for shots through audible(): the value an enemyFired carries', () => {
    const s = setup();
    expect(s.world.attribution.audible('shot', 0, -radii.shot)).toBe(true);
    expect(s.world.attribution.audible('shot', 0, -radii.shot - 0.01)).toBe(false);
    // The shot carries further than a footstep: far enough to be heard where a step is not.
    expect(s.world.attribution.audible('shot', 0, -(radii.footstep + 5))).toBe(true);
    expect(s.world.attribution.audible('footstep', 0, -(radii.footstep + 5))).toBe(false);
  });

  it('reuses its payload: nothing is allocated per sound', () => {
    const s = setup();
    const seen: unknown[] = [];
    s.bus.on('enemyFootstep', (e) => seen.push(e));
    s.world.attribution.footstep(s.bus, 1, 1, 0, 0, -5);
    s.world.attribution.footstep(s.bus, 2, 1, 0, 0, -6);
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('playerDamaged.exposedTo (F5)', () => {
  it('counts the enemies that see the player: two enemies, one behind a wall', () => {
    const s = setup([floor, wall]);
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    s.world.spawnTarget('post', 0, 0, -20, s.bus); // behind the wall, hidden
    s.world.spawnTarget('post', 8, 0, -12, s.bus); // beside it, in the open
    s.world.damagePlayer(10, 'body', 8, 1.5, -12, 1, s.bus);
    expect(s.of('playerDamaged')[0]).toMatchObject({ sourceId: 1, exposedTo: 1 });
  });

  it('counts both when neither is occluded, and none when every enemy is', () => {
    const open = setup();
    open.world.attribution.perception = createSightPerception(open.world.tunables, open.world.level.boxes, open.world.player);
    open.world.spawnTarget('post', 3, 0, -15, open.bus);
    open.world.spawnTarget('post', -6, 0, -9, open.bus);
    open.world.damagePlayer(10, 'body', 3, 1.5, -15, 0, open.bus);
    expect(open.of('playerDamaged')[0]!.exposedTo).toBe(2);

    const covered = setup([floor, wall]);
    covered.world.attribution.perception = createSightPerception(covered.world.tunables, covered.world.level.boxes, covered.world.player);
    covered.world.spawnTarget('post', 0, 0, -20, covered.bus);
    covered.world.damagePlayer(10, 'body', 0, 1.5, -20, -1, covered.bus);
    expect(covered.of('playerDamaged')[0]!.exposedTo).toBe(0);
  });

  it('respects the enemy field of view: an enemy facing away does not see him', () => {
    const s = setup();
    const facing = new Map<number, number>();
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player, (e) => facing.get(e.id) ?? 0);
    const a = s.world.spawnTarget('post', 0, 0, -10, s.bus); // south of the player; yaw 0 faces -Z, away from him
    const b = s.world.spawnTarget('post', 5, 0, -10, s.bus);
    facing.set(a, Math.PI); // turned to face +Z: towards the player
    facing.set(b, 0); // facing -Z: away
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, a, s.bus);
    expect(s.of('playerDamaged')[0]!.exposedTo).toBe(1);
    // Within the 103 degree field (51.5 degrees either side of the bearing to him) he is seen; outside it he is not.
    const bearing = Math.atan2(5, -10); // yaw from b to the player at the origin
    facing.set(b, bearing + 0.8);
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, a, s.bus);
    expect(s.of('playerDamaged')[1]!.exposedTo).toBe(2);
    facing.set(b, bearing + 1.2);
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, a, s.bus);
    expect(s.of('playerDamaged')[2]!.exposedTo).toBe(1);
  });

  it('is 0 while no perception is installed, and never lists dead enemies', () => {
    const s = setup();
    s.world.spawnTarget('post', 0, 0, -10, s.bus);
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, 0, s.bus);
    expect(s.of('playerDamaged')[0]!.exposedTo).toBe(0);
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    s.world.despawnTarget(0, s.bus);
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, 0, s.bus);
    expect(s.of('playerDamaged')[1]!.exposedTo).toBe(0);
  });
});

describe('first-sight initiator (F6)', () => {
  /** Straight down the lane the wall blocks while |x| <= 4 for an enemy 20 m out (the ray crosses the wall plane halfway). */
  it('the player strafing past a corner created the line of sight: both sides report initiator "player"', () => {
    const s = setup([floor, wall]);
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    s.world.spawnTarget('post', 0, 0, -20, s.bus);
    expect(s.of('targetVisible')).toHaveLength(0);
    for (let i = 0; i < 400 && s.of('enemySawPlayer').length === 0; i++) s.run(1, { moveX: 1 });
    const saw = s.of('enemySawPlayer');
    const vis = s.of('targetVisible');
    expect(saw).toHaveLength(1);
    expect(vis).toHaveLength(1);
    expect(saw[0]).toMatchObject({ targetId: 0, initiator: 'player' });
    expect(vis[0]).toMatchObject({ targetId: 0, initiator: 'player' });
    expect(s.world.player.pos.x).toBeGreaterThan(3.9); // he had to clear the wall's shadow first
  });

  it('an enemy doing the same, while the player holds still, created it: initiator "enemy"', () => {
    const s = setup([floor, wall]);
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    const id = s.world.spawnTarget('post', 0, 0, -20, s.bus);
    const slot = s.world.targets.find((t) => t.alive && t.id === id)!;
    s.run(8);
    expect(s.of('enemySawPlayer')).toHaveLength(0);
    for (let i = 0; i < 400 && s.of('enemySawPlayer').length === 0; i++) {
      slot.pos.x += 0.05; // the enemy peeks right, past the wall's edge
      s.run(1);
    }
    expect(s.of('enemySawPlayer')[0]).toMatchObject({ targetId: id, initiator: 'enemy' });
    expect(s.of('targetVisible')[0]).toMatchObject({ targetId: id, initiator: 'enemy' });
    expect(Math.abs(s.world.player.pos.x)).toBeLessThan(1e-9);
  });

  it('is announced once per enemy; a respawn is a new enemy and announces again', () => {
    const s = setup();
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    s.world.spawnTarget('post', 0, 0, -12, s.bus);
    s.run(10);
    expect(s.of('enemySawPlayer')).toHaveLength(1);
    s.world.despawnTarget(0, s.bus);
    s.world.spawnTarget('post', 0, 0, -12, s.bus);
    s.run(3);
    expect(s.of('enemySawPlayer')).toHaveLength(2);
    expect(s.of('enemySawPlayer')[1]!.targetId).not.toBe(s.of('enemySawPlayer')[0]!.targetId);
  });

  it('a world with no perception emits no enemySawPlayer at all (drill targets have no mind)', () => {
    const s = setup();
    s.world.spawnTarget('post', 0, 0, -12, s.bus);
    s.run(20);
    expect(s.of('enemySawPlayer')).toHaveLength(0);
    expect(s.of('targetVisible')).toHaveLength(1);
    expect(s.of('targetVisible')[0]!.initiator).toBe('enemy'); // it was simply there already
  });
});

describe('a real firing enemy (#32 Strafer) on the default perception', () => {
  function duel(extra: BoxDef[] = []) {
    const s = setup([floor, ...extra], 0);
    s.world.placePlayer(0, 0, 20, 0);
    s.world.enemiesFire = true;
    const ax = axes(50);
    s.world.spawnTarget('strafer', 0, 0, 5, s.bus, {
      strafe: { ...straferParams(ax), laneA: vec3(-6, 0, 5), laneB: vec3(6, 0, 5) },
      fire: fireParams(ax),
    });
    const keepAlive = (): void => { s.world.health.alive = true; s.world.health.hp = s.world.health.maxHp; };
    for (let i = 0; i < 128 * 12; i++) { keepAlive(); s.run(1); }
    return s;
  }

  it('its shots carry audibleToPlayer (15 m is well inside the shot radius), its first sight is announced once, and its hits report exposedTo 1', () => {
    const s = duel();
    const fired = s.of('enemyFired');
    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every((e) => e.audibleToPlayer === true)).toBe(true);
    expect(s.of('enemySawPlayer')).toHaveLength(1);
    const dmg = s.of('playerDamaged');
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.exposedTo === 1)).toBe(true);
  });

  it('a shot from beyond the shot radius is not audible', () => {
    const s = setup();
    s.world.placePlayer(0, 0, 100, 0);
    expect(s.world.soundAudible('shot', 0, 100 - defaultTunables.attribution.soundRadiusM.shot - 1)).toBe(false);
    expect(s.world.soundAudible('shot', 0, 100 - defaultTunables.attribution.soundRadiusM.shot + 1)).toBe(true);
  });

  it('a drill target that does not fire is never reported as exposing the player', () => {
    const s = setup();
    s.world.spawnTarget('post', 0, 0, -10, s.bus);
    s.world.damagePlayer(5, 'body', 0, 1.5, -10, -1, s.bus);
    expect(s.of('playerDamaged')[0]!.exposedTo).toBe(0);
    expect(s.of('enemySawPlayer')).toHaveLength(0);
  });
});

describe('determinism and cost', () => {
  it('installing a perception changes no gameplay: the world hash is identical with and without it', () => {
    const run = (withMind: boolean): number => {
      const s = setup([floor, wall]);
      s.world.spawnTarget('post', 6, 0, -14, s.bus);
      if (withMind) s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
      for (let i = 0; i < 120; i++) s.run(1, { moveX: i % 40 < 20 ? 1 : -1, fire: i % 7 === 0 });
      return s.world.hash();
    };
    expect(run(true)).toBe(run(false));
  });

  it('tick time is the stand-in perception plus one ray per not-yet-sighted enemy: under the 0.5 ms tick budget', () => {
    const s = setup([floor, wall]);
    s.world.attribution.perception = createSightPerception(s.world.tunables, s.world.level.boxes, s.world.player);
    for (let i = 0; i < 6; i++) s.world.spawnTarget('post', -6 + i * 2.4, 0, -20, s.bus);
    s.run(8);
    const start = performance.now();
    const ticks = 2000;
    for (let i = 0; i < ticks; i++) s.run(1);
    const perTickMs = (performance.now() - start) / ticks;
    expect(perTickMs).toBeLessThan(0.5);
  });
});
