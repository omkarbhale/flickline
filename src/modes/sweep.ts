import { secondsToTicks } from '../core/time';
import { vec3 } from '../core/vec3';
import { SKILL_IDS } from '../config/dial';
import type { EnemyKind } from '../config/scoring';
import { sweep as sweepDefaults, type SweepCard } from '../config/sweep';
import type { Tunables } from '../config/tunables';
import { createContactSettle, settleContact, type ContactFacts } from '../feedback/contactScore';
import { difficultyMultiplier } from '../feedback/scoring';
import { MAPS } from '../sim/mapLoader';
import type { RunEvents, SectorEvents } from '../sim/runEvents';
import type { ColdProfile } from '../config/coldOpener';
import { coldOpenerPlan, type ColdOpenerEvents } from './coldOpener';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { sectorCatalog } from './sweepCatalog';
import { perSector, planRun, type ContactPlan, type EchoPlan, type RunPlan, type SectorPlan, type SectorSource } from './sweepDirector';

/**
 * Sweep, the run (design §4; v0 is #201): a seeded chain of take sectors across the sector maps.
 * Echoes are placed on each sector's hold anchors the moment the player is put at its entry, out of
 * the player's sight (`sweepDirector.ts`); every fight is a **contact** dealt from a scenario card, tracked
 * from the first information either side has to its end and settled once (design §2.3, §8.1).
 * Health and shield carry from sector to sector (the world is never reset inside a run; kills heal,
 * the sim does that). Walking into a sector's exit ends it: the next sector's map is loaded in place
 * when it differs and the player is put at its entry. The run ends at 0 HP (`death`) or at the
 * last sector's exit (`left`).
 *
 * A run with a cold opener (design §8.5, `ctx.coldOpenerLevel`) plays its Opener as the cold opener's
 * **legs**: one stored contact each, in its own take sector (mirrored ones on the mirrored map), every
 * Echo at the level's stored profile and item difficulty, its trials tagged `baseline`. To everything
 * outside the mode the legs are one sector, the Opener: one `sectorEntered` at the first leg, one
 * `sectorEnded` at the last leg's exit (or the death or quit inside it); `coldLegEntered` marks each
 * move between legs, and `coldOpenerStarted` / `coldOpenerEnded` bracket the measurement.
 */

/** One contact while the run plays. */
interface ContactRt {
  plan: ContactPlan;
  /** Settle id of the current opening (a contact the player left and came back to opens again with a new id); -1 while closed. */
  id: number;
  open: boolean;
  /** Target ids of its Echoes (-1: refused at spawn) and their kinds, index for index. */
  echoIds: number[];
  kinds: EnemyKind[];
  alive: number;
  /** Health+shield when it opened and what the player lost since. */
  startEhp: number;
  damage: number;
  lastSightTick: number;
  /** It opened at least once: its Echoes' trials count. */
  engaged: boolean;
}

export interface SweepState {
  plan: RunPlan;
  sector: number;
  /** The cold-opener leg being played (index into `plan.cold.sectors`), or -1 outside one. */
  leg: number;
  /** Across the current sector's legs: Echoes spawned, their base points, and Echoes left alive. */
  secKinds: number;
  secBase: number;
  secAlive: number;
  contacts: ContactRt[];
  /** Health+shield at the current sector's entry. */
  entryEhp: number;
  /** Score when the current sector was entered. */
  entryScore: number;
  nextContactId: number;
  /** Contacts settled in the run, by outcome (the results card's won/lost). */
  won: number;
  lost: number;
  /** The run is over (left or died). */
  done: boolean;
}

const settle = createContactSettle();
const facts: ContactFacts & { kinds: EnemyKind[] } = { kinds: [], dial: 50, startEhp: 0, damageTaken: 0, allDead: false, died: false };
const body = vec3();
const enteredEv: SectorEvents['sectorEntered'] = {
  tick: 0, t: 0, sectorId: '', mapId: '', index: 0, of: 0, role: 'take', condition: 'full', stake: 'plain', dial: 0, depth: 1, contacts: 0, echoes: 0,
};
const endedEv: SectorEvents['sectorEnded'] = {
  tick: 0, t: 0, sectorId: '', index: 0, cleared: false, keptSector: 0, tempo: false, points: 0, clearPoints: 0, reason: 'exit',
};
const settledEv: RunEvents['contactSettled'] = { tick: 0, t: 0, contactId: 0, outcome: 'avoided', kept: 1, enemies: 0, points: 0, card: '' };
const coldStartEv: ColdOpenerEvents['coldOpenerStarted'] = { tick: 0, version: 0, level: 0, legs: 0, seed: 0 };
const coldLegEv: ColdOpenerEvents['coldLegEntered'] = { tick: 0, leg: 0, of: 0, mapId: '', sectorId: '', mirrored: false, card: '' };
const coldEndEv: ColdOpenerEvents['coldOpenerEnded'] = { tick: 0, t: 0, reason: 'exit', legsDone: 0, kept: 0 };

/** The shipped maps' sectors, built once per tunables object (the visibility answers are memoised inside). */
let catalogCache: { tunables: Tunables; sectors: SectorSource[] } | null = null;
export function sweepCatalog(tunables: Tunables): SectorSource[] {
  if (catalogCache?.tunables !== tunables) catalogCache = { tunables, sectors: sectorCatalog(Object.values(MAPS), tunables) };
  return catalogCache.sectors;
}

/**
 * The plan a seed gives (what `setup` plays): for tests, the bot report and the debug hook. With
 * `coldLevel`, the Opener is that level's cold opener for the seed (design §8.5): its first leg stands
 * in `sectors[0]`, every leg is in `cold.sectors`, and the later sectors' contacts are numbered after them.
 */
export function sweepPlan(seed: number, tunables: Tunables, coldLevel: number | null = null): RunPlan {
  const catalog = sweepCatalog(tunables);
  const plan = planRun(seed, catalog, tunables.sweep, tunables.movement);
  if (coldLevel === null) return plan;
  const cold = coldOpenerPlan(seed, coldLevel, catalog, undefined, tunables.coldOpener);
  let next = cold.sectors.length;
  const rest = plan.sectors.slice(1).map((sp) => ({ ...sp, contacts: sp.contacts.map((c) => ({ ...c, index: next++ })) }));
  return { seed, sectors: [cold.sectors[0]!, ...rest], cold };
}

/** The sector plan being played: the current cold-opener leg, else the current sector. */
export function currentSector(st: SweepState): SectorPlan {
  return st.leg >= 0 && st.plan.cold ? st.plan.cold.sectors[st.leg]! : st.plan.sectors[st.sector]!;
}

function ehp(ctx: ModeContext<SweepState>): number {
  return ctx.vitals.alive ? ctx.vitals.hp + ctx.vitals.shield : 0;
}

/**
 * Feet position of each Echo's spawn, with the dial's numbers for its kind (design §5.2, §5.3). A cold
 * opener's Echo plays the level's stored profile instead, at the level's item difficulty and dial, and
 * its trial is a `baseline` one (design §8.5): no adaptation inside the cold opener.
 */
function spawnEcho(ctx: ModeContext<SweepState>, c: ContactRt, e: EchoPlan, cold: { level: number; profile: ColdProfile } | null): number {
  const cfg = ctx.tunables.sweep;
  const a = ctx.axes;
  const p = cold?.profile;
  const fire = {
    tellSec: p ? p.tellSec : a.tellSec!, reactionSec: p ? p.reactionSec : a.enemyReactionSec!, hitChance: p ? p.hitChance : a.enemyHitChance!,
    expectation: e.expectation,
  };
  const common = {
    fire, crouched: e.crouched, card: c.plan.card, skill: cfg.cardSkill[c.plan.card], placed: true,
    ...(cold ? { source: 'baseline' as const, dial: cold.level, difficulty: cold.level } : {}),
  };
  if (e.kind === 'peeker' && e.peek) {
    return ctx.spawn('peeker', e.feet, { ...common, peek: { pattern: e.peek.pattern, hold: e.peek.hold, out: e.peek.out, wideSec: p ? p.peekWideSec : a.peekWideSec } });
  }
  return ctx.spawn('strafer', e.feet, {
    ...common,
    strafe: {
      speed: p ? p.strafeSpeed : a.strafeSpeed!, legSec: p ? p.strafeLegSec : a.strafeLegSec!, standStillSec: p ? p.standStillSec : a.standStillSec!,
      laneA: e.laneA ?? e.feet, laneB: e.laneB ?? e.feet,
    },
  });
}

/** Put the player at `sp`'s entry and place its Echoes (out of the player's sight there). Returns the Echoes placed. */
function placeSector(ctx: ModeContext<SweepState>, sp: SectorPlan, cold: { level: number; profile: ColdProfile } | null): number {
  const st = ctx.state;
  ctx.loadMap(sp.mapId);
  ctx.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, sp.entryYaw);
  st.contacts.length = 0;
  let echoes = 0;
  for (const cp of sp.contacts) {
    const c: ContactRt = {
      plan: cp, id: -1, open: false, echoIds: [], kinds: [], alive: 0, startEhp: 0, damage: 0, lastSightTick: 0, engaged: false,
    };
    for (const e of cp.echoes) {
      const id = spawnEcho(ctx, c, e, cold);
      c.echoIds.push(id);
      c.kinds.push(e.kind);
      if (id >= 0) {
        c.alive++;
        echoes++;
      }
    }
    st.contacts.push(c);
  }
  return echoes;
}

/** A key that changes whenever the player is moved to a new sector or cold-opener leg (bots re-plan their route on it). */
export function sectorKey(st: SweepState): number {
  return st.sector * 64 + st.leg + 1;
}

/** The cold opener's level and profile while a leg is played, else null. */
function coldOf(st: SweepState): { level: number; profile: ColdProfile } | null {
  return st.leg >= 0 && st.plan.cold ? st.plan.cold : null;
}

/** The next cold-opener leg: the previous one's contacts are already closed. */
function enterLeg(ctx: ModeContext<SweepState>, leg: number): void {
  const st = ctx.state;
  const cold = st.plan.cold!;
  st.leg = leg;
  placeSector(ctx, cold.sectors[leg]!, cold);
  emitLeg(ctx, leg);
}

/** Announce the cold-opener leg `leg` (`coldLegEntered`). */
function emitLeg(ctx: ModeContext<SweepState>, leg: number): void {
  const cold = ctx.state.plan.cold!;
  const sp = cold.sectors[leg]!;
  const e = coldLegEv;
  e.tick = ctx.simTick;
  e.leg = leg;
  e.of = cold.sectors.length;
  e.mapId = sp.mapId;
  e.sectorId = sp.sectorId;
  e.mirrored = cold.legs[leg]!.mirrored;
  e.card = sp.contacts[0]?.card ?? '';
  ctx.events.emit('coldLegEntered', e);
}

/**
 * Put the player at sector `i`'s entry and place its Echoes (they are out of the player's sight there).
 * Sector 0 of a run with a cold opener is its first leg; the sector's totals count every leg.
 */
function enterSector(ctx: ModeContext<SweepState>, i: number): void {
  const st = ctx.state;
  const cfg = ctx.tunables.sweep;
  st.sector = i;
  // One beat per sector: the dial is read from the posterior here, with the sector's offset (design §4.1, §9.3).
  if (i > 0) ctx.advanceBeat();
  const depth = perSector(cfg.depthMultiplier, i);
  ctx.setPointsMultiplier(depth);
  st.secKinds = st.secBase = st.secAlive = 0;
  const cold = i === 0 ? st.plan.cold ?? null : null;
  st.leg = cold ? 0 : -1;
  const sp = currentSector(st);
  const echoes = placeSector(ctx, sp, cold);
  st.entryEhp = ehp(ctx);
  st.entryScore = ctx.stats.score;
  if (cold) {
    const c = coldStartEv;
    c.tick = ctx.simTick;
    c.version = cold.version;
    c.level = cold.level;
    c.legs = cold.sectors.length;
    c.seed = st.plan.seed;
    ctx.events.emit('coldOpenerStarted', c);
  }
  const ev = enteredEv;
  ev.tick = ctx.simTick;
  ev.t = ctx.timeSec;
  ev.sectorId = cold ? 'cold-opener' : sp.sectorId;
  ev.mapId = sp.mapId;
  ev.index = i;
  ev.of = st.plan.sectors.length;
  ev.dial = cold ? cold.level : ctx.dial;
  ev.depth = depth;
  let contacts = sp.contacts.length;
  let all = echoes;
  if (cold) {
    contacts = all = 0;
    for (const leg of cold.sectors) {
      contacts += leg.contacts.length;
      for (const c of leg.contacts) all += c.echoes.length;
    }
  }
  ev.contacts = contacts;
  ev.echoes = all;
  ctx.events.emit('sectorEntered', ev);
  // The first leg is entered with the sector; later legs announce themselves as they come.
  if (cold) emitLeg(ctx, 0);
}

function contactOf(st: SweepState, targetId: number): ContactRt | null {
  for (let i = 0; i < st.contacts.length; i++) {
    const c = st.contacts[i]!;
    for (let k = 0; k < c.echoIds.length; k++) if (c.echoIds[k] === targetId) return c;
  }
  return null;
}

/** First information either side has: the contact opens (design §2.3). `lostAlready`: health+shield the triggering hit took. */
function openContact(ctx: ModeContext<SweepState>, c: ContactRt, lostAlready = 0): void {
  if (c.open || c.alive === 0) return;
  const st = ctx.state;
  c.open = true;
  c.engaged = true;
  c.id = st.nextContactId++;
  c.startEhp = ehp(ctx) + lostAlready;
  c.damage = 0;
  c.lastSightTick = ctx.simTick;
}

/** Settle an open contact once (design §8.1); its points carry the sector's depth multiplier. */
function settleOpen(ctx: ModeContext<SweepState>, c: ContactRt, died: boolean): void {
  if (!c.open) return;
  const st = ctx.state;
  c.open = false;
  facts.kinds.length = 0;
  for (let k = 0; k < c.kinds.length; k++) if (c.echoIds[k]! >= 0) facts.kinds.push(c.kinds[k]!);
  facts.dial = ctx.dial;
  facts.startEhp = c.startEhp;
  facts.damageTaken = c.damage;
  facts.allDead = c.alive === 0;
  facts.died = died;
  settleContact(settle, facts, ctx.tunables.scoring);
  const points = ctx.awardPoints(settle.total * perSector(ctx.tunables.sweep.depthMultiplier, st.sector));
  if (settle.outcome === 'cleared') st.won++;
  else if (settle.outcome === 'died' || settle.outcome === 'disengaged') st.lost++;
  const e = settledEv;
  e.tick = ctx.simTick;
  e.t = ctx.timeSec;
  e.contactId = c.id;
  e.outcome = settle.outcome;
  e.kept = settle.kept;
  e.enemies = facts.kinds.length;
  e.points = points;
  e.card = c.plan.card;
  ctx.events.emit('contactSettled', e);
}

/** Line of sight either way between the player and any live Echo of the contact (the sim's own sight test, no rays here). */
function inSight(ctx: ModeContext<SweepState>, c: ContactRt): boolean {
  for (let k = 0; k < c.echoIds.length; k++) {
    const id = c.echoIds[k]!;
    if (id >= 0 && ctx.targetInSight(id)) return true;
  }
  return false;
}

/** Close the contacts on the field: settle what is open, fail the trials of Echoes that fought and lived, clear them away, and add them to the sector's totals. */
function closeContacts(ctx: ModeContext<SweepState>, died: boolean): void {
  const st = ctx.state;
  for (const c of st.contacts) {
    settleOpen(ctx, c, died);
    for (let k = 0; k < c.echoIds.length; k++) {
      const id = c.echoIds[k]!;
      if (id < 0) continue;
      st.secKinds++;
      st.secBase += ctx.tunables.scoring.base[c.kinds[k]!];
      if (!ctx.targetPosition(id, body)) continue; // dead
      st.secAlive++;
      if (c.engaged) ctx.resolveTrial(id, false);
      ctx.despawn(id);
    }
  }
  st.contacts.length = 0;
}

/** The sector is over (its last leg, for a cold opener): close its contacts and pay the clear. */
function endSector(ctx: ModeContext<SweepState>, reason: 'exit' | 'death' | 'quit'): void {
  const st = ctx.state;
  const sp = st.plan.sectors[st.sector]!;
  const cfg = ctx.tunables.sweep;
  const died = reason === 'death';
  const cold = coldOf(st);
  closeContacts(ctx, died);
  const alive = st.secAlive;
  const kinds = st.secKinds;
  const base = st.secBase;
  const kept = died || st.entryEhp <= 0 ? 0 : Math.min(1, ehp(ctx) / st.entryEhp);
  const cleared = !died && reason === 'exit' && alive === 0 && kinds > 0;
  let clearPoints = 0;
  if (cleared) {
    const kill = (base / kinds) * difficultyMultiplier(ctx.dial, ctx.tunables.scoring);
    clearPoints = ctx.awardPoints(cfg.clearKills * kill * kept * perSector(cfg.depthMultiplier, st.sector));
  }
  if (cold) {
    const c = coldEndEv;
    c.tick = ctx.simTick;
    c.t = ctx.timeSec;
    c.reason = reason;
    c.legsDone = st.leg + (reason === 'exit' ? 1 : 0);
    c.kept = kept;
    st.leg = -1;
    ctx.events.emit('coldOpenerEnded', c);
  }
  const e = endedEv;
  e.tick = ctx.simTick;
  e.t = ctx.timeSec;
  e.sectorId = cold ? 'cold-opener' : sp.sectorId;
  e.index = st.sector;
  e.cleared = cleared;
  e.keptSector = kept;
  e.tempo = false;
  e.points = ctx.stats.score - st.entryScore;
  e.clearPoints = clearPoints;
  e.reason = reason;
  ctx.events.emit('sectorEnded', e);
}

function atExit(ctx: ModeContext<SweepState>): boolean {
  const sp = currentSector(ctx.state);
  const p = ctx.player.pos;
  const cfg = ctx.tunables.sweep;
  const dx = p.x - sp.exit.x, dz = p.z - sp.exit.z;
  return dx * dx + dz * dz <= cfg.exitRadiusM * cfg.exitRadiusM && Math.abs(p.y - sp.exit.y) <= cfg.exitHeightM;
}

export const SWEEP_MODE = 'sweep';

export const sweep: ModeDef<SweepState> = {
  id: SWEEP_MODE,
  // Sweep measures all seven skills through the trials of its contacts (design §3.1, §4.9).
  skills: SKILL_IDS,
  // The first sector's map is loaded by `setup`; this is only where the host starts.
  map: 'elbow',
  weapon: 'kestrel',
  // Real magazines and reloads, but the reserve never runs dry: the reference game refills it every
  // round, and a run is many rounds' worth of fights with no ammo to pick up (#201 decision).
  player: { allowSwap: true, infiniteReserve: true },
  // Echoes shoot back with heavy shields on both sides (design §4.1, §4.6: `full` is the default).
  economy: 'full',
  durationSec: Infinity,
  axes: ['tellSec', 'enemyReactionSec', 'enemyHitChance', 'strafeSpeed'],
  beatSec: null,
  waveCurve: sweepDefaults.dialOffset,
  missBreaksStreak: true,

  setup(ctx) {
    ctx.state = {
      plan: sweepPlan(ctx.seed, ctx.tunables, ctx.coldOpenerLevel), sector: 0, leg: -1, secKinds: 0, secBase: 0, secAlive: 0,
      contacts: [], entryEhp: 0, entryScore: 0, nextContactId: 0, won: 0, lost: 0, done: false,
    };
    enterSector(ctx, 0);
    return ctx.state;
  },

  tick(ctx) {
    const st = ctx.state;
    if (st.done) return;
    const holdTicks = secondsToTicks(ctx.tunables.scoring.contact.disengageSec);
    for (let i = 0; i < st.contacts.length; i++) {
      const c = st.contacts[i]!;
      if (!c.open) continue;
      if (inSight(ctx, c)) c.lastSightTick = ctx.simTick;
      // Two seconds with no line of sight either way: the contact is over (design §2.3).
      else if (ctx.simTick - c.lastSightTick >= holdTicks) settleOpen(ctx, c, false);
    }
    if (!atExit(ctx)) return;
    const cold = st.plan.cold;
    if (cold && st.leg >= 0 && st.leg + 1 < cold.sectors.length) {
      // A leg of the cold opener is done: the next one, still inside the Opener (no gate, no beat).
      closeContacts(ctx, false);
      enterLeg(ctx, st.leg + 1);
      return;
    }
    endSector(ctx, 'exit');
    if (st.sector + 1 >= st.plan.sectors.length) {
      st.done = true;
      ctx.end('left');
      return;
    }
    enterSector(ctx, st.sector + 1);
  },

  onEvent(ctx, ev: ModeEvent) {
    const st = ctx.state;
    if (st.done) return;
    switch (ev.type) {
      case 'targetVisible':
      case 'enemySawPlayer': {
        const c = contactOf(st, ev.payload.targetId);
        if (c) openContact(ctx, c);
        break;
      }
      case 'enemyFired': {
        const c = contactOf(st, ev.payload.id);
        if (c) openContact(ctx, c);
        break;
      }
      case 'shotImpact': {
        const id = ev.payload.targetId;
        if (ev.payload.onTarget && id !== undefined && id >= 0) {
          const c = contactOf(st, id);
          if (c) openContact(ctx, c);
        }
        break;
      }
      case 'playerDamaged': {
        const d = ev.payload;
        const c = contactOf(st, d.sourceId);
        if (!c) break;
        const lost = d.amount + d.absorbed;
        openContact(ctx, c, lost);
        c.damage += lost;
        break;
      }
      case 'targetKilled': {
        const c = contactOf(st, ev.payload.targetId);
        if (!c) break;
        openContact(ctx, c);
        c.alive--;
        if (c.alive <= 0) settleOpen(ctx, c, false);
        break;
      }
      default:
        break;
    }
  },

  onEnd(ctx, reason) {
    const st = ctx.state;
    if (st.done) return;
    st.done = true;
    endSector(ctx, reason === 'death' ? 'death' : 'quit');
  },
};

/** Cards in the plan of a seed, in order: for tests and the bot report. */
export function planCards(plan: RunPlan): SweepCard[] {
  const out: SweepCard[] = [];
  for (const s of plan.sectors) for (const c of s.contacts) out.push(c.card);
  return out;
}
