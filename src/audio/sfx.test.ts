import { describe, expect, it } from 'vitest';
import { audio } from '../config/audio';
import type { CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import type { FeedbackEvents } from '../feedback/events';
import type { StreakEvents } from '../feedback/streaks';
import type { RunEvents } from '../sim/runEvents';
import type { WeaponId } from '../config/weapon';
import type { HitZone, SimEvents } from '../sim/types';
import type { CuePlayer, PlayOptions } from './audioEngine';
import { attachSfx } from './sfx';

type E = SimEvents & FeedbackEvents & Pick<StreakEvents, 'chainUpdated'> & RunEvents;
const v = { x: 1, y: 2, z: 3 };

const impact = (onTarget: boolean): E['shotImpact'] => ({
  tick: 1, t: 0, shotId: 1, result: onTarget ? 'hit' : 'miss', targetId: onTarget ? 1 : -1, zone: onTarget ? 'body' : null,
  damage: onTarget ? 39 : 0, killed: false, point: v, normal: v, onTarget, distance: 5,
});
const shot = (tick: number, moving: boolean, weapon: WeaponId = 'kestrel'): E['shotFired'] => ({
  tick, t: 0, shotId: tick, weapon, origin: v, dir: v, aimDir: v, moving, speed: 0, airborne: false, crouching: false,
  spreadDeg: 0.2, recoilIndex: 0, recoilPitchDeg: 0, recoilYawDeg: 0, ammo: 29,
  yaw: 0, pitch: 0, aimTargetId: -1, aimErr: 0, aimDYaw: 0, aimDPitch: 0,
});
const hit = (zone: HitZone): E['targetHit'] => ({ tick: 1, t: 0, targetId: 1, kind: 'beacon', zone, point: v, damage: 1, absorbed: 0, hpLeft: 1, shieldLeft: 0, distance: 1, killed: false });
const kill = (zone: HitZone): E['targetKilled'] => ({ tick: 1, t: 0, targetId: 1, kind: 'beacon', zone, point: v, distance: 1, ttkMs: 0, rtMs: 0, firstBullet: true, bullets: 1, shield: 0, clean: true });

function setup() {
  const bus = new EventBus<E>();
  const calls: { cue: CueId; opts?: PlayOptions }[] = [];
  const loops: string[] = [];
  const player: CuePlayer = {
    play: (cue, opts) => { calls.push({ cue, opts }); },
    setLoop: (cue, on) => { loops.push(`${cue}:${on ? 'on' : 'off'}`); },
  };
  attachSfx(bus, player, audio);
  const cues = (): CueId[] => calls.map((c) => c.cue);
  return { bus, calls, cues, loops };
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

  it('plays the real shot for every weapon id, and Kestrel for an unknown one', () => {
    const { bus, cues } = setup();
    for (const w of ['rill', 'longnail', 'vane']) bus.emit('shotFired', shot(1, false, w as WeaponId));
    expect(cues()).toEqual(['shotRill', 'shotLongnail', 'shotKestrel']);
  });

  it('layers one chain chime per step beyond the first, at the kill ladder step, staggered', () => {
    const { bus, calls } = setup();
    bus.emit('streakUpdated', { streak: 3, mult: 1 });
    bus.emit('chainUpdated', { tick: 1, t: 0, count: 1 });
    bus.emit('targetKilled', kill('body'));
    expect(calls.map((c) => c.cue)).toEqual(['kill']); // a lone kill is a chain of 1: no layer
    calls.length = 0;
    bus.emit('chainUpdated', { tick: 2, t: 0, count: 2 });
    bus.emit('targetKilled', kill('body'));
    expect(calls.map((c) => c.cue)).toEqual(['kill', 'chain']);
    expect(calls[1]!.opts).toMatchObject({ pitchStep: 3, delayMs: audio.chain.staggerMs });
    calls.length = 0;
    bus.emit('chainUpdated', { tick: 3, t: 0, count: 9 });
    bus.emit('targetKilled', kill('body'));
    expect(calls.filter((c) => c.cue === 'chain')).toHaveLength(audio.chain.gains.length); // capped
    expect(calls.filter((c) => c.cue === 'chain').map((c) => c.opts?.delayMs)).toEqual([55, 110, 165]);
    calls.length = 0;
    bus.emit('chainUpdated', { tick: 4, t: 0, count: 0 }); // chain lapsed
    bus.emit('targetKilled', kill('body'));
    expect(calls.map((c) => c.cue)).toEqual(['kill']);
  });

  it('answers reload, equip and the run lifecycle', () => {
    const { bus, cues } = setup();
    bus.emit('reloadStarted', { tick: 1, weapon: 'kestrel', durationSec: 2.5 });
    bus.emit('reloadCancelled', { tick: 2, weapon: 'kestrel' });
    bus.emit('reloadStarted', { tick: 3, weapon: 'kestrel', durationSec: 2.5 });
    bus.emit('reloadCompleted', { tick: 4, weapon: 'kestrel', ammo: 30, reserve: 60 });
    bus.emit('weaponSwitched', { tick: 5, weapon: 'pace', slot: 1, equipSec: 0.5 });
    bus.emit('runReady', { tick: 6, mode: 'coldStart', seed: 1, dial: 50 });
    bus.emit('runStarted', { tick: 7 });
    bus.emit('runEnded', { tick: 8, t: 60, reason: 'timer' });
    bus.emit('runEnded', { tick: 9, t: 20, reason: 'death' });
    bus.emit('runEnded', { tick: 10, t: 20, reason: 'quit' });
    bus.emit('runEnded', { tick: 11, t: 20, reason: 'complete' });
    expect(cues()).toEqual([
      'reloadOut', 'reloadOut', 'reloadIn', 'equip', 'uiReady', 'uiGo', 'resultsFanfare', 'runEnd', 'runEnd', 'resultsFanfare',
    ]);
  });

  it('starts the Surge whoosh and shimmer loop, and always stops the loop (end, restart or run end)', () => {
    const { bus, cues, loops } = setup();
    bus.emit('surgeStarted', { tick: 1 });
    expect(cues()).toEqual(['surgeWhoosh']);
    expect(loops).toEqual(['surgeShimmer:on']);
    bus.emit('surgeEnded', { tick: 2 });
    bus.emit('surgeStarted', { tick: 3 });
    bus.emit('runEnded', { tick: 4, t: 10, reason: 'quit' }); // a run that ends mid-Surge
    bus.emit('surgeStarted', { tick: 5 });
    bus.emit('runReady', { tick: 6, mode: 'sweep', seed: 1, dial: 50 }); // an instant restart mid-Surge
    expect(loops.filter((l) => l.endsWith('off'))).toHaveLength(3);
    expect(loops.at(-1)).toBe('surgeShimmer:off');
  });

  it('plays the medal phrase', () => {
    const { bus, cues } = setup();
    bus.emit('medalAwarded', { tick: 1, id: 'quickDraw' });
    expect(cues()).toEqual(['medal']);
  });

  it('does not reset on its own: a streak break needs the streak the run ended with', () => {
    const { bus, cues } = setup();
    bus.emit('streakUpdated', { streak: 5, mult: 1 });
    bus.emit('runReady', { tick: 1, mode: 'coldStart', seed: 1, dial: 50 }); // a restart clears it silently
    bus.emit('streakUpdated', { streak: 0, mult: 1 });
    expect(cues()).toEqual(['uiReady']);
  });

  it('detaches', () => {
    const bus = new EventBus<E>();
    const calls: CueId[] = [];
    const off = attachSfx(bus, { play: (c) => { calls.push(c); }, setLoop: () => undefined }, audio);
    off();
    bus.emit('shotFired', shot(1, false));
    expect(calls).toEqual([]);
  });
});
