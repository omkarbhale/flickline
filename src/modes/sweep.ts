import { secondsToTicks, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { SKILL_IDS } from '../config/dial';
import type { EnemyKind } from '../config/scoring';
import { sweep as sweepDefaults, type SectorRole, type SweepCard } from '../config/sweep';
import type { Tunables } from '../config/tunables';
import { createContactSettle, settleContact, type ContactFacts } from '../feedback/contactScore';
import { difficultyMultiplier } from '../feedback/scoring';
import { MAPS } from '../sim/mapLoader';
import type { RunEvents, SectorEvents } from '../sim/runEvents';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { sectorCatalog } from './sweepCatalog';
import { perSector, planFollowers, planRun, type ContactPlan, type EchoPlan, type RunPlan, type SectorSource } from './sweepDirector';

/**
 * Sweep, the run (design §4; v0 is #201, hold sectors and the Finale #204): a seeded chain of six
 * sectors across the sector maps, each a take or a hold (`sweepDirector.ts`).
 * - **Take**: Echoes are placed on the sector's hold anchors the moment the player is put at its entry,
 *   out of the player's sight. Walking into the exit ends the sector; survivors of fights follow.
 * - **Hold**: the sector starts empty and its contacts **arrive** along its approach lanes at the
 *   planned times (`ArrivePlan`); the exit opens when every Echo of the sector is dead. A flank is
 *   armed only when the contact before it was won.
 * Every fight is a **contact** dealt from a scenario card, tracked from the first information either
 * side has to its end and settled once (design §2.3, §8.1). Health and shield carry from sector to
 * sector (the world is never reset inside a run; kills heal, the sim does that). The next sector's map is
 * loaded in place when it differs and the player is put at its entry. The run ends at 0 HP (`death`) or
 * at the last sector's exit (`left`).
 */

/** One contact while the run plays. */
interface ContactRt {
  plan: ContactPlan;
  /** Settle id of the current opening (a contact the player left and came back to opens again with a new id); -1 while closed. */
  id: number;
  open: boolean;
  /** Target ids of its Echoes (-1: refused at spawn, `NOT_YET`: it arrives later) and their kinds, index for index. */
  echoIds: number[];
  kinds: EnemyKind[];
  alive: number;
  /** Echoes that have not arrived yet (hold sectors, followers). */
  pending: number;
  /** A flank: the tick the contact before it was won, -1 until then (its Echoes count their `atSec` from it). */
  armedTick: number;
  /** An arrival due while its lane start is in the player's sight waits: the tick it first was due and blocked, 0 = not blocked. */
  deferredAt: number[];
  /** Health+shield when it opened and what the player lost since. */
  startEhp: number;
  damage: number;
  lastSightTick: number;
  /** It opened at least once: its Echoes' trials count. */
  engaged: boolean;
  /** Meet contacts: where each Echo was a tick ago (to read its speed) and who stopped first (`StopFirst`) since the contact opened. */
  prevX: number[];
  prevZ: number[];
  /** An Echo has run above stop speed (a standing start is not a stop). */
  moved: boolean[];
  /** The player has run above stop speed since the contact opened. */
  playerMoved: boolean;
  stopFirst: StopFirst;
}

/** Who first dropped to counter-strafe speed in a meet contact (design §4.2). */
type StopFirst = 'none' | 'player' | 'echo' | 'both';

/** An Echo of a hold contact that has not spawned yet. */
const NOT_YET = -2;

export interface SweepState {
  plan: RunPlan;
  sector: number;
  /** The role the current sector plays. */
  role: SectorRole;
  /** Sim tick the current sector began on. */
  sectorTick0: number;
  /** Hold: every Echo of the sector is dead (or the fallback ran out) and the exit is open. */
  exitOpen: boolean;
  /** Hold: tick after which the exit opens whatever is alive (a stuck Echo must not hold the run). */
  exitFallbackTick: number;
  /** Contacts won in the current sector (a flank follows only a won contact). */
  wonSector: number;
  /** Survivors that follow the player into the next sector, set when a take sector is left. */
  carry: { count: number; won: boolean } | null;
  contacts: ContactRt[];
  /** Health+shield at the current sector's entry. */
  entryEhp: number;
  /** Score when the current sector was entered. */
  entryScore: number;
  nextContactId: number;
  /** Index the next contact planned at run time (a follower's) takes, after the plan's own. */
  nextPlanIndex: number;
  /** Contacts settled in the run, by outcome (the results card's won/lost). */
  won: number;
  lost: number;
  /** The run is over (left or died). */
  done: boolean;
}

const settle = createContactSettle();
const facts: ContactFacts & { kinds: EnemyKind[] } = { kinds: [], dial: 50, startEhp: 0, damageTaken: 0, allDead: false, died: false };
const body = vec3();
const exitOpenedEv: SectorEvents['sectorExitOpened'] = { tick: 0, t: 0, sectorId: '', index: 0 };
const probe = vec3();
const enteredEv: SectorEvents['sectorEntered'] = {
  tick: 0, t: 0, sectorId: '', mapId: '', index: 0, of: 0, role: 'take', condition: 'full', stake: 'plain', dial: 0, depth: 1, contacts: 0, echoes: 0,
};
const endedEv: SectorEvents['sectorEnded'] = {
  tick: 0, t: 0, sectorId: '', index: 0, cleared: false, keptSector: 0, tempo: false, points: 0, clearPoints: 0, reason: 'exit',
};
const settledEv: RunEvents['contactSettled'] = { tick: 0, t: 0, contactId: 0, outcome: 'avoided', kept: 1, enemies: 0, points: 0, card: '' };

/** The shipped maps' sectors, built once per tunables object (the visibility answers are memoised inside). */
let catalogCache: { tunables: Tunables; sectors: SectorSource[] } | null = null;
export function sweepCatalog(tunables: Tunables): SectorSource[] {
  if (catalogCache?.tunables !== tunables) catalogCache = { tunables, sectors: sectorCatalog(Object.values(MAPS), tunables) };
  return catalogCache.sectors;
}

/** The catalog entry of a planned sector. */
function sourceOf(tunables: Tunables, mapId: string, sectorId: string): SectorSource | undefined {
  return sweepCatalog(tunables).find((x) => x.mapId === mapId && x.id === sectorId);
}

/** The plan a seed gives (what `setup` plays): for tests, the bot report and the debug hook. */
export function sweepPlan(seed: number, tunables: Tunables): RunPlan {
  return planRun(seed, sweepCatalog(tunables), tunables.sweep, tunables.movement);
}

function ehp(ctx: ModeContext<SweepState>): number {
  return ctx.vitals.alive ? ctx.vitals.hp + ctx.vitals.shield : 0;
}

/** Feet position of each Echo's spawn, with the dial's numbers for its kind (design §5.2, §5.3). */
function spawnEcho(ctx: ModeContext<SweepState>, c: ContactRt, e: EchoPlan): number {
  const a = ctx.axes;
  const cfg = ctx.tunables.sweep;
  const fire = { tellSec: a.tellSec!, reactionSec: a.enemyReactionSec!, hitChance: a.enemyHitChance!, expectation: e.expectation };
  const arrive = e.arrive ? { route: e.arrive.route, speed: e.arrive.speed, engageM: e.arrive.engageM } : undefined;
  // An arrival is out of the sector when it spawns; the fairness floors bind it as it walks in (`sim/arrival.ts`).
  const common = { fire, crouched: e.crouched, card: c.plan.card, skill: cfg.cardSkill[c.plan.card], placed: true, arrive };
  if (e.gait) {
    // A meet Echo: it travels its route at its gait, stops once it has reacted to the player, then strafes in stops.
    const speed = e.gait === 'run' ? cfg.meet.runSpeedMps : cfg.meet.walkSpeedMps;
    return ctx.spawn('strafer', e.feet, {
      ...common,
      strafe: { speed, legSec: a.strafeLegSec!, standStillSec: a.standStillSec!, laneA: e.laneA ?? e.feet, laneB: e.laneB ?? e.feet, travel: true },
    });
  }
  if (e.kind === 'peeker' && e.peek) {
    return ctx.spawn('peeker', e.feet, { ...common, peek: { pattern: e.peek.pattern, hold: e.peek.hold, out: e.peek.out, wideSec: a.peekWideSec } });
  }
  return ctx.spawn('strafer', e.feet, {
    ...common,
    strafe: { speed: a.strafeSpeed!, legSec: a.strafeLegSec!, standStillSec: a.standStillSec!, laneA: e.laneA ?? e.feet, laneB: e.laneB ?? e.feet },
  });
}

function newContact(cp: ContactPlan): ContactRt {
  return {
    plan: cp, id: -1, open: false, echoIds: [], kinds: [], alive: 0, pending: 0, armedTick: -1, deferredAt: [], startEhp: 0, damage: 0,
    lastSightTick: 0, engaged: false, prevX: [], prevZ: [], moved: [], playerMoved: false, stopFirst: 'none',
  };
}

/** Put the player at sector `i`'s entry and place its Echoes (a take: out of the player's sight) or set its arrivals (a hold). */
function enterSector(ctx: ModeContext<SweepState>, i: number): void {
  const st = ctx.state;
  const sp = st.plan.sectors[i]!;
  const cfg = ctx.tunables.sweep;
  st.sector = i;
  st.role = sp.role;
  st.exitOpen = sp.role !== 'hold';
  st.exitFallbackTick = Infinity;
  st.wonSector = 0;
  st.sectorTick0 = ctx.simTick;
  ctx.loadMap(sp.mapId);
  ctx.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, sp.entryYaw);
  // One beat per sector: the dial is read from the posterior here, with the sector's offset (design §4.1, §9.3).
  if (i > 0) ctx.advanceBeat();
  // The sector's economy (design §4.6) before anyone is placed: the Echoes spawn with its shield and weapon.
  ctx.setEconomy(sp.condition);
  const depth = perSector(cfg.depthMultiplier, i);
  ctx.setPointsMultiplier(depth);
  st.contacts.length = 0;
  // Survivors that followed the player here arrive as one more contact (design §4.2).
  const plans: ContactPlan[] = sp.contacts.slice();
  const carry = st.carry;
  st.carry = null;
  if (carry) {
    const src = sourceOf(ctx.tunables, sp.mapId, sp.sectorId);
    const f = src ? planFollowers(st.plan.seed, cfg, src, carry.count, carry.won, i, st.nextPlanIndex) : null;
    if (f) {
      plans.push(f);
      st.nextPlanIndex++;
    }
  }
  let echoes = 0;
  let lastDueSec = 0;
  for (const cp of plans) {
    const c = newContact(cp);
    for (const e of cp.echoes) {
      c.kinds.push(e.kind);
      c.prevX.push(e.feet.x);
      c.prevZ.push(e.feet.z);
      c.moved.push(false);
      c.deferredAt.push(0);
      if (e.arrive) {
        // It arrives later: nothing is in the world yet.
        c.echoIds.push(NOT_YET);
        c.pending++;
        echoes++;
        lastDueSec = Math.max(lastDueSec, e.arrive.atSec);
        continue;
      }
      const id = spawnEcho(ctx, c, e);
      c.echoIds.push(id);
      if (id >= 0) {
        c.alive++;
        echoes++;
      }
    }
    st.contacts.push(c);
  }
  if (sp.role === 'hold') st.exitFallbackTick = ctx.simTick + secondsToTicks(lastDueSec + cfg.hold.exitFallbackSec);
  st.entryEhp = ehp(ctx);
  st.entryScore = ctx.stats.score;
  const ev = enteredEv;
  ev.tick = ctx.simTick;
  ev.t = ctx.timeSec;
  ev.sectorId = sp.sectorId;
  ev.mapId = sp.mapId;
  ev.condition = sp.condition;
  ev.role = sp.role;
  ev.index = i;
  ev.of = st.plan.sectors.length;
  ev.dial = ctx.dial;
  ev.depth = depth;
  ev.contacts = plans.length;
  ev.echoes = echoes;
  ctx.events.emit('sectorEntered', ev);
}

/** Whether the first point of an arrival's route is in line of sight of the player's eye (the Echo would pop into view). */
function startShows(ctx: ModeContext<SweepState>, e: EchoPlan): boolean {
  const r = e.arrive!.route[0]!;
  probe.x = r.x;
  probe.y = r.y + 1.4;
  probe.z = r.z;
  return ctx.scheduler.sightClear(ctx.scheduler.eyePosition(), probe);
}

/** Spawn the arrivals that are due: on the sector's clock, or (a flank) on the clock of the win that armed it. */
function spawnDue(ctx: ModeContext<SweepState>): void {
  const st = ctx.state;
  const deferTicks = secondsToTicks(ctx.tunables.sweep.hold.deferMaxSec);
  for (let ci = 0; ci < st.contacts.length; ci++) {
    const c = st.contacts[ci]!;
    if (c.pending === 0) continue;
    if (c.plan.after !== undefined && c.armedTick < 0) {
      const before = st.contacts[c.plan.after];
      // A flank is armed by a contact the player won: every Echo of it dead.
      if (before && before.pending === 0 && before.alive === 0 && before.engaged) c.armedTick = ctx.simTick;
      else continue;
    }
    const base = c.plan.after !== undefined ? c.armedTick : st.sectorTick0;
    for (let k = 0; k < c.echoIds.length; k++) {
      if (c.echoIds[k] !== NOT_YET) continue;
      const e = c.plan.echoes[k]!;
      const due = base + secondsToTicks(e.arrive!.atSec);
      if (ctx.simTick < due) continue;
      // The lane's start in plain view: wait for the player to look away or move, a few seconds at most.
      if (ctx.simTick < due + deferTicks && startShows(ctx, e)) {
        if (c.deferredAt[k] === 0) c.deferredAt[k] = ctx.simTick;
        continue;
      }
      const id = spawnEcho(ctx, c, e);
      c.echoIds[k] = id;
      c.pending--;
      if (id >= 0) {
        c.alive++;
        // Joining a contact that is open: the two seconds without a sight start from now.
        c.lastSightTick = ctx.simTick;
      }
    }
  }
}

/** Every Echo of a hold sector has come and gone (the exit opens). */
function allDone(st: SweepState): boolean {
  for (let i = 0; i < st.contacts.length; i++) {
    const c = st.contacts[i]!;
    if (c.pending > 0 || c.alive > 0) return false;
  }
  return true;
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
  c.stopFirst = 'none';
  c.playerMoved = false;
}

/**
 * Meet contacts: note which side first drops to counter-strafe speed or below once the contact is open (design §4.2,
 * `sweep.meet.stopSpeedMps`). A side has to have run to stop: an Echo's speed is read from its movement since the last
 * tick, and a player who stands still throughout stopped first by standing (`stoppedFirst` at the settle). Cheap: a
 * few multiplies per Echo, no allocation.
 */
function trackStop(ctx: ModeContext<SweepState>, c: ContactRt, open: boolean): void {
  const stop = ctx.tunables.sweep.meet.stopSpeedMps;
  const stopSq = stop * stop;
  let echoStopped = false;
  for (let k = 0; k < c.echoIds.length; k++) {
    const id = c.echoIds[k]!;
    if (id < 0 || !ctx.targetPosition(id, body)) continue;
    const dx = (body.x - c.prevX[k]!) * TICK_RATE, dz = (body.z - c.prevZ[k]!) * TICK_RATE;
    c.prevX[k] = body.x;
    c.prevZ[k] = body.z;
    if (dx * dx + dz * dz > stopSq) c.moved[k] = true;
    else if (c.moved[k]) echoStopped = true;
  }
  if (!open) return;
  const v = ctx.player.vel;
  const playerSlow = v.x * v.x + v.z * v.z <= stopSq;
  if (!playerSlow) c.playerMoved = true;
  if (c.stopFirst !== 'none') return;
  const playerStopped = c.playerMoved && playerSlow;
  if (playerStopped && echoStopped) c.stopFirst = 'both';
  else if (playerStopped) c.stopFirst = 'player';
  // An Echo stops while the player is still running, or while the player has stood still all along.
  else if (echoStopped) c.stopFirst = !c.playerMoved && playerSlow ? 'player' : 'echo';
}

/** Who stopped first in a settled meet contact: a player who never ran stood still the whole time and stopped first. */
function stoppedFirst(c: ContactRt): 'player' | 'echo' | 'both' | 'neither' {
  if (c.stopFirst !== 'none') return c.stopFirst;
  return c.playerMoved ? 'neither' : 'player';
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
  if (settle.outcome === 'cleared') {
    st.won++;
    st.wonSector++;
  } else if (settle.outcome === 'died' || settle.outcome === 'disengaged') st.lost++;
  const e = settledEv;
  e.tick = ctx.simTick;
  e.t = ctx.timeSec;
  e.contactId = c.id;
  e.outcome = settle.outcome;
  e.kept = settle.kept;
  e.enemies = facts.kinds.length;
  e.points = points;
  e.card = c.plan.card;
  e.stopFirst = c.plan.card === 'meet' ? stoppedFirst(c) : undefined;
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

/** The sector is over: settle what is open, fail the trials of Echoes that fought and lived, clear the field, pay the clear. */
function endSector(ctx: ModeContext<SweepState>, reason: 'exit' | 'death' | 'quit'): void {
  const st = ctx.state;
  const sp = st.plan.sectors[st.sector]!;
  const cfg = ctx.tunables.sweep;
  const died = reason === 'death';
  let alive = 0;
  let followers = 0;
  let kinds = 0;
  let base = 0;
  for (const c of st.contacts) {
    settleOpen(ctx, c, died);
    for (let k = 0; k < c.echoIds.length; k++) {
      const id = c.echoIds[k]!;
      if (id < 0) continue;
      kinds++;
      base += ctx.tunables.scoring.base[c.kinds[k]!];
      if (!ctx.targetPosition(id, body)) continue; // dead
      alive++;
      if (c.engaged) {
        followers++;
        ctx.resolveTrial(id, false);
      }
      ctx.despawn(id);
    }
  }
  // Echoes that fought the player and lived follow him into the next sector (design §4.2); one that never met him does not know to.
  st.carry = reason === 'exit' && followers > 0 ? { count: Math.min(followers, cfg.follow.max), won: st.wonSector > 0 } : null;
  const kept = died || st.entryEhp <= 0 ? 0 : Math.min(1, ehp(ctx) / st.entryEhp);
  const cleared = !died && reason === 'exit' && alive === 0 && kinds > 0;
  let clearPoints = 0;
  if (cleared) {
    const kill = (base / kinds) * difficultyMultiplier(ctx.dial, ctx.tunables.scoring);
    clearPoints = ctx.awardPoints(cfg.clearKills * kill * kept * perSector(cfg.depthMultiplier, st.sector));
  }
  const e = endedEv;
  e.tick = ctx.simTick;
  e.t = ctx.timeSec;
  e.sectorId = sp.sectorId;
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
  const sp = ctx.state.plan.sectors[ctx.state.sector]!;
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
  player: { allowSwap: true, infiniteReserve: true, pickPrimary: true },
  // Echoes shoot back with heavy shields on both sides (design §4.1, §4.6: `full` is the default).
  economy: 'full',
  // The ready screen is the primary pick (design §4.1): `1`..`3` choose and start the run at once, else it times out on the last pick.
  readySec: sweepDefaults.pick.readySec,
  durationSec: Infinity,
  axes: ['tellSec', 'enemyReactionSec', 'enemyHitChance', 'strafeSpeed'],
  beatSec: null,
  waveCurve: sweepDefaults.dialOffset,
  missBreaksStreak: true,

  setup(ctx) {
    ctx.state = {
      plan: sweepPlan(ctx.seed, ctx.tunables), sector: 0, role: 'take', sectorTick0: 0, exitOpen: true, exitFallbackTick: Infinity, wonSector: 0,
      carry: null, contacts: [], entryEhp: 0, entryScore: 0, nextContactId: 0, nextPlanIndex: 0, won: 0, lost: 0, done: false,
    };
    ctx.state.nextPlanIndex = ctx.state.plan.sectors.reduce((n, x) => n + x.contacts.length, 0);
    enterSector(ctx, 0);
    return ctx.state;
  },

  tick(ctx) {
    const st = ctx.state;
    if (st.done) return;
    spawnDue(ctx);
    const holdTicks = secondsToTicks(ctx.tunables.scoring.contact.disengageSec);
    for (let i = 0; i < st.contacts.length; i++) {
      const c = st.contacts[i]!;
      // A meet group is moving before its contact opens: keep each Echo's last position, so its speed is right at the opening tick.
      if (c.plan.card === 'meet') trackStop(ctx, c, c.open);
      // An Echo of the contact that has not arrived yet is not "out of sight": it is on its way.
      if (!c.open || c.alive === 0) continue;
      if (inSight(ctx, c)) c.lastSightTick = ctx.simTick;
      // Two seconds with no line of sight either way: the contact is over (design §2.3).
      else if (ctx.simTick - c.lastSightTick >= holdTicks) settleOpen(ctx, c, false);
    }
    // A hold sector's exit opens when every Echo of it is dead (design §4.2).
    if (!st.exitOpen) {
      if (!allDone(st) && ctx.simTick < st.exitFallbackTick) return;
      st.exitOpen = true;
      const sp = st.plan.sectors[st.sector]!;
      const x = exitOpenedEv;
      x.tick = ctx.simTick;
      x.t = ctx.timeSec;
      x.sectorId = sp.sectorId;
      x.index = st.sector;
      ctx.events.emit('sectorExitOpened', x);
    }
    if (!atExit(ctx)) return;
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
        // The contact is won when its last Echo is dead and none is still to come (a trade's second Echo arrives).
        if (c.alive <= 0 && c.pending === 0) settleOpen(ctx, c, false);
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
