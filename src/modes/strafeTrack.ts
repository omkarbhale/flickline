import { modes as modeCfg } from '../config/modes';
import { clamp } from '../core/math';
import { secondsToTicks, TICK_DT } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { AnchorLike, StrafeSpawn } from './contracts';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { createSpawnQuery, type SpawnQuery } from './scheduler';

/** One Strafer slot: the Strafer in it (id -1 = empty) and the live tick its replacement may appear. */
interface Slot {
  id: number;
  nextAt: number;
  lane: AnchorLike | null;
  /** It stepped out from the lane's `a` end (else `b`). */
  fromA: boolean;
  /** Live tick it must be dead by. */
  deadline: number;
  spawnedAt: number;
  limitSec: number;
  speed: number;
  distance: number;
  hits: number;
  headHits: number;
}

interface State {
  slots: Slot[];
  query: SpawnQuery;
  pos: Vec3;
  feet: Vec3;
  strafe: StrafeSpawn;
  /** Scratch trial data, reused for every trial. */
  extra: Record<string, number>;
}

const MAX_SLOTS = 8;

function emptySlot(): Slot {
  return { id: -1, nextAt: 0, lane: null, fromA: true, deadline: 0, spawnedAt: 0, limitSec: 0, speed: 0, distance: 0, hits: 0, headHits: 0 };
}

/**
 * How many Strafers the dial wants alive: its density axis (1..6 in equal bands) spread over
 * 1..`maxAlive` in equal bands, so the mode's own 1-3 cap does not make the top half of the dial
 * identical (design §4.3, §9.4).
 */
export function wantedAlive(ctx: ModeContext<State>): number {
  const c = ctx.tunables.modes.strafeTrack;
  const d = ctx.tunables.dial.axes.density;
  const span = Math.max(1e-9, d.at100 - d.at0);
  const f = ((ctx.axes.density ?? d.at0) - d.at0) / span;
  return clamp(Math.round(1 + f * (c.maxAlive - 1)), 1, Math.min(c.maxAlive, MAX_SLOTS));
}

/**
 * How many living Strafers run `lane` and stepped out from each end; written to `counts` ([a, b],
 * then [2] = 1 if the newest of them came from `a`, else 0). Returns the total.
 */
function laneUse(s: State, lane: AnchorLike, counts: number[]): number {
  counts[0] = counts[1] = counts[2] = 0;
  let newest = -1;
  for (let i = 0; i < s.slots.length; i++) {
    const o = s.slots[i]!;
    if (o.id < 0 || o.lane !== lane) continue;
    counts[o.fromA ? 0 : 1]!++;
    if (o.spawnedAt >= newest) {
      newest = o.spawnedAt;
      counts[2] = o.fromA ? 1 : 0;
    }
  }
  return counts[0]! + counts[1]!;
}

const endCounts = [0, 0, 0];

/**
 * Put a Strafer in `slot`: on a lane whose distance fits the dial's distance axis (clamped to the
 * mode's 10-35 m), at one end of it (the edge of cover), with the dial's speed, leg and stand-still.
 * False = nothing could be placed this tick (try again next tick).
 */
function spawnStrafer(ctx: ModeContext<State>, slot: Slot): boolean {
  const s = ctx.state;
  const c = ctx.tunables.modes.strafeTrack;
  const q = s.query;
  const d = clamp(ctx.axes.distance ?? c.minDistM, c.minDistM, c.maxDistM);
  q.minDist = Math.max(c.minDistM, d * c.distanceLoMult);
  q.maxDist = Math.min(c.maxDistM, d * c.distanceHiMult);
  q.minAngleDeg = 0;
  q.maxAngleDeg = 180;
  q.refDir = null;
  q.aimOffsetY = ctx.tunables.targets.hit.headCentreStand;
  let lane: AnchorLike | null = null;
  for (let i = 0; i <= c.laneRetries; i++) {
    lane = ctx.scheduler.pickAnchor(q, s.pos);
    if (!lane || laneUse(s, lane, endCounts) === 0) break;
  }
  if (!lane || !lane.a || !lane.b) return false;
  // One end or the other, from the run's own stream: the Strafer steps out from there. On a lane
  // another Strafer already runs (the dial's distance band can hold a single lane), the end fewer of them stepped out from.
  laneUse(s, lane, endCounts);
  const coin = ctx.rng.next() < 0.5;
  const used = endCounts[0]! + endCounts[1]!;
  const fromA = used === 0 ? coin : endCounts[0] === endCounts[1] ? endCounts[2] === 0 : endCounts[0]! < endCounts[1]!;
  const end = fromA ? lane.a : lane.b;
  s.feet.x = end.x;
  s.feet.y = end.y;
  s.feet.z = end.z;
  const st = s.strafe;
  st.speed = ctx.axes.strafeSpeed ?? 3.7;
  st.legSec = ctx.axes.strafeLegSec ?? 0.7;
  st.standStillSec = ctx.axes.standStillSec ?? 0.3;
  st.laneA = lane.a;
  st.laneB = lane.b;
  const id = ctx.spawn('strafer', s.feet, { strafe: st });
  if (id < 0) return false;
  const eye = ctx.scheduler.eyePosition();
  slot.id = id;
  slot.lane = lane;
  slot.fromA = fromA;
  slot.spawnedAt = ctx.liveTick;
  slot.limitSec = ctx.axes.strafeLimitSec ?? 5;
  slot.deadline = ctx.liveTick + secondsToTicks(slot.limitSec);
  slot.speed = st.speed;
  slot.distance = Math.hypot(s.feet.x - eye.x, s.feet.z - eye.z);
  slot.hits = 0;
  slot.headHits = 0;
  return true;
}

function release(ctx: ModeContext<State>, slot: Slot): void {
  slot.id = -1;
  slot.lane = null;
  slot.nextAt = ctx.liveTick + secondsToTicks(ctx.tunables.modes.strafeTrack.replaceDelaySec);
}

function fillExtra(s: State, slot: Slot, ctx: ModeContext<State>, killed: boolean, ttkMs: number, headKill: boolean): Record<string, number> {
  const e = s.extra;
  e.distance = slot.distance;
  e.speed = slot.speed;
  e.limitSec = slot.limitSec;
  e.lifeMs = (ctx.liveTick - slot.spawnedAt) * TICK_DT * 1000;
  e.ttkMs = killed ? ttkMs : -1;
  e.hits = slot.hits;
  e.headHits = slot.headHits;
  e.headKill = headKill ? 1 : 0;
  e.expired = killed ? 0 : 1;
  return e;
}

/**
 * Strafe Track (design §4.3), trains `track`. Range, Kestrel, no reload; the player may move but
 * does not need to. 1-3 Strafers (the dial's density) strafe along the Range's `strafe-lane`
 * anchors 10-35 m away with a real stop-and-shoot rhythm (the Strafer behaviour, `sim/strafer.ts`);
 * they never shoot back here. Each Strafer is one trial: success = killed within its time limit
 * (8 s at dial 0, 3 s at dial 100). A replacement steps out of the lane's end 0.4 s after a kill
 * or a timeout. Time on target and the lead error are run-level stats from the sim's measurements
 * (`sim/runProbe.ts`, `feedback/statTracker.ts`).
 */
export const strafeTrack: ModeDef<State> = {
  id: 'strafeTrack',
  skills: ['track'],
  map: 'range',
  weapon: 'kestrel',
  player: { infiniteMagazine: true },
  durationSec: modeCfg.drillSec,
  axes: ['strafeSpeed', 'strafeLegSec', 'standStillSec', 'strafeLimitSec', 'distance', 'density'],

  setup(ctx) {
    const c = ctx.tunables.modes.strafeTrack;
    const slots: Slot[] = [];
    for (let i = 0; i < Math.min(c.maxAlive, MAX_SLOTS); i++) {
      const slot = emptySlot();
      slot.nextAt = secondsToTicks(c.openingStaggerSec * i);
      slots.push(slot);
    }
    return {
      slots,
      query: createSpawnQuery('strafe-lane'),
      pos: vec3(),
      feet: vec3(),
      strafe: { speed: 0, legSec: 0, standStillSec: 0, laneA: vec3(), laneB: vec3() },
      extra: {},
    };
  },

  tick(ctx: ModeContext<State>) {
    const s = ctx.state;
    const want = wantedAlive(ctx);
    for (let i = 0; i < s.slots.length; i++) {
      const slot = s.slots[i]!;
      if (slot.id >= 0) {
        if (ctx.liveTick < slot.deadline) continue;
        // Out of time: the trial is failed (with its data) and the Strafer leaves.
        const id = slot.id;
        ctx.resolveTrial(id, false, { extra: fillExtra(s, slot, ctx, false, 0, false) });
        ctx.despawn(id);
        release(ctx, slot);
      } else if (i < want && ctx.liveTick >= slot.nextAt) {
        spawnStrafer(ctx, slot);
      }
    }
  },

  onEvent(ctx: ModeContext<State>, ev: ModeEvent) {
    const s = ctx.state;
    if (ev.type === 'shotImpact') {
      const id = ev.payload.targetId;
      if (id === undefined || id < 0) return;
      for (let i = 0; i < s.slots.length; i++) {
        const slot = s.slots[i]!;
        if (slot.id !== id) continue;
        slot.hits++;
        if (ev.payload.zone === 'head') slot.headHits++;
      }
      return;
    }
    const id = ev.payload.targetId;
    for (let i = 0; i < s.slots.length; i++) {
      const slot = s.slots[i]!;
      if (slot.id !== id) continue;
      if (ev.type === 'targetKilled') {
        const p = ev.payload;
        ctx.resolveTrial(id, true, { rtMs: p.rtMs, extra: fillExtra(s, slot, ctx, true, p.ttkMs, p.zone === 'head') });
      }
      release(ctx, slot);
      return;
    }
  },
};
