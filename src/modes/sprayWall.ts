import { clamp } from '../core/math';
import { secondsToTicks } from '../core/time';
import type { AnchorLike, TrialExtra } from './contracts';
import type { ModeContext, ModeDef, ModeEvent, WeaponEvent } from './modeDef';
import type { WeaponId } from '../config/weapon';
import type { SprayWallTunables } from '../config/sprayWall';

/**
 * Spray Wall (design §4.5), trains `spray`. Range, Kestrel, real magazines. Five sprays, one per
 * alcove in the order 12 / 20 / 28 / 12 / 20 m: stand at the alcove, a Post appears in front of a
 * wall panel that records the bullets, fire the burst the dial asks for (3 / 7 / the whole
 * magazine), reload, and the next alcove starts when the reload completes. The run ends after the
 * fifth spray or at 60 s.
 *
 * One spray is one trial: success = at least the dial's fraction of the burst's bullets in the
 * Post's head or body (bullets never fired count as misses, so stopping early cannot pass). The
 * Post cannot die (it is `durable`): a 30-round spray would kill a 100 HP Post in three body hits,
 * after which every bullet would count as a miss. The mode keeps only counters; the per-bullet
 * spray trace (impact offset, the player's pull, the spec's required counter-pull) is cut from the
 * event log by `feedback/statTracker.ts`, between `sprayStarted` and `sprayEnded`.
 */

/** What the mode is doing between events. */
const WAIT = 0; // no Post yet: the stand was taken (run start, or the last reload finished)
const ACTIVE = 1; // Post up, counting bullets
const RELOAD = 2; // the spray was judged and its Post left; waiting for the reload to finish
const FINISH = 3; // the last spray was judged; waiting to end the run

export interface SprayWallState {
  phase: number;
  /** Sprays started so far (the next spray's index). */
  index: number;
  /** Live tick at which the next Post may appear / the run ends. */
  nextAt: number;
  stations: AnchorLike[];
  /** The current (or just finished) spray. */
  station: AnchorLike | null;
  postId: number;
  burst: number;
  required: number;
  bullets: number;
  hits: number;
  headHits: number;
  bodyHits: number;
  lastShotId: number;
  /** Rounds in the magazine (from `shotFired.ammo`, refilled by a completed reload). */
  ammo: number;
  /** The burst is complete (or the player reloaded): judge it on the next tick. */
  closing: boolean;
  reason: 'burst' | 'reload';
  readonly extra: Record<string, number>;
}

/** The burst length the dial asks for: 3 below dial 30, 7 below 60, then the whole magazine. */
export function burstFor(dial: number, cfg: SprayWallTunables, magazine: number): number {
  for (let i = 0; i < cfg.burstBands.length; i++) {
    const b = cfg.burstBands[i]!;
    if (dial < b.below) return Math.min(b.bullets, magazine);
  }
  return magazine;
}

/** Stations in spray order: the alcove at each distance of the cycle (nearest match), repeated for every spray of the run. */
export function stationsFor(anchors: readonly AnchorLike[], cfg: SprayWallTunables): AnchorLike[] {
  const out: AnchorLike[] = [];
  if (anchors.length === 0) return out;
  for (let i = 0; i < cfg.sprays; i++) {
    const want = cfg.distanceOrderM[i % cfg.distanceOrderM.length]!;
    let best = anchors[0]!;
    for (let k = 1; k < anchors.length; k++) {
      if (Math.abs((anchors[k]!.distance ?? 0) - want) < Math.abs((best.distance ?? 0) - want)) best = anchors[k]!;
    }
    out.push(best);
  }
  return out;
}

function counted(zone: 'head' | 'body' | 'leg' | null | undefined, cfg: SprayWallTunables): boolean {
  if (!zone) return false;
  for (let i = 0; i < cfg.countedZones.length; i++) if (cfg.countedZones[i] === zone) return true;
  return false;
}

function magazineOf(ctx: ModeContext<SprayWallState>): number {
  return ctx.tunables.weapon[ctx.mode.weapon as WeaponId].magazine;
}

function stand(ctx: ModeContext<SprayWallState>, a: AnchorLike): void {
  const p = a.stand!;
  ctx.placePlayer(p.x, p.y, p.z, a.yaw ?? 0);
}

function startSpray(ctx: ModeContext<SprayWallState>): void {
  const s = ctx.state;
  const cfg = ctx.tunables.sprayWall;
  const a = s.stations[s.index]!;
  if (s.index > 0) stand(ctx, a);
  const id = ctx.spawn('post', a.post!, { skill: 'spray', durable: true });
  if (id < 0) return; // refused (spawn fairness): try again next tick
  s.station = a;
  s.postId = id;
  s.burst = Math.max(1, Math.min(burstFor(ctx.dial, cfg, magazineOf(ctx)), s.ammo));
  s.required = ctx.axes.sprayHitFraction ?? 0.7;
  s.bullets = s.hits = s.headHits = s.bodyHits = 0;
  s.lastShotId = -1;
  s.closing = false;
  s.reason = 'burst';
  s.phase = ACTIVE;
  ctx.events.emit('sprayStarted', {
    tick: ctx.simTick,
    t: ctx.timeSec,
    index: s.index,
    station: a.id,
    distanceM: a.distance ?? 0,
    panel: a.panel ?? '',
    burst: s.burst,
    requiredFraction: s.required,
    postId: id,
  });
  s.index++;
}

function endSpray(ctx: ModeContext<SprayWallState>): void {
  const s = ctx.state;
  const fraction = s.hits / s.burst;
  const success = fraction >= s.required - 1e-9;
  const e = s.extra;
  e.index = s.index - 1;
  e.distanceM = s.station?.distance ?? 0;
  e.burst = s.burst;
  e.bullets = s.bullets;
  e.hits = s.hits;
  e.headHits = s.headHits;
  e.bodyHits = s.bodyHits;
  e.fraction = fraction;
  e.required = s.required;
  ctx.events.emit('sprayEnded', {
    tick: ctx.simTick,
    t: ctx.timeSec,
    index: s.index - 1,
    burst: s.burst,
    bullets: s.bullets,
    hits: s.hits,
    headHits: s.headHits,
    bodyHits: s.bodyHits,
    requiredFraction: s.required,
    fraction,
    success,
    reason: s.reason,
  });
  ctx.resolveTrial(s.postId, success, { extra: e as TrialExtra });
  if (success) ctx.awardScore(s.postId, { weight: clamp(fraction, 0, 1) });
  // The Post leaves with the spray; the wall's decals stay until the next spray starts.
  ctx.despawn(s.postId);
  s.postId = -1;
  if (s.index >= ctx.tunables.sprayWall.sprays) {
    s.phase = FINISH;
    s.nextAt = ctx.liveTick + secondsToTicks(ctx.tunables.sprayWall.finishDelaySec);
  } else {
    s.phase = RELOAD;
  }
}

export const sprayWall: ModeDef<SprayWallState> = {
  id: 'sprayWall',
  skills: ['spray'],
  map: 'range',
  weapon: 'kestrel',
  // Real magazines, but a reload never runs dry; the player stands still at the alcove.
  player: { lockMovement: true, infiniteMagazine: false, infiniteReserve: true },
  durationSec: 60,
  axes: ['sprayHitFraction'],
  // Misses are expected below 100%: a spray is judged as a whole, so the streak counts sprays won.
  missBreaksStreak: false,

  setup(ctx) {
    const state: SprayWallState = {
      phase: WAIT,
      index: 0,
      nextAt: secondsToTicks(ctx.tunables.sprayWall.postAppearSec),
      stations: stationsFor(ctx.scheduler.anchorsOfKind('spray-alcove'), ctx.tunables.sprayWall),
      station: null,
      postId: -1,
      burst: 0,
      required: 0,
      bullets: 0,
      hits: 0,
      headHits: 0,
      bodyHits: 0,
      lastShotId: -1,
      ammo: ctx.tunables.weapon[sprayWall.weapon as WeaponId].magazine,
      closing: false,
      reason: 'burst',
      extra: {
        index: 0, distanceM: 0, burst: 0, bullets: 0, hits: 0, headHits: 0, bodyHits: 0, fraction: 0, required: 0,
      },
    };
    if (state.stations.length > 0) stand(ctx as ModeContext<SprayWallState>, state.stations[0]!);
    return state;
  },

  tick(ctx) {
    const s = ctx.state;
    if (s.stations.length === 0) {
      ctx.end('quit'); // a map without spray alcoves cannot host this mode
      return;
    }
    switch (s.phase) {
      case WAIT:
        if (ctx.liveTick >= s.nextAt && s.ammo > 0) startSpray(ctx);
        break;
      case ACTIVE:
        if (s.closing) endSpray(ctx);
        break;
      case FINISH:
        if (ctx.liveTick >= s.nextAt) ctx.end('complete');
        break;
      default:
        break;
    }
  },

  onEvent(ctx, ev: ModeEvent) {
    const s = ctx.state;
    if (ev.type !== 'shotImpact') return;
    const p = ev.payload;
    if (s.phase !== ACTIVE || (p.shotId !== undefined && p.shotId !== s.lastShotId)) return;
    if (!p.onTarget || p.targetId !== s.postId || !counted(p.zone, ctx.tunables.sprayWall)) return;
    s.hits++;
    if (p.zone === 'head') s.headHits++;
    else s.bodyHits++;
  },

  onWeapon(ctx, ev: WeaponEvent) {
    const s = ctx.state;
    const cfg = ctx.tunables.sprayWall;
    switch (ev.type) {
      case 'shotFired': {
        if (ev.payload.weapon === ctx.mode.weapon) s.ammo = ev.payload.ammo;
        if (s.phase !== ACTIVE || s.closing || ev.payload.weapon !== ctx.mode.weapon) break;
        s.bullets++;
        s.lastShotId = ev.payload.shotId;
        if (s.bullets >= s.burst) s.closing = true;
        break;
      }
      case 'reloadStarted':
        // Reloading before the burst is done ends the spray early (judged against the whole burst).
        // The reload that starts on the burst's own last bullet (an empty magazine) is not early.
        if (s.phase === ACTIVE && !s.closing && s.bullets > 0) {
          s.closing = true;
          s.reason = 'reload';
        }
        break;
      case 'reloadCompleted':
        s.ammo = magazineOf(ctx);
        if (s.phase === RELOAD) {
          s.phase = WAIT;
          s.nextAt = ctx.liveTick + secondsToTicks(cfg.postAppearSec);
        }
        break;
      default:
        break;
    }
  },
};

