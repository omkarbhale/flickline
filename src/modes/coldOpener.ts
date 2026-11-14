import { coldOpener as coldCfg, type ColdContact, type ColdOpenerTunables, type ColdPool, type ColdProfile, type ColdV3 } from '../config/coldOpener';
import { COLD_POOL } from '../config/coldOpenerPool';
import type { SweepCard } from '../config/sweep';
import { Rng, shuffle } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import { mirrorId, mirrorPoint, mirrorYaw } from '../sim/mapMirror';
import type { ContactPlan, EchoPlan, SectorPlan, SectorSource } from './sweepDirector';

/**
 * # The cold opener's rules (design §8.5, `docs/research/transfer.md` §5, #209)
 *
 * The pure pieces of the daily learning measurement. When a cold opener is **due** (`isColdOpenerDue`:
 * the first run after `gapHours` without a finished run), the run's Opener is not dealt by the open
 * sampler: it plays one stored contact per slot of `coldOpener.slots`, drawn from the calibrated pool
 * of the player's **level** (`config/coldOpenerPool.ts`). The run's seed picks each slot's variant,
 * shuffles the order and mirrors exactly half of the contacts (`pickColdOpener`), so two days at a level
 * play different fights in a different order with identical item statistics, and none can be
 * memorised. Each contact is played as a short take **leg** in its own sector (`coldLegs`), every Echo
 * at the level's stored profile: no adaptation inside it.
 *
 * Its trials are tagged `skillTrial.source = 'baseline'`, so the matched posterior never consumes them.
 */

/** Facts about the cold opener the Sweep mode announces (logged; the measurement and the presentation read them). */
export interface ColdOpenerEvents {
  /** The run's Opener is a cold opener: its content version, level, number of legs and the run's seed. Emitted with the first leg. */
  coldOpenerStarted: { tick: number; version: number; level: number; legs: number; seed: number };
  /** A leg begins (`leg` 0-based of `of`): its map (`<map>~m` when mirrored), sector and card. */
  coldLegEntered: { tick: number; leg: number; of: number; mapId: string; sectorId: string; mirrored: boolean; card: string };
  /**
   * The cold opener is over: walked out of its last leg (`exit`), died in it, or the run was quit. `legsDone`:
   * legs finished; `kept`: health+shield at the end ÷ at its start (capped at 1, 0 after a death).
   */
  coldOpenerEnded: { tick: number; t: number; reason: 'exit' | 'death' | 'quit'; legsDone: number; kept: number };
}

declare module './contracts' {
  interface ModeEvents extends ColdOpenerEvents {}
}

/** One leg of a cold opener: which stored contact, and whether it is mirrored. */
export interface ColdLegPick {
  readonly slot: number;
  readonly variant: number;
  readonly mirrored: boolean;
  readonly contact: ColdContact;
}

/** What a run plays as its cold opener. */
export interface ColdOpenerPick {
  readonly version: number;
  readonly level: number;
  readonly profile: ColdProfile;
  /** In play order. */
  readonly legs: readonly ColdLegPick[];
}

/** The cold opener of a run plan (`RunPlan.cold`): the pick, and each leg as a sector plan to play. */
export interface ColdOpenerPlan extends ColdOpenerPick {
  /** One take sector per leg, in play order (mirrored legs on the mirrored map, `<map>~m`). */
  readonly sectors: readonly SectorPlan[];
}

/**
 * The level for a dial: the highest level at or below it (`atOrBelow`, transfer.md §5.3: no harder than
 * that dial), or the nearest level (`nearest`; a tie goes to the easier one). The lowest level for
 * anything below the levels.
 */
export function coldLevelFor(dial: number, levels: readonly number[] = coldCfg.levels, rule: 'nearest' | 'atOrBelow' = 'atOrBelow'): number {
  let level = levels[0]!;
  if (rule === 'nearest') {
    for (const l of levels) if (Math.abs(l - dial) < Math.abs(level - dial)) level = l;
    return level;
  }
  for (const l of levels) if (l <= dial) level = l;
  return level;
}

/** The first level for a player whose matched rating is `rating` (design §8.5): the rule and success rate of `cfg`. */
export function firstColdLevel(rating: number, cfg: ColdOpenerTunables = coldCfg): number {
  const q = Math.min(0.99, Math.max(0.01, cfg.firstLevelSuccess));
  return coldLevelFor(rating - cfg.scale * Math.log(q / (1 - q)), cfg.levels, cfg.firstLevelRule);
}

/**
 * Is a cold opener due (design §8.5, transfer.md §5.1)? Yes when nothing was finished in the last
 * `gapHours` hours: `lastRunEndMs` is when the player's last finished run ended, in the caller's
 * wall-clock milliseconds (`null` = never played or unknown), and `nowMs` is the same clock now.
 * Pure: the clock is injected. A last run in the future (the clock moved back) is not a gap.
 */
export function isColdOpenerDue(lastRunEndMs: number | null, nowMs: number, gapHours: number = coldCfg.gapHours): boolean {
  if (lastRunEndMs === null || !Number.isFinite(lastRunEndMs)) return true;
  return nowMs - lastRunEndMs >= gapHours * 3_600_000;
}

/** A seed for the pick stream: the run's seed folded with a constant, so it never shares a stream with the run's plan. */
const PICK_SALT = 0xc01d5eed;

/**
 * The cold opener a run with `seed` plays at `level`: one variant per slot (at least two maps among
 * them whenever the level's pool has two), the slots in a shuffled order, exactly `floor(n / 2)` of
 * them mirrored. Throws for a level the pool does not have.
 */
export function pickColdOpener(seed: number, level: number, pool: ColdPool = COLD_POOL, cfg: ColdOpenerTunables = coldCfg): ColdOpenerPick {
  const lp = pool[level];
  if (!lp) throw new Error(`cold opener: no pool at level ${level}`);
  const rng = new Rng((seed ^ PICK_SALT) >>> 0);
  const n = lp.slots.length;
  const variant = lp.slots.map((vs) => rng.int(vs.length));
  // At least two maps (design §8.5) when the pool has them: move the first slot that can change map to another one.
  const mapOf = (s: number): string => lp.slots[s]![variant[s]!]!.map;
  if (new Set(variant.map((_, s) => mapOf(s))).size < 2) {
    const only = mapOf(0);
    for (let s = 0; s < n; s++) {
      const other = lp.slots[s]!.findIndex((c) => c.map !== only);
      if (other >= 0) {
        variant[s] = other;
        break;
      }
    }
  }
  // The order: shuffled, then laid out so the same sector never comes twice in a row where the day's sectors
  // allow it (as the run's own sectors, design §4.2): each next leg is the first in the shuffle of the sector
  // with the most legs left that differs from the last one.
  const sectorOf = (s: number): string => lp.slots[s]![variant[s]!]!.sector;
  const left = shuffle(rng, lp.slots.map((_, s) => s));
  const order: number[] = [];
  while (left.length > 0) {
    const counts = new Map<string, number>();
    for (const s of left) counts.set(sectorOf(s), (counts.get(sectorOf(s)) ?? 0) + 1);
    const last = order.length > 0 ? sectorOf(order[order.length - 1]!) : null;
    let pick = -1;
    for (let i = 0; i < left.length; i++) {
      const sec = sectorOf(left[i]!);
      if (sec === last) continue;
      if (pick < 0 || counts.get(sec)! > counts.get(sectorOf(left[pick]!))!) pick = i;
    }
    order.push(left.splice(pick < 0 ? 0 : pick, 1)[0]!);
  }
  const mirror = order.map((_, i) => i < Math.floor(n / 2));
  shuffle(rng, mirror);
  const legs = order.map((slot, i) => ({ slot, variant: variant[slot]!, mirrored: mirror[i]!, contact: lp.slots[slot]![variant[slot]!]! }));
  return { version: cfg.version, level, profile: lp.profile, legs };
}

/** What two cold openers at a level must share (#209): count, cards, Echoes, maps used, mirrored legs, and the item difficulty. */
export interface ColdItemStats {
  legs: number;
  mirrored: number;
  echoes: number;
  /** Card -> legs. */
  cards: Record<string, number>;
  /** Item difficulty of every trial (the level's dial). */
  difficulty: number;
}

export function coldItemStats(pick: ColdOpenerPick): ColdItemStats {
  const cards: Record<string, number> = {};
  let echoes = 0;
  let mirrored = 0;
  for (const l of pick.legs) {
    cards[l.contact.card] = (cards[l.contact.card] ?? 0) + 1;
    echoes += l.contact.echoes.length;
    if (l.mirrored) mirrored++;
  }
  return { legs: pick.legs.length, mirrored, echoes, cards, difficulty: pick.level };
}

const toVec = (p: ColdV3, mirrored: boolean): Vec3 => {
  const v = { x: p[0], y: p[1], z: p[2] };
  return mirrored ? mirrorPoint(v) : v;
};

/**
 * Each leg of `pick` as a take sector to play: the sector's entry, facing and exit from `catalog` (the
 * unmirrored map's sources), and the leg's one contact, mirrored onto `<map>~m` when the leg is.
 * `firstContact` is the run-wide index of the first leg's contact. Throws when a stored contact names a
 * sector the catalog does not have (the maps changed: regenerate the pool with a new version).
 */
export function coldLegs(pick: ColdOpenerPick, catalog: readonly SectorSource[], firstContact = 0): SectorPlan[] {
  return pick.legs.map((leg, i) => {
    const c = leg.contact;
    const src = catalog.find((s) => s.mapId === c.map && s.id === c.sector);
    if (!src) throw new Error(`cold opener: pool contact names ${c.map}/${c.sector}, which no shipped map has`);
    const m = leg.mirrored;
    const echoes: EchoPlan[] = c.echoes.map((e) => {
      const plan: { -readonly [K in keyof EchoPlan]: EchoPlan[K] } = { spot: e.spot, kind: e.kind, feet: toVec(e.feet, m), crouched: e.crouched, expectation: e.expectation };
      if (e.lane) {
        plan.laneA = toVec(e.lane[0], m);
        plan.laneB = toVec(e.lane[1], m);
      }
      if (e.peek) plan.peek = { hold: toVec(e.peek.hold, m), out: toVec(e.peek.out, m), pattern: e.peek.pattern };
      return plan;
    });
    const contact: ContactPlan = { index: firstContact + i, card: c.card as SweepCard, spots: c.spots.slice(), echoes };
    const entry = m ? mirrorPoint(src.entry) : { ...src.entry };
    const exit = m ? mirrorPoint(src.exit) : { ...src.exit };
    return {
      index: 0, mapId: m ? mirrorId(src.mapId) : src.mapId, sectorId: src.id, entry, entryYaw: m ? mirrorYaw(src.entryYaw) : src.entryYaw, exit,
      role: 'take', drawn: 'take', stake: 'plain', sightlineM: src.sightlineM, condition: 'full', finale: false, contacts: [contact],
    };
  });
}

/** The cold opener of a run: the pick of `seed` at `level`, with its legs as sectors over `catalog`. */
export function coldOpenerPlan(seed: number, level: number, catalog: readonly SectorSource[], pool: ColdPool = COLD_POOL, cfg: ColdOpenerTunables = coldCfg): ColdOpenerPlan {
  const pick = pickColdOpener(seed, level, pool, cfg);
  return { ...pick, sectors: coldLegs(pick, catalog) };
}
