import { axisValue } from '../adaptive/dial';
import type { DialTunables } from '../config/dial';
import type { EnemyKind, ScoringTunables } from '../config/scoring';
import type { PlayerTunables } from '../config/player';
import type { SweepTunables } from '../config/sweep';
import type { WeaponDef } from '../config/weapon';
import { Rng } from '../core/rng';
import { shieldAbsorbed, zoneDamage } from '../sim/damage';
import { createContactSettle, settleContact, type ContactOutcome } from './contactScore';
import { createScoreBreakdown, scoreKill } from './scoring';

/**
 * The settling experiment of #132: does the reward table pay "isolate and disengage" more than
 * "always swing"? Sweep, its director and enemy fire are not built yet, so this runs on a seeded
 * **contact model**, not on the game sim: event-driven duels with the dial's enemy axes (reaction,
 * tell, hit chance), the spec's Kestrel damage, heavy shields on both sides and Sweep's kill-heal.
 * Kill points and the contact settle come from the real scoring code (`scoreKill`,
 * `settleContact`), so a change to the table is measured here the moment it is made.
 *
 * Model assumptions (each one a simplification; see docs/research/survival-rewards.md):
 *  - Both sides see each other at the same instant and fire after a time-to-first-shot; shots then
 *    come at a burst cadence (`MODEL.burstHz`) and hit with a fixed per-shot chance (head share
 *    separately).
 *  - The player is *matched*: per dial, the player's edge over the enemy profile is solved so that
 *    an isolated 1v1 is won without damage at the mode's target success rate (design §4.7 trial
 *    success, §9: about 70%).
 *  - A crossfire contact splits its enemies over two angles. "Always swing" is exposed to both at
 *    once; "isolate" fights one angle, then slices to the next.
 *  - A disengage stops firing and breaks line of sight after `MODEL.breakSec`. In the 1,000
 *    independent contacts the survivors then leave; in Sweep runs they come back with the next
 *    contact (health and shield as they were), as Sweep's enemies push and re-peek.
 *  - No movement, no slow-on-hit, no reloads, no Surge (its fill rules are #40's); TTK is the same
 *    for every policy, so the speed term cannot separate them.
 */

/** How a scripted player fights. */
export interface PolicyDef {
  /** Fight a crossfire one angle at a time instead of swinging into both. */
  isolate: boolean;
  /** Disengage once this share of the contact's starting health+shield is lost while an enemy is up (Infinity: never). */
  disengageAtLost: number;
  /** ...and only if the duel is being lost: the enemy that just hit has more of its health+shield left than the player has of theirs. */
  onlyWhenLosing: boolean;
}

export const POLICIES = {
  /** Takes every fight at once, never leaves one. */
  swing: { isolate: false, disengageAtLost: Infinity, onlyWhenLosing: false },
  /** Isolates angles and leaves a fight it is losing. */
  isolate: { isolate: true, disengageAtLost: 0.35, onlyWhenLosing: true },
  /** Leaves at the first hit: the degenerate passive player the table must not reward. */
  backOff: { isolate: true, disengageAtLost: 0, onlyWhenLosing: false },
} as const satisfies Record<string, PolicyDef>;
export type PolicyId = keyof typeof POLICIES;

/** The model's own constants (not game tunables). */
export const MODEL = {
  distanceM: 15,
  /** Fire cadence while bursting, shots per second (taps and short bursts, both sides). */
  burstHz: 6,
  /** Log-normal spread of each time-to-first-shot. */
  timeJitter: 0.25,
  /** Player: time to move from one enemy to the next in the same angle (s), at dial 0 and 100. */
  switchSec: [0.45, 0.25] as const,
  /** Isolate: time to slice from a cleared angle to the next (s). */
  sliceSec: 0.6,
  /** Disengage: time still exposed after deciding to leave (s). */
  breakSec: 0.3,
  /** Head share of hits, dial 0 to 100 (player-like-enemies.md §2.10: 11–32% by tier). */
  headShare: [0.12, 0.3] as const,
  /** Contact size weights for 1, 2, 3, 4 enemies (design §4.8: one to four). */
  sizeWeights: [0.3, 0.35, 0.25, 0.1] as const,
  /** Share of 2+ enemy contacts that come from two angles at once. */
  crossfireShare: 0.4,
  /** Stagger between enemies arriving through the same angle (s). */
  staggerSec: [0.3, 1.5] as const,
  kinds: ['strafer', 'peeker', 'rusher', 'bulwark'] as const satisfies readonly EnemyKind[],
  /** Contacts per Sweep run when the player lives (5:00 at about one contact per 6 s). */
  contactsPerRun: 50,
};

export interface ModelTunables {
  scoring: ScoringTunables;
  dial: DialTunables;
  player: PlayerTunables;
  sweep: SweepTunables;
  weapon: WeaponDef;
}

/** One side's fighting numbers. */
interface Side {
  ttsSec: number;
  hit: number;
  head: number;
}

interface Profile {
  enemy: Side;
  player: Side;
  switchSec: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function gauss(r: Rng): number {
  return Math.sqrt(-2 * Math.log(1 - r.next())) * Math.cos(2 * Math.PI * r.next());
}

/** Enemy profile at `dial` from the design's axes; the player gets `edge` (faster and more accurate). */
function profile(dial: number, edge: number, cfg: ModelTunables): Profile {
  const a = cfg.dial.axes;
  const t = dial / 100;
  const ttsE = Math.max(cfg.dial.floors.enemyReactionSec, axisValue(a.enemyReactionSec, dial))
    + Math.max(cfg.dial.floors.tellSec, axisValue(a.tellSec, dial));
  const hitE = axisValue(a.enemyHitChance, dial);
  const head = lerp(MODEL.headShare[0], MODEL.headShare[1], t);
  return {
    enemy: { ttsSec: ttsE, hit: hitE, head },
    player: { ttsSec: ttsE * Math.exp(-edge), hit: Math.min(0.95, hitE * Math.exp(edge)), head },
    switchSec: lerp(MODEL.switchSec[0], MODEL.switchSec[1], t),
  };
}

interface Enemy {
  kind: EnemyKind;
  /** Came back from a contact the player left: keeps its health and shield. */
  carried: boolean;
  angle: number;
  delay: number;
  hp: number;
  shield: number;
  alive: boolean;
  visAt: number;
  nextShot: number;
  shotsAt: number;
  misses: number;
  firstShotAt: number;
}

interface Contact {
  enemies: Enemy[];
}

function makeContact(r: Rng): Contact {
  let u = r.next();
  let n = 1;
  for (let i = 0; i < MODEL.sizeWeights.length; i++) {
    u -= MODEL.sizeWeights[i]!;
    if (u < 0) {
      n = i + 1;
      break;
    }
  }
  const crossfire = n >= 2 && r.next() < MODEL.crossfireShare;
  const enemies: Enemy[] = [];
  const firstOfAngle = [0, crossfire ? r.range(0, 0.3) : 0];
  const lastDelay = [-1, -1];
  for (let i = 0; i < n; i++) {
    const angle = crossfire && i >= Math.ceil(n / 2) ? 1 : 0;
    const delay = lastDelay[angle]! < 0 ? firstOfAngle[angle]! : lastDelay[angle]! + r.range(MODEL.staggerSec[0], MODEL.staggerSec[1]);
    lastDelay[angle] = delay;
    enemies.push({
      kind: MODEL.kinds[r.int(MODEL.kinds.length)]!, angle, delay, carried: false,
      hp: 0, shield: 0, alive: true, visAt: Infinity, nextShot: Infinity, shotsAt: 0, misses: 0, firstShotAt: -1,
    });
  }
  return { enemies };
}

/** Player state carried between contacts of a run. */
export interface Vitals {
  hp: number;
  shield: number;
}

export interface ContactResult {
  outcome: ContactOutcome;
  kills: number;
  /** Kills made while another live enemy had the player in sight from a second angle. */
  crossfireKills: number;
  /** Kill points (design §8.1, unchanged by #132). */
  killPoints: number;
  /** The contact settle (#132). */
  settle: number;
  damageTaken: number;
}

/** A streak counter for the model: the clean streak before each kill, broken by any miss. */
interface Streak {
  clean: number;
}

/**
 * Fight one contact. Mutates `v` (health, shield, kill-heal) and `streak`. Deterministic for a
 * given `r` state.
 */
function fightContact(
  c: Contact, p: Profile, dial: number, pol: PolicyDef, v: Vitals, streak: Streak, r: Rng, cfg: ModelTunables,
): ContactResult {
  const sc = cfg.scoring;
  const absorb = cfg.player.shield.absorb;
  const enemyShield = cfg.player.shield.heavy;
  const shotGap = 1 / MODEL.burstHz;
  const startEhp = v.hp + v.shield;
  const enemyEhp = cfg.player.health.max + enemyShield;
  const exposeAt = [0, pol.isolate ? Infinity : 0];
  for (const e of c.enemies) {
    if (!e.carried) {
      e.hp = cfg.player.health.max;
      e.shield = enemyShield;
    }
    e.alive = true;
    e.visAt = exposeAt[e.angle]! + e.delay;
    e.nextShot = e.visAt + p.enemy.ttsSec * Math.exp(MODEL.timeJitter * gauss(r));
  }
  const res: ContactResult = { outcome: 'cleared', kills: 0, crossfireKills: 0, killPoints: 0, settle: 0, damageTaken: 0 };
  const breakdown = createScoreBreakdown();
  let target: Enemy | null = null;
  let playerShot = Infinity;
  let leaveAt = Infinity; // disengage: line of sight breaks at this time
  let now = 0;
  let died = false;

  const pickTarget = (readyAt: number, fresh: boolean): void => {
    target = null;
    for (const e of c.enemies) {
      if (e.alive && Number.isFinite(e.visAt) && (target === null || e.visAt < target.visAt)) target = e;
    }
    if (target === null) {
      playerShot = Infinity;
      return;
    }
    const t: Enemy = target;
    const tts = p.player.ttsSec * Math.exp(MODEL.timeJitter * gauss(r));
    playerShot = Math.max(t.visAt + tts, fresh ? 0 : readyAt + p.switchSec);
  };
  const lostShare = (): number => (startEhp - v.hp - v.shield) / startEhp;
  const anyAlive = (): boolean => c.enemies.some((e) => e.alive);
  const startLeaving = (): void => {
    if (leaveAt === Infinity) {
      leaveAt = now + MODEL.breakSec;
      playerShot = Infinity;
    }
  };

  pickTarget(0, true);
  for (let guard = 0; guard < 2000; guard++) {
    // Next event: the player's shot, an enemy's shot, or the end of a disengage.
    let next = playerShot;
    let shooter: Enemy | null = null;
    for (const e of c.enemies) {
      if (e.alive && e.nextShot < next) {
        next = e.nextShot;
        shooter = e;
      }
    }
    if (leaveAt <= next) {
      now = leaveAt;
      break;
    }
    if (!Number.isFinite(next)) break;
    now = next;
    if (shooter) {
      const s: Enemy = shooter;
      s.nextShot += shotGap;
      if (r.next() >= p.enemy.hit) continue;
      const dmg = zoneDamage(cfg.weapon.damageBands, r.next() < p.enemy.head ? 'head' : 'body', MODEL.distanceM);
      const abs = shieldAbsorbed(dmg, v.shield, absorb);
      res.damageTaken += abs + Math.min(v.hp, dmg - abs);
      v.shield -= abs;
      v.hp -= dmg - abs;
      if (v.hp <= 0) {
        v.hp = 0;
        died = true;
        break;
      }
      if (lostShare() >= pol.disengageAtLost
        && (!pol.onlyWhenLosing || (s.hp + s.shield) / enemyEhp > (v.hp + v.shield) / startEhp)) startLeaving();
      continue;
    }
    // The player's shot at `target`.
    const t = target as Enemy | null;
    if (!t) break;
    playerShot += shotGap;
    if (t.firstShotAt < 0) t.firstShotAt = now;
    t.shotsAt++;
    if (r.next() >= p.player.hit) {
      t.misses++;
      streak.clean = 0;
      continue;
    }
    const head = r.next() < p.player.head;
    const dmg = zoneDamage(cfg.weapon.damageBands, head ? 'head' : 'body', MODEL.distanceM);
    const abs = shieldAbsorbed(dmg, t.shield, absorb);
    t.shield -= abs;
    t.hp -= dmg - abs;
    if (t.hp > 0) continue;
    // Kill.
    t.alive = false;
    res.kills++;
    let isolated = true;
    for (const e of c.enemies) if (e.alive && e.angle !== t.angle && e.visAt <= now) isolated = false;
    if (!isolated) res.crossfireKills++;
    const k = scoreKill(breakdown, {
      kind: t.kind, headshot: head, firstBullet: t.shotsAt === 1, ttkMs: (now - t.firstShotAt) * 1000,
      parSec: sc.defaultParSec, cleanStreak: streak.clean, dial, surge: false,
    }, sc);
    res.killPoints += k.total;
    if (t.misses === 0) streak.clean++;
    v.hp = Math.min(cfg.player.health.max, v.hp + (head ? cfg.sweep.killHeal.head : cfg.sweep.killHeal.body));
    if (!anyAlive()) break;
    // Isolate: angle cleared, slice to the next one unless the fight is already being lost.
    if (pol.isolate && !c.enemies.some((e) => e.alive && e.angle === t.angle) && exposeAt[1] === Infinity) {
      if (lostShare() >= pol.disengageAtLost) break; // leave before showing yourself to the second angle
      exposeAt[1] = now + MODEL.sliceSec;
      for (const e of c.enemies) {
        if (e.angle !== 1) continue;
        e.visAt = exposeAt[1] + e.delay;
        e.nextShot = e.visAt + p.enemy.ttsSec * Math.exp(MODEL.timeJitter * gauss(r));
      }
    }
    pickTarget(now, false);
  }
  const allDead = !anyAlive();
  const settle = settleContact(createContactSettle(), {
    kinds: c.enemies.map((e) => e.kind), dial, startEhp, damageTaken: res.damageTaken, allDead, died,
  }, sc);
  res.outcome = settle.outcome;
  res.settle = settle.total;
  return res;
}

/**
 * The player's edge (log-scale) that wins an isolated 1v1 *without taking damage* at `targetWin` at
 * `dial`: the trial success of design §4.7 ("every Peeker killed and no damage taken"), which the dial
 * holds at the mode's target success rate.
 */
export function calibrateEdge(dial: number, targetWin: number, cfg: ModelTunables, duels = 800): number {
  let lo = -2;
  let hi = 3;
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    const p = profile(dial, mid, cfg);
    const r = new Rng(9001 + dial);
    let wins = 0;
    for (let i = 0; i < duels; i++) {
      const c: Contact = { enemies: [{
        kind: 'peeker', angle: 0, delay: 0, carried: false, hp: 0, shield: 0, alive: true, visAt: 0, nextShot: 0, shotsAt: 0, misses: 0, firstShotAt: -1,
      }] };
      const v: Vitals = { hp: cfg.player.health.max, shield: cfg.player.shield.heavy };
      const res = fightContact(c, p, dial, POLICIES.swing, v, { clean: 0 }, r, cfg);
      if (res.outcome === 'cleared' && res.damageTaken === 0) wins++;
    }
    if (wins / duels < targetWin) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface PolicyStats {
  /** Points per contact: kills only (today's table) and kills + settle (proposed). */
  perContactNow: number;
  perContactProposed: number;
  /** Points per Sweep run (health carried, death ends the run). */
  perRunNow: number;
  perRunProposed: number;
  winRate: number;
  deathRate: number;
  disengageRate: number;
  /** Share of kills made in a crossfire (no chain credit under #132). */
  crossfireKillShare: number;
  /** Mean contacts fought per run (the one that killed the player included). */
  contactsPerRun: number;
}

export interface DialRow {
  dial: number;
  edge: number;
  policies: Record<PolicyId, PolicyStats>;
}

/**
 * Run the experiment at one dial: `contacts` seeded contacts at full health per policy (the issue's
 * 1,000), then the same number of contacts as Sweep runs (health carried, kill-heal, death ends the
 * run). Every policy meets the same contacts in the same order (common random numbers).
 */
export function runDial(dial: number, cfg: ModelTunables, contacts = 1000, targetWin?: number): DialRow {
  const win = targetWin ?? cfg.dial.modes['sweep']?.targetSuccess ?? 0.7;
  const edge = calibrateEdge(dial, win, cfg);
  const p = profile(dial, edge, cfg);
  const policies = {} as Record<PolicyId, PolicyStats>;
  for (const id of Object.keys(POLICIES) as PolicyId[]) {
    const pol = POLICIES[id];
    const s: PolicyStats = {
      perContactNow: 0, perContactProposed: 0, perRunNow: 0, perRunProposed: 0, winRate: 0, deathRate: 0,
      disengageRate: 0, crossfireKillShare: 0, contactsPerRun: 0,
    };
    let kills = 0;
    let crossfire = 0;
    for (let i = 0; i < contacts; i++) {
      const c = makeContact(new Rng(100_000 * (dial + 1) + i));
      const v: Vitals = { hp: cfg.player.health.max, shield: cfg.player.shield.heavy };
      const res = fightContact(c, p, dial, pol, v, { clean: 0 }, new Rng(7_000_000 + 100_000 * dial + i), cfg);
      s.perContactNow += res.killPoints;
      s.perContactProposed += res.killPoints + res.settle;
      if (res.outcome === 'cleared') s.winRate++;
      if (res.outcome === 'died') s.deathRate++;
      if (res.outcome === 'disengaged') s.disengageRate++;
      kills += res.kills;
      crossfire += res.crossfireKills;
    }
    s.perContactNow /= contacts;
    s.perContactProposed /= contacts;
    s.winRate /= contacts;
    s.deathRate /= contacts;
    s.disengageRate /= contacts;
    s.crossfireKillShare = kills > 0 ? crossfire / kills : 0;
    // Sweep runs until `contacts` contacts have been fought (each run: up to contactsPerRun, death ends it).
    let runs = 0;
    for (let fought = 0; fought < contacts; runs++) {
      const v: Vitals = { hp: cfg.player.health.max, shield: cfg.player.shield.heavy };
      const streak: Streak = { clean: 0 };
      let carry: Enemy[] = [];
      const r = new Rng(50_000_000 + 10_000 * dial + runs);
      for (let i = 0; i < MODEL.contactsPerRun; i++) {
        const c = makeContact(new Rng(200_000_000 + 100_000 * (dial + 1) + runs * MODEL.contactsPerRun + i));
        // Enemies of a contact the player left come back with the next one, pushing through its first angle.
        for (const e of carry) {
          e.angle = 0;
          e.delay = 0;
          e.carried = true;
          e.shotsAt = e.misses = 0;
          e.firstShotAt = -1;
        }
        c.enemies.unshift(...carry);
        const res = fightContact(c, p, dial, pol, v, streak, r, cfg);
        carry = c.enemies.filter((e) => e.alive);
        s.perRunNow += res.killPoints;
        s.perRunProposed += res.killPoints + res.settle;
        s.contactsPerRun++;
        fought++;
        if (res.outcome === 'died') break;
      }
    }
    s.perRunNow /= runs;
    s.perRunProposed /= runs;
    s.contactsPerRun /= runs;
    policies[id] = s;
  }
  return { dial, edge, policies };
}
