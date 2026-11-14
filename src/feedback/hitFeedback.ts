import type { FeedbackTunables } from '../config/feedback';
import type { HitZone } from '../sim/types';

/** Which hitmarker to show: colour AND shape differ so colour is never the only cue (research R17). */
export type HitmarkerKind = 'body' | 'leg' | 'head' | 'kill' | 'headKill';

export function hitmarkerKind(zone: HitZone, killed: boolean): HitmarkerKind {
  if (killed) return zone === 'head' ? 'headKill' : 'kill';
  return zone === 'head' ? 'head' : zone === 'leg' ? 'leg' : 'body';
}

/**
 * Provisional score for a kill, from design §8.1 (base x head precision). The real scoring module
 * (#22) replaces this; the floating `+score` number only needs "a number for this kill".
 */
export function provisionalKillScore(zone: HitZone, fb: FeedbackTunables): number {
  const p = fb.provisionalScore;
  return Math.round(p.base * (zone === 'head' ? p.headMultiplier : 1));
}

/** "182 ms · 0.41 s" for the kill float (design §7.1); null when the sim has no timing yet. */
export function formatRtTtk(rtMs: number | undefined, ttkMs: number | undefined): string | null {
  if (rtMs === undefined && ttkMs === undefined) return null;
  const parts: string[] = [];
  if (rtMs !== undefined) parts.push(`${Math.round(rtMs)} ms`);
  if (ttkMs !== undefined) parts.push(`${(ttkMs / 1000).toFixed(2)} s`);
  return parts.join(' · ');
}
