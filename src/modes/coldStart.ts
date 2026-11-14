import { modes as modeCfg } from '../config/modes';
import { secondsToTicks } from '../core/time';
import { directionFromAngles, vec3, type Vec3 } from '../core/vec3';
import type { AxisValues, SkillId } from './contracts';
import { angleDeg, directionTo, FIRST_HEAD, ShotTracker } from './aim';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { createSpawnQuery, gapTicks, type SpawnQuery } from './scheduler';

/** `Trial.step` / `onEvent` result: nothing ended, the target died, or it left unkilled. */
export const TRIAL_RUNNING = 0;
export const TRIAL_KILLED = 1;
export const TRIAL_LEFT = 2;
export type TrialStatus = typeof TRIAL_RUNNING | typeof TRIAL_KILLED | typeof TRIAL_LEFT;

/** One drill trial at a time: the common shape of the two engines, so the Placement run can mix them. */
export interface TrialEngine {
  readonly active: boolean;
  /** Success of the trial that ended last. */
  readonly lastSuccess: boolean;
  /** Gap before the next trial, in ticks, after a trial that ended this way (seeded). */
  gapTicks(ctx: ModeContext<unknown>, how: TrialStatus): number;
  /** Try to place the next target; false = nothing could be placed this tick (try again). */
  start(ctx: ModeContext<unknown>, axes: AxisValues, skill: SkillId, difficulty?: number): boolean;
  /** Per-tick bookkeeping (leave and expiry deadlines). */
  step(ctx: ModeContext<unknown>): TrialStatus;
  /** A sim fact; returns whether it ended the trial. */
  onEvent(ctx: ModeContext<unknown>, ev: ModeEvent): TrialStatus;
}

/**
 * Cold Start trial (design §4.1): one Post 5-25 degrees from the crosshair; the first bullet
 * decides it (head hit = success), and the Post leaves 0.25 s after that bullet whatever happened.
 * No bullet before its exposure ends: it leaves and counts as a miss by timeout.
 */
export class ColdStartTrial implements TrialEngine {
  targetId = -1;
  lastSuccess = false;
  private readonly tracker = new ShotTracker();
  private readonly head: Vec3 = vec3();
  private readonly feet: Vec3 = vec3();
  private readonly query: SpawnQuery = createSpawnQuery('post');
  private readonly view: Vec3 = vec3();
  private readonly dir: Vec3 = vec3();
  private expireAt = 0;
  private leaveAt = -1;
  private distance = 0;
  private readonly extra: Record<string, number> = {
    offsetDeg: 0, distance: 0, errDeg: -1, shots: 0, firstShotMs: -1, outcome: 0, timedOut: 0,
  };

  /**
   * `fromShell`: place the Post on the floor under a point of the Beacon shell instead of at a map
   * Post anchor, so it can appear all round the player (the Placement run, where the player stands
   * at the shell's centre and the Range's Post anchors are all in front of the spawn).
   */
  constructor(private readonly fromShell = false) {}

  get active(): boolean {
    return this.targetId >= 0;
  }

  gapTicks(ctx: ModeContext<unknown>): number {
    const c = ctx.tunables.modes.coldStart;
    return gapTicks(ctx.rng, c.gapMinSec, c.gapMaxSec);
  }

  start(ctx: ModeContext<unknown>, axes: AxisValues, skill: SkillId, difficulty?: number): boolean {
    const c = ctx.tunables.modes.coldStart;
    const q = this.query;
    const d = axes.distance ?? 15;
    q.minDist = d * c.distanceLoMult;
    q.maxDist = d * c.distanceHiMult;
    q.minAngleDeg = c.minAngleDeg;
    q.maxAngleDeg = c.maxAngleDeg;
    q.refDir = null;
    q.aimOffsetY = ctx.tunables.targets.hit.headCentreStand;
    if (this.fromShell) {
      if (!this.pickOnShell(ctx, q)) return false;
    } else {
      if (!ctx.scheduler.pickAnchor(q, this.head)) return false;
      this.feet.x = this.head.x;
      this.feet.y = this.head.y - q.aimOffsetY;
      this.feet.z = this.head.z;
    }
    const id = ctx.spawn('post', this.feet, { skill, difficulty });
    if (id < 0) return false;
    this.targetId = id;
    this.tracker.begin(ctx.player, this.head, ctx.liveTick);
    const eye = ctx.scheduler.eyePosition();
    this.distance = Math.hypot(this.head.x - eye.x, this.head.y - eye.y, this.head.z - eye.z);
    const exposure = Math.max(axes.coldStartExposureSec ?? 1, ctx.tunables.dial.floors.exposureSec);
    this.expireAt = ctx.liveTick + secondsToTicks(exposure);
    this.leaveAt = -1;
    return true;
  }

  /**
   * A Post on the floor under a point of the shell: the dial's distance band first, then the whole
   * shell (the hall's walls can leave no point in a narrow band in some directions). The point's
   * height is replaced by the floor, so the angle is re-checked and the head must be in sight.
   */
  private pickOnShell(ctx: ModeContext<unknown>, q: SpawnQuery): boolean {
    const shell = ctx.scheduler.firstOfKind('beacon-shell');
    if (!shell) return false;
    const eye = ctx.scheduler.eyePosition();
    const lo = q.minDist;
    const hi = q.maxDist;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt === 1) {
        q.minDist = shell.rMin ?? 0;
        q.maxDist = shell.rMax ?? Infinity;
      }
      if (!ctx.scheduler.pickShellPoint(shell, q, this.head)) continue;
      this.head.y = ctx.player.pos.y + q.aimOffsetY; // a Post stands on the floor
      directionFromAngles(this.view, ctx.player.yaw, ctx.player.pitch);
      directionTo(this.dir, eye, this.head);
      const a = angleDeg(this.view, this.dir);
      if (a < q.minAngleDeg || a > q.maxAngleDeg) continue;
      if (!ctx.scheduler.sightClear(eye, this.head)) continue;
      this.feet.x = this.head.x;
      this.feet.y = ctx.player.pos.y;
      this.feet.z = this.head.z;
      return true;
    }
    q.minDist = lo;
    q.maxDist = hi;
    return false;
  }

  step(ctx: ModeContext<unknown>): TrialStatus {
    if (this.targetId < 0) return TRIAL_RUNNING;
    const deadline = this.leaveAt >= 0 ? this.leaveAt : this.expireAt;
    if (ctx.liveTick < deadline) return TRIAL_RUNNING;
    this.finish(ctx, false, false);
    return TRIAL_LEFT;
  }

  onEvent(ctx: ModeContext<unknown>, ev: ModeEvent): TrialStatus {
    if (this.targetId < 0) return TRIAL_RUNNING;
    if (ev.type === 'shotImpact') {
      const t = this.tracker;
      t.onImpact(ctx.player, ctx.liveTick, ev.payload, this.targetId);
      if (t.shots === 1) this.leaveAt = ctx.liveTick + secondsToTicks(ctx.tunables.modes.coldStart.leaveAfterFirstBulletSec);
      return TRIAL_RUNNING;
    }
    if (ev.type === 'targetKilled' && ev.payload.targetId === this.targetId) {
      // The first bullet decides: a head hit by it. A second bullet's kill still pays points, but is not the skill.
      const won = this.tracker.shots === 1 && ev.payload.zone === 'head';
      this.finish(ctx, won, true, ev.payload.rtMs);
      return TRIAL_KILLED;
    }
    return TRIAL_RUNNING;
  }

  private finish(ctx: ModeContext<unknown>, success: boolean, killed: boolean, simRtMs = 0): void {
    const t = this.tracker;
    const e = this.extra;
    e.offsetDeg = t.spawnOffsetDeg;
    e.distance = this.distance;
    e.errDeg = t.errDeg;
    e.shots = t.shots;
    e.firstShotMs = t.firstShotMs();
    e.outcome = t.shots === 0 ? 0 : t.firstOutcome === FIRST_HEAD ? 2 : t.firstOutcome;
    e.timedOut = t.shots === 0 ? 1 : 0;
    const id = this.targetId;
    this.targetId = -1;
    this.lastSuccess = success;
    ctx.resolveTrial(id, success, { rtMs: t.rtMs(simRtMs, ctx.tunables.targets.reactionAimDeg), extra: e });
    if (!killed) ctx.despawn(id);
  }
}

interface State {
  trial: ColdStartTrial;
  /** Live tick at which the next Post may appear. */
  nextAt: number;
}

/**
 * Cold Start (design §4.1), trains `precision`. Range, Kestrel, no reload. A mode is data plus a
 * small scheduler: the trial logic is `ColdStartTrial`, shared with the Placement run.
 */
export const coldStart: ModeDef<State> = {
  id: 'coldStart',
  skills: ['precision'],
  map: 'range',
  weapon: 'kestrel',
  player: { infiniteMagazine: true },
  durationSec: modeCfg.drillSec,
  axes: ['distance', 'coldStartExposureSec'],

  setup: () => ({ trial: new ColdStartTrial(), nextAt: 0 }),

  tick(ctx: ModeContext<State>) {
    const s = ctx.state;
    const ended = s.trial.step(ctx);
    if (ended !== TRIAL_RUNNING) s.nextAt = ctx.liveTick + s.trial.gapTicks(ctx);
    if (s.trial.active || ctx.liveTick < s.nextAt) return;
    s.trial.start(ctx, ctx.axes, 'precision');
  },

  onEvent(ctx: ModeContext<State>, ev) {
    const s = ctx.state;
    const ended = s.trial.onEvent(ctx, ev);
    if (ended !== TRIAL_RUNNING) s.nextAt = ctx.liveTick + s.trial.gapTicks(ctx);
  },
};
