import { tier as tierOf, createTierInfo } from '../adaptive/dial';
import { dial as dialCfg, type DialTunables } from '../config/dial';
import { progress as progressCfg, type ProgressTunables } from '../config/progress';
import type { RankEntry } from './save';

/**
 * # Rank state and the demotion buffer (design §8.4)
 *
 * The shown rank of a skill is its committed *sub-tier* (tier and division, flat: Chalk I = 0 ... Zenith =
 * 18), which follows the skill's rating (the posterior mean, dial scale) with a buffer: ranks go up and
 * down, but a sub-tier changes only after the rating has stayed across the boundary for consecutive runs
 * (`promoteAfterRuns`, default 1: a rank-up is the reward and lands at once; `demoteAfterRuns`, default 2:
 * one bad evening does not drop a tier). When it does change it lands on the most lenient sub-tier the
 * rating showed during the streak, so it never overshoots.
 *
 * *Ascent* (the medal) is committing a sub-tier above the highest the skill ever held, so oscillating
 * around a boundary cannot farm it.
 */

/** Sub-tier index of a dial value. */
export function subTierOf(dial: number, cfg: DialTunables = dialCfg): number {
  const t = tierOf(dial, createTierInfo(), cfg);
  let base = 0;
  for (let i = 0; i < t.index; i++) base += cfg.tiers[i]!.divisions ? 3 : 1;
  return base + (t.division > 0 ? t.division - 1 : 0);
}

export interface SubTierInfo {
  tierIndex: number;
  /** 1..3, or 0 for a tier without divisions. */
  division: number;
  label: string;
}

const ROMAN = ['', 'I', 'II', 'III'];

/** Name of a sub-tier index ("Cobalt II", "Zenith"). */
export function subTierInfo(index: number, cfg: DialTunables = dialCfg): SubTierInfo {
  let base = 0;
  for (let i = 0; i < cfg.tiers.length; i++) {
    const size = cfg.tiers[i]!.divisions ? 3 : 1;
    if (index < base + size || i === cfg.tiers.length - 1) {
      const div = cfg.tiers[i]!.divisions ? Math.min(2, Math.max(0, index - base)) + 1 : 0;
      const name = cfg.tiers[i]!.name;
      return { tierIndex: i, division: div, label: div > 0 ? `${name} ${ROMAN[div]}` : name };
    }
    base += size;
  }
  return { tierIndex: 0, division: 1, label: '' };
}

export interface RankStep {
  entry: RankEntry;
  /** The committed sub-tier moved this step. */
  moved: 'up' | 'down' | null;
  /** The commit is above the skill's previous peak (the Ascent medal). */
  ascent: boolean;
}

/**
 * One run's rating of a skill arrives: the next rank entry. `prev` null = the first rating this skill ever
 * had, which commits at once (no buffer to run, and no medal for being placed).
 */
export function stepRank(prev: RankEntry | null, sub: number, cfg: ProgressTunables = progressCfg): RankStep {
  if (prev === null) return { entry: { at: sub, peak: sub, up: 0, down: 0, to: sub }, moved: null, ascent: false };
  const e: RankEntry = { ...prev };
  if (sub > e.at) {
    e.down = 0;
    e.to = e.up === 0 ? sub : Math.min(e.to, sub);
    e.up++;
    if (e.up >= cfg.promoteAfterRuns) {
      e.at = e.to;
      e.up = 0;
      const ascent = e.at > e.peak;
      if (ascent) e.peak = e.at;
      return { entry: e, moved: 'up', ascent };
    }
    return { entry: e, moved: null, ascent: false };
  }
  if (sub < e.at) {
    e.up = 0;
    e.to = e.down === 0 ? sub : Math.max(e.to, sub);
    e.down++;
    if (e.down >= cfg.demoteAfterRuns) {
      e.at = e.to;
      e.down = 0;
      return { entry: e, moved: 'down', ascent: false };
    }
    return { entry: e, moved: null, ascent: false };
  }
  e.up = 0;
  e.down = 0;
  return { entry: e, moved: null, ascent: false };
}
