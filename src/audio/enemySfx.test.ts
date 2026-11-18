import { describe, expect, it } from 'vitest';
import { audio, type CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import type { RunEvents } from '../sim/runEvents';
import type { SimEvents } from '../sim/types';
import type { CuePlayer, PlayOptions } from './audioEngine';
import { attachEnemySfx, closestApproach, type AudioWorld } from './enemySfx';
import { azimuthDeg } from './spatial';

type E = RunEvents & SimEvents;

interface Call { cue: CueId; opts: PlayOptions; at: Vec3 | null }

function setup(enemies: Record<number, Vec3> = { 7: vec3(10, 1.3, -20) }, eye: Vec3 = vec3(0, 1.6, 0), tellStrength?: () => number) {
  const bus = new EventBus<E>();
  const calls: Call[] = [];
  const player: CuePlayer = {
    // Copy the position: the subscriber reuses its scratch vector.
    play: (cue, opts = {}) => { calls.push({ cue, opts: { ...opts }, at: opts.position ? { ...opts.position } : null }); },
    setLoop: () => undefined,
  };
  const world: AudioWorld = {
    enemyVoice: (id, out) => {
      const p = enemies[id];
      if (!p) return false;
      out.x = p.x; out.y = p.y; out.z = p.z;
      return true;
    },
    playerEye: (out) => { out.x = eye.x; out.y = eye.y; out.z = eye.z; },
  };
  attachEnemySfx(bus, player, world, audio, tellStrength);
  return { bus, calls };
}

const unit = (x: number, y: number, z: number): Vec3 => {
  const n = Math.hypot(x, y, z);
  return vec3(x / n, y / n, z / n);
};

describe('closestApproach', () => {
  it('finds where a line passes a point, and reports a bullet moving away', () => {
    const out = vec3();
    // Muzzle at the origin firing +X; the point is 2 m up, 5 m along: closest at (5,0,0), miss 2.
    expect(closestApproach(out, vec3(0, 0, 0), vec3(1, 0, 0), vec3(5, 2, 0))).toBeCloseTo(2, 9);
    expect(out).toMatchObject({ x: 5, y: 0, z: 0 });
    expect(closestApproach(out, vec3(0, 0, 0), vec3(1, 0, 0), vec3(-5, 2, 0))).toBe(-1);
  });
});

describe('attachEnemySfx', () => {
  it('plays the tell at the enemy, as long as the event says', () => {
    const { bus, calls } = setup();
    bus.emit('enemyTell', { tick: 1, id: 7, durationMs: 183 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cue: 'enemyTell', opts: { durationMs: 183 }, at: { x: 10, y: 1.3, z: -20 } });
  });

  it('the tell tone fades with the tell-cue axis: quieter, then silent (design §7.4)', () => {
    let strength = 0.5;
    const { bus, calls } = setup(undefined, undefined, () => strength);
    bus.emit('enemyTell', { tick: 1, id: 7, durationMs: 183 });
    expect(calls[0]!.opts).toMatchObject({ durationMs: 183, gain: 0.5 });
    strength = 0;
    bus.emit('enemyTell', { tick: 2, id: 7, durationMs: 183 });
    expect(calls).toHaveLength(1); // the true cues (the shot, footsteps) are other handlers
    strength = 1;
    bus.emit('enemyTell', { tick: 3, id: 7, durationMs: 183 });
    expect(calls[1]!.opts.gain).toBeUndefined();
  });

  it('is silent for an enemy that is not in the field', () => {
    const { bus, calls } = setup();
    bus.emit('enemyTell', { tick: 1, id: 99, durationMs: 200 });
    bus.emit('enemyFired', { tick: 2, id: 99, hit: false, dir: unit(0, 0, 1), audibleToPlayer: true });
    expect(calls).toEqual([]);
  });

  it('plays the enemy shot at the enemy on a hit, with no whiz and no extra sound', () => {
    const { bus, calls } = setup();
    bus.emit('enemyFired', { tick: 1, id: 7, hit: true, dir: unit(-10, 0.3, 20), audibleToPlayer: true });
    expect(calls.map((c) => c.cue)).toEqual(['enemyShot']);
    expect(calls[0]!.at).toMatchObject({ x: 10, y: 1.3, z: -20 });
  });

  it('plays a whiz on the side the bullet passed, at the point of closest approach', () => {
    // Enemy straight ahead at 20 m, player facing it. Aim 0.6 m to the player's right (+X) and 0.6 m to the left.
    for (const side of [1, -1]) {
      const { bus, calls } = setup({ 7: vec3(0, 1.3, -20) });
      bus.emit('enemyFired', { tick: 1, id: 7, hit: false, dir: unit(side * 0.6, 0.3, 20), audibleToPlayer: true });
      expect(calls.map((c) => c.cue)).toEqual(['enemyShot', 'whiz']);
      const w = calls[1]!.at!;
      expect(Math.sign(w.x)).toBe(side);
      expect(Math.hypot(w.x, w.y - 1.6, w.z)).toBeCloseTo(0.6, 1);
      // The bullet is 0.6 m to that side of the head, so the whiz sits at about +-90 degrees.
      expect(Math.abs(azimuthDeg(0, 0, 0, w.x, w.z))).toBeGreaterThan(60);
      expect(Math.sign(azimuthDeg(0, 0, 0, w.x, w.z))).toBe(side);
    }
  });

  it('skips the whiz for a miss that passed far away or moved off behind the muzzle', () => {
    const far = setup({ 7: vec3(0, 1.3, -20) });
    far.bus.emit('enemyFired', { tick: 1, id: 7, hit: false, dir: unit(8, 0, 20), audibleToPlayer: true }); // passes ~8 m wide
    expect(far.calls.map((c) => c.cue)).toEqual(['enemyShot']);
    const away = setup({ 7: vec3(0, 1.3, -20) });
    away.bus.emit('enemyFired', { tick: 1, id: 7, hit: false, dir: unit(0, 0, -1), audibleToPlayer: true });
    expect(away.calls.map((c) => c.cue)).toEqual(['enemyShot']);
  });

  it('keeps a whiz off the exact centre of the head', () => {
    const { bus, calls } = setup({ 7: vec3(0, 1.6, -20) });
    bus.emit('enemyFired', { tick: 1, id: 7, hit: false, dir: unit(0.01, 0, 20), audibleToPlayer: true }); // a hair off the centre
    const w = calls[1]!.at!;
    expect(Math.hypot(w.x, w.y - 1.6, w.z)).toBeGreaterThanOrEqual(audio.whiz.minOffsetM - 1e-9);
  });

  it('plays the damage thud, centred in the head', () => {
    const { bus, calls } = setup();
    bus.emit('playerDamaged', { tick: 1, t: 0, amount: 20, absorbed: 0, hp: 80, maxHp: 100, shield: 0, maxShield: 0, zone: 'body', dir: vec3(0, 0, -1), yaw: 0, sourceId: 7, killed: false, exposedTo: 1, x: 0, z: 0, distance: 10 });
    expect(calls).toMatchObject([{ cue: 'damageThud', at: null }]);
  });
});
