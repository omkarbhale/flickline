import { Rng } from '../core/rng';
import type { Vec3 } from '../core/vec3';
import type { SweepCard, SweepTunables } from '../config/sweep';
import type { PeekPattern } from '../sim/mapTypes';
import type { Expectation } from '../sim/enemyTiming';

/**
 * The Sweep run director (design §4, #201): from the run's seed, which sectors the run visits, the
 * scenario card of each contact and where each Echo stands. Pure and deterministic: it reads only
 * the seed, the sector catalog and the tunables, and draws from its own seeded stream, so the same
 * seed gives the same plan whatever happens in the fights. What depends on the fights (the dial
 * the Echoes are spawned at) is applied by the mode when a sector is entered (`modes/sweep.ts`).
 *
 * Take sectors (design §4.2): every Echo is placed before the player can see it, on the sector's
 * hold anchors. A placement is accepted only if the Echo's body, all of its strafe lane and all of
 * its peek path are hidden from the entry eye, so no line of sight is open when the player arrives
 * and none opens unless the player moves.
 */

/** One hold anchor of a sector, as the director needs it (built from the map by `sweepCatalog.ts`). */
export interface SectorSpot {
  readonly id: string;
  /** Feet position an Echo holds from (a peek anchor's `hold`, a post's `pos`). */
  readonly feet: Vec3;
  readonly crouched: boolean;
  /** Peek anchors: the hidden and fully-out feet positions and the anchor's pattern. */
  readonly peek?: { readonly hold: Vec3; readonly out: Vec3; readonly pattern: PeekPattern };
  /** Posts: the direction the anchor faces (radians, architecture §6 convention), for a lane across it. */
  readonly yaw?: number;
}

/** One sector of a map, with what the director needs to place Echoes in it. */
export interface SectorSource {
  readonly mapId: string;
  readonly id: string;
  readonly roles: readonly string[];
  /** Feet position the player is placed at, and the yaw he faces. */
  readonly entry: Vec3;
  readonly entryYaw: number;
  readonly exit: Vec3;
  readonly spots: readonly SectorSpot[];
  /** Whether any part of an Echo standing at `feet` is visible from the eye position `eye`. */
  visible(eye: Vec3, feet: Vec3, crouched: boolean): boolean;
  /** Whether an Echo can walk the straight line between two feet positions (nothing solid in between). */
  walkable(a: Vec3, b: Vec3): boolean;
}

export type EchoKind = 'strafer' | 'peeker';

export interface EchoPlan {
  /** The hold anchor it was placed on. */
  readonly spot: string;
  readonly kind: EchoKind;
  /** Spawn feet position (out of sight of the entry). */
  readonly feet: Vec3;
  readonly crouched: boolean;
  /** What it expects (design §4.4, #142): a holder on its angle is `prepared`, one facing elsewhere `unaware`. */
  readonly expectation: Expectation;
  /** Strafer: the lane it moves along; both ends equal = it stands still. */
  readonly laneA?: Vec3;
  readonly laneB?: Vec3;
  /** Peeker: its path and pattern. */
  readonly peek?: { readonly hold: Vec3; readonly out: Vec3; readonly pattern: PeekPattern };
}

export interface ContactPlan {
  /** Index of the contact in the run (0-based, across sectors). */
  readonly index: number;
  readonly card: SweepCard;
  /** The anchors the card puts in play (a `clear` has two, one of them empty). */
  readonly spots: readonly string[];
  readonly echoes: readonly EchoPlan[];
}

export interface SectorPlan {
  readonly index: number;
  readonly mapId: string;
  readonly sectorId: string;
  readonly entry: Vec3;
  readonly entryYaw: number;
  readonly exit: Vec3;
  readonly contacts: readonly ContactPlan[];
}

export interface RunPlan {
  readonly seed: number;
  readonly sectors: readonly SectorPlan[];
}

/** What the plan needs about the player: eye height when standing at an entry. */
export interface PlanBody {
  readonly standEyeHeight: number;
}

/** The entry of a per-sector list for sector `index` (the last entry repeats). */
export function perSector(list: readonly number[], index: number): number {
  return list[Math.min(index, list.length - 1)] ?? 0;
}

/** A seed of its own for the plan, so the plan never shares a stream with the sim or the runner. */
export function planSeed(seed: number): number {
  let h = (seed ^ 0x5eed5eed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** The order the run visits take sectors in: a shuffled deck, reshuffled when spent, never the same sector twice in a row. */
export function pickSectors(rng: Rng, takes: readonly SectorSource[], count: number): SectorSource[] {
  const out: SectorSource[] = [];
  if (takes.length === 0) return out;
  let deck: SectorSource[] = [];
  while (out.length < count) {
    if (deck.length === 0) {
      deck = takes.slice();
      for (let i = deck.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = deck[i]!;
        deck[i] = deck[j]!;
        deck[j] = t;
      }
      // A fresh deck never opens with the sector just played.
      const last = out[out.length - 1];
      if (last && deck.length > 1 && deck[deck.length - 1] === last) {
        const t = deck[0]!;
        deck[0] = deck[deck.length - 1]!;
        deck[deck.length - 1] = t;
      }
    }
    out.push(deck.pop()!);
  }
  return out;
}

/** How many anchors a card needs. */
export function cardSpots(card: SweepCard): number {
  return card === 'clear' || card === 'crossfire' ? 2 : 1;
}

/**
 * Draw one card: weighted by `cardWeight` over the cards this contact may hold (crossfire only from
 * `crossfireFromSector`, enough anchors left, and never `maxCardRun + 1` of the same card in a row).
 * Returns null when no card fits.
 */
export function drawCard(rng: Rng, cfg: SweepTunables, sectorIndex: number, spotsLeft: number, recent: readonly SweepCard[]): SweepCard | null {
  const run = cfg.maxCardRun;
  let streakCard: SweepCard | null = null;
  if (recent.length >= run) {
    streakCard = recent[recent.length - 1]!;
    for (let i = recent.length - run; i < recent.length; i++) if (recent[i] !== streakCard) streakCard = null;
  }
  let total = 0;
  const cards = CARD_ORDER;
  for (const c of cards) if (allowed(c)) total += cfg.cardWeight[c];
  if (total <= 0) return null;
  let u = rng.next() * total;
  for (const c of cards) {
    if (!allowed(c)) continue;
    u -= cfg.cardWeight[c];
    if (u < 0) return c;
  }
  // Rounding: the last allowed card.
  for (let i = cards.length - 1; i >= 0; i--) if (allowed(cards[i]!)) return cards[i]!;
  return null;

  function allowed(c: SweepCard): boolean {
    if (c === streakCard) return false;
    if (c === 'crossfire' && sectorIndex < cfg.crossfireFromSector) return false;
    return cardSpots(c) <= spotsLeft && cfg.cardWeight[c] > 0;
  }
}

const CARD_ORDER: readonly SweepCard[] = ['take-unaware', 'take-expected', 'clear', 'crossfire'];

/** A point `t` metres from `a` towards `dir` (a unit horizontal direction). */
function along(a: Vec3, dx: number, dz: number, t: number): Vec3 {
  return { x: a.x + dx * t, y: a.y, z: a.z + dz * t };
}

/**
 * How far from `from` an Echo can go along the unit direction (`dx`, `dz`), up to `maxM`, with every
 * sample hidden from `eye` and the path walkable: metres (0 = not at all).
 */
export function hiddenReach(s: SectorSource, eye: Vec3, from: Vec3, crouched: boolean, dx: number, dz: number, maxM: number, stepM: number): number {
  let ok = 0;
  for (let t = stepM; t <= maxM + 1e-9; t += stepM) {
    const p = along(from, dx, dz, t);
    if (s.visible(eye, p, crouched) || !s.walkable(from, p)) break;
    ok = t;
  }
  return ok;
}

/** Highest share (0..1) of a peek path, from its hold end, whose every sample is hidden from `eye`. */
export function hiddenPeekShare(s: SectorSource, eye: Vec3, peek: NonNullable<SectorSpot['peek']>, crouched: boolean, stepM: number): number {
  const len = Math.hypot(peek.out.x - peek.hold.x, peek.out.y - peek.hold.y, peek.out.z - peek.hold.z);
  if (s.visible(eye, peek.hold, crouched)) return -1;
  if (len < 1e-6) return 1;
  // A hop stands up on the spot: the standing body must be hidden too.
  if (peek.pattern === 'hop' && s.visible(eye, peek.hold, false)) return 0;
  const n = Math.max(1, Math.ceil(len / stepM));
  let ok = 0;
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    const p = { x: peek.hold.x + (peek.out.x - peek.hold.x) * u, y: peek.hold.y + (peek.out.y - peek.hold.y) * u, z: peek.hold.z + (peek.out.z - peek.hold.z) * u };
    if (s.visible(eye, p, crouched)) break;
    ok = u;
  }
  return ok;
}

/** The entry eye of a sector. */
export function entryEye(s: SectorSource, body: PlanBody): Vec3 {
  return { x: s.entry.x, y: s.entry.y + body.standEyeHeight, z: s.entry.z };
}

/** The spots of a sector an Echo can stand on unseen from its entry (an anchor in view is skipped, never used). */
export function hiddenSpots(s: SectorSource, body: PlanBody): SectorSpot[] {
  const eye = entryEye(s, body);
  return s.spots.filter((p) => !s.visible(eye, p.feet, p.crouched));
}

/**
 * Place one Echo on `spot` for `card`: its kind, stance, lane or peek path and expectation. Every
 * position it can reach on its own is hidden from the entry eye.
 */
export function placeEcho(rng: Rng, cfg: SweepTunables, s: SectorSource, body: PlanBody, spot: SectorSpot, card: SweepCard): EchoPlan {
  const p = cfg.place;
  const eye = entryEye(s, body);
  // One draw per Echo for its kind and one for its lane, always, so the stream does not depend on the map.
  const kindU = rng.next();
  const laneU = rng.next();
  const peekShare = spot.peek ? hiddenPeekShare(s, eye, spot.peek, spot.crouched, p.sampleStepM) : -1;

  if (card === 'clear' && spot.peek && peekShare >= 1 && kindU < p.clearPeekerShare) {
    // It swings the angle when it chooses to: a wide peek, the one pattern that shoots (design §5.2).
    return {
      spot: spot.id, kind: 'peeker', feet: { ...spot.peek.hold }, crouched: spot.crouched, expectation: 'attending',
      peek: { hold: { ...spot.peek.hold }, out: { ...spot.peek.out }, pattern: 'wide' },
    };
  }

  const expectation: Expectation = card === 'take-unaware' ? 'unaware' : card === 'clear' ? 'attending' : 'prepared';
  const holder = card === 'take-expected' || card === 'crossfire';
  const mover = card === 'take-unaware' ? kindU < p.unawareMoverShare : card === 'clear';
  const want = holder ? Math.min(p.holderLaneMaxM, p.laneMinM + (p.laneMaxM - p.laneMinM) * laneU) : mover ? p.laneMinM + (p.laneMaxM - p.laneMinM) * laneU : 0;

  // Where it stands: a holder moves up its anchor's peek path as far as it stays hidden (it holds the
  // angle the player will open, design §4.2); anyone else holds the anchor itself.
  let feet: Vec3 = { ...spot.feet };
  let dx = 0, dz = 0;
  if (spot.peek) {
    const ox = spot.peek.out.x - spot.peek.hold.x, oz = spot.peek.out.z - spot.peek.hold.z;
    const ol = Math.hypot(ox, oz);
    if (ol > 1e-6) { dx = ox / ol; dz = oz / ol; }
    if (holder && peekShare > 0 && ol > 1e-6) {
      const u = Math.min(1, peekShare);
      feet = { x: spot.peek.hold.x + ox * u, y: spot.peek.hold.y + (spot.peek.out.y - spot.peek.hold.y) * u, z: spot.peek.hold.z + oz * u };
      // Shuffle back towards cover from there.
      dx = -dx; dz = -dz;
    }
  }
  if (dx === 0 && dz === 0) {
    // Across the way the anchor faces (forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)).
    const yaw = spot.yaw ?? 0;
    dx = Math.cos(yaw);
    dz = -Math.sin(yaw);
  }
  if (want < p.laneDropM) {
    return { spot: spot.id, kind: 'strafer', feet, crouched: spot.crouched, expectation, laneA: { ...feet }, laneB: { ...feet } };
  }
  // The lane: as far each way as it stays hidden and walkable, then cut to the length wanted.
  const fwdMax = hiddenReach(s, eye, feet, spot.crouched, dx, dz, want, p.sampleStepM);
  const backMax = hiddenReach(s, eye, feet, spot.crouched, -dx, -dz, want, p.sampleStepM);
  // Centred on the spot where both sides allow it, else pushed to the side that has room.
  let fwd = Math.min(fwdMax, Math.max(want / 2, want - backMax));
  let back = Math.min(backMax, want - fwd);
  if (fwd + back < p.laneDropM) fwd = back = 0;
  const laneA = along(feet, -dx, -dz, back);
  const laneB = along(feet, dx, dz, fwd);
  return { spot: spot.id, kind: 'strafer', feet, crouched: spot.crouched, expectation, laneA, laneB };
}

/**
 * The whole run's plan: `cfg.sectors` take sectors drawn from `catalog`, each with its contacts,
 * cards and Echo placements. Throws if the catalog has no take sector with a hidden hold anchor.
 */
export function planRun(seed: number, catalog: readonly SectorSource[], cfg: SweepTunables, body: PlanBody): RunPlan {
  const rng = new Rng(planSeed(seed));
  const takes = catalog
    .filter((s) => s.roles.includes('take') && hiddenSpots(s, body).length > 0)
    .sort((a, b) => (a.mapId + '/' + a.id < b.mapId + '/' + b.id ? -1 : 1));
  if (takes.length === 0) throw new Error('sweep: no take sector with a hidden hold anchor');
  const chain = pickSectors(rng, takes, cfg.sectors);
  const recent: SweepCard[] = [];
  const sectors: SectorPlan[] = [];
  let contactIndex = 0;
  for (let i = 0; i < chain.length; i++) {
    const s = chain[i]!;
    const free = hiddenSpots(s, body);
    const lo = perSector(cfg.contactsMin, i);
    const hi = Math.max(lo, perSector(cfg.contactsMax, i));
    const want = Math.min(free.length, lo + rng.int(hi - lo + 1));
    const contacts: ContactPlan[] = [];
    for (let c = 0; c < want && free.length > 0; c++) {
      // Leave one anchor for each contact still to come.
      const spare = free.length - (want - c - 1);
      const card = drawCard(rng, cfg, i, Math.max(1, spare), recent);
      if (!card) break;
      recent.push(card);
      const spots: SectorSpot[] = [];
      for (let k = 0; k < cardSpots(card); k++) spots.push(free.splice(rng.int(free.length), 1)[0]!);
      const echoes: EchoPlan[] = [];
      if (card === 'clear') {
        // Two possible spots, one of them occupied (design §4.4).
        const occupied = spots[rng.int(2)]!;
        echoes.push(placeEcho(rng, cfg, s, body, occupied, card));
      } else {
        for (const spot of spots) echoes.push(placeEcho(rng, cfg, s, body, spot, card));
      }
      contacts.push({ index: contactIndex++, card, spots: spots.map((p) => p.id), echoes });
    }
    sectors.push({ index: i, mapId: s.mapId, sectorId: s.id, entry: { ...s.entry }, entryYaw: s.entryYaw, exit: { ...s.exit }, contacts });
  }
  return { seed, sectors };
}
