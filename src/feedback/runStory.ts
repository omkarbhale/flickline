import type { PlayerTunables } from '../config/player';

/**
 * # The run's story for the results card (design §8.2 sections 1-3)
 *
 * Pure. Folds the run's events into what the card tells at a glance: **the route** (one tile per
 * sector: role, condition, door stake, contacts won and lost, HP in and out, a gold mark for a
 * Flawless sector), **how deep** the run got, and **fights by situation** (the scenario cards the
 * player fought this run and how each ended). It is the one seam between the card and the run: it
 * reads facts off the event vocabulary of design §14.3 and nothing else, so the run director
 * (#201) and the card can change independently. Numbers are counted here once; the card renders
 * them and never recomputes (design §14.3 "nothing computes accuracy in the UI").
 *
 * Events read (payloads as in §14.3; extra fields are ignored, a missing optional field degrades the
 * tile instead of failing): `runReady`, `sectorEntered`, `sectorEnded`, `contactSettled` (+ its
 * `card`), `playerDamaged`, `playerHealed`, `shotFired`, `shotImpact`, `targetKilled`, `runBanked`,
. A run without sectors (a drill mode) yields an empty story and the card hides both rows.
 *
 * A **contact is won** when it ended `cleared`; **lost** when the player `died` in it or
 * `disengaged` (retreated after losing at least 30% of its starting health); `avoided` contacts
 * (left unhurt) are neither and only appear in the fights row's `played` count.
 */

export type ContactOutcome = 'cleared' | 'disengaged' | 'avoided' | 'died';

/** The payloads the story reads: the subset of design §14.3 it needs, typed structurally. */
export interface StoryEvents {
  runReady: { mode: string; seed: number; dial: number };
  sectorEntered: { sectorId: string; index: number; of?: number; role: string; condition?: string; stake?: string; dial?: number };
  sectorEnded: { sectorId: string; cleared: boolean; keptSector?: number; tempo?: boolean; points?: number; reason?: string };
  contactSettled: { contactId: number; outcome: ContactOutcome; kept: number; points: number; card?: string };
  playerDamaged: { hp: number; shield: number };
  playerHealed: { hp: number };
  shotFired: { moving: boolean };
  shotImpact: { result: 'hit' | 'miss' };
  targetKilled: { targetId?: number };
  runBanked: { points: number; overtimeSectors?: number };
}

export type StoryEventType = keyof StoryEvents;

/** Event types the story listens to (the feature subscribes to exactly these). */
export const STORY_EVENT_TYPES: readonly StoryEventType[] = [
  'runReady', 'sectorEntered', 'sectorEnded', 'contactSettled', 'playerDamaged', 'playerHealed',
  'shotFired', 'shotImpact', 'targetKilled', 'runBanked',
];
const READ = new Set<string>(STORY_EVENT_TYPES);

/** One tile of the route strip. */
export interface SectorTile {
  /** 1-based position in the run (the order sectors were entered). */
  number: number;
  sectorId: string;
  role: string;
  condition: string;
  stake: string;
  /** The sector was cleared (every Echo dead, player alive). */
  cleared: boolean;
  /** The sector ended (the player left or cleared it); false for the one the run ended in. */
  ended: boolean;
  /** The player died (or the run was stopped) in this sector: it has no exit, or its end said `death`. */
  fell: boolean;
  /** Contacts cleared / lost (died or disengaged) / avoided in this sector. */
  won: number;
  lost: number;
  avoided: number;
  kills: number;
  /** Health at the sector's entry and at its exit (or at the end of the run for the last tile). */
  hpIn: number;
  hpOut: number;
  /** No miss and no moving shot, with at least one shot fired (design §8.4 "Flawless"). */
  flawless: boolean;
  /** Beyond the route's last sector (Overtime, §4.7). */
  overtime: boolean;
  points: number;
}

/** One row of "fights by situation": a scenario card and how this run's contacts with it ended. */
export interface SituationRow {
  card: string;
  played: number;
  won: number;
  lost: number;
  avoided: number;
}

export interface RunStory {
  sectors: SectorTile[];
  situations: SituationRow[];
  /** Sectors in the run's route as the run director reported them (`sectorEntered.of`); null when it never did. */
  total: number | null;
  /** Overtime sectors entered (0 when the run never went past the route's last sector). */
  overtimeSectors: number;
  /** Points a Leave gate banked, from `runBanked`; null when none was reported. */
  banked: number | null;
  /** Total contacts won / lost over the whole run. */
  won: number;
  lost: number;
}

export interface RunStoryConfig {
  /** Sectors before Overtime (design §4.1: the Finale is sector 6). */
  routeSectors: number;
  /** Player health the run starts with, before any event says otherwise. */
  startHp: number;
  /** Cap on tiles (a long Overtime streak must not grow the strip without bound). */
  maxSectors: number;
}

export function storyConfigFrom(player: PlayerTunables, routeSectors: number, maxSectors: number): RunStoryConfig {
  return { routeSectors, startHp: player.health.max, maxSectors };
}

interface MutableTile extends SectorTile {
  shots: number;
  misses: number;
  movingShots: number;
}

/**
 * Accumulates the story while a run plays, or replays a recorded one: feed it every event through
 * `ingest`. Allocates per sector and per distinct card (a handful per run), never per tick.
 */
export class RunStoryTracker {
  private tiles: MutableTile[] = [];
  private cards = new Map<string, SituationRow>();
  private current: MutableTile | null = null;
  private hp: number;
  private banked: number | null = null;
  private total: number | null = null;
  private won = 0;
  private lost = 0;

  constructor(private readonly cfg: RunStoryConfig) {
    this.hp = cfg.startHp;
  }

  reset(): void {
    this.tiles = [];
    this.cards = new Map();
    this.current = null;
    this.hp = this.cfg.startHp;
    this.banked = null;
    this.total = null;
    this.won = 0;
    this.lost = 0;
  }

  /** Whether `type` is one the story reads (so a bus-wide listener can skip the rest cheaply). */
  static reads(type: string): type is StoryEventType {
    return READ.has(type);
  }

  ingest<K extends StoryEventType>(type: K, e: StoryEvents[K]): void {
    switch (type) {
      case 'runReady':
        this.reset();
        break;
      case 'sectorEntered':
        this.enter(e as StoryEvents['sectorEntered']);
        break;
      case 'sectorEnded':
        this.exit(e as StoryEvents['sectorEnded']);
        break;
      case 'contactSettled':
        this.settle(e as StoryEvents['contactSettled']);
        break;
      case 'playerDamaged':
        this.hp = (e as StoryEvents['playerDamaged']).hp;
        break;
      case 'playerHealed':
        this.hp = (e as StoryEvents['playerHealed']).hp;
        break;
      case 'shotFired':
        if (this.current) {
          this.current.shots++;
          if ((e as StoryEvents['shotFired']).moving) this.current.movingShots++;
        }
        break;
      case 'shotImpact':
        if (this.current && (e as StoryEvents['shotImpact']).result === 'miss') this.current.misses++;
        break;
      case 'targetKilled':
        if (this.current) this.current.kills++;
        break;
      case 'runBanked':
        this.banked = (e as StoryEvents['runBanked']).points;
        break;
    }
  }

  private enter(e: StoryEvents['sectorEntered']): void {
    if (e.of !== undefined && e.of > 0) this.total = e.of;
    // The previous sector's exit may not have been reported (the run director can chain entries):
    // close it at the HP the player walked out with.
    if (this.current && !this.current.ended) this.current.hpOut = this.hp;
    if (this.tiles.length >= this.cfg.maxSectors) {
      this.current = null;
      return;
    }
    const n = this.tiles.length + 1;
    const tile: MutableTile = {
      number: n,
      sectorId: e.sectorId,
      role: e.role,
      condition: e.condition ?? 'full',
      stake: e.stake ?? 'plain',
      cleared: false,
      ended: false,
      fell: false,
      won: 0,
      lost: 0,
      avoided: 0,
      kills: 0,
      hpIn: this.hp,
      hpOut: this.hp,
      flawless: false,
      overtime: n > this.cfg.routeSectors,
      points: 0,
      shots: 0,
      misses: 0,
      movingShots: 0,
    };
    this.tiles.push(tile);
    this.current = tile;
  }

  private exit(e: StoryEvents['sectorEnded']): void {
    const t = this.current;
    if (!t || t.sectorId !== e.sectorId) return;
    t.ended = true;
    t.fell = e.reason === 'death';
    t.cleared = e.cleared;
    t.hpOut = this.hp;
    t.points = e.points ?? 0;
  }

  private settle(e: StoryEvents['contactSettled']): void {
    const lost = e.outcome === 'died' || e.outcome === 'disengaged';
    const won = e.outcome === 'cleared';
    if (won) this.won++;
    if (lost) this.lost++;
    const t = this.current;
    if (t) {
      if (won) t.won++;
      else if (lost) t.lost++;
      else t.avoided++;
    }
    if (e.card !== undefined) {
      let row = this.cards.get(e.card);
      if (!row) {
        row = { card: e.card, played: 0, won: 0, lost: 0, avoided: 0 };
        this.cards.set(e.card, row);
      }
      row.played++;
      if (won) row.won++;
      else if (lost) row.lost++;
      else row.avoided++;
    }
  }

  /**
   * The story so far: plain data, safe to keep (copies the tiles). The sector the run ended in has no exit
   * event, so its HP out is the health the player has now.
   */
  snapshot(): RunStory {
    if (this.current && !this.current.ended) this.current.hpOut = this.hp;
    const sectors: SectorTile[] = this.tiles.map((t) => ({
      number: t.number,
      sectorId: t.sectorId,
      role: t.role,
      condition: t.condition,
      stake: t.stake,
      cleared: t.cleared,
      ended: t.ended,
      fell: t.fell || !t.ended,
      won: t.won,
      lost: t.lost,
      avoided: t.avoided,
      kills: t.kills,
      hpIn: t.hpIn,
      hpOut: t.hpOut,
      flawless: t.shots > 0 && t.misses === 0 && t.movingShots === 0,
      overtime: t.overtime,
      points: t.points,
    }));
    return {
      sectors,
      situations: Array.from(this.cards.values(), (r) => ({ ...r })),
      overtimeSectors: sectors.reduce((n, s) => n + (s.overtime ? 1 : 0), 0),
      banked: this.banked,
      total: this.total,
      won: this.won,
      lost: this.lost,
    };
  }
}
