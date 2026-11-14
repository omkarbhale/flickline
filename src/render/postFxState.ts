import type { PostTunables } from '../config/post';
import { PulseBudget } from '../feedback/pulseBudget';

/**
 * The two timed post effects as pure state (no GL): the damage vignette closing in and fading, and
 * the kill chromatic pulse. Everything is in milliseconds of frame time, so none of it depends on
 * the frame rate. Outputs are 0..1 envelopes the pipeline turns into uniforms.
 *
 * Reduce flashing (design section 13.3) zeroes both and refuses new ones: the player keeps the
 * static vignette and the HP bar, and the CSS directional arc is untouched. The chromatic pulse is
 * also off until the player opts in, and rate-limited by the shared pulse budget (research R10).
 *
 * Allocation-free: plain fields and one preallocated budget.
 */
export class PostFxState {
  /** Damage vignette envelope, 0..1. */
  damage = 0;
  /** Chromatic pulse envelope, 0..1. */
  chroma = 0;

  private damageMs = Infinity;
  private chromaMs = Infinity;
  private reduceFlashing = false;
  private chromaticEnabled = false;
  private readonly budget: PulseBudget;

  constructor(
    private readonly cfg: Readonly<PostTunables>,
    /** Length of the damage vignette, ms (`damageFx.vignetteMs`: the HUD's CSS one lasts as long). */
    private readonly damageTotalMs: number,
  ) {
    this.budget = new PulseBudget(cfg.chromatic.maxPerSecond);
  }

  setReduceFlashing(v: boolean): void {
    this.reduceFlashing = v;
    if (v) this.clear();
  }

  setChromaticEnabled(v: boolean): void {
    this.chromaticEnabled = v;
    if (!v) {
      this.chromaMs = Infinity;
      this.chroma = 0;
    }
  }

  /** The player was hit: restart the damage vignette. */
  hurt(): void {
    if (this.reduceFlashing) return;
    this.damageMs = 0;
  }

  /** A kill at sim time `nowSec`: start a chromatic pulse unless it is off or over budget. Returns whether one started. */
  kill(nowSec: number): boolean {
    if (this.reduceFlashing || !this.chromaticEnabled) return false;
    if (!this.budget.tryAcquire(nowSec)) return false;
    this.chromaMs = 0;
    return true;
  }

  /** Advance by `dtSec` of frame time and refresh the envelopes. */
  update(dtSec: number): void {
    const dt = dtSec * 1000;
    if (this.damageMs < this.damageTotalMs) {
      this.damageMs += dt;
      this.damage = damageEnvelope(this.damageMs, this.damageTotalMs, this.cfg.damage.attack);
    } else {
      this.damage = 0;
    }
    if (this.chromaMs < this.cfg.chromatic.ms) {
      this.chromaMs += dt;
      this.chroma = chromaEnvelope(this.chromaMs, this.cfg.chromatic.ms);
    } else {
      this.chroma = 0;
    }
  }

  /** The world was reset (restart, new run): drop anything showing. */
  reset(): void {
    this.clear();
    this.budget.reset();
  }

  private clear(): void {
    this.damageMs = this.chromaMs = Infinity;
    this.damage = this.chroma = 0;
  }
}

/** Damage vignette: 0 -> 1 over `attack` of the total, then an ease-out fade to 0 (matches the HUD's CSS curve). */
export function damageEnvelope(ms: number, totalMs: number, attack: number): number {
  if (ms <= 0) return 0;
  if (ms >= totalMs) return 0;
  const a = totalMs * attack;
  if (ms < a) return ms / a;
  const x = (ms - a) / (totalMs - a);
  return (1 - x) * (1 - x);
}

/** Chromatic pulse: full at the start, straight down to 0 at `totalMs`. */
export function chromaEnvelope(ms: number, totalMs: number): number {
  if (ms >= totalMs) return 0;
  return 1 - Math.max(0, ms) / totalMs;
}
