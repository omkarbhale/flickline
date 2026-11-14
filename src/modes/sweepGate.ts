import type { Rng } from '../core/rng';
import type { GateStake, HeardBucket, SweepCard, SweepTunables } from '../config/sweep';
import { GATE_STAKES } from '../config/sweep';
import {
  baseContacts, buildSector, drawableSectors, hiddenSpots, planRun, routeCards, sectorKey, sectorStream,
  type DoorFacts, type DoorPlan, type DoorStake, type GatePlan, type PlanBody, type RunPlan, type SectorPlan, type SectorSource,
} from './sweepDirector';

/**
 * The gate between two sectors (design §4.5, #205): two doors, each leading to a sector that is
 * already planned, each showing three facts about it and a stake. Pure and deterministic like the
 * rest of the director.
 *
 * **Honesty by construction.** A door's facts are computed from the sector plan behind it and from
 * nothing else: the role is the sector's, the sightline class is its entry's longest line, the heard
 * bucket counts the Echoes the plan placed within hearing of the entry, and the stake is what
 * `modes/sweep.ts` applies on entering. Walking through plays exactly that plan, so a door cannot
 * promise what the sector does not hold. Nothing is drawn twice: there is no "shown" copy that could drift.
 *
 * **Lazy per gate.** The gate before sector `i` is drawn when the player reaches it, from a seeded
 * stream of its own (`sectorStream(seed, i)`) and what the route holds so far (the cards dealt, the
 * last Shield, the primary carried), so the card rules of design §4.4 (never three alike in a row)
 * hold along whatever route the player takes. The same seed and the same choices give the same run.
 */

/** What the gate planner reads besides the run's plan. */
export interface GateEnv {
  readonly catalog: readonly SectorSource[];
  readonly cfg: SweepTunables;
  readonly body: PlanBody;
  /** How far an Echo's footsteps carry, metres (`audio.enemy.maxAudibleM`: the radius the fights use). */
  readonly hearM: number;
  /** The primary the run starts with (`ModeDef.weapon`). */
  readonly startPrimary: string;
}

/** Echoes of a sector plan the player would hear from its entry: placed within `hearM` of it (horizontal distance, like the footstep model). */
export function heardCount(sp: SectorPlan, hearM: number): number {
  let n = 0;
  for (const c of sp.contacts) {
    for (const e of c.echoes) {
      const dx = e.feet.x - sp.entry.x, dz = e.feet.z - sp.entry.z;
      if (dx * dx + dz * dz <= hearM * hearM) n++;
    }
  }
  return n;
}

/** The bucket of an Echo count: `quiet` up to `heard.quietMax`, `few` ("one or two") up to `heard.fewMax`, else `several`. */
export function heardBucket(count: number, cfg: SweepTunables): HeardBucket {
  const h = cfg.gate.heard;
  return count <= h.quietMax ? 'quiet' : count <= h.fewMax ? 'few' : 'several';
}

/** The facts a door shows, from the sector plan behind it. */
export function doorFacts(sp: SectorPlan, cfg: SweepTunables, hearM: number): DoorFacts {
  return {
    role: sp.role,
    sightline: sp.sightlineM >= cfg.gate.longSightlineM ? 'long' : 'close',
    heard: heardBucket(heardCount(sp, hearM), cfg),
    stake: sp.stake,
    arms: sp.arms,
  };
}

/** What the route so far holds that a gate's draw depends on. */
interface RouteView {
  recent: SweepCard[];
  /** Index of the last sector entered through a Shield door (-Infinity: none). */
  lastShieldAt: number;
  /** The primary the player carries along this route. */
  primary: string;
  contacts: number;
}

function routeView(plan: RunPlan, startPrimary: string): RouteView {
  let lastShieldAt = -Infinity;
  let primary = startPrimary;
  let contacts = 0;
  for (const s of plan.sectors) {
    if (s.stake === 'shield') lastShieldAt = s.index;
    if (s.stake === 'arms' && s.arms) primary = s.arms;
    contacts += s.contacts.length;
  }
  return { recent: routeCards(plan.sectors), lastShieldAt, primary, contacts };
}

function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = list[i]!;
    list[i] = list[j]!;
    list[j] = t;
  }
  return list;
}

/** Weighted draw of a stake (`gate.stakeWeight`) over the allowed ones. */
function drawStake(rng: Rng, cfg: SweepTunables, allowed: readonly GateStake[]): GateStake {
  let total = 0;
  for (const k of allowed) total += cfg.gate.stakeWeight[k];
  let u = rng.next() * total;
  for (const k of allowed) {
    u -= cfg.gate.stakeWeight[k];
    if (u < 0) return k;
  }
  return allowed[allowed.length - 1]!;
}

/**
 * The two sectors the doors lead to: never the one just played, differing in map or role when the
 * catalog has two such, else in sightline class, else any two (a catalog of one sector gets it twice).
 */
export function pickCandidates(rng: Rng, pool: readonly SectorSource[], current: SectorPlan, cfg: SweepTunables): [SectorSource, SectorSource] {
  let cands = pool.filter((s) => sectorKey(s) !== current.mapId + '/' + current.sectorId);
  if (cands.length === 0) cands = pool.slice();
  shuffle(rng, cands);
  const a = cands[0]!;
  let best = a, bestScore = -1;
  for (let i = 1; i < cands.length; i++) {
    const b = cands[i]!;
    const score =
      (b.mapId !== a.mapId || b.roles[0] !== a.roles[0] ? 2 : 0) +
      ((b.sightlineM >= cfg.gate.longSightlineM) !== (a.sightlineM >= cfg.gate.longSightlineM) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return [a, best];
}

/**
 * The gate before the next sector of `plan`: two sectors with their stakes. Shield is not offered in
 * two sectors in a row (`gate.shieldEverySectors`), Arms names a primary the player does not carry,
 * Hot only where the sector has an anchor for the extra contact, and the two doors never carry the
 * same stake. Does not change `plan`; `commitGate` does.
 */
export function planGate(plan: RunPlan, env: GateEnv): GatePlan {
  const { cfg, body } = env;
  const g = cfg.gate;
  const index = plan.sectors.length;
  const cur = plan.sectors[index - 1]!;
  const rng = sectorStream(plan.seed, index);
  const pool = drawableSectors(env.catalog, body);
  const view = routeView(plan, env.startPrimary);
  const [a, b] = pickCandidates(rng, pool, cur, cfg);

  const shieldOk = index - view.lastShieldAt >= g.shieldEverySectors;
  const armsPool = g.armsPool.filter((w) => w !== view.primary);
  const drawn: DoorStake[] = [];
  const sources = [a, b];
  const bases: number[] = [];
  const frees: number[] = [];
  for (const s of sources) {
    frees.push(hiddenSpots(s, body).length);
    bases.push(baseContacts(rng, cfg, index, frees[frees.length - 1]!));
  }
  let taken: GateStake | null = null;
  for (let d = 0; d < 2; d++) {
    const allowed: GateStake[] = [];
    for (const k of GATE_STAKES) {
      if (k === taken) continue;
      if (k === 'shield' && !shieldOk) continue;
      if (k === 'arms' && armsPool.length === 0) continue;
      if (k === 'hot' && bases[d]! + g.hotExtraContacts > frees[d]!) continue;
      allowed.push(k);
    }
    const stake = drawStake(rng, cfg, allowed);
    taken = stake;
    drawn.push(stake === 'arms' ? { stake, arms: armsPool[rng.int(armsPool.length)]! } : { stake });
  }

  const doors: DoorPlan[] = [];
  for (let d = 0; d < 2; d++) {
    const stake = drawn[d]!;
    const want = bases[d]! + (stake.stake === 'hot' ? g.hotExtraContacts : 0);
    const sector = buildSector(rng, cfg, sources[d]!, body, index, view.recent.slice(), want, stake, view.contacts);
    doors.push({ door: d as 0 | 1, facts: doorFacts(sector, cfg, env.hearM), sector });
  }
  return { index, doors: [doors[0]!, doors[1]!] };
}

/** The player walked through `door` of `gate`: the run's route takes its sector. */
export function commitGate(plan: RunPlan, gate: GatePlan, door: 0 | 1): SectorPlan {
  const sector = gate.doors[door].sector;
  plan.gates.push(gate);
  plan.doors.push(door);
  plan.sectors.push(sector);
  return sector;
}

/**
 * The whole route a seed gives when `choose` picks the door at every gate: for tests, the bot report
 * and the debug hook. `choose` sees the gate and the plan so far.
 */
export function planRoute(seed: number, env: GateEnv, choose: (gate: GatePlan, plan: RunPlan) => 0 | 1): RunPlan {
  const plan = planRun(seed, env.catalog, env.cfg, env.body);
  while (plan.sectors.length < env.cfg.sectors) {
    const gate = planGate(plan, env);
    commitGate(plan, gate, choose(gate, plan));
  }
  return plan;
}
