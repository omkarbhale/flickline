import { secondsToTicks, TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import { axisValue } from '../adaptive/dial';
import { SectorDial } from '../adaptive/sectorDial';
import { SKILL_IDS } from '../config/dial';
import type { EnemyKind } from '../config/scoring';
import { sweep as sweepDefaults, type SweepCard } from '../config/sweep';
import type { Tunables } from '../config/tunables';
import { createContactSettle, settleContact, type ContactFacts } from '../feedback/contactScore';
import { difficultyMultiplier } from '../feedback/scoring';
import { MAPS } from '../sim/mapLoader';
import type { RunEvents, SectorEvents } from '../sim/runEvents';
import type { SkillId } from './contracts';
import { ContactTrials, type SightQuery, type TrialSink } from './contactTrials';
import type { ModeContext, ModeDef, ModeEvent } from './modeDef';
import { sectorCatalog } from './sweepCatalog';
import { perSector, planRun, type ContactPlan, type EchoPlan, type GatePlan, type RunPlan, type SectorPlan, type SectorSource } from './sweepDirector';
import { NO_LEAN, leanedSweep, type Lean } from './lean';
import { commitGate, planGate, type GateEnv } from './sweepGate';

/**
 * Sweep, the run (design §4; v0 is #201): a seeded chain of take sectors across the sector maps.
 * Echoes are placed on each sector's hold anchors the moment the player is put at its entry, out of
 * the player's sight (`sweepDirector.ts`); every fight is a **contact** dealt from a scenario card, tracked
 * from the first information either side has to its end and settled once (design §2.3, §8.1).
 * Health and shield carry from sector to sector (the world is never reset inside a run; kills heal,
 * the sim does that). Walking into a sector's exit ends it and puts the player in a **gate** (#205,
 * design §4.5): a small room with two doors, each showing three facts about the sector behind it and
 * a stake (`sweepGate.ts`). Walking through a door commits: its sector's map is loaded in place when
 * it differs, the player is put at its entry and the stake is applied (Shield refills the shield,
 * Arms swaps the primary, Hot adds a contact and multiplies the sector's points). The run ends at 0 HP
 * (`death`) or at the last sector's exit (`left`; no gate after it).
 *
 * Skill matching inside the run (design §9, #203): the dial is set once per sector from the skill
 * model's fight track and the depth curve (`adaptive/sectorDial.ts`); every contact's facts are
 * classified into trials for the seven skills (`contactTrials.ts`), each at the contact's placement
 * dial plus its card's offset, and every decided contact is reported with that difficulty for the
 * fight track. A new profile's first Opener is a chain of single-Echo contact sectors on a placement
 * staircase, no gate between them, whose final dial seeds sector 2 (design §9.2).
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
  /** It opened at least once. */
  engaged: boolean;
  /** Its index in the sector's trial classifier (= its index in `SweepState.contacts`). */
  trialIndex: number;
  /** Trials its facts produced so far (design §3.1; every contact that opens produces one). */
  trials: number;
  /** Item difficulty of its trials and of the contact itself: placement dial + card offset. */
  difficulty: number;
  /** Meet contacts: where each Echo was a tick ago (to read its speed) and who stopped first (`StopFirst`) since the contact opened. */
  prevX: number[];
  prevZ: number[];
  /** An Echo has run above stop speed (a standing start is not a stop). */
  moved: boolean[];
  /** The player has run above stop speed since the contact opened. */
  playerMoved: boolean;
  stopFirst: StopFirst;
}

/** The gate the player stands in. */
export interface GateRt {
  plan: GatePlan;
  /** The door walked through (-1: none yet) and the sim tick it was. */
  door: -1 | 0 | 1;
  chosenTick: number;
}

/** Who first dropped to counter-strafe speed in a meet contact (design §4.2). */
type StopFirst = 'none' | 'player' | 'echo' | 'both';

export interface SweepState {
  plan: RunPlan;
  /** The gate drawn for the sector after this one (drawn when this one is entered, under the fade), or null after the last. */
  nextGate: GatePlan | null;
  /** In a gate: its doors and the choice. Null while a sector plays. */
  gate: GateRt | null;
  /** Multiplier on every point of the current sector: depth x the Hot stake. */
  mult: number;
  sector: number;
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
  /** The run's dial, sector by sector (and the placing Opener's staircase). */
  dial: SectorDial;
  /** The current sector's trial classifier. */
  trials: ContactTrials;
  /** A placing Opener: the index of its contact sector being played (`plan.openerStages`), -1 once it is over or when the run does not place. */
  openerStage: number;
  /** Contacts fought (not avoided) in a placing Opener so far. */
  openerFought: number;
}

const settle = createContactSettle();
const facts: ContactFacts & { kinds: EnemyKind[] } = { kinds: [], dial: 50, startEhp: 0, damageTaken: 0, allDead: false, died: false };
const body = vec3();
const enteredEv: SectorEvents['sectorEntered'] = {
  tick: 0, t: 0, sectorId: '', mapId: '', index: 0, opener: false, of: 0, role: 'take', condition: 'full', stake: 'plain', arms: '', dial: 0, depth: 1, contacts: 0, echoes: 0,
};
const endedEv: SectorEvents['sectorEnded'] = {
  tick: 0, t: 0, sectorId: '', index: 0, cleared: false, keptSector: 0, tempo: false, points: 0, clearPoints: 0, reason: 'exit',
};
const gateEnteredEv: SectorEvents['gateEntered'] = { tick: 0, t: 0, index: 0 };
const gateChosenEv: SectorEvents['gateChosen'] = { tick: 0, t: 0, index: 0, door: 0, stake: 'plain', role: 'take', heard: 'quiet' };
const settledEv: RunEvents['contactSettled'] = {
  tick: 0, t: 0, contactId: 0, outcome: 'avoided', kept: 1, enemies: 0, points: 0, card: '', trials: 0, difficulty: 0,
};

/** The shipped maps' sectors, built once per tunables object (the visibility answers are memoised inside). */
let catalogCache: { tunables: Tunables; sectors: SectorSource[] } | null = null;
export function sweepCatalog(tunables: Tunables): SectorSource[] {
  if (catalogCache?.tunables !== tunables) catalogCache = { tunables, sectors: sectorCatalog(Object.values(MAPS), tunables) };
  return catalogCache.sectors;
}

/**
 * What the gate planner reads: the catalog, the tunables, how far Echoes are heard (the fights' radius) and the starting
 * primary. `dial`: the dial the sectors drawn now are played at, which sets how far from the player the Echoes stand
 * (design §9.4's distance axis, #249); without one the plan asks for the distance of the middle of the dial.
 */
export function sweepEnv(tunables: Tunables, lean: Lean = NO_LEAN, dial?: number): GateEnv {
  return {
    catalog: sweepCatalog(tunables), cfg: leanedCfg(tunables, lean, dial), body: tunables.movement, hearM: tunables.audio.enemy.maxAudibleM, startPrimary: sweep.weapon,
  };
}

/**
 * The plan a seed starts with (what `setup` plays: the opener; the gates are drawn as the run reaches them; `placing`: a new
 * profile's first run, with its placing Opener): for tests, the bot report and the debug hook.
 */
export function sweepPlan(seed: number, tunables: Tunables, lean: Lean = NO_LEAN, placing = false, dial?: number): RunPlan {
  return planRun(seed, sweepCatalog(tunables), leanedCfg(tunables, lean, dial), tunables.movement, placing);
}

/**
 * The sweep tunables with the run's lean applied to the card and role weights (design §4.4, #210) and, given a dial, the
 * distance it asks of a placement (`place.targetM`, design §9.4, #249); the same object when there is neither.
 */
function leanedCfg(tunables: Tunables, lean: Lean, dial?: number): Tunables['sweep'] {
  const spec = lean.length > 0 ? { cards: lean, boost: tunables.lean.boost, maxShareFactor: tunables.lean.maxShareFactor } : null;
  const cfg = leanedSweep(tunables.sweep, spec);
  if (dial === undefined || !Number.isFinite(dial)) return cfg;
  const p = cfg.place;
  const t = Math.min(1, Math.max(0, dial / 100));
  return { ...cfg, place: { ...p, targetM: axisValue(tunables.dial.axes.distance, dial), distanceSigma: p.distanceSigmaAt0 + (p.distanceSigmaAt100 - p.distanceSigmaAt0) * t } };
}

/** The classifier's trials, sent to the runner, and its sight query (the context is the run's). */
class RunTrials implements TrialSink, SightQuery {
  constructor(private readonly ctx: ModeContext<SweepState>) {}
  private readonly opts = { difficulty: 0, card: '', extra: undefined as Readonly<Record<string, number>> | undefined };
  trial(
    contact: number, skill: SkillId, itemDifficulty: number, success: boolean, card: string, _targetId: number, extra: Readonly<Record<string, number>>,
  ): void {
    const c = this.ctx.state.contacts[contact];
    if (c) c.trials++;
    const o = this.opts;
    o.difficulty = itemDifficulty;
    o.card = card;
    o.extra = extra;
    this.ctx.recordTrial(skill, success, o);
  }
  inSight(id: number): boolean {
    return this.ctx.targetInSight(id);
  }
}

function trialsFor(ctx: ModeContext<SweepState>): ContactTrials {
  const link = new RunTrials(ctx);
  return new ContactTrials(ctx.tunables.trials, ctx.tunables.targets.reactionAimDeg, link, link);
}

function ehp(ctx: ModeContext<SweepState>): number {
  return ctx.vitals.alive ? ctx.vitals.hp + ctx.vitals.shield : 0;
}

/** Feet position of each Echo's spawn, with the dial's numbers for its kind (design §5.2, §5.3). */
function spawnEcho(ctx: ModeContext<SweepState>, c: ContactRt, e: EchoPlan): number {
  const a = ctx.axes;
  const cfg = ctx.tunables.sweep;
  const fire = { tellSec: a.tellSec!, reactionSec: a.enemyReactionSec!, hitChance: a.enemyHitChance!, expectation: e.expectation };
  // No trial per Echo: the contact's facts are classified into trials (`contactTrials.ts`).
  const common = { fire, crouched: e.crouched, card: c.plan.card, placed: true, trial: false };
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

/**
 * Put the player at the entry of `sp` (the plan of the sector entered: the opener, or the sector
 * behind the door walked through), apply its door's stake and place its Echoes (they are out of the
 * player's sight there).
 */
function enterSector(ctx: ModeContext<SweepState>, sp: SectorPlan): void {
  const st = ctx.state;
  const cfg = ctx.tunables.sweep;
  const i = sp.index;
  st.sector = i;
  st.gate = null;
  ctx.loadMap(sp.mapId);
  ctx.placePlayer(sp.entry.x, sp.entry.y, sp.entry.z, sp.entryYaw);
  // One dial per sector (design §4.1, §9.3.2): read from the fight track here and nowhere else; a placing Opener's later
  // contact sectors take the staircase's dial, and the sector after it is seeded with the staircase's final dial.
  const laterStage = st.openerStage > 0;
  const target = laterStage ? NaN : ctx.targetDial();
  const dial = st.dial.enterSector(i, laterStage, target, perSector(cfg.dialOffset, i), st.plan.placing);
  if (i === 0 && !laterStage) ctx.setDial(dial);
  else ctx.advanceBeat(dial);
  // The stake (design §4.5): what the door promised, applied on entry.
  if (sp.stake === 'shield') ctx.refillShield(cfg.gate.shieldRefillTo);
  else if (sp.stake === 'arms' && sp.arms) ctx.setPrimary(sp.arms);
  // The sector's economy (design §4.6) before anyone is placed: the Echoes spawn with its shield and weapon.
  ctx.setEconomy(sp.condition);
  const depth = perSector(cfg.depthMultiplier, i);
  st.mult = depth * (sp.stake === 'hot' ? cfg.gate.hotMultiplier : 1);
  ctx.setPointsMultiplier(st.mult);
  st.contacts.length = 0;
  st.trials.reset();
  let echoes = 0;
  for (const cp of sp.contacts) {
    const c: ContactRt = {
      plan: cp, id: -1, open: false, echoIds: [], kinds: [], alive: 0, startEhp: 0, damage: 0, lastSightTick: 0, engaged: false,
      prevX: [], prevZ: [], moved: [], playerMoved: false, stopFirst: 'none',
      trials: 0, difficulty: ctx.itemDifficulty + ctx.tunables.trials.cardOffset[cp.card], trialIndex: -1,
    };
    c.trialIndex = st.trials.addContact(cp.card, c.difficulty, sp.role === 'take');
    for (const e of cp.echoes) {
      const id = spawnEcho(ctx, c, e);
      c.echoIds.push(id);
      c.kinds.push(e.kind);
      c.prevX.push(e.feet.x);
      c.prevZ.push(e.feet.z);
      c.moved.push(false);
      if (id >= 0) {
        c.alive++;
        echoes++;
        const strafing = e.kind === 'strafer' && !!e.laneA && !!e.laneB && (e.laneA.x !== e.laneB.x || e.laneA.z !== e.laneB.z);
        st.trials.addEcho(c.trialIndex, id, strafing);
      }
    }
    st.contacts.push(c);
  }
  st.entryEhp = ehp(ctx);
  st.entryScore = ctx.stats.score;
  // The gate after this sector is drawn now, while the screen is cut (it costs a few ms the first time a sector is placed).
  // Its Echoes stand as far as the dial of that sector asks: the matched dial now (it moves by at most a beat's step before then) plus its depth offset.
  const nextDial = ctx.pinned ? ctx.dial : st.dial.matched + perSector(cfg.dialOffset, i + 1);
  st.nextGate = i + 1 < cfg.sectors ? planGate(st.plan, sweepEnv(ctx.tunables, ctx.lean, nextDial)) : null;
  const ev = enteredEv;
  ev.tick = ctx.simTick;
  ev.t = ctx.timeSec;
  ev.sectorId = sp.sectorId;
  ev.mapId = sp.mapId;
  ev.condition = sp.condition;
  ev.role = sp.role;
  ev.index = i;
  ev.opener = sp.opener === true;
  ev.of = cfg.sectors;
  ev.stake = sp.stake;
  ev.arms = sp.arms ?? '';
  ev.dial = ctx.dial;
  ev.depth = depth;
  ev.contacts = sp.contacts.length;
  ev.echoes = echoes;
  ctx.events.emit('sectorEntered', ev);
}

/** The sector is left through its exit: the player is put in the gate before the next one. */
function enterGate(ctx: ModeContext<SweepState>): void {
  const st = ctx.state;
  const g = ctx.tunables.sweep.gate;
  const gate = st.nextGate!;
  st.nextGate = null;
  st.gate = { plan: gate, door: -1, chosenTick: 0 };
  ctx.loadMap(g.mapId);
  ctx.placePlayer(g.entry.x, g.entry.y, g.entry.z, g.entry.yaw);
  const e = gateEnteredEv;
  e.tick = ctx.simTick;
  e.t = ctx.timeSec;
  e.index = gate.index;
  ctx.events.emit('gateEntered', e);
}

/** The door the player's feet are through (past its plane by `commitDepthM`, between its jambs), or -1. */
function doorThrough(ctx: ModeContext<SweepState>): -1 | 0 | 1 {
  const g = ctx.tunables.sweep.gate;
  const p = ctx.player.pos;
  for (let d = 0; d < 2; d++) {
    const door = g.doors[d]!;
    if (Math.abs(p.x - door.x) <= g.doorHalfWidthM && p.z <= door.z - g.commitDepthM) return d as 0 | 1;
  }
  return -1;
}

/** In a gate: wait for a door; once one is walked through, close the other and, after `commitSec`, enter its sector. */
function gateTick(ctx: ModeContext<SweepState>): void {
  const gate = ctx.state.gate!;
  if (gate.door === -1) {
    const d = doorThrough(ctx);
    if (d === -1) return;
    gate.door = d;
    gate.chosenTick = ctx.simTick;
    const door = gate.plan.doors[d];
    const e = gateChosenEv;
    e.tick = ctx.simTick;
    e.t = ctx.timeSec;
    e.index = gate.plan.index;
    e.door = d;
    e.stake = door.facts.stake;
    e.role = door.facts.role;
    e.heard = door.facts.heard;
    ctx.events.emit('gateChosen', e);
    return;
  }
  if (ctx.simTick - gate.chosenTick < secondsToTicks(ctx.tunables.sweep.gate.commitSec)) return;
  enterSector(ctx, commitGate(ctx.state.plan, gate.plan, gate.door));
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
  const points = ctx.awardPoints(settle.total * st.mult);
  const lost = settle.outcome === 'died' || settle.outcome === 'disengaged';
  if (settle.outcome === 'cleared') st.won++;
  else if (lost) st.lost++;
  st.trials.settle(c.trialIndex, lost);
  // The placing Opener's staircase (design §9.2): up after two clean wins, down after a loss; a fight avoided does not count.
  if (st.openerStage >= 0 && st.dial.placing && settle.outcome !== 'avoided') {
    st.openerFought++;
    const clean = c.damage <= ctx.tunables.sweep.opener.winMaxShieldLoss * ctx.vitals.maxShield;
    st.dial.recordOpener(lost ? 'loss' : clean ? 'win' : 'neutral');
  }
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
  e.trials = c.trials;
  e.difficulty = c.difficulty;
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
  let kinds = 0;
  let base = 0;
  st.trials.flush();
  for (const c of st.contacts) {
    settleOpen(ctx, c, died);
    for (let k = 0; k < c.echoIds.length; k++) {
      const id = c.echoIds[k]!;
      if (id < 0) continue;
      kinds++;
      base += ctx.tunables.scoring.base[c.kinds[k]!];
      if (!ctx.targetPosition(id, body)) continue; // dead
      alive++;
      ctx.despawn(id);
    }
  }
  const kept = died || st.entryEhp <= 0 ? 0 : Math.min(1, ehp(ctx) / st.entryEhp);
  const cleared = !died && reason === 'exit' && alive === 0 && kinds > 0;
  let clearPoints = 0;
  if (cleared) {
    const kill = (base / kinds) * difficultyMultiplier(ctx.dial, ctx.tunables.scoring);
    clearPoints = ctx.awardPoints(cfg.clearKills * kill * kept * st.mult);
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
    // A new profile's first run places it inside its Opener (design §9.2); a pinned run never does.
    const placing = ctx.newProfile && !ctx.pinned;
    ctx.state = {
      plan: sweepPlan(ctx.seed, ctx.tunables, ctx.lean, placing, ctx.dial), nextGate: null, gate: null, mult: 1, sector: 0, contacts: [], entryEhp: 0, entryScore: 0,
      nextContactId: 0, won: 0, lost: 0, done: false, dial: new SectorDial(ctx.tunables.dial), trials: trialsFor(ctx),
      openerStage: placing ? 0 : -1, openerFought: 0,
    };
    enterSector(ctx, ctx.state.plan.sectors[0]!);
    return ctx.state;
  },

  tick(ctx) {
    const st = ctx.state;
    if (st.done) return;
    if (st.gate) {
      gateTick(ctx);
      return;
    }
    st.trials.step(ctx.simTick);
    const holdTicks = secondsToTicks(ctx.tunables.scoring.contact.disengageSec);
    for (let i = 0; i < st.contacts.length; i++) {
      const c = st.contacts[i]!;
      // A meet group is moving before its contact opens: keep each Echo's last position, so its speed is right at the opening tick.
      if (c.plan.card === 'meet') trackStop(ctx, c, c.open);
      if (!c.open) continue;
      if (inSight(ctx, c)) c.lastSightTick = ctx.simTick;
      // Two seconds with no line of sight either way: the contact is over (design §2.3).
      else if (ctx.simTick - c.lastSightTick >= holdTicks) settleOpen(ctx, c, false);
    }
    if (!atExit(ctx)) return;
    endSector(ctx, 'exit');
    if (nextOpenerStage(ctx)) return;
    if (st.sector + 1 >= ctx.tunables.sweep.sectors) {
      st.done = true;
      ctx.end('left');
      return;
    }
    enterGate(ctx);
  },

  onEvent(ctx, ev: ModeEvent) {
    const st = ctx.state;
    if (st.done) return;
    switch (ev.type) {
      case 'targetVisible': {
        const p = ev.payload;
        const c = contactOf(st, p.targetId);
        if (!c) break;
        openContact(ctx, c);
        st.trials.sighted(p.tick, p.targetId, p.preAim ?? 0, p.dYaw ?? 0, p.dPitch ?? 0);
        break;
      }
      case 'enemySawPlayer': {
        const c = contactOf(st, ev.payload.targetId);
        if (c) openContact(ctx, c);
        break;
      }
      case 'shotFired': {
        const p = ev.payload;
        st.trials.fired(p.tick, p.shotId, p.aimTargetId ?? -1, p.aimErr ?? Infinity, p.moving, p.aimDYaw ?? 0, p.aimDPitch ?? 0);
        break;
      }
      case 'aimOnTarget':
        st.trials.aimOn(ev.payload.on, ev.payload.id);
        break;
      case 'enemyFired': {
        const c = contactOf(st, ev.payload.id);
        if (c) openContact(ctx, c);
        break;
      }
      case 'shotImpact': {
        const p = ev.payload;
        const id = p.onTarget && p.targetId !== undefined ? p.targetId : -1;
        if (id >= 0) {
          const c = contactOf(st, id);
          if (c) openContact(ctx, c);
        }
        if (p.shotId !== undefined) st.trials.impact(p.shotId, id, p.zone);
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
        st.trials.killed(ev.payload.tick, ev.payload.targetId);
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
    // Stopped in a gate: the sector before it already ended on the way out.
    if (st.gate) return;
    endSector(ctx, reason === 'death' ? 'death' : 'quit');
  },
};

/**
 * A placing Opener's exit (design §9.2): until the staircase is done, the next of its contact sectors is
 * swapped into the route's first place and entered directly, no gate. Returns false once the Opener is
 * over (the run goes on through the gate before sector 2) or when the run does not place.
 */
function nextOpenerStage(ctx: ModeContext<SweepState>): boolean {
  const st = ctx.state;
  if (st.openerStage < 0) return false;
  const op = ctx.tunables.sweep.opener;
  const next = st.openerStage + 1;
  if (next >= st.plan.openerStages.length || st.dial.openerDone(st.openerFought, op.contactsMin, op.contactsMax)) {
    st.openerStage = -1;
    return false;
  }
  st.openerStage = next;
  st.plan.sectors[0] = st.plan.openerStages[next]!;
  enterSector(ctx, st.plan.sectors[0]);
  return true;
}

/** Cards in the plan of a seed, in order: for tests and the bot report. */
export function planCards(plan: RunPlan): SweepCard[] {
  const out: SweepCard[] = [];
  for (const s of plan.sectors) for (const c of s.contacts) out.push(c.card);
  return out;
}
