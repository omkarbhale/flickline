import { describe, expect, it } from 'vitest';
import { audio } from '../config/audio';
import type { CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import type { FeedbackEvents } from '../feedback/events';
import type { WeaponId } from '../config/weapon';
import type { HitZone, SimEvents } from '../sim/types';
import type { CuePlayer, PlayOptions } from './audioEngine';
import { attachSfx } from './sfx';

type E = SimEvents & FeedbackEvents;
const v = { x: 1, y: 2, z: 3 };

const impact = (onTarget: boolean): E['shotImpact'] => ({
  tick: 1, t: 0, shotId: 1, result: onTarget ? 'hit' : 'miss', targetId: onTarget ? 1 : -1, zone: onTarget ? 'body' : null,
  damage: onTarget ? 39 : 0, killed: false, point: v, normal: v, onTarget, distance: 5,
});
const shot = (tick: number, moving: boolean, weapon: WeaponId = 'kestrel'): E['shotFired'] => ({
  tick, t: 0, shotId: tick, weapon, origin: v, dir: v, moving, speed: 0, airborne: false, crouching: false,
  spreadDeg: 0.2, recoilIndex: 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: 29,
  yaw: 0, pitch: 0, aimTargetId: -1, aimErr: 0, aimDYaw: 0, aimDPitch: 0,
});
const hit = (zone: HitZone): E['targetHit'] => ({ tick: 1, t: 0, targetId: 1, kind: 'beacon', zone, point: v, damage: 1, hpLeft: 1, distance: 1, killed: false });
const kill = (zone: HitZone): E['targetKilled'] => ({ tick: 1, t: 0, targetId: 1, kind: 'beacon', zone, point: v, distance: 1, ttkMs: 0, rtMs: 0, firstBullet: true, bullets: 1, clean: true });

function setup() {
  const bus = new EventBus<E>();
  const calls: { cue: CueId; opts?: PlayOptions }[] = [];
  const player: CuePlayer = { play: (cue, opts) => { calls.push({ cue, opts }); } };
  attachSfx(bus, player, audio);
  const cues = (): CueId[] => calls.map((c) => c.cue);
  return { bus, calls, cues };
}

describe('attachSfx', () => {
  it('plays the weapon shot for the weapon id', () => {
    const { bus, cues } = setup();
    bus.emit('shotFired', shot(1, false, 'pace'));
    bus.emit('shotFired', shot(2, false, 'kestrel'));
    expect(cues()).toEqual(['shotPace', 'shotKestrel']);
  });

  it('layers the moving-shot tock under a moving shot only', () => {
    const { bus, cues } = setup();
    bus.emit('shotFired', shot(1, false));
    bus.emit('shotFired', shot(2, true));
    expect(cues()).toEqual(['shotKestrel', 'shotKestrel', 'movingShot']);
  });

  it('plays a positional miss only when the shot hit no target', () => {
    const { bus, calls } = setup();
    bus.emit('shotImpact', impact(true));
    bus.emit('shotImpact', impact(false));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cue).toBe('miss');
    expect(calls[0]!.opts?.position).toBe(v);
  });

  it('maps hit zones to thock, leg thock and headshot (absent zone is body)', () => {
    const { bus, cues } = setup();
    bus.emit('targetHit', hit('body'));
    bus.emit('targetHit', hit('leg'));
    bus.emit('targetHit', hit('head'));
    expect(cues()).toEqual(['hitBody', 'hitLeg', 'hitHead']);
  });

  it('climbs the kill ladder with the clean streak, caps at step 8, and sparkles on headshot kills', () => {
    const { bus, calls } = setup();
    bus.emit('targetKilled', kill('body')); // no streak yet -> step 1
    expect(calls[0]).toMatchObject({ cue: 'kill', opts: { pitchStep: 1 } });
    calls.length = 0;
    for (const s of [1, 3, 8, 20]) {
      bus.emit('streakUpdated', { streak: s, mult: 1 });
      bus.emit('targetKilled', kill('body'));
    }
    expect(calls.map((c) => c.opts?.pitchStep)).toEqual([1, 3, 8, 8]);
    calls.length = 0;
    bus.emit('targetKilled', kill('head'));
    expect(calls.map((c) => c.cue)).toEqual(['kill', 'killSparkle']);
    expect(calls[1]!.opts?.pitchStep).toBe(8);
  });

  it('plays the soft streak break only when a streak of 2+ ends', () => {
    const { bus, cues } = setup();
    bus.emit('streakUpdated', { streak: 1, mult: 1 });
    bus.emit('streakUpdated', { streak: 0, mult: 1 });
    expect(cues()).toEqual([]);
    bus.emit('streakUpdated', { streak: 1, mult: 1 });
    bus.emit('streakUpdated', { streak: 2, mult: 1 });
    bus.emit('streakUpdated', { streak: 0, mult: 1 });
    expect(cues()).toEqual(['streakBreak']);
  });

  it('detaches', () => {
    const bus = new EventBus<E>();
    const calls: CueId[] = [];
    const off = attachSfx(bus, { play: (c) => { calls.push(c); } }, audio);
    off();
    bus.emit('shotFired', shot(1, false));
    expect(calls).toEqual([]);
  });
});
