import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { DEG2RAD } from '../core/math';
import { Rng } from '../core/rng';
import { directionFromAngles, distance, vec3 } from '../core/vec3';
import type { AnchorLike } from './contracts';
import { ringAnchors } from './testHarness';
import { AnchorIndex, angleBetweenDeg, createSpawnQuery, SpawnScheduler } from './scheduler';

const tun = cloneTunables();
const player = { pos: vec3(0, 0, 0), yaw: 0, pitch: 0, eyeHeight: 1.62 };

function make(anchors: AnchorLike[], seed = 1, bounds?: { min: ReturnType<typeof vec3>; max: ReturnType<typeof vec3> }) {
  return new SpawnScheduler(tun.dial.floors, new Rng(seed), new AnchorIndex({ anchors, bounds }), player);
}

describe('pickAnchor', () => {
  it('never returns an anchor within 4 m of the eye, even when the query allows it', () => {
    const s = make(ringAnchors());
    const q = createSpawnQuery('post');
    q.minDist = 0;
    q.maxDist = 4; // only the 2 m ring is inside this band, and it is inside the floor
    const out = vec3();
    for (let i = 0; i < 200; i++) {
      const a = s.pickAnchor(q, out);
      if (a) expect(distance(s.eyePosition(), out)).toBeGreaterThanOrEqual(4);
    }
  });

  it('never returns an anchor inside the view cone closer than 5 m (design §9.3.5)', () => {
    // A ring at 4.5 m (eye-level aim points): only the part behind the ±51.5° view cone is fair.
    const ring: AnchorLike[] = [];
    for (let a = 0; a < 360; a += 10) {
      const rad = a * DEG2RAD;
      ring.push({ id: `r${a}`, kind: 'post', pos: vec3(Math.sin(rad) * 4.5, 1.62, -Math.cos(rad) * 4.5) });
    }
    const s = make(ring);
    const q = createSpawnQuery('post');
    q.minDist = 0;
    q.maxDist = 10;
    q.minAngleDeg = 0;
    q.maxAngleDeg = 180;
    const view = directionFromAngles(vec3(), player.yaw, player.pitch);
    const out = vec3();
    const dir = vec3();
    let picked = 0;
    for (let i = 0; i < 200; i++) {
      if (!s.pickAnchor(q, out)) continue;
      picked++;
      const e = s.eyePosition();
      const d = distance(e, out);
      dir.x = (out.x - e.x) / d;
      dir.y = (out.y - e.y) / d;
      dir.z = (out.z - e.z) / d;
      expect(angleBetweenDeg(dir, view)).toBeGreaterThanOrEqual(tun.dial.floors.spawnViewAngleDeg);
    }
    expect(picked).toBe(200);
  });

  it('respects the distance band when anchors exist inside it', () => {
    const s = make(ringAnchors());
    const q = createSpawnQuery('post');
    q.minDist = 9;
    q.maxDist = 21;
    const out = vec3();
    for (let i = 0; i < 100; i++) {
      expect(s.pickAnchor(q, out)).not.toBeNull();
      const d = distance(s.eyePosition(), out);
      expect(d).toBeGreaterThanOrEqual(9);
      expect(d).toBeLessThanOrEqual(21);
    }
  });

  it('respects the angle band from the view direction, measured to the aim point', () => {
    const s = make(ringAnchors(10));
    const q = createSpawnQuery('post');
    q.minAngleDeg = 5;
    q.maxAngleDeg = 25;
    q.minDist = 5;
    q.aimOffsetY = 1.66;
    const out = vec3();
    const view = directionFromAngles(vec3(), player.yaw, player.pitch);
    const dir = vec3();
    for (let i = 0; i < 100; i++) {
      expect(s.pickAnchor(q, out)).not.toBeNull();
      const e = s.eyePosition();
      const d = distance(e, out);
      dir.x = (out.x - e.x) / d;
      dir.y = (out.y - e.y) / d;
      dir.z = (out.z - e.z) / d;
      const ang = angleBetweenDeg(dir, view);
      expect(ang).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(ang).toBeLessThanOrEqual(25 + 1e-9);
      expect(out.y).toBeCloseTo(1.66, 9); // aim point includes the offset
    }
  });

  it('filters by tag', () => {
    const s = make(ringAnchors());
    const q = createSpawnQuery('post');
    q.tag = 'band-20';
    const out = vec3();
    for (let i = 0; i < 30; i++) {
      s.pickAnchor(q, out);
      expect(Math.hypot(out.x, out.z)).toBeCloseTo(20, 6);
    }
  });

  it('relaxes the angle, then the distance band, but never the floor', () => {
    const only: AnchorLike[] = [{ id: 'a', kind: 'post', pos: vec3(0, 0, -20) }, { id: 'near', kind: 'post', pos: vec3(0, 0, -2) }];
    const s = make(only);
    const q = createSpawnQuery('post');
    q.minAngleDeg = 90; // nothing is 90+ degrees from the view: angle band relaxes
    q.maxAngleDeg = 180;
    const out = vec3();
    expect(s.pickAnchor(q, out)?.id).toBe('a');
    q.minDist = 100; // nothing that far either: distance band relaxes too
    q.maxDist = 200;
    expect(s.pickAnchor(q, out)?.id).toBe('a');
    // Only the 2 m anchor left: the floor refuses it.
    const s2 = make([only[1]!]);
    expect(s2.pickAnchor(q, out)).toBeNull();
    expect(s2.rejected).toBe(1);
  });

  it('returns null for a kind the map does not have', () => {
    expect(make(ringAnchors()).pickAnchor(createSpawnQuery('gate'), vec3())).toBeNull();
  });

  it('picks uniformly among valid anchors', () => {
    const s = make(ringAnchors(), 7);
    const q = createSpawnQuery('post');
    q.minDist = 9;
    q.maxDist = 11; // the 10 m ring: 12 anchors
    const hits = new Map<string, number>();
    const out = vec3();
    for (let i = 0; i < 2400; i++) {
      const a = s.pickAnchor(q, out)!;
      hits.set(a.id, (hits.get(a.id) ?? 0) + 1);
    }
    expect(hits.size).toBe(12);
    for (const n of hits.values()) expect(n).toBeGreaterThan(120); // expected 200
  });

  it('is deterministic under the seed', () => {
    const run = (seed: number): string[] => {
      const s = make(ringAnchors(), seed);
      const q = createSpawnQuery('post');
      q.minDist = 5;
      const out = vec3();
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) ids.push(s.pickAnchor(q, out)!.id);
      return ids;
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });
});

describe('line of sight (the map says what is hidden)', () => {
  // A wall 5 m ahead (-Z) blocks everything in front of it within +-2 m of the axis.
  const wall = (from: { x: number; z: number }, to: { x: number; z: number }): boolean => {
    const t = (-5 - from.z) / (to.z - from.z);
    if (!(t > 0 && t < 1)) return true;
    return Math.abs(from.x + (to.x - from.x) * t) > 2;
  };
  const source = (anchors: AnchorLike[]) => new AnchorIndex({ anchors, sightClear: wall });

  it('pickAnchor skips anchors that are not visible, and reports nothing when all are hidden', () => {
    const behind: AnchorLike = { id: 'hidden', kind: 'post', pos: vec3(0, 0, -12) };
    const open: AnchorLike = { id: 'open', kind: 'post', pos: vec3(9, 0, -12) };
    const q = createSpawnQuery('post');
    const out = vec3();
    const s = new SpawnScheduler(tun.dial.floors, new Rng(1), source([behind, open]), player);
    for (let i = 0; i < 20; i++) expect(s.pickAnchor(q, out)!.id).toBe('open');
    const s2 = new SpawnScheduler(tun.dial.floors, new Rng(1), source([behind]), player);
    expect(s2.pickAnchor(q, out)).toBeNull();
  });

  it('sightClear is true when the map gives no predicate', () => {
    const s = make([]);
    expect(s.sightClear(vec3(0, 0, 0), vec3(0, 0, -20))).toBe(true);
  });
});
