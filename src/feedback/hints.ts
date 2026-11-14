import { HINT_IDS, type HintId, type HintsTunables } from '../config/hints';

/**
 * The one-time hints (design §13.4): pure rules for *when* a hint is owed. Each fires the first time
 * its situation happens and never again; which ones were shown is the caller's to persist (the
 * profile's `hintsSeen`, so they survive a reload and travel with the save). Allocation-free after
 * construction: the situations are fed from per-shot and per-sighting events.
 */
export class HintRules {
  private readonly seen = new Set<HintId>();
  /** The last shot: moving, and whether a live target was near the view ray (a shot at something). */
  private shotId = -1;
  private shotMoving = false;
  private shotAtTarget = false;
  /** Tick of the player's last loud (running) footstep; -Infinity = none yet. */
  private loudStepTick = Number.NEGATIVE_INFINITY;

  constructor(
    seen: readonly string[],
    private readonly cfg: HintsTunables,
    private readonly tickDt: number,
  ) {
    for (const id of seen) if ((HINT_IDS as readonly string[]).includes(id)) this.seen.add(id as HintId);
  }

  /** Whether `id` was already shown (now or in an earlier session). */
  has(id: HintId): boolean {
    return this.seen.has(id);
  }

  /** The ids shown so far, in `HINT_IDS` order (what the profile stores). */
  shown(): HintId[] {
    return HINT_IDS.filter((id) => this.seen.has(id));
  }

  /** Mark `id` shown. True the first time (show it now), false when it was shown before. */
  claim(id: HintId): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }

  /** A shot left the gun. `atTarget`: a live target was near the view ray (the player shot at something). */
  onShot(shotId: number, moving: boolean, atTarget: boolean): void {
    this.shotId = shotId;
    this.shotMoving = moving;
    this.shotAtTarget = atTarget;
  }

  /**
   * Where that shot ended. "Stop to shoot" is owed for the first moving shot at a target that did not
   * hit one: the miss the lesson is about (a stray shot at nothing teaches nothing). True = show it.
   */
  onShotEnded(shotId: number, hit: boolean): boolean {
    if (hit || shotId !== this.shotId || !this.shotMoving || !this.shotAtTarget) return false;
    return this.claim('stopToShoot');
  }

  /** A player footstep: only the loud ones (running, standing up) count towards "Walk to stay quiet". */
  onFootstep(tick: number, walking: boolean, crouching: boolean): void {
    if (!walking && !crouching) this.loudStepTick = tick;
  }

  /** An Echo saw the player first. True = "Walk to stay quiet" is owed (loud steps just before, first time). */
  onEchoNoticed(tick: number, byEnemy: boolean): boolean {
    if (!byEnemy || this.seen.has('walkQuiet')) return false;
    if ((tick - this.loudStepTick) * this.tickDt > this.cfg.loudStepWindowSec) return false;
    return this.claim('walkQuiet');
  }
}
