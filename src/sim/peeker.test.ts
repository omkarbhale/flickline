import { describe, expect, it } from 'vitest';
import { axes } from '../adaptive/dial';
import { cloneTunables } from '../config/tunables';
import { EventBus } from '../core/eventBus';
import { TICK_DT } from '../core/time';
import { vec3 } from '../core/vec3';
import type { PeekPattern } from './mapTypes';
import { bandExposure, bodyExposure, bodyTop } from './exposure';
import { PEEK_HIDDEN, PEEK_HOLD } from './peeker';
import { createTickInput, type LevelDef, type SimEvents } from './types';
import { World } from './world';

/**
 * A flat arena with a wall at z 0; the Echo holds 1.5 m behind it, the player stands 20 m in front.
 * Full cover (2.5 m) for the lateral peeks, low cover (1.35 m: above a crouched head, below a
 * standing one) for the hop.
 */
const arenaWith = (coverTop: number): LevelDef => ({
  name: 'peek arena',
  boxes: [
    { tag: 'floor', min: vec3(-200, -1, -200), max: vec3(200, 0, 200) },
    { tag: 'cover', id: 'cover', min: vec3(-1.5, 0, -0.5), max: vec3(1.5, coverTop, 0.5) },
  ],
  spawn: { pos: vec3(0, 0, 20), yaw: 0 },
  targets: [],
});
const arena = arenaWith(2.5);
const lowArena = arenaWith(1.35);

const tun = cloneTunables();
const H = tun.targets.hit;
const TICK = TICK_DT * 1.01;

interface Sample {
  state: number;
  crouched: boolean;
  /** Fine-grid exposure of the whole body, and of the head, torso and leg bands. */
  body: number;
  head: number;
  torso: number;
  leg: number;
  measured: boolean;
}

function runPeek(pattern: PeekPattern, seconds: number, opts: { wideSec?: number; crouchedHold?: boolean; seed?: number } = {}): Sample[] {
  const world = new World({ level: opts.crouchedHold ? lowArena : arena, tunables: cloneTunables(), seed: opts.seed ?? 3 });
  const bus = new EventBus<SimEvents>();
  const id = world.spawnTarget('peeker', 0, 0, -1.5, bus, {
    peek: {
      pattern, hold: vec3(0, 0, -1.5), out: vec3(2, 0, -1.5), wideSec: opts.wideSec, crouchedHold: opts.crouchedHold,
    },
  });
  const t = world.targetField.byId(id)!;
  const p = world.player;
  const boxes = world.level.boxes;
  const eye = (f: (ey: number) => number): number => f(p.pos.y + p.eyeHeight);
  const input = createTickInput();
  const out: Sample[] = [];
  const COLS = 31;
  for (let i = 0; i < seconds * 128; i++) {
    world.step(input, bus);
    const c = t.crouched;
    // Exposure is measured while holding a step and every 16th tick otherwise (it is a dense raycast).
    if (t.fsm.state !== PEEK_HOLD && i % 16 !== 0) {
      out.push({ state: t.fsm.state, crouched: c, body: 0, head: 0, torso: 0, leg: 0, measured: false });
      continue;
    }
    const top = bodyTop(H, c);
    const band = (y0: number, y1: number): number =>
      eye((ey) => bandExposure(boxes, H, c, p.pos.x, ey, p.pos.z, t.pos.x, t.pos.y, t.pos.z, y0, y1, COLS, 5));
    out.push({
      state: t.fsm.state,
      crouched: c,
      body: eye((ey) => bodyExposure(boxes, H, c, p.pos.x, ey, p.pos.z, t.pos.x, t.pos.y, t.pos.z, COLS, 9)),
      head: band((c ? H.headCentreCrouch : H.headCentreStand) - H.headRadius, top),
      torso: band(c ? H.torsoBottomCrouch : H.torsoBottomStand, c ? H.torsoTopCrouch : H.torsoTopStand),
      leg: band(0, c ? H.legTopCrouch : H.legTopStand),
      measured: true,
    });
  }
  return out;
}

/** Lengths (seconds) of the complete runs of `state`, and the samples in each. */
function runsOf(s: readonly Sample[], state: number): Sample[][] {
  const out: Sample[][] = [];
  let cur: Sample[] | null = null;
  for (let i = 0; i <= s.length; i++) {
    const inState = i < s.length && s[i]!.state === state;
    if (inState) (cur ??= []).push(s[i]!);
    else if (cur) {
      if (i < s.length) out.push(cur);
      cur = null;
    }
  }
  return out;
}

const secs = (r: readonly unknown[]): number => r.length * TICK_DT;

describe('Peeker patterns expose the design\'s fractions of the body (raycast, design §5.2)', () => {
  it('hidden behind the cover nothing of the body is visible', () => {
    for (const s of runPeek('wide', 6).filter((x) => x.measured && x.state === PEEK_HIDDEN)) expect(s.body).toBeLessThan(0.02);
  });

  it('shoulder: 40% of the body for 0.3 s', () => {
    const holds = runsOf(runPeek('shoulder', 12), PEEK_HOLD);
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const h of holds) {
      expect(Math.abs(secs(h) - 0.3)).toBeLessThanOrEqual(TICK);
      for (const s of h) expect(Math.abs(s.body - 0.4)).toBeLessThanOrEqual(0.06);
    }
  });

  it('wide: the full body for 0.8-1.2 s by default', () => {
    const holds = runsOf(runPeek('wide', 20), PEEK_HOLD);
    expect(holds.length).toBeGreaterThanOrEqual(5);
    for (const h of holds) {
      expect(secs(h)).toBeGreaterThanOrEqual(0.8 - TICK);
      expect(secs(h)).toBeLessThanOrEqual(1.2 + TICK);
      for (const s of h) expect(s.body).toBeGreaterThanOrEqual(0.95);
    }
    // The draw is a real range.
    const lengths = holds.map(secs);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.05);
  });

  it('wide at the top of the dial: the dial\'s exposure with its floor (0.3 s)', () => {
    const wide = axes(100).peekWideSec;
    expect(wide).toBeCloseTo(0.3, 5);
    for (const h of runsOf(runPeek('wide', 12, { wideSec: wide }), PEEK_HOLD)) {
      expect(secs(h)).toBeGreaterThanOrEqual(0.3 - TICK);
      expect(secs(h)).toBeLessThanOrEqual(0.36 + TICK);
    }
  });

  it('jiggle: shoulder out, in, out (0.15, 0.12, 0.15 s)', () => {
    const holds = runsOf(runPeek('jiggle', 14), PEEK_HOLD);
    expect(holds.length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i + 2 < holds.length; i += 3) {
      const [a, b, c] = [holds[i]!, holds[i + 1]!, holds[i + 2]!];
      expect(Math.abs(secs(a) - 0.15)).toBeLessThanOrEqual(TICK);
      expect(Math.abs(secs(b) - 0.12)).toBeLessThanOrEqual(TICK);
      expect(Math.abs(secs(c) - 0.15)).toBeLessThanOrEqual(TICK);
      for (const s of [...a, ...c]) expect(Math.abs(s.body - 0.4)).toBeLessThanOrEqual(0.06);
      for (const s of b) expect(s.body).toBeLessThan(0.02);
    }
  });

  it('hop: rises above low cover for 0.35 s, head and upper body only', () => {
    const samples = runPeek('hop', 12, { crouchedHold: true });
    const holds = runsOf(samples, PEEK_HOLD);
    expect(holds.length).toBeGreaterThanOrEqual(3);
    for (const h of holds) {
      expect(Math.abs(secs(h) - 0.35)).toBeLessThanOrEqual(TICK);
      for (const s of h) {
        expect(s.crouched).toBe(false);
        expect(s.head).toBeGreaterThanOrEqual(0.95);
        expect(s.torso).toBeGreaterThan(0.1);
        expect(s.leg).toBeLessThan(0.02);
      }
    }
    // Crouched behind the wall it shows nothing.
    for (const s of samples.filter((x) => x.measured && x.state === PEEK_HIDDEN)) {
      expect(s.crouched).toBe(true);
      expect(s.body).toBeLessThan(0.02);
    }
  });

  it('the position is solved from where the player stands: a player standing off to the open side still sees 40%', () => {
    const world = new World({ level: arena, tunables: cloneTunables(), seed: 9 });
    const bus = new EventBus<SimEvents>();
    world.placePlayer(4, 0, 14, 0);
    const id = world.spawnTarget('peeker', 0, 0, -1.5, bus, {
      peek: { pattern: 'shoulder', hold: vec3(0, 0, -1.5), out: vec3(2, 0, -1.5) },
    });
    const t = world.targetField.byId(id)!;
    const p = world.player;
    const input = createTickInput();
    let seen = 0;
    for (let i = 0; i < 128 * 8; i++) {
      world.step(input, bus);
      if (t.fsm.state !== PEEK_HOLD) continue;
      const e = bodyExposure(world.level.boxes, H, t.crouched, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z, t.pos.x, t.pos.y, t.pos.z, 41, 9);
      expect(Math.abs(e - 0.4)).toBeLessThanOrEqual(0.06);
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });
});
