import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { cloneTunables } from '../config/tunables';
import { secondsToTicks } from '../core/time';
import { vec3 } from '../core/vec3';
import type { AnchorSource } from './contracts';
import { READY, TABLE } from './drillSupport';
import { burstFor, sprayWall, stationsFor } from './sprayWall';
import { makeHarness, type Harness } from './testHarness';

/** The Range's three alcoves (sim/levels/range.json), shuffled so the order cannot come from the map. */
function alcoves(): AnchorSource {
  const a = (id: string, d: number, x: number) => ({
    id, kind: 'spray-alcove', distance: d, stand: vec3(x, 0, -28.5 + d), yaw: 0, post: vec3(x, 0, -28.5), panel: `panel-${d}`,
  });
  return { anchors: [a('spray-28', 28, 8), a('spray-12', 12, -8), a('spray-20', 20, 0)] };
}

const MAG = 30;

function start(dial = 20, seed = 3): Harness {
  const h = makeHarness(TABLE, dial);
  h.runner.begin(sprayWall, { seed, pinDial: dial, anchors: alcoves() });
  h.step(READY);
  return h;
}

let shotId = 0;
/** One bullet: `shotFired`, then its impact on the Post (`zone`) or the wall (null). */
function bullet(h: Harness, postId: number, zone: 'head' | 'body' | 'leg' | null, weapon = 'kestrel'): void {
  shotId++;
  h.bus.emit('shotFired', {
    tick: h.simTick, shotId, moving: false, speed: 0, airborne: false, crouching: false, weapon, dir: vec3(0, 0, -1), yaw: 0, pitch: 0, recoilPitchDeg: 0, recoilYawDeg: 0, spreadDeg: 0.2, ammo: 0,
  });
  h.bus.emit('shotImpact', { tick: h.simTick, shotId, onTarget: zone !== null, targetId: zone ? postId : -1, zone });
}

const postId = (h: Harness): number => [...h.targets.keys()][0]!;
const untilPost = (h: Harness, ticks = 400): void => {
  for (let i = 0; i < ticks && h.targets.size === 0; i++) h.step(1);
};
const reload = (h: Harness): void => {
  h.bus.emit('reloadStarted', { tick: h.simTick });
  h.step(secondsToTicks(2.5));
  h.bus.emit('reloadCompleted', { tick: h.simTick });
};

describe('Spray Wall rules', () => {
  it('is a 60 s spray drill on the Range with Kestrel, real magazines, standing still', () => {
    expect(sprayWall.skills).toEqual(['spray']);
    expect(sprayWall.map).toBe('range');
    expect(sprayWall.weapon).toBe('kestrel');
    expect(sprayWall.durationSec).toBe(60);
    expect(sprayWall.player?.infiniteMagazine).toBe(false);
    expect(sprayWall.player?.lockMovement).toBe(true);
    expect(sprayWall.missBreaksStreak).toBe(false);
  });

  it('burst length scales with the dial exactly as design §4.5: 3 below 30, 7 below 60, then the full magazine', () => {
    const cfg = cloneTunables().sprayWall;
    for (const [dial, bullets] of [[0, 3], [10, 3], [29.99, 3], [30, 7], [45, 7], [59.99, 7], [60, MAG], [85, MAG], [100, MAG]] as const) {
      expect(burstFor(dial, cfg, MAG), `dial ${dial}`).toBe(bullets);
    }
    expect(burstFor(100, cfg, 20)).toBe(20); // never more than the magazine
  });

  it('the required hit fraction runs 60% at dial 0 to 85% at dial 100 (a dial axis)', () => {
    expect(axes(0).sprayHitFraction).toBeCloseTo(0.6, 9);
    expect(axes(100).sprayHitFraction).toBeCloseTo(0.85, 9);
    expect(axes(50).sprayHitFraction).toBeCloseTo(0.725, 9);
    let prev = 0;
    for (let d = 0; d <= 100; d += 5) {
      const v = axes(d).sprayHitFraction;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('five sprays cycle the alcoves 12 / 20 / 28 / 12 / 20 m, whatever order the map lists them in', () => {
    const cfg = cloneTunables().sprayWall;
    expect(stationsFor(alcoves().anchors, cfg).map((a) => a.distance)).toEqual([12, 20, 28, 12, 20]);
    expect(stationsFor([], cfg)).toEqual([]);
  });

  it('stands the player at the first alcove for the ready phase, and a Post appears at its post after the stand is taken', () => {
    const h = makeHarness(TABLE, 20);
    h.runner.begin(sprayWall, { seed: 1, pinDial: 20, anchors: alcoves() });
    expect(h.placed).toHaveLength(1);
    expect(h.placed[0]).toMatchObject({ x: -8, z: -16.5, yaw: 0 }); // the 12 m alcove
    h.step(READY);
    expect(h.targets.size).toBe(0); // not at once: a beat to settle
    untilPost(h);
    expect(h.targets.size).toBe(1);
    const t = [...h.targets.values()][0]!;
    expect(t.kind).toBe('post');
    expect(t.pos).toMatchObject({ x: -8, y: 0, z: -28.5 });
    const started = h.events('sprayStarted');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ index: 0, station: 'spray-12', distanceM: 12, panel: 'panel-12', burst: 3 });
    expect(started[0]!.requiredFraction as number).toBeGreaterThan(0.59);
  });
});

describe('a spray is one trial', () => {
  it('3 of 3 on the wall at dial 20 wins: skillTrial, a score, the Post leaves, the next Post waits for the reload', () => {
    const h = start(20);
    untilPost(h);
    const id = postId(h);
    bullet(h, id, 'body');
    bullet(h, id, 'head');
    h.step(1);
    expect(h.events('sprayEnded')).toHaveLength(0); // one bullet short
    bullet(h, id, 'body');
    h.step(1);
    const ended = h.events('sprayEnded');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ index: 0, burst: 3, bullets: 3, hits: 3, headHits: 1, bodyHits: 2, fraction: 1, success: true, reason: 'burst' });
    const trials = h.events('skillTrial');
    expect(trials).toHaveLength(1);
    expect(trials[0]).toMatchObject({ skill: 'spray', success: true });
    expect(trials[0]!.extra).toMatchObject({ distanceM: 12, burst: 3, hits: 3, fraction: 1 });
    const score = h.events('scoreAwarded');
    expect(score).toHaveLength(1);
    expect(score[0]!.points as number).toBeGreaterThan(0);
    expect(h.runner.stats.score).toBe(score[0]!.points);
    expect(h.targets.size).toBe(0); // the Post left with the spray

    // No next Post until the reload completes, however long we wait.
    h.step(secondsToTicks(5));
    expect(h.targets.size).toBe(0);
    expect(h.events('sprayStarted')).toHaveLength(1);
    reload(h);
    h.step(secondsToTicks(0.3));
    expect(h.targets.size).toBe(0); // a beat after the reload, not at once
    untilPost(h);
    expect(h.events('sprayStarted')).toHaveLength(2);
    expect(h.events('sprayStarted')[1]).toMatchObject({ index: 1, station: 'spray-20', distanceM: 20 });
    expect(h.placed.at(-1)).toMatchObject({ x: 0, z: -8.5 }); // moved to the 20 m alcove
  });

  it('too few bullets on the wall fails the trial, pays nothing and breaks the clean streak', () => {
    const h = start(20);
    untilPost(h);
    const id = postId(h);
    bullet(h, id, 'body');
    bullet(h, id, null);
    bullet(h, id, 'leg'); // a leg hit does not count: design §4.5 says head or body
    h.step(1);
    const e = h.events('sprayEnded')[0]!;
    expect(e).toMatchObject({ hits: 1, success: false });
    expect(e.fraction as number).toBeCloseTo(1 / 3, 9);
    expect(h.events('skillTrial')[0]).toMatchObject({ success: false });
    expect(h.events('scoreAwarded')).toHaveLength(0);
    expect(h.runner.stats.score).toBe(0);
  });

  it('misses inside a spray do not break the clean streak; winning sprays build it, a lost one resets it', () => {
    const h = start(20);
    const winSpray = () => {
      untilPost(h);
      const id = postId(h);
      bullet(h, id, 'body');
      bullet(h, id, 'body');
      bullet(h, id, 'body');
      h.step(1);
    };
    winSpray();
    expect(h.runner.cleanStreak).toBe(1);
    reload(h);
    untilPost(h);
    const id = postId(h);
    bullet(h, id, 'head');
    bullet(h, id, null); // a miss mid-spray
    bullet(h, id, 'body'); // 2/3 = 67% >= 60% at dial 20: still a win
    h.step(1);
    expect(h.events('sprayEnded')[1]).toMatchObject({ success: true, hits: 2 });
    expect(h.runner.cleanStreak).toBe(2);
    reload(h);
    untilPost(h);
    const id3 = postId(h);
    bullet(h, id3, null);
    bullet(h, id3, null);
    bullet(h, id3, 'body');
    h.step(1);
    expect(h.events('skillTrial')[2]).toMatchObject({ success: false });
    expect(h.runner.cleanStreak).toBe(0);
  });

  it('bullets after the burst are ignored: they cannot change the verdict', () => {
    const h = start(20);
    untilPost(h);
    const id = postId(h);
    bullet(h, id, 'body');
    bullet(h, id, 'body');
    bullet(h, id, 'body');
    bullet(h, id, 'head'); // the same tick: already past the burst
    bullet(h, id, 'head');
    h.step(1);
    bullet(h, id, null); // after the Post left
    h.step(1);
    expect(h.events('sprayEnded')).toHaveLength(1);
    expect(h.events('sprayEnded')[0]).toMatchObject({ bullets: 3, hits: 3, headHits: 0 });
  });

  it('reloading before the burst is done ends the spray early, judged against the whole burst', () => {
    const h = start(50); // bursts of 7
    untilPost(h);
    const id = postId(h);
    for (let i = 0; i < 4; i++) bullet(h, id, 'body');
    h.bus.emit('reloadStarted', { tick: h.simTick });
    h.step(1);
    const e = h.events('sprayEnded')[0]!;
    expect(e).toMatchObject({ burst: 7, bullets: 4, hits: 4, reason: 'reload', success: false }); // 4/7 = 57% < 72.5%
    expect(e.fraction as number).toBeCloseTo(4 / 7, 9);
  });

  it('the full-magazine burst ends on the last round even though the empty gun starts a reload that tick', () => {
    const h = start(80);
    untilPost(h);
    const id = postId(h);
    expect(h.events('sprayStarted')[0]).toMatchObject({ burst: MAG });
    for (let i = 0; i < MAG; i++) bullet(h, id, 'body');
    h.bus.emit('reloadStarted', { tick: h.simTick }); // auto-reload on the empty magazine
    h.step(1);
    expect(h.events('sprayEnded')[0]).toMatchObject({ bullets: MAG, hits: MAG, reason: 'burst', success: true });
  });

  it('only the mode weapon counts: a sidearm shot is not a bullet of the spray', () => {
    const h = start(20);
    untilPost(h);
    const id = postId(h);
    bullet(h, id, 'body', 'pace');
    bullet(h, id, 'body', 'pace');
    bullet(h, id, 'body', 'pace');
    h.step(1);
    expect(h.events('sprayEnded')).toHaveLength(0);
  });

  it('a shot fired before the Post is up is not part of any spray, and a spent magazine caps the burst', () => {
    const h = start(80);
    h.bus.emit('shotFired', {
      tick: h.simTick, shotId: 900, moving: false, speed: 0, airborne: false, crouching: false, weapon: 'kestrel', dir: vec3(0, 0, -1), yaw: 0, pitch: 0, recoilPitchDeg: 0, recoilYawDeg: 0, spreadDeg: 0.2, ammo: 22,
    });
    untilPost(h);
    expect(h.events('sprayStarted')[0]).toMatchObject({ burst: 22 }); // 8 rounds went before the Post: the full magazine is 22 now
  });
});

describe('a run', () => {
  it('ends after the fifth spray (complete), a moment later so the wall can be read, with all five trials', () => {
    const h = start(20);
    for (let n = 0; n < 5; n++) {
      untilPost(h);
      const id = postId(h);
      bullet(h, id, 'body');
      bullet(h, id, 'body');
      bullet(h, id, 'body');
      h.step(1);
      if (n < 4) reload(h);
    }
    expect(h.runner.phase).toBe('live'); // not yet
    h.step(secondsToTicks(1.5));
    expect(h.runner.phase).toBe('result');
    expect(h.runner.endReason).toBe('complete');
    expect(h.events('skillTrial')).toHaveLength(5);
    expect(h.events('sprayStarted').map((e) => e.distanceM)).toEqual([12, 20, 28, 12, 20]);
    expect(h.runner.cleanStreak).toBe(5);
  });

  it('ends at 60 s with the sprays it got through when the player never finishes', () => {
    const h = start(20);
    h.step(secondsToTicks(61));
    expect(h.runner.phase).toBe('result');
    expect(h.runner.endReason).toBe('timer');
    expect(h.events('sprayStarted')).toHaveLength(1);
    expect(h.events('sprayEnded')).toHaveLength(0);
  });

  it('asks for a durable Post (a spray must not be able to kill it), and the trial follows the beat\'s dial', () => {
    const h = start(40);
    untilPost(h);
    expect([...h.targets.values()][0]!.durable).toBe(true);
    expect(h.runner.dial).toBe(40);
    expect(h.runner.axes.sprayHitFraction).toBeCloseTo(0.7, 9); // 0.6 + 0.25 x 0.4
    expect(h.events('sprayStarted')[0]!.requiredFraction as number).toBeCloseTo(0.7, 9);
  });

  it('a map with no spray alcoves ends the run instead of hanging', () => {
    const h = makeHarness(TABLE, 20);
    h.runner.begin(sprayWall, { seed: 1, anchors: { anchors: [] } });
    h.step(READY + 2);
    expect(h.runner.phase).toBe('result');
  });
});
