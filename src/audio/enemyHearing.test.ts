import { describe, expect, it } from 'vitest';
import { audio, type CueId } from '../config/audio';
import { EventBus } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import type { EnemySoundEvent } from '../sim/attribution';
import type { SimEvents } from '../sim/types';
import type { CuePlayer } from './audioEngine';
import { attachEnemyHearing } from './enemyHearing';

function setup() {
  const plays: { cue: CueId; x: number; y: number; z: number }[] = [];
  const player: CuePlayer = {
    play: (cue, o) => { plays.push({ cue, x: o?.position?.x ?? NaN, y: o?.position?.y ?? NaN, z: o?.position?.z ?? NaN }); },
    setLoop: () => undefined,
  };
  const bus = new EventBus<SimEvents>();
  attachEnemyHearing(bus, player, audio.enemy);
  const sound = (x: number, z: number, audibleToPlayer: boolean): EnemySoundEvent => ({ tick: 1, t: 0, id: 1, pos: vec3(x, 0, z), distance: Math.hypot(x, z), audibleToPlayer });
  return { plays, bus, sound };
}

describe('attachEnemyHearing', () => {
  it('plays each audible sound positioned where it happened: steps and landings at the feet, a reload at the hands', () => {
    const { plays, bus, sound } = setup();
    bus.emit('enemyFootstep', sound(5, -5, true));
    bus.emit('enemyLanded', sound(-3, -8, true));
    bus.emit('enemyReloadStarted', sound(2, -9, true));
    expect(plays.map((p) => p.cue)).toEqual(['enemyFootstep', 'enemyLand', 'enemyReload']);
    expect([plays[0]!.x, plays[0]!.z]).toEqual([5, -5]);
    expect(plays[0]!.y).toBeCloseTo(0.05, 6);
    expect([plays[1]!.x, plays[1]!.z]).toEqual([-3, -8]);
    expect([plays[2]!.x, plays[2]!.z]).toEqual([2, -9]);
    expect(plays[2]!.y).toBeCloseTo(audio.enemy.handsHeightM, 6);
  });

  it('is silent for a sound the sim says is out of earshot (no radius of its own to disagree with)', () => {
    const { plays, bus, sound } = setup();
    bus.emit('enemyFootstep', sound(100, 0, false));
    bus.emit('enemyLanded', sound(100, 0, false));
    bus.emit('enemyReloadStarted', sound(100, 0, false));
    expect(plays).toEqual([]);
  });
});
