import { DEG2RAD, RAD2DEG } from '../core/math';
import { TICK_DT, TICK_RATE } from '../core/time';
import { fightLedger as defaultTunables, fightLedgerCapacity, type FightLedgerTunables } from '../config/fightLedger';
import { targets as defaultTargets, type TargetTunables } from '../config/targets';
import { weapon as defaultWeapons, type WeaponId } from '../config/weapon';
import type { Expectation } from '../sim/enemyTiming';
import type { RunEvents } from '../sim/runEvents';
import type { HitZone, SimEvents } from '../sim/types';
import type { LoggedEvent, RunLog } from './eventLog';

/**
 * The fight ledger (#120): the event log of a run turned into **fight records** (`docs/research/
 * fight-attribution.md` §3.1 units, §3.2 facts F1–F12). A pure function of the log, like every other
 * stat (design §14.3): no verdicts, causes or par (the attribution engine, #121, reads these records),
 * no UI.
 *
 * Three levels, all plain data:
 *  - **Contact** — what a Sweep contact is (one to four enemies). Opens at the first information either
 *    side has about the other; closes when every enemy in it is dead (`cleared`), when nobody has seen the
 *    other for `contactGapSec` (`lost`; a re-peek inside that gap is the same contact), at the player's
 *    death or at the end of the run. Carries the scenario card (#97) when a `contactSettled` named one.
 *  - **Duel** — the player against one enemy inside a contact, from the first moment either could see the
 *    other until one dies or the line of sight is broken for more than `duelBreakSec`. An enemy seen again
 *    after a longer break is a new duel (its `samePeek` fact says whether it was from the same spot).
 *    A duel carries the facts F1–F12.
 *  - **Damage instance** — one `playerDamaged`, assigned to the duel of its source, so the HP lost can be
 *    split by cause even in a multi-enemy contact.
 *
 * Records are **struct-of-preallocated-objects**: `buildFights` fills the same `FightLedger` every time,
 * so a steady-state build allocates nothing (and a run that exceeds a capacity sets `overflow` instead of
 * allocating). **The ledger `buildFights` returns is reused by the next build: copy what you keep.** A
 * contact's duels and damage instances are contiguous: `duels[c.firstDuel .. c.firstDuel + c.duelCount)`.
 *
 * What the log can and cannot say today (the contract this codes against; each gap is a value that is
 * `NaN` / `'unknown'` / `null`, never a guess):
 *  - Enemy ids are one id space: a `targetId`, a mind's `id` (`perceiver*`, `enemy*` events) and a
 *    `playerDamaged.sourceId` all name the same enemy.
 *  - "Seen" is read from discrete instants (a first sight, a shot aimed at it, an aim-on edge, its tell, its
 *    shot, its perceiver seeing or losing the player); the line of sight itself is not logged. An enemy's own
 *    shot, tell or hit on the player holds its duel open for `enemyFireHoldSec`, so a shooter is one duel, not one per shot.
 *  - The enemy's reaction draw and its percentile (F10 `enemyReacted`, #94) and its aim error at first sight
 *    (F6 held and pre-aimed) are not logged yet, nor is the mind's "teammate died" channel (F12 trade): the
 *    trade fact is therefore "hit within the window while still at the kill spot", for any enemy.
 */

/** How the player first learned of an enemy: seeing it, hearing one of its sounds, or being hit by it. */
export type InfoChannel = 'none' | 'sight' | 'footstep' | 'landing' | 'reload' | 'shot' | 'damage';
/** How the enemy first learned of the player (the mind's channel, #89). */
export type EnemyChannel = 'none' | 'sight' | 'sound' | 'shared' | 'fired';
/** Whose movement created the first line of sight (F6). */
export type Initiator = 'none' | 'player' | 'enemy';
/** Who saw whom first (F1). */
export type FirstSaw = 'none' | 'player' | 'enemy' | 'same';
/** F8: what a shot at the enemy was. */
export type ShotClass = 'none' | 'hit' | 'aimMiss' | 'spreadMiss';
export type DuelEnd = 'open' | 'killed' | 'broken' | 'lost' | 'expired' | 'died' | 'runEnded';
export type ContactEnd = 'open' | 'cleared' | 'lost' | 'died' | 'runEnded';

/** One duel: the player against one enemy, with the facts F1–F12 (see the module comment for what each field is). */
export class Duel {
  index = -1;
  contact = -1;
  /** The enemy's id (-1: damage with no source). */
  enemyId = -1;
  /** The same enemy's previous duel (any contact), or -1. */
  prevDuel = -1;
  startTick = -1;
  /** First sight either way, and the latest sight instant (-1: none). */
  sightTick = -1;
  lastSightTick = -1;
  endTick = -1;
  end: DuelEnd = 'open';
  /** The enemy's perceiver sees the player now / the aim ray is on it now (open intervals that keep the duel alive). */
  enemySees = false;
  aimOn = false;
  /** Until this tick an enemy that just shot at the player is assumed to still see him (no break). */
  holdUntil = -1;

  // --- F1: who perceived whom first, and by what channel ---
  /** First information the player had about it (-1 none) and how. */
  playerInfoTick = -1;
  playerChannel: InfoChannel = 'none';
  /** `targetVisible`: it entered the player's view unoccluded (-1: never in this duel). `playerSawExact` is false on a re-peek duel, where it is the first sight instant. */
  playerSawTick = -1;
  playerSawExact = false;
  /** The enemy first got the player in sight (-1 never), the first thing it learned of him and how. */
  enemySawTick = -1;
  enemyInfoTick = -1;
  enemyChannel: EnemyChannel = 'none';
  /** What the enemy expected when it first saw the player (#89), or `'unknown'` while no mind reports it. */
  enemyContact: Expectation | 'unknown' = 'unknown';
  enemyInAttention: boolean | null = null;
  firstSaw: FirstSaw = 'none';
  /** `enemySaw − playerSaw`, seconds: positive when the player saw first. +Infinity: only the player saw, -Infinity: only the enemy, NaN: neither. */
  sightLeadSec = NaN;

  // --- F2: information lead and time to shot ---
  /** `playerSaw − playerInfo`: how long the player knew before seeing, seconds (NaN: no earlier information or no sight). */
  infoLeadSec = NaN;
  /** `firstShot − playerSaw`, seconds (design §3 RT, renamed time-to-shot). NaN: no sight or no shot at it. */
  timeToShotSec = NaN;
  firstShotTick = -1;

  // --- F3: pre-aim error at first sight (`targetVisible`), degrees, NaN where there was none ---
  preAimDeg = NaN;
  preAimYawDeg = NaN;
  preAimPitchDeg = NaN;

  // --- F4: moving when firing ---
  /** Shots at this enemy (aimed within `shotAtDeg` of it, or that hit it) and how many were above the accuracy deadzone or airborne. */
  shots = 0;
  movingShots = 0;
  firstShotMoving = false;

  // --- F5: exposure to several enemies ---
  /** The largest `exposedTo` over this duel's damage instances (0 when it never hurt the player). */
  maxExposed = 0;
  /** HP the player lost to this enemy while aiming at another one (off-target damage) and in how many hits. */
  offTargetDamage = 0;
  offTargetHits = 0;

  // --- F6: angle advantage ---
  initiator: Initiator = 'none';

  // --- F7: distance against weapon role ---
  weapon: WeaponId | '' = '';
  /** Distance to the enemy at the first shot, metres (the impact's when the first shot hit, else the nearest known; NaN unknown). */
  distanceM = NaN;
  distanceFromShot = false;
  /** Probability a perfectly aimed, stationary first shot of `weapon` hits a head at `distanceM` (NaN unknown) and whether it is below `outOfRoleHeadProb`. */
  headHitProb = NaN;
  outOfRole = false;

  // --- F8: shots against the ideal ---
  firstShotId = -1;
  hitShots = 0;
  aimMissShots = 0;
  spreadMissShots = 0;
  firstShotClass: ShotClass = 'none';
  /** Angle from the first shot's aim ray (before spread) to the enemy's head centre, degrees (NaN: no shot at it). */
  firstShotAimErrDeg = NaN;

  // --- F9: time available before damage ---
  firstDamageTick = -1;
  /** True when the player saw it (`targetVisible`) at all. */
  playerSaw = false;
  /** `firstDamage − playerSaw`, seconds; negative when it hurt him before he saw it; -Infinity when he never saw it; NaN: it never hurt him. */
  windowSec = NaN;
  /** The enemy's tell (the real aiming phase, mind F5): when it started, how long, and `firstDamage − tellStart` seconds. */
  tellTick = -1;
  tellMs = NaN;
  windowFromTellSec = NaN;

  // --- F10: the enemy's side (#94 adds the reaction draw) ---
  enemyShots = 0;
  enemyHits = 0;
  enemyFirstShotTick = -1;

  // --- F11: the player's state ---
  /** HP when the duel began (NaN: no damage or heal had been logged yet), and reloading at the enemy's first sight / at its first damage. */
  hpAtStart = NaN;
  reloadingAtEnemySaw = false;
  reloadingAtDamage = false;
  /** Shots at it fired while tagged (slowed), and the player's running footsteps in the `footstepWindowSec` before the enemy first perceived him. */
  taggedShots = 0;
  footstepsBefore = 0;

  // --- F12: repetition and trades ---
  /** Same peek: re-exposed to the same enemy from within `samePeekRadiusM` of the previous spot within `samePeekWindowSec` of breaking sight. */
  samePeek = false;
  /** Stayed after the kill: this enemy hurt the player within `tradeWindowSec` of a kill while he was still at the kill spot. */
  trade = false;
  /** Where the player stood at the duel's first shot (else its first damage); NaN unknown. */
  posX = NaN;
  posZ = NaN;

  // --- Outcome ---
  /** HP and shield this enemy took off the player in this duel, and how many damage instances. */
  hpLost = 0;
  shieldAbsorbed = 0;
  damageCount = 0;
  killedByPlayer = false;
  killTick = -1;

  /** The damage instances of this duel are `damages[i]` with `duel === index`; this is the first one (-1 none). */
  firstDamage = -1;

  reset(): void {
    this.index = -1; this.contact = -1; this.enemyId = -1; this.prevDuel = -1;
    this.startTick = -1; this.sightTick = -1; this.lastSightTick = -1; this.endTick = -1; this.end = 'open';
    this.enemySees = false; this.aimOn = false; this.holdUntil = -1;
    this.playerInfoTick = -1; this.playerChannel = 'none'; this.playerSawTick = -1; this.playerSawExact = false;
    this.enemySawTick = -1; this.enemyInfoTick = -1; this.enemyChannel = 'none'; this.enemyContact = 'unknown';
    this.enemyInAttention = null; this.firstSaw = 'none'; this.sightLeadSec = NaN;
    this.infoLeadSec = NaN; this.timeToShotSec = NaN; this.firstShotTick = -1;
    this.preAimDeg = NaN; this.preAimYawDeg = NaN; this.preAimPitchDeg = NaN;
    this.shots = 0; this.movingShots = 0; this.firstShotMoving = false;
    this.maxExposed = 0; this.offTargetDamage = 0; this.offTargetHits = 0;
    this.initiator = 'none';
    this.weapon = ''; this.distanceM = NaN; this.distanceFromShot = false; this.headHitProb = NaN; this.outOfRole = false;
    this.firstShotId = -1; this.hitShots = 0; this.aimMissShots = 0; this.spreadMissShots = 0;
    this.firstShotClass = 'none'; this.firstShotAimErrDeg = NaN;
    this.firstDamageTick = -1; this.playerSaw = false; this.windowSec = NaN;
    this.tellTick = -1; this.tellMs = NaN; this.windowFromTellSec = NaN;
    this.enemyShots = 0; this.enemyHits = 0; this.enemyFirstShotTick = -1;
    this.hpAtStart = NaN; this.reloadingAtEnemySaw = false; this.reloadingAtDamage = false; this.taggedShots = 0; this.footstepsBefore = 0;
    this.samePeek = false; this.trade = false; this.posX = NaN; this.posZ = NaN;
    this.hpLost = 0; this.shieldAbsorbed = 0; this.damageCount = 0; this.killedByPlayer = false; this.killTick = -1;
    this.firstDamage = -1;
  }
}

/** One `playerDamaged`, assigned to the duel of its source. */
export class DamageInstance {
  index = -1;
  tick = -1;
  contact = -1;
  /** Index of the source's duel in `FightLedger.duels`. */
  duel = -1;
  sourceId = -1;
  /** HP lost (after the shield took its share), the shield's part, HP left, the zone struck and whether it killed. */
  amount = 0;
  absorbed = 0;
  hp = 0;
  zone: HitZone = 'body';
  killed = false;
  /** F5: enemies that saw the player at the hit, the enemy his aim was on (-1: none), and whether the hit came from another one. */
  exposedTo = 0;
  aimedId = -1;
  offTarget = false;
  /** F12: within the trade window of a kill, at the kill spot. */
  trade = false;
  /** Player's position (feet) and the shooter's distance, metres. */
  x = 0;
  z = 0;
  distance = 0;
  /** The player was reloading. */
  reloading = false;

  reset(): void {
    this.index = -1; this.tick = -1; this.contact = -1; this.duel = -1; this.sourceId = -1;
    this.amount = 0; this.absorbed = 0; this.hp = 0; this.zone = 'body'; this.killed = false;
    this.exposedTo = 0; this.aimedId = -1; this.offTarget = false; this.trade = false;
    this.x = 0; this.z = 0; this.distance = 0; this.reloading = false;
  }
}

/** One contact: a run of duels with the scenario card (when a settle named one). */
export class Contact {
  index = -1;
  startTick = -1;
  endTick = -1;
  end: ContactEnd = 'open';
  /** Duels and damage instances: contiguous ranges in the ledger's arrays. */
  firstDuel = 0;
  duelCount = 0;
  firstDamage = 0;
  damageCount = 0;
  /** Distinct enemies in it, how many the player killed, the HP it cost, and the most enemies that saw the player at a hit. */
  enemies = 0;
  kills = 0;
  hpLost = 0;
  maxExposed = 0;
  /** The sweep sector index it happened in (-1: no sector). */
  sector = -1;
  /** The scenario card of the `contactSettled` that settled it (#97): `''` when absent. `contactId` -1 and `settledOutcome` '' when none settled it. */
  card = '';
  contactId = -1;
  settledOutcome: RunEvents['contactSettled']['outcome'] | '' = '';
  /** Latest sight instant of any member (the 2 s no-contact clock starts from it). */
  lastSightTick = -1;
  /** Enemies of the contact not yet dead. */
  alive = 0;

  reset(): void {
    this.index = -1; this.startTick = -1; this.endTick = -1; this.end = 'open';
    this.firstDuel = 0; this.duelCount = 0; this.firstDamage = 0; this.damageCount = 0;
    this.enemies = 0; this.kills = 0; this.hpLost = 0; this.maxExposed = 0; this.sector = -1;
    this.card = ''; this.contactId = -1; this.settledOutcome = ''; this.lastSightTick = -1; this.alive = 0;
  }
}

/** Everything the ledger reads besides the log: its own tunables, the head size and each weapon's first-shot cone. */
export interface FightLedgerConfig {
  fightLedger: FightLedgerTunables;
  targets: Pick<TargetTunables, 'hit'>;
  weapon: Readonly<Record<WeaponId, { spreadFirstDeg: number }>>;
}

export const defaultFightLedgerConfig: FightLedgerConfig = { fightLedger: defaultTunables, targets: defaultTargets, weapon: defaultWeapons };

const FOOTSTEP_RING = 64;
const EMPTY = -2;

/** Seconds to whole ticks (rounded), for comparing against the log's tick stamps. */
function ticks(sec: number): number {
  return Math.round(sec * TICK_RATE);
}

type Ev<K extends keyof (SimEvents & RunEvents)> = (SimEvents & RunEvents)[K];

/**
 * The reused result of `buildFights`, and the single pass that fills it. Every field is plain data;
 * `buildFights` is the entry point.
 */
export class FightLedger {
  readonly contacts: Contact[] = [];
  readonly duels: Duel[] = [];
  readonly damages: DamageInstance[] = [];
  contactCount = 0;
  duelCount = 0;
  damageCount = 0;
  /** A capacity was exceeded: later contacts, duels or damage instances were dropped (never allocated). */
  overflow = false;
  /** The log hit its own capacity and dropped later events: the ledger is of the part it kept. */
  truncated = false;
  mode = '';
  seed = 0;
  dial = 0;

  // --- builder state (reset by `build`) ---
  private cfg: FightLedgerConfig = defaultFightLedgerConfig;
  private cur = -1;
  private lastClosed = -1;
  private curSector = -1;
  private readonly junkDuel = new Duel();
  private readonly junkContact = new Contact();
  private readonly idKeys = new Int32Array(fightLedgerCapacity.enemies).fill(EMPTY);
  private readonly idLast = new Int32Array(fightLedgerCapacity.enemies).fill(-1);
  private readonly idMask = fightLedgerCapacity.enemies - 1;
  private readonly steps = new Int32Array(FOOTSTEP_RING);
  private stepHead = 0;
  private stepCount = 0;
  // the player
  private weaponId: WeaponId | '' = '';
  private hp = NaN;
  private reloadingUntil = -1;
  private taggedUntil = -1;
  private aimOnId = -1;
  private aimShotId = -1;
  private aimShotTick = -1;
  // the shot in flight
  private lastShotId = -1;
  private lastShotDuel = -1;
  private lastShotClass: ShotClass = 'none';
  private lastShotMoving = false;
  private lastShotX = NaN;
  private lastShotZ = NaN;
  // the last kill (trade rule)
  private lastKillTick = -1;
  private lastKillId = -1;
  private lastKillX = NaN;
  private lastKillZ = NaN;
  // tunables in ticks
  private gapTicks = 0;
  private breakTicks = 0;
  private peekTicks = 0;
  private tradeTicks = 0;
  private stepTicks = 0;
  private aimMemoryTicks = 0;
  private cardLagTicks = 0;
  private shotAtRad = 0;
  private fireHoldTicks = 0;

  constructor() {
    const cap = fightLedgerCapacity;
    for (let i = 0; i < cap.contacts; i++) this.contacts.push(new Contact());
    for (let i = 0; i < cap.duels; i++) this.duels.push(new Duel());
    for (let i = 0; i < cap.damages; i++) this.damages.push(new DamageInstance());
  }

  /** Rebuild this ledger from `log`. Allocates nothing in steady state. */
  build(log: RunLog, cfg: FightLedgerConfig = defaultFightLedgerConfig): this {
    this.begin(log, cfg);
    const evs = log.events;
    let lastTick = 0;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i]!;
      lastTick = (ev.data as { tick: number }).tick;
      this.expire(lastTick);
      this.apply(ev, lastTick);
    }
    if (this.cur >= 0) this.closeContact(this.contacts[this.cur]!, Math.max(lastTick, this.contacts[this.cur]!.lastSightTick), 'runEnded');
    return this;
  }

  private begin(log: RunLog, cfg: FightLedgerConfig): void {
    this.cfg = cfg;
    const t = cfg.fightLedger;
    this.gapTicks = ticks(t.contactGapSec);
    this.breakTicks = ticks(t.duelBreakSec);
    this.peekTicks = ticks(t.samePeekWindowSec);
    this.tradeTicks = ticks(t.tradeWindowSec);
    this.stepTicks = ticks(t.footstepWindowSec);
    this.aimMemoryTicks = ticks(t.aimMemorySec);
    this.cardLagTicks = ticks(t.cardLagSec);
    this.shotAtRad = t.shotAtDeg * DEG2RAD;
    this.fireHoldTicks = ticks(t.enemyFireHoldSec);
    this.contactCount = this.duelCount = this.damageCount = 0;
    this.overflow = false;
    this.truncated = log.truncated;
    this.mode = log.mode; this.seed = log.seed; this.dial = log.dial;
    this.cur = -1; this.lastClosed = -1; this.curSector = -1;
    this.idKeys.fill(EMPTY);
    this.stepHead = 0; this.stepCount = 0;
    this.weaponId = ''; this.hp = NaN; this.reloadingUntil = -1; this.taggedUntil = -1;
    this.aimOnId = -1; this.aimShotId = -1; this.aimShotTick = -1;
    this.lastShotId = -1; this.lastShotDuel = -1; this.lastShotClass = 'none'; this.lastShotMoving = false;
    this.lastShotX = this.lastShotZ = NaN;
    this.lastKillTick = -1; this.lastKillId = -1; this.lastKillX = this.lastKillZ = NaN;
  }

  // --- the dispatcher ----------------------------------------------------------------------

  private apply(ev: LoggedEvent, tick: number): void {
    switch (ev.type) {
      case 'sectorEntered': this.curSector = ev.data.index; break;
      case 'runEnded': if (this.cur >= 0) this.closeContact(this.contacts[this.cur]!, tick, 'runEnded'); break;
      case 'playerDied': if (this.cur >= 0) this.closeContact(this.contacts[this.cur]!, tick, 'died'); break;
      case 'footstep': if (!ev.data.walking) this.pushStep(tick); break;
      case 'reloadStarted': this.reloadingUntil = tick + ticks(ev.data.durationSec); break;
      case 'reloadCompleted': case 'reloadCancelled': this.reloadingUntil = -1; break;
      case 'weaponSwitched': this.weaponId = ev.data.weapon; this.reloadingUntil = -1; break;
      case 'playerSlowed': this.taggedUntil = tick + ticks(ev.data.durationMs / 1000); break;
      case 'playerHealed': this.hp = ev.data.hp; break;
      case 'targetVisible': this.onTargetVisible(ev.data, tick); break;
      case 'enemySawPlayer': this.onEnemySaw(ev.data.targetId, tick, ev.data.initiator, 'unknown', null); break;
      case 'perceiverSaw': this.onPerceiverSaw(ev.data, tick); break;
      case 'perceiverLostSight': this.onPerceiverLost(ev.data.id, tick); break;
      case 'perceiverHeard': this.onEnemyInfo(ev.data.id, tick, 'sound', ev.data.distance); break;
      case 'perceiverGotShared': this.onEnemyInfo(ev.data.id, tick, 'shared', NaN); break;
      case 'enemyFootstep': this.onEnemySound(ev.data, tick, 'footstep'); break;
      case 'enemyLanded': this.onEnemySound(ev.data, tick, 'landing'); break;
      case 'enemyReloadStarted': this.onEnemySound(ev.data, tick, 'reload'); break;
      case 'enemyTell': this.onTell(ev.data, tick); break;
      case 'enemyFired': this.onEnemyFired(ev.data, tick); break;
      case 'aimOnTarget': this.onAimOn(ev.data, tick); break;
      case 'shotFired': this.onShotFired(ev.data, tick); break;
      case 'shotImpact': this.onShotImpact(ev.data, tick); break;
      case 'targetKilled': this.onKilled(ev.data, tick); break;
      case 'targetExpired': this.onExpired(ev.data.targetId, tick); break;
      case 'playerDamaged': this.onDamaged(ev.data, tick); break;
      case 'contactSettled': this.onSettled(ev.data, tick); break;
      default: break;
    }
  }

  // --- contacts ----------------------------------------------------------------------------

  /** A contact ends once nobody has seen the other for `contactGapSec` (§3.1). */
  private expire(tick: number): void {
    if (this.cur < 0) return;
    const c = this.contacts[this.cur]!;
    if (tick - c.lastSightTick > this.gapTicks && !this.held(c)) this.closeContact(c, c.lastSightTick, 'lost');
  }

  /** A member's sight is open: its mind sees the player, or the player's aim ray is on it. */
  private held(c: Contact): boolean {
    for (let i = c.firstDuel; i < c.firstDuel + c.duelCount; i++) {
      const d = this.duels[i]!;
      if (d.end === 'open' && (d.enemySees || d.aimOn)) return true;
    }
    return false;
  }

  private ensureContact(tick: number): Contact {
    if (this.cur >= 0) return this.contacts[this.cur]!;
    if (this.contactCount >= this.contacts.length) {
      this.overflow = true;
      this.junkContact.reset();
      this.junkContact.lastSightTick = tick;
      return this.junkContact;
    }
    const c = this.contacts[this.contactCount]!;
    c.reset();
    c.index = this.contactCount++;
    c.startTick = tick;
    c.lastSightTick = tick;
    c.firstDuel = this.duelCount;
    c.firstDamage = this.damageCount;
    c.sector = this.curSector;
    this.cur = c.index;
    return c;
  }

  private closeContact(c: Contact, tick: number, why: ContactEnd): void {
    for (let i = c.firstDuel; i < c.firstDuel + c.duelCount; i++) {
      const d = this.duels[i]!;
      if (d.end !== 'open') continue;
      const reason: DuelEnd = why === 'died' ? 'died' : why === 'runEnded' ? 'runEnded' : 'lost';
      this.endDuel(d, why === 'lost' && d.lastSightTick >= 0 ? Math.min(d.lastSightTick, tick) : tick, reason);
    }
    c.end = why;
    c.endTick = tick;
    if (c.index >= 0 && this.cur === c.index) {
      this.cur = -1;
      this.lastClosed = c.index;
    }
  }

  // --- duels -------------------------------------------------------------------------------

  private slot(id: number): number {
    let h = (Math.imul(id, 0x9e3779b1) >>> 0) & this.idMask;
    for (let n = 0; n <= this.idMask; n++) {
      const k = this.idKeys[h]!;
      if (k === id || k === EMPTY) return h;
      h = (h + 1) & this.idMask;
    }
    return -1;
  }

  /** The enemy's open duel in the open contact, or null. */
  private activeDuel(id: number): Duel | null {
    if (this.cur < 0) return null;
    const s = this.slot(id);
    if (s < 0 || this.idKeys[s] !== id) return null;
    const di = this.idLast[s]!;
    if (di < 0) return null;
    const d = this.duels[di]!;
    return d.contact === this.cur && d.end === 'open' ? d : null;
  }

  /** The enemy's open duel, opening a contact and a duel for it when it has none. */
  private duelFor(id: number, tick: number): Duel {
    const a = this.activeDuel(id);
    if (a !== null) return a;
    const c = this.ensureContact(tick);
    return this.newDuel(c, id, tick);
  }

  private newDuel(c: Contact, id: number, tick: number): Duel {
    if (this.duelCount >= this.duels.length) {
      this.overflow = true;
      this.junkDuel.reset();
      return this.junkDuel;
    }
    const s = this.slot(id);
    const d = this.duels[this.duelCount]!;
    d.reset();
    d.index = this.duelCount++;
    d.contact = c.index;
    d.enemyId = id;
    d.startTick = tick;
    d.hpAtStart = this.hp;
    c.duelCount++;
    let prev = -1;
    if (s >= 0) {
      // `idLast` is only meaningful for a key this build has stored.
      if (this.idKeys[s] === id) prev = this.idLast[s]!;
      else this.idKeys[s] = id;
      this.idLast[s] = d.index;
    }
    d.prevDuel = prev;
    // A new enemy joins the contact; a re-peek duel of one already in it does not.
    if (prev < 0 || this.duels[prev]!.contact !== c.index) {
      c.enemies++;
      c.alive++;
    }
    return d;
  }

  private endDuel(d: Duel, tick: number, why: DuelEnd): void {
    if (d.end !== 'open') return;
    d.end = why;
    d.endTick = tick;
    this.finish(d);
  }

  /** The facts that are differences of instants, computed once the duel is over. */
  private finish(d: Duel): void {
    const ps = d.playerSawTick, es = d.enemySawTick;
    d.firstSaw = ps < 0 && es < 0 ? 'none' : es < 0 ? 'player' : ps < 0 ? 'enemy' : ps < es ? 'player' : es < ps ? 'enemy' : 'same';
    d.sightLeadSec = ps >= 0 && es >= 0 ? (es - ps) * TICK_DT : ps >= 0 ? Infinity : es >= 0 ? -Infinity : NaN;
    d.playerSaw = ps >= 0;
    d.infoLeadSec = ps >= 0 && d.playerInfoTick >= 0 ? (ps - d.playerInfoTick) * TICK_DT : NaN;
    d.timeToShotSec = ps >= 0 && d.firstShotTick >= 0 ? (d.firstShotTick - ps) * TICK_DT : NaN;
    if (d.firstDamageTick >= 0) {
      d.windowSec = ps >= 0 ? (d.firstDamageTick - ps) * TICK_DT : -Infinity;
      d.windowFromTellSec = d.tellTick >= 0 ? (d.firstDamageTick - d.tellTick) * TICK_DT : NaN;
    }
    if (d.weapon !== '' && d.distanceM > 0) {
      const head = Math.atan(this.cfg.targets.hit.headRadius / d.distanceM);
      const cone = this.cfg.weapon[d.weapon].spreadFirstDeg * DEG2RAD;
      d.headHitProb = cone <= head ? 1 : (head / cone) * (head / cone);
      d.outOfRole = d.headHitProb < this.cfg.fightLedger.outOfRoleHeadProb;
    }
  }

  /** An instant at which the enemy and the player are in sight of each other (or one saw the other): keeps the duel and contact alive. */
  private sightInstant(id: number, tick: number, enemyShot = false): Duel {
    let d = this.duelFor(id, tick);
    if (d.sightTick >= 0 && !d.enemySees && !d.aimOn && tick - d.lastSightTick > this.breakTicks && tick > d.holdUntil) {
      // Broken for longer than `duelBreakSec`: that duel is over, this is a new one (a re-peek).
      this.endDuel(d, d.lastSightTick, 'broken');
      const c = this.contacts[d.contact]!;
      const prevSaw = d.playerSawTick >= 0;
      d = this.newDuel(c, id, tick);
      if (prevSaw) { d.playerSawTick = tick; d.playerSawExact = false; }
    }
    if (d.sightTick < 0) d.sightTick = tick;
    d.lastSightTick = tick;
    if (enemyShot) d.holdUntil = tick + this.fireHoldTicks;
    const c = d.contact >= 0 ? this.contacts[d.contact]! : this.junkContact;
    if (tick > c.lastSightTick) c.lastSightTick = tick;
    return d;
  }

  /** Remember where the player stood; the first known spot decides the same-peek fact (F12). */
  private setPos(d: Duel, x: number, z: number): void {
    if (d.posX === d.posX) return; // already known (NaN !== NaN)
    d.posX = x; d.posZ = z;
    if (d.prevDuel < 0) return;
    const p = this.duels[d.prevDuel]!;
    if (p.end === 'killed' || p.endTick < 0 || p.posX !== p.posX) return;
    if (d.startTick - p.endTick > this.peekTicks) return;
    const r = this.cfg.fightLedger.samePeekRadiusM;
    const dx = x - p.posX, dz = z - p.posZ;
    if (dx * dx + dz * dz <= r * r) d.samePeek = true;
  }

  private setDistance(d: Duel, m: number): void {
    if (d.shots === 0 && !d.distanceFromShot && m === m) d.distanceM = m;
  }

  private pushStep(tick: number): void {
    this.steps[this.stepHead] = tick;
    this.stepHead = (this.stepHead + 1) % FOOTSTEP_RING;
    if (this.stepCount < FOOTSTEP_RING) this.stepCount++;
  }

  private stepsSince(from: number, to: number): number {
    let n = 0;
    for (let i = 0; i < this.stepCount; i++) {
      const t = this.steps[i]!;
      if (t >= from && t <= to) n++;
    }
    return n;
  }

  // --- player-side events ------------------------------------------------------------------

  private onTargetVisible(e: Ev<'targetVisible'>, tick: number): void {
    const d = this.sightInstant(e.targetId, tick);
    if (d.playerSawTick < 0) {
      d.playerSawTick = tick;
      d.playerSawExact = true;
      d.preAimDeg = e.preAim * RAD2DEG;
      d.preAimYawDeg = e.dYaw * RAD2DEG;
      d.preAimPitchDeg = e.dPitch * RAD2DEG;
    }
    if (d.playerInfoTick < 0) { d.playerInfoTick = tick; d.playerChannel = 'sight'; }
    if (d.initiator === 'none') d.initiator = e.initiator;
  }

  private onEnemySound(e: Ev<'enemyFootstep'>, tick: number, channel: 'footstep' | 'landing' | 'reload'): void {
    if (!e.audibleToPlayer) return;
    const d = this.duelFor(e.id, tick);
    if (d.playerInfoTick < 0) { d.playerInfoTick = tick; d.playerChannel = channel; }
    this.setDistance(d, e.distance);
  }

  private onAimOn(e: Ev<'aimOnTarget'>, tick: number): void {
    if (e.on) {
      const d = this.sightInstant(e.id, tick);
      d.aimOn = true;
      this.aimOnId = e.id;
    } else {
      const d = this.activeDuel(e.id);
      if (d !== null) { d.aimOn = false; d.lastSightTick = tick; this.touchContact(d, tick); }
      if (this.aimOnId === e.id) this.aimOnId = -1;
    }
  }

  private touchContact(d: Duel, tick: number): void {
    const c = this.contacts[d.contact];
    if (c !== undefined && tick > c.lastSightTick) c.lastSightTick = tick;
  }

  private onShotFired(e: Ev<'shotFired'>, tick: number): void {
    this.weaponId = e.weapon;
    this.lastShotId = e.shotId;
    this.lastShotDuel = -1;
    this.lastShotClass = 'none';
    this.lastShotMoving = e.moving;
    this.lastShotX = e.origin.x; this.lastShotZ = e.origin.z;
    if (e.aimTargetId >= 0 && e.aimErr <= this.cfg.fightLedger.offTargetDeg * DEG2RAD) {
      this.aimShotId = e.aimTargetId;
      this.aimShotTick = tick;
    }
    if (e.aimTargetId < 0 || e.aimErr > this.shotAtRad) return;
    const d = this.sightInstant(e.aimTargetId, tick);
    this.countShot(d, tick, e.shotId, e.moving);
    // F8: the aim ray before the spread draw against the enemy's head centre.
    const hy = e.yaw + e.aimDYaw, hp = e.pitch + e.aimDPitch, cp = Math.cos(hp);
    const dot = -Math.sin(hy) * cp * e.aimDir.x + Math.sin(hp) * e.aimDir.y - Math.cos(hy) * cp * e.aimDir.z;
    const err = Math.acos(dot > 1 ? 1 : dot < -1 ? -1 : dot) * RAD2DEG;
    const cls: ShotClass = err <= this.cfg.fightLedger.onTargetDeg ? 'spreadMiss' : 'aimMiss';
    if (cls === 'spreadMiss') d.spreadMissShots++; else d.aimMissShots++;
    if (d.firstShotId === e.shotId) { d.firstShotClass = cls; d.firstShotAimErrDeg = err; }
    this.lastShotDuel = d.index;
    this.lastShotClass = cls;
    this.setPos(d, e.origin.x, e.origin.z);
  }

  /** A shot at this enemy: counts it, and records the first one's facts (F2, F4, F7, F11). */
  private countShot(d: Duel, tick: number, shotId: number, moving: boolean): void {
    d.shots++;
    if (moving) d.movingShots++;
    if (this.taggedUntil > tick) d.taggedShots++;
    if (d.shots === 1) {
      d.firstShotTick = tick;
      d.firstShotId = shotId;
      d.firstShotMoving = moving;
      if (this.weaponId !== '') d.weapon = this.weaponId;
    }
  }

  private onShotImpact(e: Ev<'shotImpact'>, tick: number): void {
    if (e.shotId !== this.lastShotId || e.result !== 'hit' || e.targetId < 0) return;
    const d = this.sightInstant(e.targetId, tick);
    if (d.index === this.lastShotDuel) {
      // The provisional miss was a hit.
      if (this.lastShotClass === 'spreadMiss') d.spreadMissShots--;
      else if (this.lastShotClass === 'aimMiss') d.aimMissShots--;
    } else {
      // Hit an enemy the shot was not aimed at (or aimed at none): still a shot at it.
      this.countShot(d, tick, e.shotId, this.lastShotMoving);
      this.setPos(d, this.lastShotX, this.lastShotZ);
    }
    d.hitShots++;
    if (d.firstShotId === e.shotId) {
      d.firstShotClass = 'hit';
      d.distanceM = e.distance;
      d.distanceFromShot = true;
      if (d.index !== this.lastShotDuel) d.firstShotAimErrDeg = NaN;
    }
    this.lastShotClass = 'hit';
  }

  private onKilled(e: Ev<'targetKilled'>, tick: number): void {
    // The kill ends the enemy's open duel; it is never the start of a new one, however long the sight was broken.
    const d = this.duelFor(e.targetId, tick);
    d.lastSightTick = tick;
    this.touchContact(d, tick);
    d.killedByPlayer = true;
    d.killTick = tick;
    this.endDuel(d, tick, 'killed');
    this.lastKillTick = tick; this.lastKillId = e.targetId;
    this.lastKillX = this.lastShotX; this.lastKillZ = this.lastShotZ;
    if (this.aimOnId === e.targetId) this.aimOnId = -1;
    if (this.aimShotId === e.targetId) this.aimShotId = -1;
    this.memberGone(d, tick, true);
  }

  private onExpired(id: number, tick: number): void {
    const d = this.activeDuel(id);
    if (d === null) return;
    this.endDuel(d, tick, 'expired');
    this.memberGone(d, tick, false);
  }

  /** An enemy left the contact (killed or expired): the contact is cleared when none is left. */
  private memberGone(d: Duel, tick: number, killed: boolean): void {
    const c = this.contacts[d.contact];
    if (c === undefined) return;
    if (killed) c.kills++;
    if (--c.alive <= 0 && this.cur === c.index) this.closeContact(c, tick, 'cleared');
  }

  // --- enemy-side events -------------------------------------------------------------------

  private onEnemySaw(id: number, tick: number, initiator: Initiator, contact: Expectation | 'unknown', inAttention: boolean | null): void {
    const d = this.sightInstant(id, tick);
    if (d.enemySawTick >= 0) return;
    d.enemySawTick = tick;
    d.enemyContact = contact;
    d.enemyInAttention = inAttention;
    if (d.enemyInfoTick < 0) { d.enemyInfoTick = tick; d.enemyChannel = 'sight'; }
    if (d.initiator === 'none') d.initiator = initiator;
    d.reloadingAtEnemySaw = this.reloadingUntil > tick;
    d.footstepsBefore = this.stepsSince(tick - this.stepTicks, tick);
  }

  private onPerceiverSaw(e: Ev<'perceiverSaw'>, tick: number): void {
    this.onEnemySaw(e.id, tick, 'none', e.contact, e.inAttention);
    const d = this.activeDuel(e.id);
    if (d !== null) { d.enemySees = true; this.setDistance(d, e.distance); }
  }

  private onPerceiverLost(id: number, tick: number): void {
    const d = this.activeDuel(id);
    if (d === null) return;
    d.enemySees = false;
    d.lastSightTick = tick;
    this.touchContact(d, tick);
  }

  /** The enemy learned of the player without seeing him (a sound, a callout): information, not sight. */
  private onEnemyInfo(id: number, tick: number, channel: EnemyChannel, distance: number): void {
    const d = this.duelFor(id, tick);
    if (d.enemyInfoTick < 0) { d.enemyInfoTick = tick; d.enemyChannel = channel; }
    this.setDistance(d, distance);
  }

  private onTell(e: Ev<'enemyTell'>, tick: number): void {
    const d = this.sightInstant(e.id, tick, true);
    if (d.tellTick < 0) { d.tellTick = tick; d.tellMs = e.durationMs; }
    if (d.enemyInfoTick < 0) { d.enemyInfoTick = tick; d.enemyChannel = 'sight'; }
  }

  private onEnemyFired(e: Ev<'enemyFired'>, tick: number): void {
    const d = this.sightInstant(e.id, tick, true);
    d.enemyShots++;
    if (e.hit) d.enemyHits++;
    if (d.enemyFirstShotTick < 0) d.enemyFirstShotTick = tick;
    if (d.enemyInfoTick < 0) { d.enemyInfoTick = tick; d.enemyChannel = 'fired'; }
    if (e.audibleToPlayer && d.playerInfoTick < 0) { d.playerInfoTick = tick; d.playerChannel = 'shot'; }
  }

  // --- damage ------------------------------------------------------------------------------

  /** The enemy the player's aim is on right now (the aim ray on it, or a shot aimed at it within `aimMemorySec`), or -1. */
  private aimedAt(tick: number): number {
    if (this.aimOnId >= 0) return this.aimOnId;
    if (this.aimShotId >= 0 && tick - this.aimShotTick <= this.aimMemoryTicks) return this.aimShotId;
    return -1;
  }

  private onDamaged(e: Ev<'playerDamaged'>, tick: number): void {
    const d = this.sightInstant(e.sourceId, tick, true);
    if (d.playerInfoTick < 0) { d.playerInfoTick = tick; d.playerChannel = 'damage'; }
    if (d.enemyInfoTick < 0) { d.enemyInfoTick = tick; d.enemyChannel = 'fired'; }
    this.hp = e.hp;
    this.setPos(d, e.x, e.z);
    const c = this.contacts[d.contact] ?? this.junkContact;
    const aimed = this.aimedAt(tick);
    const offTarget = aimed >= 0 && aimed !== e.sourceId;
    const reloading = this.reloadingUntil > tick;
    let trade = false;
    if (this.lastKillTick >= 0 && e.sourceId !== this.lastKillId && tick - this.lastKillTick <= this.tradeTicks) {
      const r = this.cfg.fightLedger.tradeRadiusM;
      const dx = e.x - this.lastKillX, dz = e.z - this.lastKillZ;
      trade = dx * dx + dz * dz <= r * r;
    }
    d.hpLost += e.amount; d.shieldAbsorbed += e.absorbed; d.damageCount++;
    if (e.exposedTo > d.maxExposed) d.maxExposed = e.exposedTo;
    if (offTarget) { d.offTargetDamage += e.amount; d.offTargetHits++; }
    if (d.firstDamageTick < 0) { d.firstDamageTick = tick; d.reloadingAtDamage = reloading; }
    if (trade) d.trade = true;
    c.hpLost += e.amount;
    if (e.exposedTo > c.maxExposed) c.maxExposed = e.exposedTo;
    this.setDistance(d, e.distance);

    if (this.damageCount >= this.damages.length) { this.overflow = true; return; }
    const m = this.damages[this.damageCount]!;
    m.reset();
    m.index = this.damageCount++;
    if (d.firstDamage < 0) d.firstDamage = m.index;
    c.damageCount++;
    m.tick = tick; m.contact = d.contact; m.duel = d.index; m.sourceId = e.sourceId;
    m.amount = e.amount; m.absorbed = e.absorbed; m.hp = e.hp; m.zone = e.zone; m.killed = e.killed;
    m.exposedTo = e.exposedTo; m.aimedId = aimed; m.offTarget = offTarget; m.trade = trade;
    m.x = e.x; m.z = e.z; m.distance = e.distance; m.reloading = reloading;
  }

  // --- the scenario card -------------------------------------------------------------------

  /** A settle names the card of the contact it ends: the open contact, else the one that just ended. */
  private onSettled(e: Ev<'contactSettled'>, tick: number): void {
    let c: Contact | null = null;
    if (this.cur >= 0) c = this.contacts[this.cur]!;
    else if (this.lastClosed >= 0 && tick - this.contacts[this.lastClosed]!.endTick <= this.cardLagTicks) c = this.contacts[this.lastClosed]!;
    if (c === null || c.contactId >= 0) return;
    c.contactId = e.contactId;
    c.settledOutcome = e.outcome;
    c.card = e.card ?? '';
  }
}

let shared: FightLedger | null = null;

/**
 * The fight ledger of a run: its contacts, the duels in them and each damage instance on its source's
 * duel. Pure and deterministic; **allocation-free after the first call**, because every call refills one
 * preallocated ledger (the module's own, or `out`). The result is therefore reused by the next call: read
 * it, or copy what you keep. Needs no tunables: `cfg` defaults to the config files.
 */
export function buildFights(log: RunLog, out?: FightLedger, cfg: FightLedgerConfig = defaultFightLedgerConfig): FightLedger {
  const l = out ?? (shared ??= new FightLedger());
  return l.build(log, cfg);
}
