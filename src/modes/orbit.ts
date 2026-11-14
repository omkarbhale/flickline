import { modes as modeCfg } from '../config/modes';
import { secondsToTicks } from '../core/time';
import { vec3, type Vec3 } from '../core/vec3';
import type { AxisValues, SkillId } from './contracts';
import { FIRST_HEAD, ShotTracker } from './aim';
import { TRIAL_KILLED, TRIAL_LEFT, TRIAL_RUNNING, type TrialEngine, type TrialStatus } from './coldStart';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { createSpawnQuery, type SpawnQuery } from './scheduler';

/**
 * Orbit trial (design §4.2): one Beacon on the 8-25 m shell around the player, at an angular
 * distance from the previous Beacon set by the dial. One bullet that hits it kills it; success =
 * killed before its time to live runs out. Extra data per trial: flick error, reaction time.
 */
export class OrbitTrial implements TrialEngine {
  targetId = -1;
  lastSuccess = false;
  private readonly tracker = new ShotTracker();
  private readonly centre: Vec3 = vec3();
  private readonly query: SpawnQuery = createSpawnQuery('beacon-shell');
  /** Direction of the previous Beacon from the eye (the angle reference); unset before the first. */
  private readonly prevDir: Vec3 = vec3();
  private hasPrev = false;
  private expireAt = 0;
  private distance = 0;
  private readonly extra: Record<string, number> = {
    flickDeg: 0, distance: 0, errDeg: -1, overshootDeg: 0, shots: 0, firstShotMs: -1, firstHit: 0, expired: 0,
  };

  /** `fromView`: measure every angle from the crosshair, not from the previous Beacon (mixed runs, where other trials move it). */
  constructor(private readonly fromView = false) {}

  get active(): boolean {
    return this.targetId >= 0;
  }

  gapTicks(ctx: ModeContext<unknown>, how: TrialStatus): number {
    const c = ctx.tunables.modes.orbit;
    return secondsToTicks(how === TRIAL_KILLED ? c.gapAfterKillSec : c.gapAfterExpirySec);
  }

  start(ctx: ModeContext<unknown>, axes: AxisValues, skill: SkillId, difficulty?: number): boolean {
    const c = ctx.tunables.modes.orbit;
    const shell = ctx.scheduler.firstOfKind('beacon-shell');
    if (!shell) return false;
    const q = this.query;
    q.minDist = c.minDistM;
    q.maxDist = c.maxDistM;
    q.minAngleDeg = axes.flickMinDeg ?? 20;
    q.maxAngleDeg = axes.flickMaxDeg ?? 40;
    q.refDir = this.hasPrev && !this.fromView ? this.prevDir : null;
    if (!ctx.scheduler.pickShellPoint(shell, q, this.centre)) return false;
    const id = ctx.spawn('beacon', this.centre, { scale: axes.beaconScale ?? 1, skill, difficulty });
    if (id < 0) return false;
    this.targetId = id;
    this.tracker.begin(ctx.player, this.centre, ctx.liveTick);
    // The next Beacon's angle is measured from this one, wherever the crosshair ends up.
    const t = this.tracker.targetDir;
    this.prevDir.x = t.x;
    this.prevDir.y = t.y;
    this.prevDir.z = t.z;
    this.hasPrev = true;
    const eye = ctx.scheduler.eyePosition();
    const dx = this.centre.x - eye.x, dy = this.centre.y - eye.y, dz = this.centre.z - eye.z;
    this.distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const exposure = Math.max(axes.orbitExposureSec ?? 1, ctx.tunables.dial.floors.exposureSec);
    this.expireAt = ctx.liveTick + secondsToTicks(exposure);
    return true;
  }

  step(ctx: ModeContext<unknown>): TrialStatus {
    if (this.targetId < 0 || ctx.liveTick < this.expireAt) return TRIAL_RUNNING;
    this.finish(ctx, false, 0);
    return TRIAL_LEFT;
  }

  onEvent(ctx: ModeContext<unknown>, ev: ModeEvent): TrialStatus {
    if (this.targetId < 0) return TRIAL_RUNNING;
    if (ev.type === 'shotImpact') {
      this.tracker.onImpact(ctx.player, ctx.liveTick, ev.payload, this.targetId);
      return TRIAL_RUNNING;
    }
    if (ev.type === 'targetKilled' && ev.payload.targetId === this.targetId) {
      this.finish(ctx, true, ev.payload.rtMs);
      return TRIAL_KILLED;
    }
    return TRIAL_RUNNING;
  }

  private finish(ctx: ModeContext<unknown>, killed: boolean, simRtMs: number): void {
    const t = this.tracker;
    const e = this.extra;
    e.flickDeg = t.spawnOffsetDeg;
    e.distance = this.distance;
    e.errDeg = t.errDeg;
    e.overshootDeg = t.overshoot;
    e.shots = t.shots;
    e.firstShotMs = t.firstShotMs();
    e.firstHit = t.shots > 0 && t.firstOutcome === FIRST_HEAD ? 1 : 0;
    e.expired = killed ? 0 : 1;
    const id = this.targetId;
    this.targetId = -1;
    this.lastSuccess = killed;
    ctx.resolveTrial(id, killed, { rtMs: t.rtMs(simRtMs, ctx.tunables.targets.reactionAimDeg), extra: e });
    if (!killed) ctx.despawn(id);
  }
}

interface State {
  trial: OrbitTrial;
  nextAt: number;
}

/**
 * Orbit (design §4.2), trains `flick`. Range, Pace, movement locked at the shell's centre, no
 * reload. 0.1 s after a kill and 0.2 s after an expiry the next Beacon appears.
 */
export const orbit: ModeDef<State> = {
  id: 'orbit',
  skills: ['flick'],
  map: 'range',
  weapon: 'pace',
  player: { standAt: 'beacon-shell', lockMovement: true, infiniteMagazine: true },
  durationSec: modeCfg.drillSec,
  axes: ['beaconScale', 'flickMinDeg', 'flickMaxDeg', 'orbitExposureSec'],

  setup: () => ({ trial: new OrbitTrial(), nextAt: 0 }),

  tick(ctx: ModeContext<State>) {
    const s = ctx.state;
    const ended = s.trial.step(ctx);
    if (ended !== TRIAL_RUNNING) s.nextAt = ctx.liveTick + s.trial.gapTicks(ctx, ended);
    if (s.trial.active || ctx.liveTick < s.nextAt) return;
    s.trial.start(ctx, ctx.axes, 'flick');
  },

  onEvent(ctx: ModeContext<State>, ev) {
    const s = ctx.state;
    const ended = s.trial.onEvent(ctx, ev);
    if (ended !== TRIAL_RUNNING) s.nextAt = ctx.liveTick + s.trial.gapTicks(ctx, ended);
  },
};
