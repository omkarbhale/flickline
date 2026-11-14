import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { Rng } from '../core/rng';
import { createShotTiming, enemyShotTiming, reactionDraw, type ReactionDist } from './enemyTiming';

const tun = cloneTunables();
const floors = tun.dial.floors;
const exp = tun.expectation;
/** The research's top anchor (player-like-enemies.md §5.4). */
const TOP: ReactionDist = { muSec: 0.235, sigmaSec: 0.022, tauSec: 0.055 };
/** A degenerate draw: always `mu` exactly. */
const fixed = (s: number): ReactionDist => ({ muSec: s, sigmaSec: 0, tauSec: 0 });

describe('enemyShotTiming (#127: floors split by expectation)', () => {
  it('a surprised enemy keeps the reaction floor and holds fire for the tell, even on target', () => {
    // 0.30 s: the dial-100 tell (#130), above the 0.25 s tell floor, so the dial's length is what is held.
    const t = enemyShotTiming(new Rng(1), fixed(0.1), 'attending', 'none', 0, 0.3, floors, exp, createShotTiming());
    expect(t.reactionSec).toBe(floors.enemyReactionSec);
    expect(t.tellStartSec).toBe(floors.enemyReactionSec);
    expect(t.fireReadySec).toBeCloseTo(floors.enemyReactionSec + 0.3);
  });

  it('a surprised enemy still aiming fires when the aim phase ends, never later (research F5)', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.3), 'attending', 'none', 0.4, 0.18, floors, exp, createShotTiming());
    expect(t.fireReadySec).toBeCloseTo(0.3 + 0.4);
  });

  it('the tell is floored at tellSec', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.3), 'attending', 'none', 0, 0.01, floors, exp, createShotTiming());
    expect(t.fireReadySec - t.tellStartSec).toBeCloseTo(floors.tellSec);
  });

  it('an unaware enemy pays the orientation cost', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.3), 'unaware', 'none', 0, 0.18, floors, exp, createShotTiming());
    expect(t.reactionSec).toBeCloseTo(0.3 + exp.orientationSec);
  });

  it('a prepared holder on target fires on its reaction, with the tell running from first sight', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.3), 'prepared', 'none', 0, 0.18, floors, exp, createShotTiming());
    expect(t.reactionSec).toBeCloseTo(0.3 - exp.preparedBonusSec);
    expect(t.tellStartSec).toBe(0);
    expect(t.fireReadySec).toBeCloseTo(0.3 - exp.preparedBonusSec);
  });

  it('a prepared holder adds its aim phase but no tell', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.3), 'prepared', 'none', 0.12, 0.5, floors, exp, createShotTiming());
    expect(t.fireReadySec).toBeCloseTo(0.3 - exp.preparedBonusSec + 0.12);
  });

  it('a prepared holder is never faster than preparedReactionSec', () => {
    const t = enemyShotTiming(new Rng(1), fixed(0.05), 'prepared', 'none', 0, 0, floors, exp, createShotTiming());
    expect(t.reactionSec).toBe(floors.preparedReactionSec);
    const rng = new Rng(9);
    for (let i = 0; i < 2000; i++) {
      const r = enemyShotTiming(rng, TOP, 'prepared', 'enemy', 0, 0, floors, exp, createShotTiming());
      expect(r.reactionSec).toBeGreaterThanOrEqual(floors.preparedReactionSec);
    }
  });

  it('peeker\'s advantage delays perception when the player peeks and shortens reaction when the enemy peeks', () => {
    const pa = { ...exp, peekerAdvantageMinSec: 0.05, peekerAdvantageMaxSec: 0.05 };
    const player = enemyShotTiming(new Rng(1), fixed(0.3), 'prepared', 'player', 0, 0, floors, pa, createShotTiming());
    expect(player.perceiveSec).toBeCloseTo(0.05);
    expect(player.tellStartSec).toBeCloseTo(0.05);
    expect(player.fireReadySec).toBeCloseTo(0.05 + 0.3 - exp.preparedBonusSec);
    const enemy = enemyShotTiming(new Rng(1), fixed(0.3), 'prepared', 'enemy', 0, 0, floors, pa, createShotTiming());
    expect(enemy.perceiveSec).toBe(0);
    expect(enemy.fireReadySec).toBeCloseTo(0.3 - exp.preparedBonusSec - 0.05);
  });

  it('a prepared top-anchor holder answers in a real prepared holder\'s time (research §1.2: 0.25–0.35 s on target)', () => {
    const rng = new Rng(3);
    const xs: number[] = [];
    for (let i = 0; i < 4000; i++) xs.push(enemyShotTiming(rng, TOP, 'prepared', 'player', 0, 0, floors, exp, createShotTiming()).fireReadySec);
    xs.sort((a, b) => a - b);
    const median = xs[xs.length >> 1]!;
    expect(median).toBeGreaterThan(0.2);
    expect(median).toBeLessThan(0.3);
  });

  it('truncation is a cut, not a spike at the floor', () => {
    const rng = new Rng(5);
    let atFloor = 0;
    for (let i = 0; i < 4000; i++) if (reactionDraw(rng, TOP, -0.1, 0.15) === 0.15) atFloor++;
    expect(atFloor / 4000).toBeLessThan(0.01);
  });

  it('is deterministic for a seed', () => {
    const a = enemyShotTiming(new Rng(42), TOP, 'unaware', 'player', 0.2, 0.3, floors, exp, createShotTiming());
    const b = enemyShotTiming(new Rng(42), TOP, 'unaware', 'player', 0.2, 0.3, floors, exp, createShotTiming());
    expect(a).toEqual(b);
  });
});
