import { describe, expect, it } from 'vitest';
import { audio, type CueId } from '../config/audio';
import type { TargetState } from '../sim/types';
import { vec3 } from '../core/vec3';
import type { CuePlayer } from './audioEngine';
import { EnemyFootsteps } from './enemyFootsteps';

function slot(id: number, x: number, z: number, alive = true): TargetState {
  return { id, alive, pos: vec3(x, 0, z) } as unknown as TargetState;
}

function setup(capacity = 4) {
  const plays: { cue: CueId; x: number; z: number }[] = [];
  const player: CuePlayer = { play: (cue, o) => { plays.push({ cue, x: o?.position?.x ?? NaN, z: o?.position?.z ?? NaN }); }, setLoop: () => undefined };
  return { plays, steps: new EnemyFootsteps(player, audio.enemy, capacity) };
}

/** Walk slot 0 along +X at `speed` m/s for `seconds`, ticking at 128 Hz. */
function walk(steps: EnemyFootsteps, s: TargetState, speed: number, seconds: number, listener = [0, 0]): void {
  for (let i = 0; i < Math.round(seconds * 128); i++) {
    s.pos.x += speed / 128;
    steps.tick([s], listener[0]!, listener[1]!);
  }
}

describe('EnemyFootsteps', () => {
  it('plays one positioned step per stride walked, and none standing still', () => {
    const { plays, steps } = setup();
    const s = slot(1, 5, -5);
    steps.tick([s], 0, 0);
    for (let i = 0; i < 256; i++) steps.tick([s], 0, 0); // 2 s standing
    expect(plays).toEqual([]);
    walk(steps, s, 4.4, 2); // 8.8 m = 4 strides of 2.2 m
    expect(plays.length).toBe(4);
    expect(plays.every((p) => p.cue === 'enemyFootstep')).toBe(true);
    expect(plays[3]!.x).toBeGreaterThan(plays[0]!.x);
  });

  it('is silent beyond the audible range and for dead slots', () => {
    const { plays, steps } = setup();
    const far = slot(1, 100, 0);
    steps.tick([far], 0, 0);
    walk(steps, far, 5, 2);
    expect(plays).toEqual([]);
    const dead = slot(2, 3, 0, false);
    steps.tick([dead], 0, 0);
    walk(steps, dead, 5, 2);
    expect(plays).toEqual([]);
  });

  it('does not count a respawn or a teleport as walking', () => {
    const { plays, steps } = setup();
    const s = slot(1, 0, -5);
    steps.tick([s], 0, 0);
    s.pos.x = 40; // teleported
    steps.tick([s], 0, 0);
    s.id = 2; // a new target in the same slot, elsewhere
    s.pos.x = -3;
    steps.tick([s], 0, 0);
    expect(plays).toEqual([]);
    walk(steps, s, 4.4, 0.6); // a bit over one stride from the new position: one step
    expect(plays).toHaveLength(1);
  });

  it('a walking enemy is silent and a running one is heard (honest audio, design §4.4)', () => {
    const { plays, steps } = setup();
    const walker = slot(1, 5, -5);
    steps.tick([walker], 0, 0);
    walk(steps, walker, audio.enemy.silentBelowMps - 0.3, 4); // ~2.7 m/s, a rifle walk
    expect(plays).toEqual([]);
    const runner = slot(2, 5, -5);
    steps.tick([runner], 0, 0);
    walk(steps, runner, 5.4, 2); // a rifle run: 10.8 m = 4 strides
    expect(plays.length).toBeGreaterThanOrEqual(4);
  });
});
