import { axes } from '../adaptive/dial';
import { BASELINE_SKILLS, type BaselineItemTable, type BaselineItemTuple, type BaselineSkill } from '../config/baseline';
import type { Tunables } from '../config/tunables';
import { DEG2RAD, RAD2DEG } from '../core/math';
import { Rng, shuffle } from '../core/rng';

/**
 * The generator of the Baseline's stored item lists (design §8.5, `docs/research/transfer.md`
 * §5.2). Run once, from a fixed seed, by `scripts/gen-baseline-items.mjs`, which writes
 * `config/baselineItems.ts`; the lists are data from then on and the app never calls this.
 *
 * Each (skill, level) list has `trialsPerSkill` items drawn like its mode draws them (Orbit: angle
 * `flickMinDeg..flickMaxDeg`, pitch biased to head height, distance on the 8-25 m shell; Cold
 * Start: angle 5-25 degrees, distance `0.7-1.4 x` the dial's `distance` axis) but stratified: one
 * item per equal slice of each range, the columns paired by a seeded shuffle. A list therefore
 * covers its range evenly, whatever the seed, and the same seed always writes the same file.
 * Scale and exposure are the level's own axis values (the dial fixes them), so every item of a list
 * is exactly as hard as its level says in the dial terms the skill model reads.
 */

/** Rounded the way the data file stores them, so the file and the generator compare equal. */
const round = (x: number, places: number): number => {
  const m = 10 ** places;
  return Math.round(x * m) / m;
};

/** `n` values, one uniformly inside each of `n` equal slices of `[lo, hi]` (slice order). */
function stratified(rng: Rng, n: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(lo + ((hi - lo) * (k + rng.next())) / n);
  return out;
}

/**
 * The Orbit shell's pitch law (`SpawnScheduler.pickShellPoint`): the mean of two uniforms (a
 * triangular law) mapped piecewise-linearly onto `[lo, bias, hi]`, so most beacons sit near head
 * height. This is its inverse at quantile `q`, so a stratified `q` gives a stratified pitch.
 */
function shellPitch(q: number, lo: number, bias: number, hi: number): number {
  const u = q < 0.5 ? Math.sqrt(q / 2) : 1 - Math.sqrt((1 - q) / 2);
  return u < 0.5 ? lo + (bias - lo) * (u * 2) : bias + (hi - bias) * ((u - 0.5) * 2);
}

/** `shellPitch`'s CDF: the quantile at which the law reaches `p`. */
function shellQuantile(p: number, lo: number, bias: number, hi: number): number {
  const u = p < bias ? ((p - lo) / (bias - lo)) / 2 : 0.5 + ((p - bias) / (hi - bias)) / 2;
  return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
}

function flickList(t: Tunables, rng: Rng, level: number): BaselineItemTuple[] {
  const n = t.baseline.trialsPerSkill;
  const ax = axes(level, undefined, t.dial);
  const m = t.modes;
  const angle = shuffle(rng, stratified(rng, n, ax.flickMinDeg, ax.flickMaxDeg));
  const quantile = shuffle(rng, stratified(rng, n, 0, 1));
  const dist = shuffle(rng, stratified(rng, n, m.orbit.minDistM, m.orbit.maxDistM));
  const eyeY = t.movement.standEyeHeight;
  const out: BaselineItemTuple[] = [];
  for (let i = 0; i < n; i++) {
    // The pitch law, cut where the orb would be under the floor at this distance (the placement
    // sampler rejects those too): the item's quantile is spread over what is left of the law.
    const floor = Math.asin(Math.min(1, Math.max(-1, (t.baseline.minBeaconHeightM - eyeY) / dist[i]!))) / DEG2RAD;
    const lo = Math.max(m.shellPitchMinDeg, floor);
    const q0 = shellQuantile(lo, m.shellPitchMinDeg, m.shellPitchBiasDeg, m.shellPitchMaxDeg);
    const q = q0 + (1 - q0) * quantile[i]!;
    const pitch = shellPitch(q, m.shellPitchMinDeg, m.shellPitchBiasDeg, m.shellPitchMaxDeg);
    out.push([round(angle[i]!, 2), round(pitch, 2), round(dist[i]!, 2), round(ax.beaconScale, 3), round(ax.orbitExposureSec, 3)]);
  }
  return out;
}

function precisionList(t: Tunables, rng: Rng, level: number): BaselineItemTuple[] {
  const n = t.baseline.trialsPerSkill;
  const ax = axes(level, undefined, t.dial);
  const c = t.modes.coldStart;
  const lo = Math.max(ax.distance * c.distanceLoMult, t.baseline.minPostDistanceM);
  const hi = Math.max(lo, Math.min(ax.distance * c.distanceHiMult, t.baseline.maxDistanceM));
  const angle = shuffle(rng, stratified(rng, n, c.minAngleDeg, c.maxAngleDeg));
  const dist = shuffle(rng, stratified(rng, n, lo, hi));
  // A Post's head is at a fixed height on a standing body: its pitch is what the distance makes it.
  const headDy = t.targets.hit.headCentreStand - t.movement.standEyeHeight;
  const out: BaselineItemTuple[] = [];
  for (let i = 0; i < n; i++) {
    const d = round(dist[i]!, 2);
    out.push([round(angle[i]!, 2), round(Math.asin(headDy / d) * RAD2DEG, 2), d, 1, round(ax.coldStartExposureSec, 3)]);
  }
  return out;
}

/** The seed of one (skill, level) list: the generator seed folded with both, so lists are independent and each is stable. */
function listSeed(seed: number, skill: BaselineSkill, level: number): number {
  const s = BASELINE_SKILLS.indexOf(skill) + 1;
  return (seed ^ Math.imul(s, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b)) >>> 0;
}

/** Every stored list, from the generator seed in `t.baseline`. Pure and deterministic. */
export function generateBaselineItems(t: Tunables): BaselineItemTable {
  const out: Record<BaselineSkill, Record<number, BaselineItemTuple[]>> = { flick: {}, precision: {} };
  for (const level of t.baseline.levels) {
    out.flick[level] = flickList(t, new Rng(listSeed(t.baseline.generatorSeed, 'flick', level)), level);
    out.precision[level] = precisionList(t, new Rng(listSeed(t.baseline.generatorSeed, 'precision', level)), level);
  }
  return out;
}

/** The text of `config/baselineItems.ts` for a table: one list per line group, so a diff shows which list moved. */
export function baselineItemsSource(table: BaselineItemTable, t: Tunables): string {
  const lines: string[] = [
    "import type { BaselineItemTable } from './baseline';",
    '',
    '/**',
    ' * The Daily Baseline\'s stored item lists (design §8.5, `docs/research/transfer.md` §5.2):',
    ' * `BASELINE_ITEMS[skill][level]`, one tuple per item: [angle from the crosshair (deg), pitch of the',
    ' * target (deg), distance (m), Beacon scale (x real head), exposure (s)].',
    ' *',
    ' * GENERATED by `npm run baseline:items` from `baseline.generatorSeed`; do not edit by hand. Any change',
    ' * here is a change of Baseline content: bump `baseline.version` and freeze the new hash in',
    ' * `modes/baselineItems.test.ts`.',
    ' */',
    'export const BASELINE_ITEMS: BaselineItemTable = {',
  ];
  for (const skill of BASELINE_SKILLS) {
    lines.push(`  ${skill}: {`);
    for (const level of t.baseline.levels) {
      lines.push(`    ${level}: [`);
      for (const it of table[skill][level]!) lines.push(`      [${it.join(', ')}],`);
      lines.push('    ],');
    }
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}
