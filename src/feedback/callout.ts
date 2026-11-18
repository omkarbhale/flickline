import { DEG2RAD } from '../core/math';
import type { Rng } from '../core/rng';
import type { CalloutTunables } from '../config/callout';

/**
 * The callout stand-in (engagement-information §4.2, #99): what a teammate's "two short, left" would
 * give a player who has no teammates, kept honest. Pure: `planCallout` decides, from a sector's
 * contact, whether to issue one, in which direction and after how long; the producer feature
 * (`features/callout.ts`) feeds it and emits `calloutIssued` when the delay is up, and sound and
 * the edge glow subscribe (`audio/calloutSfx.ts`, `hud/calloutGlow.ts`).
 *
 * What it will never be: a position. The event carries a direction only (a unit vector in the
 * world, off the true bearing by a uniform error of up to `maxErrorDeg`), so the cue says "that
 * side", never "there"; no marker, no distance, no count.
 */
export interface CalloutEvents {
  /** The stand-in fired: look towards (`dirX`, `dirZ`) (world frame, unit, -Z = yaw 0 ahead), coarse to within `errorDeg`. */
  calloutIssued: { tick: number; t: number; dirX: number; dirZ: number; errorDeg: number; sectorIndex: number };
}

declare module '../core/gameEvents' {
  interface GameEvents extends CalloutEvents {}
}

/** What the plan reads about a sector the player just entered. */
export interface CalloutInput {
  /** The card of the first contact (the one the player meets first). */
  card: string;
  /** Feet of that contact's Echoes (horizontal positions are all that is read). */
  echoes: readonly { readonly x: number; readonly z: number }[];
  /** Whether any of them runs (its steps carry: the sound already tells the player, so no stand-in). */
  anyRunning: boolean;
  /** The player's feet. */
  player: { readonly x: number; readonly z: number };
  /** The sector's index in the run, and the index of the last sector that got a callout (-Infinity: none yet). */
  sectorIndex: number;
  lastIssuedIndex: number;
}

export interface CalloutPlan {
  /** Seconds after the sector was entered. */
  delaySec: number;
  /** The called direction in the world: unit, true bearing plus the error. */
  dirX: number;
  dirZ: number;
  /** The error drawn, degrees (signed; |error| <= `maxErrorDeg`). */
  errorDeg: number;
}

/**
 * Whether this sector gets a callout, and if so its delay and direction. Draws from `rng` in a fixed
 * order (chance, delay, error), so a seeded stream gives the same answer every time. Null: none.
 */
export function planCallout(rng: Rng, cfg: CalloutTunables, input: CalloutInput): CalloutPlan | null {
  // The draws come first so the stream does not depend on which gate refused.
  const roll = rng.next();
  const delaySec = cfg.delaySec[0] + rng.next() * (cfg.delaySec[1] - cfg.delaySec[0]);
  const errorDeg = (rng.next() * 2 - 1) * cfg.maxErrorDeg;
  if (!cfg.cards.includes(input.card) || input.echoes.length === 0 || input.anyRunning) return null;
  if (input.sectorIndex - input.lastIssuedIndex <= cfg.minSectorGap) return null;
  if (roll >= cfg.chance) return null;
  let cx = 0, cz = 0;
  for (const e of input.echoes) { cx += e.x; cz += e.z; }
  cx = cx / input.echoes.length - input.player.x;
  cz = cz / input.echoes.length - input.player.z;
  const len = Math.hypot(cx, cz);
  if (len < 1e-6) return null;
  // Rotate the true direction by the error, in the horizontal plane.
  const a = errorDeg * DEG2RAD;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = cx / len, dz = cz / len;
  return { delaySec, dirX: dx * c - dz * s, dirZ: dx * s + dz * c, errorDeg };
}

/** A callout waiting for its delay: one slot, since a sector gets at most one. */
export class CalloutTimer {
  private dueTick = -1;
  private plan: CalloutPlan | null = null;
  private index = 0;

  /** Wait `plan.delaySec` from tick `now` (`tickRate` ticks per second). */
  schedule(plan: CalloutPlan, now: number, tickRate: number, sectorIndex: number): void {
    this.plan = plan;
    this.dueTick = now + Math.max(1, Math.round(plan.delaySec * tickRate));
    this.index = sectorIndex;
  }

  cancel(): void {
    this.plan = null;
    this.dueTick = -1;
  }

  get pending(): boolean {
    return this.plan !== null;
  }

  /** At tick `tick`: if the delay is up, hand the plan to `fire` once (and clear it). */
  step(tick: number, fire: (plan: CalloutPlan, sectorIndex: number) => void): void {
    const p = this.plan;
    if (p === null || tick < this.dueTick) return;
    this.plan = null;
    this.dueTick = -1;
    fire(p, this.index);
  }
}
