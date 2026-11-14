import { secondsToTicks } from '../core/time';
import { createSpawnQuery, gapTicks, type SpawnQuery } from './scheduler';
import { vec3, type Vec3 } from '../core/vec3';
import type { ModeContext, ModeDef } from './modeDef';
import type { AxisRange } from './linearDial';

/** Axes `TestMode` uses (a slice of design §9.4); the real table lives in #17's `config/dial.ts`. */
export const TEST_MODE_AXES: Record<string, AxisRange> = {
  exposureSec: { at0: 3, at100: 0.45, geometric: true },
  distance: { at0: 5, at100: 50, geometric: true },
};

interface State {
  /** Tick at which the next target appears. */
  nextAt: number;
  targetId: number;
  readonly pos: Vec3;
  readonly query: SpawnQuery;
}

/**
 * The smallest useful mode, and the proof that a mode needs < 100 lines: one Post at a time at a
 * seeded anchor, killed before it leaves = success. The framework does run timing, beats and the
 * dial, scoring, streaks and `skillTrial`.
 */
export const testMode: ModeDef<State> = {
  id: 'test',
  skills: ['precision'],
  map: 'range',
  weapon: 'kestrel',
  durationSec: 30,
  axes: ['exposureSec', 'distance'],

  setup: () => ({ nextAt: 0, targetId: -1, pos: vec3(), query: createSpawnQuery('post') }),

  tick(ctx: ModeContext<State>) {
    const s = ctx.state;
    if (s.targetId >= 0 || ctx.liveTick < s.nextAt) return;
    const q = s.query;
    q.minDist = ctx.axes.distance! * 0.6;
    q.maxDist = ctx.axes.distance!;
    q.aimOffsetY = ctx.tunables.targets.hit.headCentreStand;
    const anchor = ctx.scheduler.pickAnchor(q, s.pos);
    if (!anchor) return;
    s.pos.y -= q.aimOffsetY; // the anchor is at the feet; the pick measured to the head
    s.targetId = ctx.spawn('post', s.pos, { lifetimeSec: ctx.axes.exposureSec! });
  },

  onEvent(ctx: ModeContext<State>, ev) {
    if (ev.type === 'shotImpact' || ev.payload.targetId !== ctx.state.targetId) return;
    ctx.state.targetId = -1;
    ctx.state.nextAt = ctx.liveTick + (ev.type === 'targetKilled' ? secondsToTicks(0.1) : gapTicks(ctx.rng, 0.2, 0.4));
  },
};
