import type { Vec3 } from '../core/vec3';

/**
 * The run-level event vocabulary (design §14.3), typed. Naming follows the architecture issue
 * (camelCase past-tense facts). Every payload carries `tick` (the sim tick it happened on); seconds
 * since the run went live are `t` where a payload has it, else `(tick - runStartedTick) * TICK_DT`.
 * Angles are radians (events), distances metres, durations in ms only where the design says `*Ms`.
 * Payloads are plain data, read-only, and valid only during the callback.
 *
 * Producers: the run lifecycle (`run*`: the run controller, or the mode runner, one at a time with
 * identical payloads; `modes/contracts.ts` `ModeEvents` declares the same three) and later systems
 * (enemies, player damage, surge, medals) for the rest, typed here so consumers can code against
 * them now. The sim's target and shot events live in `SimEvents`; chain/streak/skillTrial/score
 * events belong to the mode framework (`ModeEvents`, `feedback/streaks.ts`).
 */

/** `left`: the player walked out of a run's last exit alive (a Leave gate, design §4.9). */
export type RunEndReason = 'timer' | 'death' | 'complete' | 'quit' | 'left';

/**
 * Spray Wall's facts (design §4.5): one spray = one trial. They are logged (`feedback/eventLog.ts`)
 * so the spray trace is, like every stat, a pure function of the event log: the stat tracker cuts
 * the run's shots into sprays between `sprayStarted` and `sprayEnded`.
 */
export interface SprayEvents {
  /** The player stands at an alcove with a Post up: bullets from now on belong to this spray. */
  sprayStarted: {
    tick: number;
    t: number;
    /** 0-based spray number in the run. */
    index: number;
    /** The alcove's anchor id (`spray-12`), its distance in metres and the id of its wall panel box. */
    station: string;
    distanceM: number;
    panel: string;
    /** Bullets the spray asks for (3, 7 or the full magazine) and the share of them that must hit head or body. */
    burst: number;
    requiredFraction: number;
    postId: number;
  };
  /** The spray is over (the burst was fired, or the player reloaded early) and was judged. */
  sprayEnded: {
    tick: number;
    t: number;
    index: number;
    burst: number;
    /** Bullets fired in the spray, and how many of them hit the Post's head or body. */
    bullets: number;
    hits: number;
    headHits: number;
    bodyHits: number;
    requiredFraction: number;
    /** `hits / burst`: bullets never fired count as misses. */
    fraction: number;
    success: boolean;
    reason: 'burst' | 'reload';
  };
}

export type SweepSectorRole = 'take' | 'hold' | 'meet';

/**
 * Sweep's sector facts (design §4.2, §14.3), emitted by the Sweep mode (`modes/sweep.ts`) and logged. Payloads are
 * reused: copy what you keep.
 */
export interface SectorEvents {
  sectorEntered: {
    tick: number;
    t: number;
    sectorId: string;
    mapId: string;
    /** 0-based position in the run (design §4.1's rows: 0 is the Opener; a placing Opener's contact sectors are all 0). */
    index: number;
    /** One of a new profile's placing Opener's contact sectors (design §9.2, #203). */
    opener: boolean;
    /** Sectors in the run. */
    of: number;
    role: SweepSectorRole;
    /** Economy condition (design §4.6; v0: always `full`). */
    condition: 'full' | 'light' | 'eco' | 'cold';
    /** Door stake the sector was entered by (design §4.5; the opener's is `plain`). */
    stake: 'plain' | 'shield' | 'arms' | 'hot';
    /** Arms stake: the primary the door named (empty for any other stake). */
    arms: string;
    dial: number;
    /** Depth multiplier on every point earned in the sector (design §8.1). */
    depth: number;
    contacts: number;
    echoes: number;
  };
  /**
   * The player is in a gate and its two doors are drawn (design §4.5, #205). `index` is the 0-based
   * index of the sector the gate leads to. The doors' facts are in the run's state (`SweepState.gate`);
   * this is the moment the "Pick a door" hint (#202) fires.
   */
  gateEntered: { tick: number; t: number; index: number };
  /** The player walked through a door (design §14.3): the other closes. `heard` is the bucket the door showed. */
  gateChosen: {
    tick: number;
    t: number;
    /** 0-based index of the sector entered. */
    index: number;
    door: 0 | 1;
    stake: 'plain' | 'shield' | 'arms' | 'hot';
    role: SweepSectorRole;
    heard: 'quiet' | 'few' | 'several';
  };
  /** A hold sector's exit opened: every Echo of the sector is dead (design §4.2). A take sector's exit is always open and never announces it. */
  sectorExitOpened: {
    tick: number;
    t: number;
    sectorId: string;
    index: number;
  };
  sectorEnded: {
    tick: number;
    t: number;
    sectorId: string;
    index: number;
    /** Every Echo of the sector dead and the player alive. */
    cleared: boolean;
    /** Health+shield at the exit ÷ at the entry, capped at 1 (0 when the player died). */
    keptSector: number;
    /** Tempo bonus earned (design §4.3; #100). v0: always false. */
    tempo: boolean;
    /** Points earned in the sector, kills, settles and the clear, depth multiplier included. */
    points: number;
    /** The sector clear's part of `points`. */
    clearPoints: number;
    /** `exit`: the player walked out; `death`: the player died in it; `quit`: the run was stopped. */
    reason: 'exit' | 'death' | 'quit';
  };
}

export interface RunEvents extends SprayEvents, SectorEvents {
  runReady: { tick: number; mode: string; seed: number; dial: number };
  runStarted: { tick: number };
  runEnded: { tick: number; t: number; reason: RunEndReason };

  /** A shot absorbed by a Bulwark plate. */
  targetShielded: { tick: number; targetId: number };

  enemyTell: { tick: number; id: number; durationMs: number };
  /** An enemy fired. `audibleToPlayer`: the shot is within `attribution.soundRadiusM.shot` of the player (fight-attribution F1). */
  enemyFired: { tick: number; id: number; hit: boolean; dir: Vec3; audibleToPlayer: boolean };
  // `playerDamaged`, `playerSlowed`, `playerDied` and `playerHealed` live in `SimEvents` (sim/types.ts).

  surgeStarted: { tick: number };
  surgeEnded: { tick: number };
  medalAwarded: { tick: number; id: string };

  /**
   * One Sweep contact or Corner Clear angle ended (design §3 "Contact", §8.1, §14.3). `enemies` is how many
   * enemies the contact sent (the Untouched medal needs 3 or more); `kept` is the health kept, 1 = no damage.
   * Emitted by the mode that owns contacts (Corner Clear #50, Sweep #51); the medals engine reads it.
   */
  contactSettled: {
    tick: number;
    t: number;
    contactId: number;
    outcome: 'cleared' | 'disengaged' | 'avoided' | 'died';
    kept: number;
    enemies: number;
    points: number;
    /** The scenario card the contact was drawn from (Sweep, design §4.4); absent where contacts have no card. */
    card?: string;
    /** Skill trials the contact's facts produced up to its settle (Sweep, design §3.1); absent elsewhere. */
    trials?: number;
    /** The contact's item difficulty (its placement dial + its card's offset, design §9.1): a decided contact feeds the fight track at it (#203). */
    difficulty?: number;
    /**
     * Meet contacts (#212, design §4.2): which side first dropped to counter-strafe speed or below (the accuracy
     * deadzone, `sweep.meet.stopSpeedMps`) once the contact opened: the player, an Echo, both in the same tick, or
     * neither before it settled. Absent on every other card.
     */
    stopFirst?: 'player' | 'echo' | 'both' | 'neither';
  };

  /** A Leave gate banked the run (design §4.7, §14.3; Overtime and its gates arrive with #204, so nothing emits this yet): `points` includes the Overtime points that were at risk (design §4.7). */
  runBanked: { tick: number; t: number; points: number; overtimeSectors: number };
}

declare module '../core/gameEvents' {
  interface GameEvents extends RunEvents {}
}
