import type { Subscribable } from '../core/eventBus';
import { secondsToTicks, TICK_DT } from '../core/time';
import type { Tunables } from '../config/tunables';
import type { World } from '../sim/world';

/**
 * # Fight pace (#248, design §2.2)
 *
 * How many fights a minute a Sweep run gives and how long the player goes without one. One tracker
 * serves the game (`features/fightPace.ts`: overlay line, `__flickline.fightPace()`, the `state()`
 * section, so a playtest records the fight rate of a person's runs) and the bot report
 * (`npm run bot -- --sweep-report`), so they cannot disagree.
 *
 * - **Fights** are contacts fought: settled `cleared`, `died` or `disengaged` (an `avoided` contact
 *   never became a fight). **Fights per live minute** divides them by the run's live time, from
 *   `runStarted` to `runEnded`, gates included: the minutes the player spent in the run.
 * - **Duels** are Echo kills plus the player's death: the reference game's deathmatch unit (a kill or
 *   a death per fight), so the two can be compared where a contact holds two or three Echoes.
 * - **Dead air** is a stretch inside a sector (from `sectorEntered` to `sectorEnded`) with no Echo
 *   **seen** (an unoccluded line from the player's eye to its head or body, whatever the view
 *   direction: it is there to be seen), **heard** (an Echo running within footstep range, the
 *   speed and radius the game's enemy footsteps use, or an audible Echo shot, reload or landing) or
 *   **shooting** (an Echo shot that hit or was heard). Sight and running steps are sampled every
 *   `fightPace.sampleSec`; the events count at their tick. Gates are timed on their own.
 *
 * Pure: reads events and the world, never writes either. No allocation per tick or per event.
 */

/** The events the tracker reads (a subset of the game's, so the game bus feeds it directly). */
export interface FightPaceEvents {
  runStarted: { tick: number };
  runEnded: { tick: number; reason: string };
  sectorEntered: { tick: number };
  sectorEnded: { tick: number };
  gateEntered: { tick: number };
  contactSettled: { tick: number; outcome: 'cleared' | 'disengaged' | 'avoided' | 'died' };
  targetKilled: { tick: number };
  enemyFired: { tick: number; hit: boolean; audibleToPlayer: boolean };
  enemyFootstep: { tick: number; audibleToPlayer: boolean };
  enemyLanded: { tick: number; audibleToPlayer: boolean };
  enemyReloadStarted: { tick: number; audibleToPlayer: boolean };
  targetVisible: { tick: number };
  playerDamaged: { tick: number };
}

/** The numbers of one run (live while it runs, final once it ended). */
export interface FightPaceStats {
  /** Live seconds from `runStarted` to `runEnded` (or to now while live). */
  liveSec: number;
  /** Contacts fought (cleared, died, disengaged), and those avoided. */
  fights: number;
  avoided: number;
  /** Echoes killed, and 1 if the player died. */
  kills: number;
  deaths: number;
  /** Fights ÷ live minutes, and (kills + deaths) ÷ live minutes; 0 before the first live second. */
  fightsPerMin: number;
  duelsPerMin: number;
  /** Sectors entered, and the seconds spent inside them. */
  sectors: number;
  sectorSec: number;
  /** The longest dead air inside a sector (an open stretch counts while it runs), and the stretches longer than `fightPace.maxDeadAirSec`. */
  deadAirMaxSec: number;
  deadAirOver: number;
  /** Gates walked (entered, then left into a sector), their total and their longest, seconds. */
  gates: number;
  gateSec: number;
  gateMaxSec: number;
}

export function createFightPaceStats(): FightPaceStats {
  return {
    liveSec: 0, fights: 0, avoided: 0, kills: 0, deaths: 0, fightsPerMin: 0, duelsPerMin: 0,
    sectors: 0, sectorSec: 0, deadAirMaxSec: 0, deadAirOver: 0, gates: 0, gateSec: 0, gateMaxSec: 0,
  };
}

/** What the tracker reads of the world: the player, the targets and the level's boxes. */
export type FightPaceWorld = Pick<World, 'player' | 'targetField' | 'boxes' | 'tick'>;

export class FightPace {
  private running = false;
  private startTick = 0;
  private endTick = -1;
  private fights = 0;
  private avoided = 0;
  private kills = 0;
  private deaths = 0;
  private sectors = 0;
  private sectorTicks = 0;
  /** In a sector: the tick it began and the last tick something was seen, heard or shooting (-1: not in a sector). */
  private sectorStart = -1;
  private lastEngaged = 0;
  private deadAirMax = 0;
  private deadAirOver = 0;
  /** In a gate: the tick it began (-1: not in a gate). */
  private gateStart = -1;
  private gates = 0;
  private gateTicks = 0;
  private gateMax = 0;
  private nextSample = 0;
  private readonly sampleTicks: number;
  private readonly overTicks: number;
  private readonly offs: (() => void)[];

  constructor(
    bus: Subscribable<FightPaceEvents>,
    private readonly world: FightPaceWorld,
    private readonly tunables: Tunables,
  ) {
    this.sampleTicks = Math.max(1, secondsToTicks(tunables.fightPace.sampleSec));
    this.overTicks = secondsToTicks(tunables.fightPace.maxDeadAirSec);
    const heard = (e: { tick: number; audibleToPlayer: boolean }): void => {
      if (e.audibleToPlayer) this.engaged(e.tick);
    };
    const mark = (e: { tick: number }): void => this.engaged(e.tick);
    this.offs = [
      bus.on('runStarted', (e) => this.start(e.tick)),
      bus.on('runEnded', (e) => this.end(e.tick, e.reason === 'death')),
      bus.on('sectorEntered', (e) => this.enterSector(e.tick)),
      bus.on('sectorEnded', (e) => this.leaveSector(e.tick)),
      bus.on('gateEntered', (e) => {
        if (this.running) this.gateStart = e.tick;
      }),
      bus.on('contactSettled', (e) => {
        if (!this.running) return;
        if (e.outcome === 'avoided') this.avoided++;
        else this.fights++;
      }),
      bus.on('targetKilled', (e) => {
        if (!this.running) return;
        this.kills++;
        this.engaged(e.tick);
      }),
      bus.on('enemyFired', (e) => {
        if (e.hit || e.audibleToPlayer) this.engaged(e.tick);
      }),
      bus.on('enemyFootstep', heard),
      bus.on('enemyLanded', heard),
      bus.on('enemyReloadStarted', heard),
      bus.on('targetVisible', mark),
      bus.on('playerDamaged', mark),
    ];
  }

  /** Forget the run (a world reset). The next `runStarted` starts a new one. */
  reset(): void {
    this.running = false;
    this.startTick = 0;
    this.endTick = -1;
    this.fights = this.avoided = this.kills = this.deaths = 0;
    this.sectors = this.sectorTicks = 0;
    this.sectorStart = -1;
    this.lastEngaged = 0;
    this.deadAirMax = this.deadAirOver = 0;
    this.gateStart = -1;
    this.gates = this.gateTicks = this.gateMax = 0;
    this.nextSample = 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
  }

  /** Call after every sim tick of a run: samples sight and running Echoes every `fightPace.sampleSec` inside a sector. */
  tick(): void {
    if (!this.running || this.sectorStart < 0) return;
    const now = this.world.tick;
    if (now < this.nextSample) return;
    this.nextSample = now + this.sampleTicks;
    if (this.sample()) this.engaged(now);
  }

  /** The run's numbers into `out` (no allocation). While live, open stretches count up to the current tick. */
  read(out: FightPaceStats): FightPaceStats {
    const now = this.endTick >= 0 ? this.endTick : this.running ? this.world.tick : this.startTick;
    const live = Math.max(0, now - this.startTick) * TICK_DT;
    out.liveSec = live;
    out.fights = this.fights;
    out.avoided = this.avoided;
    out.kills = this.kills;
    out.deaths = this.deaths;
    out.fightsPerMin = live >= 1 ? this.fights / (live / 60) : 0;
    out.duelsPerMin = live >= 1 ? (this.kills + this.deaths) / (live / 60) : 0;
    out.sectors = this.sectors;
    const open = this.running && this.sectorStart >= 0;
    out.sectorSec = (this.sectorTicks + (open ? now - this.sectorStart : 0)) * TICK_DT;
    out.deadAirMaxSec = Math.max(this.deadAirMax, open ? now - this.lastEngaged : 0) * TICK_DT;
    out.deadAirOver = this.deadAirOver;
    out.gates = this.gates;
    out.gateSec = this.gateTicks * TICK_DT;
    out.gateMaxSec = this.gateMax * TICK_DT;
    return out;
  }

  private start(tick: number): void {
    this.reset();
    this.running = true;
    this.startTick = tick;
  }

  /** The run ended (`died`: at 0 HP; the death is read here, since the run can end before `playerDied` is heard). */
  private end(tick: number, died: boolean): void {
    if (!this.running) return;
    if (died) this.deaths = 1;
    this.leaveSector(tick);
    this.gateStart = -1;
    this.running = false;
    this.endTick = tick;
  }

  private enterSector(tick: number): void {
    if (!this.running) return;
    if (this.gateStart >= 0) {
      const g = tick - this.gateStart;
      this.gates++;
      this.gateTicks += g;
      if (g > this.gateMax) this.gateMax = g;
      this.gateStart = -1;
    }
    this.sectors++;
    this.sectorStart = tick;
    this.lastEngaged = tick;
    this.nextSample = tick;
  }

  private leaveSector(tick: number): void {
    if (!this.running || this.sectorStart < 0) return;
    this.closeGap(tick);
    this.sectorTicks += tick - this.sectorStart;
    this.sectorStart = -1;
  }

  /** Something was seen, heard or shooting at `tick`: the dead-air stretch before it closes. */
  private engaged(tick: number): void {
    if (!this.running || this.sectorStart < 0 || tick < this.lastEngaged) return;
    this.closeGap(tick);
    this.lastEngaged = tick;
  }

  private closeGap(tick: number): void {
    const gap = tick - this.lastEngaged;
    if (gap > this.deadAirMax) this.deadAirMax = gap;
    if (gap > this.overTicks) this.deadAirOver++;
  }

  /** Any living Echo in an open line from the eye, or running (its speed this tick) within footstep range. */
  private sample(): boolean {
    const p = this.world.player;
    const field = this.world.targetField;
    const boxes = this.world.boxes;
    const ex = p.pos.x, ey = p.pos.y + p.eyeHeight, ez = p.pos.z;
    const silentStep = this.tunables.audio.enemy.silentBelowMps * TICK_DT;
    const r = this.tunables.attribution.soundRadiusM.footstep;
    const slots = field.slots;
    for (let i = 0; i < slots.length; i++) {
      const t = slots[i]!;
      if (!t.alive) continue;
      const mx = t.pos.x - t.prevPos.x, mz = t.pos.z - t.prevPos.z;
      const dx = t.pos.x - ex, dz = t.pos.z - ez;
      if (mx * mx + mz * mz >= silentStep * silentStep && dx * dx + dz * dz <= r * r) return true;
      if (field.hasLineOfSightFrom(t, ex, ey, ez, boxes)) return true;
    }
    return false;
  }
}
