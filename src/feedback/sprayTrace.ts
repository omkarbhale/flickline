import type { HitZone } from '../sim/types';

/**
 * The spray trace of design §3 (Spray Wall, #48), as plain data and pure helpers. The stat tracker
 * cuts a run's shots into sprays and fills these records; the results card (#39) draws them.
 *
 * Conventions, all in degrees and in screen terms (right and up are positive), measured from the
 * spray's FIRST bullet:
 *   impact   where the bullet went (view + the spec's recoil offset + spread) relative to the
 *            direction the crosshair pointed at the first bullet
 *   pull     how far the player moved the view since the first bullet (a pull down is negative Y)
 *   required the pull that would cancel the spec's recoil exactly: minus the change in the recoil
 *            offset since the first bullet. A player who pulls exactly this lands every bullet at
 *            the first bullet's offset plus only the spec's random spread (the ideal trace).
 */
export interface SprayBulletTrace {
  /** Position in the spray, 0 = first bullet. */
  index: number;
  /** Milliseconds since the first bullet. */
  tMs: number;
  impactXDeg: number;
  impactYDeg: number;
  pullXDeg: number;
  pullYDeg: number;
  requiredPullXDeg: number;
  requiredPullYDeg: number;
  /** The spread half-angle this bullet was drawn from. */
  spreadDeg: number;
  /** Struck the Post's head or body (a hit for the spray's success fraction). */
  hit: boolean;
  /** Zone struck, null for a bullet that missed the Post. */
  zone: HitZone | null;
}

export interface SprayRecord {
  /** Spray number in the run, 0-based. */
  index: number;
  station: string;
  distanceM: number;
  /** Bullets the spray asked for, and the share of them that had to hit. */
  burst: number;
  requiredFraction: number;
  /** Bullets fired and how many hit head or body; `fraction = hits / burst`. */
  fired: number;
  hits: number;
  headHits: number;
  bodyHits: number;
  fraction: number;
  success: boolean;
  /** Why it ended: the burst was fired, or the player reloaded early. */
  reason: 'burst' | 'reload';
  /** One entry per bullet fired, in order. */
  trace: SprayBulletTrace[];
}

/** Hit rate of each bullet index over the run's sprays (null where no spray reached that index). */
export function sprayHitRateByIndex(sprays: readonly SprayRecord[]): (number | null)[] {
  let longest = 0;
  for (const s of sprays) longest = Math.max(longest, s.burst);
  const out: (number | null)[] = [];
  for (let i = 0; i < longest; i++) {
    let n = 0;
    let h = 0;
    for (const s of sprays) {
      if (i >= s.burst) continue;
      n++; // a bullet never fired counts as a miss, as in the spray's own judgement
      const b = s.trace[i];
      if (b?.hit) h++;
    }
    out.push(n === 0 ? null : h / n);
  }
  return out;
}

/**
 * Mean absolute difference between the player's vertical pull and the required one, per bullet
 * index (null where no spray fired that bullet): the "pull curve" error of the spray trace plot.
 */
export function sprayPullErrorByIndex(sprays: readonly SprayRecord[]): (number | null)[] {
  let longest = 0;
  for (const s of sprays) longest = Math.max(longest, s.trace.length);
  const out: (number | null)[] = [];
  for (let i = 0; i < longest; i++) {
    let n = 0;
    let sum = 0;
    for (const s of sprays) {
      const b = s.trace[i];
      if (!b) continue;
      n++;
      sum += Math.abs(b.pullYDeg - b.requiredPullYDeg);
    }
    out.push(n === 0 ? null : sum / n);
  }
  return out;
}

/**
 * The bullet index where a per-index series "falls apart": the start of the trailing run of
 * indices that are all beyond `limit` (`below` = true: all under it, a hit rate; false: all over
 * it, a pull error). Null if the series ends fine, or has no data.
 */
export function collapseIndex(series: readonly (number | null)[], limit: number, below: boolean): number | null {
  let start = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v === null || v === undefined) continue;
    if (below ? v < limit : v > limit) start = i;
    else break;
  }
  return start < 0 ? null : start;
}
