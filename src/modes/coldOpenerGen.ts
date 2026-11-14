import { axes } from '../adaptive/dial';
import type { ColdContact, ColdEcho, ColdLevelPool, ColdPool, ColdProfile, ColdV3 } from '../config/coldOpener';
import type { SweepCard } from '../config/sweep';
import type { Tunables } from '../config/tunables';
import { Rng } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import { cardSpots, hiddenSpots, placeEcho, type EchoPlan, type PlanBody, type SectorSource } from './sweepDirector';

/**
 * The generator of the cold opener's calibrated pool (design §8.5, #209). Run once, from a fixed seed,
 * by `scripts/gen-cold-pool.mjs`, which writes `config/coldOpenerPool.ts`; the pool is data from then
 * on and the game never calls this.
 *
 * For every level and every slot of `coldOpener.slots` it stores `variants` contacts of the slot's
 * card, each in a take sector of the shipped maps and placed by the Sweep director's own rules
 * (`placeEcho`: every Echo, its lane and its peek path hidden from the sector's entry). Variants walk
 * the eligible sectors in turn, so a slot's variants spread over every map and sector that can hold
 * its card. The level's Echo profile is stored with it, read from the dial axes. Same seed and same
 * maps, rules and axes: the same bytes.
 */

/** Rounded the way the data file stores them, so the file and the generator compare equal. */
const round = (x: number, places: number): number => {
  const m = 10 ** places;
  const r = Math.round(x * m) / m;
  return Object.is(r, -0) ? 0 : r;
};

const v3 = (p: Vec3): ColdV3 => [round(p.x, 2), round(p.y, 2), round(p.z, 2)];

/** The level's Echo numbers (the dial axes Sweep spawns its Echoes with, `modes/sweep.ts`). */
export function coldProfile(t: Tunables, level: number): ColdProfile {
  const a = axes(level, undefined, t.dial);
  return {
    tellSec: round(a.tellSec, 3),
    reactionSec: round(a.enemyReactionSec, 3),
    hitChance: round(a.enemyHitChance, 3),
    strafeSpeed: round(a.strafeSpeed, 3),
    strafeLegSec: round(a.strafeLegSec, 3),
    standStillSec: round(a.standStillSec, 3),
    peekWideSec: round(a.peekWideSec, 3),
  };
}

function storeEcho(e: EchoPlan, seed: number): ColdEcho {
  const out: { -readonly [K in keyof ColdEcho]: ColdEcho[K] } = { spot: e.spot, kind: e.kind, feet: v3(e.feet), crouched: e.crouched, expectation: e.expectation, seed };
  if (e.kind === 'strafer' && e.laneA && e.laneB) out.lane = [v3(e.laneA), v3(e.laneB)];
  if (e.peek) out.peek = { hold: v3(e.peek.hold), out: v3(e.peek.out), pattern: e.peek.pattern };
  return out;
}

/** The seed of one (level, slot) stream: lists are independent and each is stable. */
function slotSeed(seed: number, level: number, slot: number): number {
  return (seed ^ Math.imul(slot + 1, 0x9e3779b1) ^ Math.imul(level + 1, 0x85ebca6b)) >>> 0;
}

/** Take sectors that can hold `card` unseen (enough hidden anchors), in a stable order that alternates maps. */
export function eligibleSectors(catalog: readonly SectorSource[], body: PlanBody, card: SweepCard, exclude: readonly string[] = []): SectorSource[] {
  const ok = catalog
    .filter((s) => s.roles.includes('take') && !exclude.includes(`${s.mapId}/${s.id}`) && hiddenSpots(s, body).length >= cardSpots(card))
    .sort((a, b) => (a.mapId + '/' + a.id < b.mapId + '/' + b.id ? -1 : 1));
  // Interleave by map (a, b, a, b, ...) so consecutive variants change map whenever two maps qualify.
  const byMap = new Map<string, SectorSource[]>();
  for (const s of ok) {
    const l = byMap.get(s.mapId) ?? [];
    l.push(s);
    byMap.set(s.mapId, l);
  }
  const lists = [...byMap.values()];
  const out: SectorSource[] = [];
  for (let i = 0; out.length < ok.length; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}

/** One stored contact of `card` in sector `s`, drawn from `rng` with the director's placement rules. */
function contactIn(rng: Rng, t: Tunables, s: SectorSource, body: PlanBody, card: SweepCard): ColdContact {
  const free = hiddenSpots(s, body);
  const spots = [];
  for (let k = 0; k < cardSpots(card); k++) spots.push(free.splice(rng.int(free.length), 1)[0]!);
  const placed: EchoPlan[] = [];
  if (card === 'clear') placed.push(placeEcho(rng, t.sweep, s, body, spots[rng.int(2)]!, card));
  else for (const spot of spots) placed.push(placeEcho(rng, t.sweep, s, body, spot, card));
  const echoes = placed.map((e) => storeEcho(e, Math.floor(rng.next() * 0x100000000) >>> 0));
  return { map: s.mapId, sector: s.id, card, spots: spots.map((p) => p.id), echoes };
}

/** The whole pool, from `t.coldOpener.generatorSeed` over `catalog`. Pure and deterministic. Throws when a slot's card fits no sector. */
export function generateColdPool(t: Tunables, catalog: readonly SectorSource[]): ColdPool {
  const cfg = t.coldOpener;
  const body = t.movement;
  const out: Record<number, ColdLevelPool> = {};
  for (const level of cfg.levels) {
    const slots: ColdContact[][] = [];
    cfg.slots.forEach((card, slot) => {
      const sectors = eligibleSectors(catalog, body, card, cfg.excludeSectors);
      if (sectors.length === 0) throw new Error(`cold opener: no take sector can hold a ${card} contact unseen`);
      const rng = new Rng(slotSeed(cfg.generatorSeed, level, slot));
      // Start each slot at its own place in the sector cycle, so a day's slots spread over the sectors too.
      const variants: ColdContact[] = [];
      for (let v = 0; v < cfg.variants; v++) variants.push(contactIn(rng, t, sectors[(slot + v) % sectors.length]!, body, card));
      slots.push(variants);
    });
    out[level] = { profile: coldProfile(t, level), slots };
  }
  return out;
}

const fmt = (p: ColdV3): string => `[${p.join(', ')}]`;

function echoSource(e: ColdEcho): string {
  const parts = [`spot: '${e.spot}'`, `kind: '${e.kind}'`, `feet: ${fmt(e.feet)}`, `crouched: ${e.crouched}`, `expectation: '${e.expectation}'`];
  if (e.lane) parts.push(`lane: [${fmt(e.lane[0])}, ${fmt(e.lane[1])}]`);
  if (e.peek) parts.push(`peek: { hold: ${fmt(e.peek.hold)}, out: ${fmt(e.peek.out)}, pattern: '${e.peek.pattern}' }`);
  parts.push(`seed: ${e.seed}`);
  return `{ ${parts.join(', ')} }`;
}

/** The text of `config/coldOpenerPool.ts`: one contact per line, so a diff shows which contact moved. */
export function coldPoolSource(pool: ColdPool, t: Tunables): string {
  const lines: string[] = [
    "import type { ColdPool } from './coldOpener';",
    '',
    '/**',
    " * The cold opener's calibrated pool (design §8.5, #209): `COLD_POOL[level]` holds the level's Echo",
    ' * profile and, per slot of `coldOpener.slots`, its stored contacts (take sector, card, Echo placements and',
    ' * personality seeds). Positions are the unmirrored map\'s; a day plays each mirrored or not.',
    ' *',
    ' * GENERATED by `npm run cold:pool` from `coldOpener.generatorSeed`; do not edit by hand. Any change here is',
    ' * a change of cold-opener content: bump `coldOpener.version` and freeze the new hash in',
    ' * `modes/coldOpenerPool.test.ts`.',
    ' */',
    'export const COLD_POOL: ColdPool = {',
  ];
  for (const level of t.coldOpener.levels) {
    const lp = pool[level]!;
    const p = lp.profile;
    lines.push(`  ${level}: {`);
    lines.push(
      `    profile: { tellSec: ${p.tellSec}, reactionSec: ${p.reactionSec}, hitChance: ${p.hitChance}, strafeSpeed: ${p.strafeSpeed}, strafeLegSec: ${p.strafeLegSec}, standStillSec: ${p.standStillSec}, peekWideSec: ${p.peekWideSec} },`,
    );
    lines.push('    slots: [');
    for (const variants of lp.slots) {
      lines.push('      [');
      for (const c of variants) {
        lines.push(`        { map: '${c.map}', sector: '${c.sector}', card: '${c.card}', spots: [${c.spots.map((s) => `'${s}'`).join(', ')}], echoes: [${c.echoes.map(echoSource).join(', ')}] },`);
      }
      lines.push('      ],');
    }
    lines.push('    ],');
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}
