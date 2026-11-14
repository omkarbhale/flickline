import { describe, expect, it } from 'vitest';
import { cloneTunables } from '../config/tunables';
import { DEG2RAD } from '../core/math';
import { Rng } from '../core/rng';
import { directionFromAngles, distance, vec3 } from '../core/vec3';
import type { AnchorLike } from './contracts';
import { ringAnchors } from './testHarness';
import { AnchorIndex, angleBetweenDeg, createSpawnQuery, SpawnScheduler } from './scheduler';

const tun = cloneTunables();
const cfg = tun.modes;
const player = { pos: vec3(0, 0, 0), yaw: 0, pitch: 0, eyeHeight: 1.62 };

function make(anchors: AnchorLike[], seed = 1, bounds?: { min: ReturnType<typeof vec3>; max: ReturnType<typeof vec3> }) {
  return new SpawnScheduler(cfg, tun.dial.floors, new Rng(seed), new AnchorIndex({ anchors, bounds }), player);
}

describe('pickAnchor', () => {
  it('never returns an anchor within 3 m of the eye, even when the query allows it', () => {
    const s = make(ringAnchors());
    const q = createSpawnQuery('post');
    q.minDist = 0;
    q.maxDist = 4; // only the 2 m ring is inside this band, and it is inside the floor
    const out = vec3();
    for (let i = 0; i < 200; i++) {
      const a = s.pickAnchor(q, out);
      if (a) expect(distance(s.eyePosition(), out)).toBeGreaterThanOrEqual(3);
    }
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

describe('pickShellPoint (Orbit-style shell)', () => {
  const shell: AnchorLike = { id: 's', kind: 'beacon-shell', centre: vec3(0, 1.6, 0), rMin: 8, rMax: 25 };

  it('honours radius, angle band, pitch limits and the 3 m floor', () => {
    const s = make([shell], 3);
    const q = createSpawnQuery('beacon-shell');
    const prev = directionFromAngles(vec3(), 0.7, 0.1);
    q.refDir = prev;
    q.minAngleDeg = 90;
    q.maxAngleDeg = 180;
    const out = vec3();
    const dir = vec3();
    for (let i = 0; i < 300; i++) {
      expect(s.pickShellPoint(shell, q, out)).toBe(true);
      const e = s.eyePosition();
      const r = distance(e, out);
      expect(r).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(r).toBeLessThanOrEqual(25 + 1e-9);
      dir.x = (out.x - e.x) / r;
      dir.y = (out.y - e.y) / r;
      dir.z = (out.z - e.z) / r;
      const ang = angleBetweenDeg(dir, prev);
      expect(ang).toBeGreaterThanOrEqual(90 - 1e-6);
      expect(ang).toBeLessThanOrEqual(180 + 1e-6);
      const pitchDeg = Math.asin(dir.y) / DEG2RAD;
      expect(pitchDeg).toBeGreaterThanOrEqual(cfg.shellPitchMinDeg - 1e-6);
      expect(pitchDeg).toBeLessThanOrEqual(cfg.shellPitchMaxDeg + 1e-6);
    }
  });

  it('biases the pitch towards head height', () => {
    const s = make([shell], 5);
    const q = createSpawnQuery('beacon-shell');
    q.minAngleDeg = 20;
    q.maxAngleDeg = 40;
    const out = vec3();
    let central = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      s.pickShellPoint(shell, q, out);
      const e = s.eyePosition();
      const pitch = Math.asin((out.y - e.y) / distance(e, out)) / DEG2RAD;
      if (Math.abs(pitch - cfg.shellPitchBiasDeg) < 6) central++;
    }
    // A uniform pitch over 45 degrees would put 12/45 = 27% there; the triangular bias doubles it.
    expect(central / N).toBeGreaterThan(0.4);
  });

  it('stays inside the map bounds and fails cleanly when nothing fits', () => {
    const s = make([shell], 9, { min: vec3(-30, 0, -30), max: vec3(30, 8, 30) });
    const q = createSpawnQuery('beacon-shell');
    q.minAngleDeg = 0;
    q.maxAngleDeg = 180;
    const out = vec3();
    for (let i = 0; i < 200; i++) {
      if (!s.pickShellPoint(shell, q, out)) continue;
      expect(out.y).toBeGreaterThanOrEqual(0);
      expect(out.y).toBeLessThanOrEqual(8);
    }
    const tight = make([shell], 9, { min: vec3(-1, 0, -1), max: vec3(1, 3, 1) });
    expect(tight.pickShellPoint(shell, q, out)).toBe(false);
    expect(tight.rejected).toBe(1);
    q.minDist = 50;
    q.maxDist = 60; // band beyond the shell
    expect(make([shell]).pickShellPoint(shell, q, out)).toBe(false);
  });

  it('is deterministic under the seed', () => {
    const run = (seed: number): number[] => {
      const s = make([shell], seed);
      const q = createSpawnQuery('beacon-shell');
      q.minAngleDeg = 30;
      q.maxAngleDeg = 120;
      const out = vec3();
      const v: number[] = [];
      for (let i = 0; i < 20; i++) {
        s.pickShellPoint(shell, q, out);
        v.push(out.x, out.y, out.z);
      }
      return v;
    };
    expect(run(11)).toEqual(run(11));
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
    const s = new SpawnScheduler(cfg, tun.dial.floors, new Rng(1), source([behind, open]), player);
    for (let i = 0; i < 20; i++) expect(s.pickAnchor(q, out)!.id).toBe('open');
    const s2 = new SpawnScheduler(cfg, tun.dial.floors, new Rng(1), source([behind]), player);
    expect(s2.pickAnchor(q, out)).toBeNull();
  });

  it('pickShellPoint never returns a point behind the wall', () => {
    const shell: AnchorLike = { id: 's', kind: 'beacon-shell', centre: vec3(0, 1.62, 0), rMin: 8, rMax: 25 };
    const s = new SpawnScheduler(cfg, tun.dial.floors, new Rng(3), source([shell]), player);
    const q = createSpawnQuery('beacon-shell');
    q.minAngleDeg = 0;
    q.maxAngleDeg = 40; // straight ahead: the wall is in the way for the central part
    const out = vec3();
    let found = 0;
    for (let i = 0; i < 200; i++) {
      if (!s.pickShellPoint(shell, q, out)) continue;
      found++;
      expect(wall(s.eyePosition(), out)).toBe(true);
    }
    expect(found).toBeGreaterThan(20);
  });

  it('sightClear is true when the map gives no predicate', () => {
    const s = make([]);
    expect(s.sightClear(vec3(0, 0, 0), vec3(0, 0, -20))).toBe(true);
  });
});
