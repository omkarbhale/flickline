import { describe, expect, it } from 'vitest';
import { cloneTunables, type Tunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { DEG2RAD } from '../core/math';
import { TICK_DT, TICK_RATE } from '../core/time';
import { testRoom } from './levels';
import { tagSpeedScale, tagTotalSec, yawFrameDirection } from './playerHealth';
import { createTickInput, type SimEvents, type TickInput } from './types';
import { World } from './world';

function setup(patch?: (t: Tunables) => void, seed = 1) {
  const tun = cloneTunables();
  patch?.(tun);
  const world = new World({ level: testRoom, tunables: tun, seed });
  const bus = new EventBus<SimEvents>();
  const log: { type: keyof SimEvents; tick: number; data: unknown }[] = [];
  bus.onAny((type, e) => log.push({ type, tick: world.tick, data: JSON.parse(JSON.stringify(e)) }));
  const input = createTickInput();
  const run = (n: number, patchInput: Partial<TickInput> = {}): void => {
    Object.assign(input, patchInput);
    input.yaw = world.player.yaw;
    for (let i = 0; i < n; i++) {
      world.step(input, bus);
      input.jump = false;
    }
  };
  const all = <K extends keyof SimEvents>(t: K): SimEvents[K][] =>
    log.filter((l) => l.type === t).map((l) => l.data as SimEvents[K]);
  run(4); // settle on the floor
  log.length = 0;
  const eye = (): { x: number; y: number; z: number } => ({
    x: world.player.pos.x, y: world.player.pos.y + world.player.eyeHeight, z: world.player.pos.z,
  });
  /** A hit from a shooter `dist` metres ahead of the player's eye. */
  const hitFromAhead = (amount: number, zone: 'head' | 'body' | 'leg' = 'body', dist = 10): boolean => {
    const e = eye();
    return world.damagePlayer(amount, zone, e.x, e.y, e.z - dist, 7, bus);
  };
  return { world, bus, log, input, run, all, tun, eye, hitFromAhead };
}

describe('player health (spec §4.1, §7.1)', () => {
  it('starts at health.max 100 with no armour', () => {
    const { world, tun } = setup();
    expect(tun.player.health.max).toBe(100);
    expect(world.health.hp).toBe(100);
    expect(world.health.maxHp).toBe(100);
    expect(world.health.alive).toBe(true);
  });

  it('takes damage by zone and range from the weapon tables (spec §3.2 / §7.4)', () => {
    const { world, tun, eye, log } = setup();
    const e = eye();
    // Kestrel (rifle_spray) at 10 m: body 39, leg 33.15, head 156. At 30 m: body 35.
    world.hitPlayer('kestrel', 'body', e.x, e.y, e.z - 10, 1, new EventBus<SimEvents>());
    expect(world.health.hp).toBeCloseTo(100 - 39, 9);
    world.reset();
    world.hitPlayer('kestrel', 'leg', e.x, e.y, e.z - 10, 1, new EventBus<SimEvents>());
    expect(world.health.hp).toBeCloseTo(100 - 33.15, 9);
    world.reset();
    world.hitPlayer('kestrel', 'body', e.x, e.y, e.z - 30, 1, new EventBus<SimEvents>());
    expect(world.health.hp).toBeCloseTo(100 - 35, 9);
    world.reset();
    // Pace (pistol_accurate): body 30 at range, a headshot 105 kills outright.
    expect(world.hitPlayer('pace', 'head', e.x, e.y, e.z - 10, 1, new EventBus<SimEvents>())).toBe(true);
    expect(tun.weapon.pace.damageBands[0]!.head).toBe(105);
    expect(log.length).toBe(0); // those went to a throwaway bus
  });

  it('kills in the spec bullet counts: Kestrel 3 body bullets or 1 headshot', () => {
    const { world, eye, bus } = setup();
    const e = eye();
    expect(world.hitPlayer('kestrel', 'body', e.x, e.y, e.z - 10, 1, bus)).toBe(false);
    expect(world.hitPlayer('kestrel', 'body', e.x, e.y, e.z - 10, 1, bus)).toBe(false);
    expect(world.hitPlayer('kestrel', 'body', e.x, e.y, e.z - 10, 1, bus)).toBe(true);
    expect(world.health.alive).toBe(false);
    expect(world.health.hp).toBe(0);
  });

  it('emits playerDamaged with amount, hp, zone and source, and playerSlowed with the tag numbers', () => {
    const { all, hitFromAhead, tun } = setup();
    hitFromAhead(39, 'body');
    const d = all('playerDamaged');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ amount: 39, hp: 61, maxHp: 100, zone: 'body', sourceId: 7, killed: false });
    const s = all('playerSlowed');
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ factor: tun.player.tag.speedScale, durationMs: tagTotalSec(tun.player.tag) * 1000 });
    expect(all('playerDied')).toHaveLength(0);
  });

  it('ignores zero and negative damage', () => {
    const { world, all, hitFromAhead } = setup();
    hitFromAhead(0);
    hitFromAhead(-5);
    expect(world.health.hp).toBe(100);
    expect(all('playerDamaged')).toHaveLength(0);
  });

  it('dies once: playerDied, alive false, hp clamped to 0, later hits ignored', () => {
    const { world, all, hitFromAhead } = setup();
    expect(hitFromAhead(60)).toBe(false);
    expect(hitFromAhead(60)).toBe(true);
    expect(hitFromAhead(60)).toBe(false);
    expect(world.health.hp).toBe(0);
    expect(world.health.alive).toBe(false);
    expect(all('playerDied')).toHaveLength(1);
    const dmg = all('playerDamaged');
    expect(dmg).toHaveLength(2);
    expect(dmg[1]!.killed).toBe(true);
    expect(dmg[1]!.amount).toBe(40); // only the HP that was left
  });

  it('a dead world freezes (no tick, no state change) until reset restores full health', () => {
    const { world, run, hitFromAhead, bus } = setup();
    run(10, { moveZ: 1 });
    hitFromAhead(1000);
    const h = world.hash();
    const tick = world.tick;
    run(50, { moveZ: 1, fire: true });
    expect(world.tick).toBe(tick);
    expect(world.hash()).toBe(h);
    world.reset();
    expect(world.health.alive).toBe(true);
    expect(world.health.hp).toBe(100);
    expect(world.player.tagScale).toBe(1);
    expect(world.player.aimPunch).toBe(0);
    world.step(createTickInput(), bus);
    expect(world.tick).toBe(1);
  });
});

describe('damage direction in the player yaw frame', () => {
  const dirFor = (yawDeg: number, sx: number, sz: number): { x: number; y: number; z: number } => {
    const { world, all, bus } = setup();
    world.player.yaw = yawDeg * DEG2RAD;
    const p = world.player;
    world.damagePlayer(10, 'body', p.pos.x + sx, p.pos.y + p.eyeHeight, p.pos.z + sz, 1, bus);
    return all('playerDamaged')[0]!.dir;
  };

  it('ahead is -Z, right is +X, behind is +Z, left is -X (yaw 0)', () => {
    expect(dirFor(0, 0, -5)).toMatchObject({ x: 0, y: 0, z: -1 });
    const right = dirFor(0, 5, 0);
    expect(right.x).toBeCloseTo(1, 9);
    expect(right.z).toBeCloseTo(0, 9);
    expect(dirFor(0, 0, 5).z).toBeCloseTo(1, 9);
    expect(dirFor(0, -5, 0).x).toBeCloseTo(-1, 9);
  });

  it('turning the view moves the same world shooter around the frame', () => {
    // Shooter dead ahead in the world (-Z). Turn left 90 deg (yaw +): it is now on the right.
    const d = dirFor(90, 0, -5);
    expect(d.x).toBeCloseTo(1, 9);
    expect(d.z).toBeCloseTo(0, 9);
    // Turn right 90 deg (yaw -): it is on the left.
    expect(dirFor(-90, 0, -5).x).toBeCloseTo(-1, 9);
    // Turn around: it is behind.
    expect(dirFor(180, 0, -5).z).toBeCloseTo(1, 9);
  });

  it('is a unit vector and carries the vertical component; a shooter on top of the eye points ahead', () => {
    const { world } = setup();
    const out = { x: 0, y: 0, z: 0 };
    const p = world.player;
    yawFrameDirection(out, p, p.pos.x + 3, p.pos.y + p.eyeHeight + 4, p.pos.z);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(0.8, 9);
    yawFrameDirection(out, p, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
    expect(out).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('records the player yaw at the hit so a presenter can keep the arc on the shooter', () => {
    const { world, all, bus } = setup();
    world.player.yaw = 0.7;
    world.damagePlayer(5, 'leg', 0, 0, 0, 1, bus);
    expect(all('playerDamaged')[0]!.yaw).toBeCloseTo(0.7, 12);
  });
});

describe('tagging (spec §4.3)', () => {
  const horizSpeed = (w: World): number => Math.hypot(w.player.vel.x, w.player.vel.z);

  it('the numbers are the spec ones: 0.275 cap, 0.10 s ramp-in, 0.5 s release', () => {
    const { tun } = setup();
    expect(tun.player.tag).toEqual({ speedScale: 0.275, rampInSec: 0.1, releaseSec: 0.5 });
  });

  it('tagSpeedScale: ramps in over ramp_in, holds while hits continue, returns over release', () => {
    const tag = cloneTunables().player.tag;
    expect(tagSpeedScale(tag, Infinity, 0)).toBe(1);
    expect(tagSpeedScale(tag, 0, 0)).toBe(1); // the instant of the hit: the ramp has not started
    expect(tagSpeedScale(tag, 0.05, 0.5)).toBeCloseTo(1 - 0.5 * 0.725, 9); // half way up the ramp
    expect(tagSpeedScale(tag, 0.1, 1)).toBeCloseTo(0.275, 12); // ramp complete: the full cap
    expect(tagSpeedScale(tag, 0.35, 1)).toBeCloseTo(1 - 0.5 * 0.725, 9); // halfway through the release
    expect(tagSpeedScale(tag, 0.6, 1)).toBe(1); // gone: ramp_in + release after the last hit
    expect(tagTotalSec(tag)).toBeCloseTo(0.6, 12);
  });

  it('a hit caps a full run at 27.5% of max speed, then the speed comes back', () => {
    const { world, run, hitFromAhead, tun } = setup();
    run(TICK_RATE, { moveZ: 1 });
    const max = world.maxSpeed();
    expect(horizSpeed(world)).toBeCloseTo(max, 3);
    hitFromAhead(10);
    // The ramp-in takes 0.10 s: right after it the player is on the cap (a single hit reaches it).
    run(Math.ceil(0.1 * TICK_RATE), { moveZ: 1 });
    expect(horizSpeed(world)).toBeCloseTo(max * tun.player.tag.speedScale, 1);
    // Never below the cap while the slow lasts.
    let lowest = Infinity;
    for (let i = 0; i < 0.2 * TICK_RATE; i++) {
      run(1, { moveZ: 1 });
      lowest = Math.min(lowest, horizSpeed(world));
    }
    expect(lowest).toBeGreaterThanOrEqual(max * tun.player.tag.speedScale * 0.999);
    // The slow is gone ramp_in + release after the hit, and the run speed comes back.
    run(Math.round(0.8 * TICK_RATE), { moveZ: 1 });
    expect(horizSpeed(world)).toBeCloseTo(max, 3);
    expect(world.player.tagScale).toBe(1);
  });

  it('is at the full cap while hits keep coming (each hit refreshes the release)', () => {
    const { world, run, hitFromAhead, tun } = setup();
    run(TICK_RATE, { moveZ: 1 });
    const cap = world.maxSpeed() * tun.player.tag.speedScale;
    for (let i = 0; i < 12; i++) {
      hitFromAhead(1);
      run(Math.round(0.07 * TICK_RATE), { moveZ: 1 }); // ~ a rifle's fire interval
    }
    expect(horizSpeed(world)).toBeCloseTo(cap, 2);
    // ramp_in + release (0.6 s) after the last hit it is gone.
    run(Math.round(0.7 * TICK_RATE), { moveZ: 1 });
    expect(world.player.tagScale).toBe(1);
  });

  it('applies to airborne players too (horizontal speed only)', () => {
    const { world, run, hitFromAhead } = setup();
    run(TICK_RATE, { moveZ: 1 });
    run(1, { moveZ: 1, jump: true });
    expect(world.player.grounded).toBe(false);
    const vy = world.player.vel.y;
    hitFromAhead(10);
    run(Math.round(0.12 * TICK_RATE), { moveZ: 1 });
    expect(horizSpeed(world)).toBeLessThanOrEqual(world.maxSpeed() * 0.5);
    expect(world.player.vel.y).toBeLessThan(vy); // gravity still acts, the slow is horizontal
  });

  it('the tag constants are tunables: a different speed_scale changes the cap', () => {
    const { world, run, hitFromAhead } = setup((t) => { t.player.tag.speedScale = 0.5; });
    run(TICK_RATE, { moveZ: 1 });
    for (let i = 0; i < 12; i++) {
      hitFromAhead(1);
      run(Math.round(0.07 * TICK_RATE), { moveZ: 1 });
    }
    expect(horizSpeed(world)).toBeCloseTo(world.maxSpeed() * 0.5, 2);
  });
});

describe('flinch (spec §4.4)', () => {
  it('kicks the view pitch up by zone and recovers in recovery_s', () => {
    const { world, run, hitFromAhead, tun } = setup();
    hitFromAhead(1, 'head');
    run(1);
    // one tick of recovery has already happened by the time the player steps
    const kick = tun.player.flinch.pitchHeadDeg - (tun.player.flinch.pitchHeadDeg / tun.player.flinch.recoverySec) * TICK_DT;
    expect(world.player.aimPunch / DEG2RAD).toBeCloseTo(kick, 6);
    expect(world.player.pitch).toBeCloseTo(world.player.aimPunch, 12);
    run(Math.round(0.26 * TICK_RATE));
    expect(world.player.aimPunch).toBe(0);
  });

  it('is zone dependent: head 2.0, body 0.6, leg 0.3 degrees', () => {
    for (const [zone, deg] of [['head', 2.0], ['body', 0.6], ['leg', 0.3]] as const) {
      const { world, hitFromAhead } = setup();
      hitFromAhead(1, zone);
      expect(world.health.flinchDeg).toBeCloseTo(deg, 12);
    }
  });

  it('strength 0 disables it; strength scales it; it never stacks beyond maxDeg', () => {
    const off = setup((t) => { t.player.flinch.strength = 0; });
    off.hitFromAhead(1, 'head');
    off.run(2);
    expect(off.world.player.aimPunch).toBe(0);
    const big = setup((t) => { t.player.flinch.strength = 2; });
    big.hitFromAhead(1, 'head');
    expect(big.world.health.flinchDeg).toBeCloseTo(4, 12);
    big.hitFromAhead(1, 'head');
    expect(big.world.health.flinchDeg).toBeCloseTo(4, 12); // capped at maxDeg
  });

  it('moves the shot direction with the view (the punch is part of the aim)', () => {
    const { world, all, run, hitFromAhead } = setup();
    hitFromAhead(1, 'head');
    run(1, { fire: true });
    const shot = all('shotFired')[0]!;
    const noPunch = setup();
    noPunch.run(1, { fire: true });
    expect(shot.dir.y).toBeGreaterThan(noPunch.all('shotFired')[0]!.dir.y);
    expect(world.health.hp).toBeLessThan(100);
  });
});

describe('kill-heal (design §4.8, tunables.sweep.killHeal)', () => {
  /** Spawn a Post 6 m ahead with `hp` HP and shoot it once with the given pitch (deg). */
  function shootPost(s: ReturnType<typeof setup>, hp: number, pitchDeg: number): void {
    const id = s.world.spawnTarget('post', s.world.player.pos.x, 0, s.world.player.pos.z - 6, s.bus);
    s.world.targetField.byId(id)!.hp = hp;
    s.input.pitch = pitchDeg * DEG2RAD;
    s.run(1, { fire: true });
    s.run(1, { fire: false });
  }

  it('the values are 5 for a body kill and 10 for a headshot kill, in tunables.sweep.killHeal', () => {
    expect(setup().tun.sweep.killHeal).toEqual({ body: 5, head: 10 });
  });

  it('a body kill heals 5 HP', () => {
    const s = setup();
    s.hitFromAhead(40);
    shootPost(s, 1, -4.5); // chest height at 6 m
    const k = s.all('targetKilled');
    expect(k).toHaveLength(1);
    expect(k[0]!.zone).toBe('body');
    expect(s.world.health.hp).toBeCloseTo(65, 9);
    const h = s.all('playerHealed');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ amount: 5, hp: 65, maxHp: 100, source: 'kill' });
  });

  it('a headshot kill heals 10 HP', () => {
    const s = setup();
    s.hitFromAhead(40);
    shootPost(s, 1, 0);
    expect(s.all('targetKilled')[0]!.zone).toBe('head');
    expect(s.world.health.hp).toBeCloseTo(70, 9);
  });

  it('caps at max HP: the event reports what was actually added, and nothing at full health', () => {
    const s = setup();
    s.hitFromAhead(3);
    shootPost(s, 1, 0);
    expect(s.world.health.hp).toBe(100);
    expect(s.all('playerHealed')[0]!.amount).toBe(3);
    shootPost(s, 1, 0);
    expect(s.world.health.hp).toBe(100);
    expect(s.all('playerHealed')).toHaveLength(1); // the second kill healed nothing and said nothing
  });

  it('a non-lethal hit on a target heals nothing', () => {
    const s = setup();
    s.hitFromAhead(40);
    shootPost(s, 1000, -4.5);
    expect(s.all('targetKilled')).toHaveLength(0);
    expect(s.world.health.hp).toBeCloseTo(60, 9);
  });

  it('follows the tunable: a different value heals a different amount', () => {
    const s = setup((t) => { t.sweep.killHeal.body = 17; });
    s.hitFromAhead(40);
    shootPost(s, 1, -4.5);
    expect(s.world.health.hp).toBeCloseTo(77, 9);
  });

  it('a dead player is not healed', () => {
    const s = setup();
    s.hitFromAhead(1000);
    expect(s.world.health.hp).toBe(0);
    expect(s.all('playerHealed')).toHaveLength(0);
  });
});

describe('determinism and allocation', () => {
  function script(): number {
    const s = setup(undefined, 3);
    for (let i = 0; i < 6; i++) {
      s.run(40, { moveZ: 1, moveX: i % 2 === 0 ? 1 : -1 });
      s.hitFromAhead(9, i % 2 === 0 ? 'body' : 'head', 8 + i);
    }
    return s.world.hash();
  }

  it('the same inputs and hits give the same hash', () => {
    expect(script()).toBe(script());
  });

  it('health state is part of the hash', () => {
    const a = setup();
    const b = setup();
    a.hitFromAhead(10);
    expect(a.world.hash()).not.toBe(b.world.hash());
  });

  it('reuses its event payload objects: no allocation per hit', () => {
    const tun = cloneTunables();
    const world = new World({ level: testRoom, tunables: tun, seed: 1 });
    const seen: unknown[] = [];
    const sink = { emit: (_t: string, p: unknown): void => { seen.push(p); } } as unknown as import('../core/eventBus').EventSink<SimEvents>;
    for (let i = 0; i < 5; i++) world.damagePlayer(1, 'body', 0, 1, -5, 1, sink);
    const dmg = seen.filter((_, i) => i % 2 === 0);
    expect(new Set(dmg).size).toBe(1);
    expect(new Set(seen.filter((_, i) => i % 2 === 1)).size).toBe(1);
  });
});
