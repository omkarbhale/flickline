import { Rng } from '../core/rng';
import type { Economy } from '../config/economy';
import type { Vec3 } from '../core/vec3';
import type { GateStake, HeardBucket, SectorRole, SweepCard, SweepTunables } from '../config/sweep';
import type { PeekPattern } from '../sim/mapTypes';
import type { Expectation } from '../sim/enemyTiming';

/**
 * The Sweep run director (design §4, #201): from the run's seed, which sectors the run visits, the
 * scenario card of each contact and where each Echo stands. Pure and deterministic: it reads only
 * the seed, the sector catalog and the tunables, and draws from its own seeded stream, so the same
 * seed gives the same plan whatever happens in the fights. What depends on the fights (the dial
 * the Echoes are spawned at) is applied by the mode when a sector is entered (`modes/sweep.ts`).
 *
 * Sector roles (design §4.2): the Opener is a take; every later sector draws its role from the mix
 * (`cfg.roleMix`). Take sectors are as below; a **meet** sector (#212) deals one contact, `meet`: an
 * Echo group of one or two that starts on the far side of the corridor and runs or walks to the
 * player's end of it. Nothing is hidden there by design: both sides are moving into each other, the
 * Echoes start 15 m or more away, and what the player gets is information, not a surprise (a run is
 * heard, a walk is silent; both are in view down the corridor).
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
  /** Feet position the player is placed at, and the yaw the player faces. */
  readonly entry: Vec3;
  readonly entryYaw: number;
  readonly exit: Vec3;
  /** The longest unobstructed horizontal line at eye height from the entry, inside the sector's region, metres (the gate's "sightline" fact, #205). */
  readonly sightlineM: number;
  readonly spots: readonly SectorSpot[];
  /**
   * Meet sectors: the straight walk from the exit towards the entry that an Echo group crosses on (the first
   * straight leg of the nav route from the exit to the entry). Absent for a sector without a meet role.
   */
  readonly meetRoute?: { readonly from: Vec3; readonly to: Vec3 };
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
  /** Meet: it travels from `laneA` to `laneB` at this gait before its first stop (`StrafeParams.travel`). */
  readonly gait?: 'run' | 'walk';
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
  readonly role: SectorRole;
  /** The role as drawn, before any fallback (a drawn hold plays as a take until #204): what the "never three alike" rule counts. */
  readonly drawn: SectorRole;
  /** The door stake this sector was entered by (design §4.5, #205): the opener's is `plain`. */
  readonly stake: GateStake;
  /** Arms stake: the primary the door names. */
  readonly arms?: string;
  /** Longest sightline from the entry, metres (the sector source's). */
  readonly sightlineM: number;
  /** One of a new profile's placing Opener sectors (design §9.2, #203): one single-Echo contact on the staircase. */
  readonly opener?: boolean;
  /** The sector's economy (design §4.6): `full` unless the run dealt it a light or an eco condition. */
  readonly condition: Economy;
  readonly contacts: readonly ContactPlan[];
}

/** The three facts and the stake a door shows (design §4.5). All of them are computed from the sector plan behind it, never drawn on their own. */
export interface DoorFacts {
  readonly role: SectorRole;
  readonly sightline: 'long' | 'close';
  readonly heard: HeardBucket;
  readonly stake: GateStake;
  readonly arms?: string;
  /** The sector's economy (design §4.6): a light or eco sector is announced on its door. */
  readonly condition: Economy;
}

export interface DoorPlan {
  readonly door: 0 | 1;
  readonly facts: DoorFacts;
  /** The sector the door leads to, placed and ready: walking through plays exactly this plan. */
  readonly sector: SectorPlan;
}

/** The gate before sector `index`: two doors. */
export interface GatePlan {
  readonly index: number;
  readonly doors: readonly [DoorPlan, DoorPlan];
}

/**
 * A run's plan so far: the route played (`sectors[0]` is the opener) and the gate before each later
 * sector (`gates[i - 1]` led to `sectors[i]`, through door `doors[i - 1]`). It grows by one at
 * every gate (`modes/sweep.ts`); `planGate` (`sweepGate.ts`) reads it to draw the next two doors.
 */
export interface RunPlan {
  readonly seed: number;
  /**
   * The route played. While a placing Opener runs, `sectors[0]` is its current contact sector (the
   * mode swaps the next of `openerStages` in at each exit, until the staircase is done).
   */
  readonly sectors: SectorPlan[];
  /** The run places a new profile (design §9.2): its Opener is `openerStages`, short take sectors of one single-Echo contact each. */
  readonly placing: boolean;
  /** A placing Opener's contact sectors, in order (empty when the run does not place). */
  readonly openerStages: readonly SectorPlan[];
  readonly gates: GatePlan[];
  readonly doors: (0 | 1)[];
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

/**
 * A shuffled deck of sectors, reshuffled when spent, never dealing the sector just played twice in a
 * row (null when the deck has only that sector).
 */
export class SectorDeck {
  private deck: SectorSource[] = [];

  constructor(private readonly rng: Rng, private readonly sectors: readonly SectorSource[]) {}

  draw(last: SectorSource | undefined): SectorSource | null {
    const n = this.sectors.length;
    if (n === 0) return null;
    if (n === 1) return this.sectors[0] === last ? null : this.sectors[0]!;
    let at = this.pick(last);
    if (at < 0) {
      // What is left is only the sector just played: a fresh deck.
      this.deck = this.sectors.slice();
      const d = this.deck;
      for (let i = d.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        const t = d[i]!;
        d[i] = d[j]!;
        d[j] = t;
      }
      at = this.pick(last);
    }
    return this.deck.splice(at, 1)[0]!;
  }

  /** Index of the card nearest the top that is not `last`, or -1. */
  private pick(last: SectorSource | undefined): number {
    for (let i = this.deck.length - 1; i >= 0; i--) if (this.deck[i] !== last) return i;
    return -1;
  }
}

/**
 * The role of sector `index` (design §4.2): the Opener is a take; the rest draw from `cfg.roleMix`, never a role
 * that `drawn` already holds twice at its end (never three in a row). `drawn` is the roles as drawn, before any fallback
 * (a role the run cannot play yet plays as a take, but counts as itself). One draw per call, always.
 */
export function drawRole(rng: Rng, cfg: SweepTunables, index: number, drawn: readonly SectorRole[]): SectorRole {
  const u = rng.next();
  if (index === 0) return 'take';
  const run = ROLE_RUN_MAX;
  let barred: SectorRole | null = null;
  if (drawn.length >= run) {
    barred = drawn[drawn.length - 1]!;
    for (let i = drawn.length - run; i < drawn.length; i++) if (drawn[i] !== barred) barred = null;
  }
  let total = 0;
  for (const r of ROLE_ORDER) if (r !== barred) total += cfg.roleMix[r];
  let x = u * total;
  let last: SectorRole = 'take';
  for (const r of ROLE_ORDER) {
    if (r === barred || cfg.roleMix[r] <= 0) continue;
    last = r;
    x -= cfg.roleMix[r];
    if (x < 0) return r;
  }
  return last;
}

/** Roles in the order the draw walks them, and how many of one role may follow each other (design §4.2: never three). */
const ROLE_ORDER: readonly SectorRole[] = ['take', 'hold', 'meet'];
const ROLE_RUN_MAX = 2;

/** How many anchors a card needs. */
export function cardSpots(card: SweepCard): number {
  return card === 'clear' || card === 'crossfire' ? 2 : 1;
}

/**
 * Draw one card: weighted by `cardWeight` over the cards this contact may hold (crossfire only from
 * `crossfireFromSector`, enough anchors left, and never `maxCardRun + 1` of the same card in a row).
 * Returns null when no card fits.
 */
export function drawCard(
  rng: Rng, cfg: SweepTunables, sectorIndex: number, spotsLeft: number, recent: readonly SweepCard[], cards: readonly SweepCard[] = CARD_ORDER,
): SweepCard | null {
  const run = cfg.maxCardRun;
  let streakCard: SweepCard | null = null;
  if (recent.length >= run) {
    streakCard = recent[recent.length - 1]!;
    for (let i = recent.length - run; i < recent.length; i++) if (recent[i] !== streakCard) streakCard = null;
  }
  let total = 0;
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

/**
 * The condition of each of `count` sectors (design §4.6, #207): at most one eco and one light, never the
 * Opener (`conditions.firstSector`) and never the Finale (`finaleSector`, 1-based). Drawn from a stream of
 * its own, so dealing conditions never moves a placement. An eco and a light never share a sector.
 */
export function drawConditions(seed: number, count: number, cfg: SweepTunables): Economy[] {
  const rng = new Rng((planSeed(seed) ^ 0xec0ec0) >>> 0);
  const out: Economy[] = [];
  const open: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push('full');
    if (i >= cfg.conditions.firstSector && i !== cfg.finaleSector - 1) open.push(i);
  }
  // Two draws each, always, so a run's eco does not depend on whether its light came up.
  for (const [cond, chance] of [['eco', cfg.conditions.ecoChance], ['light', cfg.conditions.lightChance]] as const) {
    const roll = rng.next();
    const pick = rng.next();
    if (roll < chance && open.length > 0) out[open.splice(Math.floor(pick * open.length), 1)[0]!] = cond;
  }
  return out;
}

/** A point `t` metres from `a` towards `dir` (a unit horizontal direction). */
function along(a: Vec3, dx: number, dz: number, t: number): Vec3 {
  return { x: a.x + dx * t, y: a.y, z: a.z + dz * t };
}

/**
 * How far from `from` an Echo can go along the unit direction (`dx`, `dz`), up to `maxM`, with every
 * sample hidden from `eye` and the path walkable: metres (0 = not at all). One sample step is kept
 * back from the first visible sample, as a margin: between two hidden samples a sliver can show.
 */
export function hiddenReach(s: SectorSource, eye: Vec3, from: Vec3, crouched: boolean, dx: number, dz: number, maxM: number, stepM: number): number {
  let ok = 0;
  for (let t = stepM; t <= maxM + 1e-9; t += stepM) {
    const p = along(from, dx, dz, t);
    if (s.visible(eye, p, crouched) || !s.walkable(from, p)) return Math.max(0, ok - stepM);
    ok = t;
  }
  return ok;
}

/**
 * Highest share (0..1) of a peek path, from its hold end, whose every sample is hidden from `eye`
 * (with one sample step of margin before the first visible one, as `hiddenReach`); -1 when the hold
 * itself shows.
 */
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
    if (s.visible(eye, p, crouched)) return Math.max(0, ok - 1 / n);
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
 * A meet group's Echoes (design §4.2, #212): one or two on straight routes from the far side of the
 * sector's corridor to the player's end of it, at a gait (a walk is silent, a run is heard), with the
 * second one behind and to the side of the first. Starts are drawn so that nothing depends on the map:
 * five draws per group, always.
 */
export function placeMeet(rng: Rng, cfg: SweepTunables, s: SectorSource, sectorIndex: number): EchoPlan[] {
  const m = cfg.meet;
  const route = s.meetRoute;
  if (!route) return [];
  const sizeU = rng.next(), gaitU = rng.next(), backU = rng.next(), gapU = rng.next(), sideU = rng.next();
  const size = sizeU < perSector(m.groupTwoShare, sectorIndex) ? 2 : 1;
  const gait: 'run' | 'walk' = gaitU < m.runShare ? 'run' : 'walk';
  const len = Math.hypot(route.to.x - route.from.x, route.to.z - route.from.z);
  if (len < 1e-6) return [];
  const dx = (route.to.x - route.from.x) / len, dz = (route.to.z - route.from.z) / len;
  // Behind the exit as far as the lead wants, as far as it can walk.
  const wantBack = m.startBackMinM + (m.startBackMaxM - m.startBackMinM) * backU;
  let back = 0;
  for (let t = 0.5; t <= wantBack + 1e-9; t += 0.5) {
    if (!s.walkable(route.from, along(route.from, dx, dz, -t))) break;
    back = t;
  }
  const gap = m.gapMinM + (m.gapMaxM - m.gapMinM) * gapU;
  const side = sideU < 0.5 ? -1 : 1;
  const px = -dz, pz = dx;
  const end = along(route.to, dx, dz, -Math.min(m.endShortM, len / 2));
  const out: EchoPlan[] = [];
  for (let k = 0; k < size; k++) {
    // The second Echo is further back (as far as the corridor goes behind the first) and to one side where that is walkable.
    let behind = back + k * gap;
    let off = k === 0 ? 0 : side * m.lateralM;
    let a = { x: route.from.x - dx * behind + px * off, y: route.from.y, z: route.from.z - dz * behind + pz * off };
    let b = { x: end.x + px * off, y: end.y, z: end.z + pz * off };
    if (k > 0 && !(s.walkable(a, b) && s.walkable(route.from, a))) {
      off = 0;
      a = { x: route.from.x - dx * behind, y: route.from.y, z: route.from.z - dz * behind };
      b = { x: end.x, y: end.y, z: end.z };
      if (!s.walkable(route.from, a)) {
        // No room behind: it trails as far as the corridor allows.
        behind = back;
        a = { x: route.from.x - dx * behind, y: route.from.y, z: route.from.z - dz * behind };
      }
    }
    out.push({ spot: 'route', kind: 'strafer', feet: { ...a }, crouched: false, expectation: 'attending', laneA: a, laneB: b, gait });
  }
  return out;
}

/** A sector's key in the catalog (map, then id). */
export function sectorKey(s: { mapId: string; id: string }): string {
  return s.mapId + '/' + s.id;
}

/**
 * The sectors the director can play in `role`, in a fixed order: a take needs a hold anchor hidden from
 * its entry, a meet a corridor route. A hold is not playable yet (#204): it plays as a take.
 */
export function drawableSectors(catalog: readonly SectorSource[], body: PlanBody, role: SectorRole): SectorSource[] {
  const r = role === 'meet' ? 'meet' : 'take';
  const ok = (s: SectorSource): boolean => (r === 'meet' ? s.roles.includes('meet') && s.meetRoute !== undefined : s.roles.includes('take') && hiddenSpots(s, body).length > 0);
  return catalog.filter(ok).sort((a, b) => (sectorKey(a) < sectorKey(b) ? -1 : 1));
}

/** The role a sector plays as: a role the run cannot play yet (`cfg.playableRoles`: holds until #204) plays as a take. */
export function playedRole(wanted: SectorRole, cfg: SweepTunables): SectorRole {
  return cfg.playableRoles.includes(wanted) ? wanted : 'take';
}

/**
 * The seeded stream the sector at `index` is drawn from (its role, contacts, cards and placements, and
 * for a later sector the door choices before it): one stream per index, so what the player did in the
 * sectors before never shifts the draws of this one.
 */
export function sectorStream(seed: number, index: number): Rng {
  return new Rng(planSeed(((seed >>> 0) + Math.imul(index, 0x9e3779b1)) >>> 0));
}

/** Contacts a take sector at `index` would hold with no Hot stake: drawn from the per-sector range, capped by its hidden anchors (one draw). */
export function baseContacts(rng: Rng, cfg: SweepTunables, index: number, spotCount: number): number {
  const lo = perSector(cfg.contactsMin, index);
  const hi = Math.max(lo, perSector(cfg.contactsMax, index));
  return Math.min(spotCount, lo + rng.int(hi - lo + 1));
}

/** What a door adds to the sector behind it. */
export interface DoorStake {
  readonly stake: GateStake;
  readonly arms?: string;
}

/**
 * One sector's plan. A take: `want` contacts drawn card by card (`recent` is the route's cards so far and
 * is extended as they are dealt, so pass a copy), each placed on hidden hold anchors. A meet: one `meet`
 * contact, the Echo group crossing the corridor. `firstContact` is the run-wide index of its first contact.
 * `cards`: the cards a take may deal (a placing Opener's are the gentlest; the no-streak rule is waived
 * there when it would leave none).
 */
export function buildSector(
  rng: Rng, cfg: SweepTunables, s: SectorSource, body: PlanBody, index: number, role: SectorRole, drawn: SectorRole, condition: Economy, recent: SweepCard[], want: number, door: DoorStake, firstContact: number,
  cards?: readonly SweepCard[],
): SectorPlan {
  const contacts: ContactPlan[] = [];
  let contactIndex = firstContact;
  if (role === 'meet') {
    recent.push('meet');
    contacts.push({ index: contactIndex++, card: 'meet', spots: [], echoes: placeMeet(rng, cfg, s, index) });
  } else {
    const free = hiddenSpots(s, body);
    for (let c = 0; c < want && free.length > 0; c++) {
      // Leave one anchor for each contact still to come.
      const spare = free.length - (want - c - 1);
      const card = cards
        ? drawCard(rng, cfg, index, Math.max(1, spare), recent, cards) ?? drawCard(rng, cfg, index, Math.max(1, spare), [], cards)
        : drawCard(rng, cfg, index, Math.max(1, spare), recent);
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
  }
  return {
    index, mapId: s.mapId, sectorId: s.id, entry: { ...s.entry }, entryYaw: s.entryYaw, exit: { ...s.exit }, role, drawn, condition,
    stake: door.stake, arms: door.arms, sightlineM: s.sightlineM, contacts,
  };
}

/** Cards dealt along a route, in order. */
export function routeCards(sectors: readonly SectorPlan[]): SweepCard[] {
  const out: SweepCard[] = [];
  for (const s of sectors) for (const c of s.contacts) out.push(c.card);
  return out;
}

/**
 * The run's opener: a take sector drawn from the seed (design §4.1: always a take), no stake. The rest of the route is drawn gate by gate (`sweepGate.ts`).
 * `placing` (a new profile's first run, design §9.2, #203): the Opener is `opener.maxSectors` short take sectors with one single-Echo
 * contact each from the gentlest cards (never the same sector twice in a row), played until the staircase is done (`SectorDial.openerDone`).
 * The same `(seed, placing)` gives the same plan.
 */
export function planRun(seed: number, catalog: readonly SectorSource[], cfg: SweepTunables, body: PlanBody, placing = false): RunPlan {
  // `cfg` already carries the lean (`leanedSweep`, #210): the draws read its weights and nothing else changes.
  const takes = drawableSectors(catalog, body, 'take');
  if (takes.length === 0) throw new Error('sweep: no take sector with a hidden hold anchor');
  const rng = sectorStream(seed, 0);
  const condition = drawConditions(seed, cfg.sectors, cfg)[0]!;
  if (!placing) {
    const s = takes[rng.int(takes.length)]!;
    const base = baseContacts(rng, cfg, 0, hiddenSpots(s, body).length);
    const opener = buildSector(rng, cfg, s, body, 0, 'take', 'take', condition, [], base, { stake: 'plain' }, 0);
    return { seed, sectors: [opener], gates: [], doors: [], placing: false, openerStages: [] };
  }
  const stages: SectorPlan[] = [];
  const recent: SweepCard[] = [];
  let last: SectorSource | null = null;
  for (let k = 0; k < Math.max(1, cfg.opener.maxSectors); k++) {
    let s = takes[rng.int(takes.length)]!;
    if (s === last && takes.length > 1) s = takes[(takes.indexOf(s) + 1 + rng.int(takes.length - 1)) % takes.length]!;
    last = s;
    const stage = buildSector(rng, cfg, s, body, 0, 'take', 'take', condition, recent, 1, { stake: 'plain' }, k, cfg.opener.cards);
    stages.push({ ...stage, opener: true });
  }
  return { seed, sectors: [stages[0]!], gates: [], doors: [], placing: true, openerStages: stages };
}
