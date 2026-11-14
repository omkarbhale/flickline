import { describe, expect, it } from 'vitest';
import { audio } from '../config/audio';
import type { CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import type { FeedbackEvents } from '../feedback/events';
import type { SimEvents } from '../sim/types';
import type { CuePlayer, PlayOptions } from './audioEngine';
import { attachSfx } from './sfx';

type E = SimEvents & FeedbackEvents;
const v = { x: 1, y: 2, z: 3 };

function setup() {
  const bus = new EventBus<E>();
  const calls: { cue: CueId; opts?: PlayOptions }[] = [];
  const player: CuePlayer = { play: (cue, opts) => { calls.push({ cue, opts }); } };
  attachSfx(bus, player, audio);
  const cues = (): CueId[] => calls.map((c) => c.cue);
  return { bus, calls, cues };
}

describe('attachSfx', () => {
  it('plays the weapon shot for the weapon id, defaulting to Kestrel', () => {
    const { bus, cues } = setup();
    bus.emit('shotFired', { tick: 1, origin: v, dir: v, weapon: 'pace' });
    bus.emit('shotFired', { tick: 2, origin: v, dir: v, weapon: 'kestrel' });
    bus.emit('shotFired', { tick: 3, origin: v, dir: v });
    expect(cues()).toEqual(['shotPace', 'shotKestrel', 'shotKestrel']);
  });

  it('layers the moving-shot tock under a moving shot only', () => {
    const { bus, cues } = setup();
    bus.emit('shotFired', { tick: 1, origin: v, dir: v, moving: false });
    bus.emit('shotFired', { tick: 2, origin: v, dir: v, moving: true });
    expect(cues()).toEqual(['shotKestrel', 'shotKestrel', 'movingShot']);
  });

  it('plays a positional miss only when the shot hit no target', () => {
    const { bus, calls } = setup();
    bus.emit('shotImpact', { tick: 1, point: v, normal: v, onTarget: true, distance: 5 });
    bus.emit('shotImpact', { tick: 1, point: v, normal: v, onTarget: false, distance: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cue).toBe('miss');
    expect(calls[0]!.opts?.position).toBe(v);
  });

  it('maps hit zones to thock, leg thock and headshot (absent zone is body)', () => {
    const { bus, cues } = setup();
    const hit = { tick: 1, targetId: 1, point: v, damage: 1, hpLeft: 1, distance: 1 };
    bus.emit('targetHit', hit);
    bus.emit('targetHit', { ...hit, zone: 'body' });
    bus.emit('targetHit', { ...hit, zone: 'leg' });
    bus.emit('targetHit', { ...hit, zone: 'head' });
    expect(cues()).toEqual(['hitBody', 'hitBody', 'hitLeg', 'hitHead']);
  });

  it('climbs the kill ladder with the clean streak, caps at step 8, and sparkles on headshot kills', () => {
    const { bus, calls } = setup();
    const kill = { tick: 1, targetId: 1, point: v, distance: 1 };
    bus.emit('targetKilled', kill); // no streak yet -> step 1
    expect(calls[0]).toMatchObject({ cue: 'kill', opts: { pitchStep: 1 } });
    calls.length = 0;
    for (const s of [1, 3, 8, 20]) {
      bus.emit('streakUpdated', { streak: s, mult: 1 });
      bus.emit('targetKilled', kill);
    }
    expect(calls.map((c) => c.opts?.pitchStep)).toEqual([1, 3, 8, 8]);
    calls.length = 0;
    bus.emit('targetKilled', { ...kill, zone: 'head' });
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
    bus.emit('shotFired', { tick: 1, origin: v, dir: v });
    expect(calls).toEqual([]);
  });
});
